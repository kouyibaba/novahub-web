#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NovaHub · 星隅 商业化数据层（纯标准库 SQLite，零外部依赖）。

负责用户账号鉴权（PBKDF2 + HMAC-SHA256 Token）、卡密生成与核销、
Pro 会员有效期计算、云端多端进度同步与动态广告位配置管理。
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("NOVAHUB_DB_PATH", os.path.join(ROOT, "novahub.db"))
_DB_LOCK = threading.Lock()

DEFAULT_SITE_CONFIG = {
    "ad_enabled": "1",
    "ad_title": "赞助支持 NovaHub · 星隅",
    "ad_desc": "纯净流式影视、无损黑胶与在线阅读体验 · 开通 Pro 会员享全局免广告与云端同步",
    "ad_url": "",
    "ad_btn": "了解 Pro",
    "sponsor_tip": "通过赞助或兑换卡密即可立即激活 NovaHub Pro 会员，支持多端云同步与无损音质。",
}


def _conn():
    """创建开启 WAL 模式的 SQLite 连接。"""
    c = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db():
    """初始化商业化核心表结构及默认站点配置。"""
    with _DB_LOCK, _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                pwd_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                vip_expire_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS redeem_codes (
                code TEXT PRIMARY KEY,
                days INTEGER NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                used_by INTEGER,
                used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_sync (
                user_id INTEGER PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS site_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        # 初始化持久化签名密钥与默认管理员密码（NovaAdmin888，支持环境变量或后台随时修改）
        row = c.execute("SELECT value FROM site_config WHERE key='jwt_secret'").fetchone()
        if not row:
            c.execute(
                "INSERT INTO site_config(key, value) VALUES('jwt_secret', ?)",
                (secrets.token_hex(32),),
            )
        adm = c.execute("SELECT value FROM site_config WHERE key='admin_pwd_hash'").fetchone()
        if not adm:
            init_pwd = os.environ.get("NOVAHUB_ADMIN_PWD", "NovaAdmin888")
            salt = secrets.token_hex(16)
            c.execute(
                "INSERT INTO site_config(key, value) VALUES('admin_pwd_hash', ?)",
                (f"{salt}${_hash_pwd(init_pwd, salt)}",),
            )
        for k, v in DEFAULT_SITE_CONFIG.items():
            c.execute(
                "INSERT OR IGNORE INTO site_config(key, value) VALUES(?, ?)",
                (k, v),
            )


def _get_secret():
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT value FROM site_config WHERE key='jwt_secret'").fetchone()
        return row["value"] if row else "novahub-fallback-secret"


def _hash_pwd(password, salt):
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return base64.b64encode(dk).decode("ascii")


def _sign_token(user_id, username, ttl_days=30):
    """签发轻量 HMAC-SHA256 Token（有效期默认 30 天）。"""
    payload = {
        "uid": int(user_id),
        "u": username,
        "exp": int(time.time()) + ttl_days * 86400,
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    p_b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(_get_secret().encode("utf-8"), p_b64.encode("ascii"), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"{p_b64}.{s_b64}"


def _format_user(row):
    """格式化用户公开字段并计算 Pro 会员有效状态。"""
    now = int(time.time())
    exp = int(row["vip_expire_at"] or 0)
    return {
        "id": row["id"],
        "username": row["username"],
        "vip_expire_at": exp,
        "is_pro": exp > now,
        "remain_days": max(0, (exp - now + 86399) // 86400) if exp > now else 0,
    }


def register_user(username, password):
    """注册新账号并返回用户信息与登录 Token。"""
    u = (username or "").strip()
    p = (password or "").strip()
    if len(u) < 3 or len(u) > 24:
        raise ValueError("账号长度需为 3~24 位字符")
    if len(p) < 6 or len(p) > 64:
        raise ValueError("密码长度需为 6~64 位")

    salt = secrets.token_hex(16)
    pwd_hash = _hash_pwd(p, salt)
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        try:
            cur = c.execute(
                "INSERT INTO users(username, pwd_hash, salt, vip_expire_at, created_at) VALUES(?, ?, ?, 0, ?)",
                (u, pwd_hash, salt, now),
            )
        except sqlite3.IntegrityError:
            raise ValueError("该账号已被注册")
        row = c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    user = _format_user(row)
    return user, _sign_token(user["id"], user["username"])


def login_user(username, password):
    """校验账号密码并返回用户信息与登录 Token。"""
    u = (username or "").strip()
    p = (password or "").strip()
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (u,)).fetchone()
    if not row or not hmac.compare_digest(row["pwd_hash"], _hash_pwd(p, row["salt"])):
        raise ValueError("账号或密码错误")
    user = _format_user(row)
    return user, _sign_token(user["id"], user["username"])


def verify_token(token):
    """校验 Bearer Token，返回最新用户状态字典，无效则返回 None。"""
    if not token or "." not in token:
        return None
    try:
        p_b64, s_b64 = token.split(".", 1)
        expected = hmac.new(_get_secret().encode("utf-8"), p_b64.encode("ascii"), hashlib.sha256).digest()
        exp_b64 = base64.urlsafe_b64encode(expected).decode("ascii").rstrip("=")
        if not hmac.compare_digest(s_b64, exp_b64):
            return None
        pad = "=" * ((4 - len(p_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(p_b64 + pad).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        uid = int(payload["uid"])
    except Exception:
        return None

    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _format_user(row) if row else None


def generate_codes(count, days, note=""):
    """批量生成 Pro 会员兑换卡密（格式：NH-XXXX-XXXX-XXXX）。"""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    now = int(time.time())
    codes = []
    with _DB_LOCK, _conn() as c:
        for _ in range(int(count)):
            while True:
                seg = lambda: "".join(secrets.choice(alphabet) for _ in range(4))
                code = f"NH-{seg()}-{seg()}-{seg()}"
                try:
                    c.execute(
                        "INSERT INTO redeem_codes(code, days, note, created_at) VALUES(?, ?, ?, ?)",
                        (code, int(days), str(note or ""), now),
                    )
                    codes.append(code)
                    break
                except sqlite3.IntegrityError:
                    continue
    return codes


def redeem_code(user_id, code_str):
    """核销兑换码并为用户叠加 Pro 会员天数（事务原子防重放）。"""
    code = (code_str or "").strip().upper()
    if not code:
        raise ValueError("请输入有效卡密")
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM redeem_codes WHERE code=?", (code,)).fetchone()
        if not row:
            raise ValueError("卡密不存在，请检查输入")
        if row["used_by"] is not None:
            raise ValueError("该卡密已被使用")
        u_row = c.execute("SELECT * FROM users WHERE id=?", (int(user_id),)).fetchone()
        if not u_row:
            raise ValueError("用户不存在")
        days = int(row["days"])
        base_ts = max(now, int(u_row["vip_expire_at"] or 0))
        new_exp = base_ts + days * 86400
        c.execute("UPDATE redeem_codes SET used_by=?, used_at=? WHERE code=?", (int(user_id), now, code))
        c.execute("UPDATE users SET vip_expire_at=? WHERE id=?", (new_exp, int(user_id)))
        u_new = c.execute("SELECT * FROM users WHERE id=?", (int(user_id),)).fetchone()
    return _format_user(u_new), days


def save_user_sync(user_id, payload_obj):
    """保存用户云端同步快照（限制 1MB 以内）。"""
    raw = json.dumps(payload_obj, ensure_ascii=False)
    if len(raw.encode("utf-8")) > 1024 * 1024:
        raise ValueError("同步数据体积超出限制")
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        c.execute(
            "INSERT INTO user_sync(user_id, payload, updated_at) VALUES(?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            (int(user_id), raw, now),
        )
    return now


def get_user_sync(user_id):
    """读取用户云端同步快照。"""
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT payload, updated_at FROM user_sync WHERE user_id=?", (int(user_id),)).fetchone()
    if not row:
        return None
    return {"data": json.loads(row["payload"]), "updated_at": row["updated_at"]}


def get_public_config():
    """读取对前端下发的公开商业配置（过滤内部密钥）。"""
    with _DB_LOCK, _conn() as c:
        rows = c.execute("SELECT key, value FROM site_config WHERE key != 'jwt_secret'").fetchall()
    cfg = dict(DEFAULT_SITE_CONFIG)
    for r in rows:
        cfg[r["key"]] = r["value"]
    return {
        "ad_enabled": cfg.get("ad_enabled") == "1",
        "ad_title": cfg.get("ad_title", ""),
        "ad_desc": cfg.get("ad_desc", ""),
        "ad_url": cfg.get("ad_url", ""),
        "ad_btn": cfg.get("ad_btn", "了解 Pro"),
        "sponsor_tip": cfg.get("sponsor_tip", ""),
    }


def set_site_config(key, value):
    """更新站点配置项（如动态开关广告或修改赞助文案）。"""
    if key in ("jwt_secret", "admin_pwd_hash"):
        raise ValueError("禁止直接修改内部安全字段")
    with _DB_LOCK, _conn() as c:
        c.execute(
            "INSERT INTO site_config(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(key), str(value)),
        )


def verify_admin_password(password):
    """校验站长后台密码。"""
    p = (password or "").strip()
    if not p:
        return False
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT value FROM site_config WHERE key='admin_pwd_hash'").fetchone()
    if not row or "$" not in row["value"]:
        return False
    salt, expected = row["value"].split("$", 1)
    return hmac.compare_digest(expected, _hash_pwd(p, salt))


def set_admin_password(old_password, new_password):
    """修改站长后台密码。"""
    if not verify_admin_password(old_password):
        raise ValueError("原管理员密码错误")
    np = (new_password or "").strip()
    if len(np) < 6 or len(np) > 64:
        raise ValueError("新密码长度需为 6~64 位")
    salt = secrets.token_hex(16)
    val = f"{salt}${_hash_pwd(np, salt)}"
    with _DB_LOCK, _conn() as c:
        c.execute(
            "INSERT INTO site_config(key, value) VALUES('admin_pwd_hash', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (val,),
        )


def sign_admin_token(ttl_days=7):
    """签发独立管理员 Token（与普通用户 Token 隔离）。"""
    payload = {"role": "admin", "exp": int(time.time()) + ttl_days * 86400}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    p_b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(_get_secret().encode("utf-8"), p_b64.encode("ascii"), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"{p_b64}.{s_b64}"


def verify_admin_token(token):
    """校验管理员 Bearer Token。"""
    if not token or "." not in token:
        return False
    try:
        p_b64, s_b64 = token.split(".", 1)
        expected = hmac.new(_get_secret().encode("utf-8"), p_b64.encode("ascii"), hashlib.sha256).digest()
        exp_b64 = base64.urlsafe_b64encode(expected).decode("ascii").rstrip("=")
        if not hmac.compare_digest(s_b64, exp_b64):
            return False
        pad = "=" * ((4 - len(p_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(p_b64 + pad).decode("utf-8"))
        return payload.get("role") == "admin" and int(payload.get("exp", 0)) >= int(time.time())
    except Exception:
        return False


def get_admin_dashboard(limit=80):
    """汇总站长后台统计指标、卡密台账与站点配置。"""
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        total_users = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        pro_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at > ?", (now,)).fetchone()[0]
        unused_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NULL").fetchone()[0]
        used_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NOT NULL").fetchone()[0]
        rows = c.execute(
            """
            SELECT rc.code, rc.days, rc.note, rc.used_at, rc.created_at, u.username AS used_by_name
            FROM redeem_codes rc
            LEFT JOIN users u ON rc.used_by = u.id
            ORDER BY rc.created_at DESC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
    codes = [
        {
            "code": r["code"],
            "days": r["days"],
            "note": r["note"],
            "used": r["used_at"] is not None,
            "used_by": r["used_by_name"] or "",
            "used_at": r["used_at"] or 0,
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    return {
        "stats": {
            "total_users": total_users,
            "pro_users": pro_users,
            "unused_codes": unused_codes,
            "used_codes": used_codes,
        },
        "codes": codes,
        "config": get_public_config(),
    }
