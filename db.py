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
import urllib.parse
import sync_state

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("NOVAHUB_DB_PATH", os.path.join(ROOT, "novahub.db"))
_DB_LOCK = threading.Lock()

DEFAULT_SITE_CONFIG = {
    "ad_enabled": "0",
    "ad_title": "",
    "ad_desc": "",
    "ad_url": "",
    "ad_btn": "了解 Pro",
    "ad_image": "",
    "ad_slots": "home,novel",
    "ad_provider": "manual",
    "sponsor_tip": "Pro 支持站内广告豁免、高码率音乐与会员标识；音质以曲源实际提供为准。账号云同步与系统听书向普通用户开放。",
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
        if not c.execute("SELECT 1 FROM site_config WHERE key='ad_schema_v2'").fetchone():
            title = c.execute("SELECT value FROM site_config WHERE key='ad_title'").fetchone()
            if title and title['value'] == '赞助支持 NovaHub · 星隅':
                c.execute("UPDATE site_config SET value='0' WHERE key='ad_enabled'")
            c.execute("INSERT INTO site_config VALUES('ad_schema_v2','1')")


def _get_secret():
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT value FROM site_config WHERE key='jwt_secret'").fetchone()
        return row["value"] if row else "novahub-fallback-secret"


def _hash_pwd(password, salt):
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return base64.b64encode(dk).decode("ascii")


def _sign_token(user_id, username, ttl_days=30, role=None, credential_version=None):
    """签发轻量 HMAC-SHA256 Token（有效期默认 30 天）。"""
    payload = {
        "uid": int(user_id),
        "u": username,
        "exp": int(time.time()) + ttl_days * 86400,
        "cv": _user_credential_version(user_id) if credential_version is None else credential_version,
    }
    if role:
        payload["role"] = role
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    p_b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(_get_secret().encode("utf-8"), p_b64.encode("ascii"), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"{p_b64}.{s_b64}"


def _credential_version(value):
    return hmac.new(_get_secret().encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def _user_credential_version(user_id):
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT pwd_hash, salt FROM users WHERE id=?", (int(user_id),)).fetchone()
    return _credential_version(row["salt"] + "$" + row["pwd_hash"]) if row else ""


def _admin_credential_version():
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT value FROM site_config WHERE key='admin_pwd_hash'").fetchone()
    return _credential_version(row["value"]) if row else ""


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
    return user, _sign_token(user["id"], user["username"],
                             credential_version=_credential_version(row["salt"] + "$" + row["pwd_hash"]))


def login_user(username, password):
    """校验账号密码并返回用户信息与登录 Token。"""
    u = (username or "").strip()
    p = (password or "").strip()
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (u,)).fetchone()
    if not row or not hmac.compare_digest(row["pwd_hash"], _hash_pwd(p, row["salt"])):
        raise ValueError("账号或密码错误")
    user = _format_user(row)
    return user, _sign_token(user["id"], user["username"],
                             credential_version=_credential_version(row["salt"] + "$" + row["pwd_hash"]))


def verify_token(token, role=None):
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
        if int(payload.get("exp", 0)) <= int(time.time()):
            return None
        uid = int(payload["uid"])
    except Exception:
        return None

    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row or payload.get("role") != role or not hmac.compare_digest(
        str(payload.get("cv", "")), _credential_version(row["salt"] + "$" + row["pwd_hash"])
    ):
        return None
    return _format_user(row)


def refresh_user_session(token):
    """Renew an active session near expiry without resurrecting revoked credentials."""
    user = verify_token(token)
    if not user:
        raise ValueError("登录已失效，请重新登录")
    encoded = token.split(".", 1)[0]
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    if int(payload["exp"]) - int(time.time()) <= 7 * 86400:
        # Carry the validated credential version: a concurrent password reset
        # must also revoke the token produced by this refresh.
        token = _sign_token(user["id"], user["username"], credential_version=payload["cv"])
    return user, token


def sign_media_ticket(token):
    """Six-hour read-only media ticket for native video/HLS requests."""
    user = verify_token(token)
    if not user:
        raise ValueError("请先重新登录账号")
    encoded = token.split(".", 1)[0]
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    return _sign_token(user["id"], user["username"], ttl_days=0.25, role="media",
                       credential_version=payload["cv"])


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
        row = c.execute('SELECT payload FROM user_sync WHERE user_id=?', (int(user_id),)).fetchone()
        merged = sync_state.merge(json.loads(row['payload']) if row else {}, payload_obj)
        raw = json.dumps(merged, ensure_ascii=False)
        if len(raw.encode('utf-8')) > 1024 * 1024: raise ValueError('合并后同步数据体积超出限制')
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
    return {"data": sync_state.merge({}, json.loads(row["payload"])), "updated_at": row["updated_at"]}


def get_legacy_sources(user_id):
    """Internal migration input only; never emit old API URLs in sync responses."""
    with _DB_LOCK, _conn() as c:
        row = c.execute('SELECT payload FROM user_sync WHERE user_id=?', (int(user_id),)).fetchone()
    data = json.loads(row['payload']) if row else {}
    return data.get('source') if isinstance(data, dict) else None


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
        "ad_image": cfg.get("ad_image", ""),
        "ad_slots": [x for x in cfg.get("ad_slots", "home,novel").split(',') if x in ('home','novel')],
        "ad_provider": cfg.get("ad_provider", "manual"),
        "sponsor_tip": cfg.get("sponsor_tip", ""),
    }


def configure_site(body):
    if not isinstance(body, dict): raise ValueError('配置必须为对象')
    values = {}
    for key in DEFAULT_SITE_CONFIG:
        if key not in body: continue
        value = body[key]
        if key == 'ad_enabled':
            if not isinstance(value, bool): raise ValueError('广告开关必须为布尔值')
            value = '1' if value else '0'
        else: value = str(value or '').strip()
        if len(value) > (2048 if key in ('ad_url','ad_image') else 500): raise ValueError('配置过长')
        if key in ('ad_url','ad_image') and value:
            try: p = urllib.parse.urlsplit(value)
            except ValueError: raise ValueError('广告链接无效')
            if p.scheme != 'https' or not p.hostname or p.username or p.password or any(ord(ch)<=32 for ch in value) or '\\' in value:
                raise ValueError('广告链接和图片必须为 HTTPS 地址')
        if key == 'ad_provider' and value not in ('manual','reserved'): raise ValueError('暂不支持该广告供应商')
        if key == 'ad_slots':
            slots = list(dict.fromkeys(value.split(',')))
            if not slots or any(x not in ('home','novel') for x in slots): raise ValueError('请选择有效广告位置')
            value = ','.join(slots)
        values[key] = value
    with _DB_LOCK, _conn() as c:
        c.executemany('INSERT INTO site_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', values.items())
    return get_public_config()


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


def login_admin(password):
    """Bind the issued session to the exact password snapshot that was checked."""
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT value FROM site_config WHERE key='admin_pwd_hash'").fetchone()
    if not row or "$" not in row["value"]:
        raise ValueError("管理员密码错误")
    salt, expected = row["value"].split("$", 1)
    if not hmac.compare_digest(expected, _hash_pwd((password or "").strip(), salt)):
        raise ValueError("管理员密码错误")
    return sign_admin_token(credential_version=_credential_version(row["value"]))


def sign_admin_token(ttl_days=7, credential_version=None):
    """签发独立管理员 Token（与普通用户 Token 隔离）。"""
    payload = {"role": "admin", "exp": int(time.time()) + ttl_days * 86400,
               "cv": _admin_credential_version() if credential_version is None else credential_version}
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
        return (payload.get("role") == "admin"
                and int(payload.get("exp", 0)) > int(time.time())
                and hmac.compare_digest(str(payload.get("cv", "")), _admin_credential_version()))
    except Exception:
        return False


def get_admin_dashboard(limit=200):
    """汇总站长后台统计指标、卡密台账、近期注册用户与站点配置。"""
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        total_users = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        pro_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at > ?", (now,)).fetchone()[0]
        unused_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NULL").fetchone()[0]
        used_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NOT NULL").fetchone()[0]
        synced_users = c.execute("SELECT COUNT(*) FROM user_sync").fetchone()[0]
        recent_rows = c.execute(
            "SELECT id, username, vip_expire_at, created_at FROM users ORDER BY created_at DESC LIMIT 6"
        ).fetchall()
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
    db_size_bytes = 0
    for suffix in ("", "-wal"):
        p = DB_PATH + suffix
        if os.path.exists(p):
            try:
                db_size_bytes += os.path.getsize(p)
            except OSError:
                pass
    recent_users = []
    for ur in recent_rows:
        fmt_u = _format_user(ur)
        fmt_u["created_at"] = ur["created_at"]
        recent_users.append(fmt_u)
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
            "synced_users": synced_users,
            "db_size_bytes": db_size_bytes,
        },
        "recent_users": recent_users,
        "codes": codes,
        "config": get_public_config(),
    }


def list_admin_users(query="", status="all", limit=200):
    """分页检索平台注册用户列表及其 Pro 状态与云端同步时间。"""
    now = int(time.time())
    q = (query or "").strip()
    where = []
    params = []
    if q:
        where.append("u.username LIKE ?")
        params.append(f"%{q}%")
    if status == "pro":
        where.append("u.vip_expire_at > ?")
        params.append(now)
    elif status == "free":
        where.append("u.vip_expire_at <= ?")
        params.append(now)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(max(1, min(500, int(limit))))
    sql = f"""
        SELECT u.id, u.username, u.vip_expire_at, u.created_at, us.updated_at AS last_sync_at
        FROM users u
        LEFT JOIN user_sync us ON u.id = us.user_id
        {where_sql}
        ORDER BY u.created_at DESC
        LIMIT ?
    """
    with _DB_LOCK, _conn() as c:
        rows = c.execute(sql, params).fetchall()
    result = []
    for r in rows:
        item = _format_user(r)
        item["created_at"] = r["created_at"]
        item["last_sync_at"] = r["last_sync_at"] or 0
        result.append(item)
    return result


def admin_set_user_vip(user_id, action, days=0):
    """管理员手工赠送/续期或取消指定用户的 Pro 会员资格。"""
    uid = int(user_id)
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        if action == "add":
            d = int(days)
            if d < 1 or d > 36500:
                raise ValueError("天数范围需在 1 ~ 36500 之间")
            base_ts = max(now, int(row["vip_expire_at"] or 0))
            new_exp = base_ts + d * 86400
        elif action == "clear":
            new_exp = 0
        else:
            raise ValueError("不支持的操作类型")
        c.execute("UPDATE users SET vip_expire_at=? WHERE id=?", (new_exp, uid))
        updated = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _format_user(updated)


def admin_reset_user_password(user_id, new_password):
    """管理员重置指定用户登录密码（PBKDF2-SHA256 加盐哈希）。"""
    uid = int(user_id)
    np = (new_password or "").strip()
    if len(np) < 6 or len(np) > 64:
        raise ValueError("新密码长度需为 6~64 位")
    salt = secrets.token_hex(16)
    pwd_hash = _hash_pwd(np, salt)
    with _DB_LOCK, _conn() as c:
        cur = c.execute("UPDATE users SET pwd_hash=?, salt=? WHERE id=?", (pwd_hash, salt, uid))
        if cur.rowcount == 0:
            raise ValueError("用户不存在")


def delete_unused_code(code_str):
    """事务作废并删除尚未核销的卡密。"""
    code = (code_str or "").strip().upper()
    if not code:
        raise ValueError("请指定卡密")
    with _DB_LOCK, _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT used_by FROM redeem_codes WHERE code=?", (code,)).fetchone()
        if not row:
            raise ValueError("卡密不存在")
        if row["used_by"] is not None:
            raise ValueError("已核销的卡密不可删除")
        c.execute("DELETE FROM redeem_codes WHERE code=?", (code,))
