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
import re
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
    "access_gate_enabled": "1",
    "trial_days": "3",
    "trial_max_per_ip_day": "2",
    "redeem_guide_tip": "请联系站长获取兑换卡密，或在下方活动入口领取体验码。输入卡密后立即解锁全部影视、无损音乐与小说功能。",
    "redeem_buy_url": "",
    "redeem_qr_image": "",
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
            CREATE TABLE IF NOT EXISTS user_presence (
                user_id INTEGER NOT NULL,
                device_id TEXT NOT NULL,
                client_type TEXT NOT NULL DEFAULT 'web',
                device_info TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                logged_in INTEGER NOT NULL DEFAULT 1,
                last_seen_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, device_id)
            );
            CREATE INDEX IF NOT EXISTS idx_user_presence_seen ON user_presence(last_seen_at);
            CREATE TABLE IF NOT EXISTS user_watch_items (
                user_id INTEGER NOT NULL,
                item_type TEXT NOT NULL,
                item_key TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                meta_json TEXT NOT NULL DEFAULT '{}',
                last_count INTEGER NOT NULL DEFAULT 0,
                last_marker TEXT NOT NULL DEFAULT '',
                notify_enabled INTEGER NOT NULL DEFAULT 1,
                last_checked_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, item_type, item_key)
            );
            CREATE TABLE IF NOT EXISTS user_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                item_type TEXT NOT NULL,
                item_key TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                delta_count INTEGER NOT NULL DEFAULT 1,
                read_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id, read_at, created_at);
            CREATE TABLE IF NOT EXISTS trial_grants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                device_id TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                days INTEGER NOT NULL DEFAULT 3,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_trial_grants_dev ON trial_grants(device_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_trial_grants_ip ON trial_grants(ip, created_at);
            CREATE TABLE IF NOT EXISTS admin_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_type TEXT NOT NULL DEFAULT 'notice',
                display_mode TEXT NOT NULL DEFAULT 'inbox',
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT NOT NULL DEFAULT '',
                action_type TEXT NOT NULL DEFAULT 'none',
                action_label TEXT NOT NULL DEFAULT '',
                action_value TEXT NOT NULL DEFAULT '',
                audience TEXT NOT NULL DEFAULT 'all',
                target_usernames TEXT NOT NULL DEFAULT '',
                show_on_guest INTEGER NOT NULL DEFAULT 0,
                include_new_users INTEGER NOT NULL DEFAULT 1,
                expire_at INTEGER NOT NULL DEFAULT 0,
                revoked_at INTEGER NOT NULL DEFAULT 0,
                sent_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_admin_msg_active ON admin_messages(revoked_at, expire_at, created_at);
            CREATE TABLE IF NOT EXISTS admin_message_images (
                id TEXT PRIMARY KEY,
                mime TEXT NOT NULL,
                data BLOB NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            """
        )
        am_cols = {r["name"] for r in c.execute("PRAGMA table_info(admin_messages)").fetchall()}
        if "image_url" not in am_cols:
            c.execute("ALTER TABLE admin_messages ADD COLUMN image_url TEXT NOT NULL DEFAULT ''")
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)").fetchall()}
        if "trial_expire_at" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN trial_expire_at INTEGER NOT NULL DEFAULT 0")
        if "trial_source" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN trial_source TEXT NOT NULL DEFAULT ''")
        if "access_exempt" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN access_exempt INTEGER NOT NULL DEFAULT 0")
        if not c.execute("SELECT 1 FROM site_config WHERE key='trial_schema_v1'").fetchone():
            # 存量老用户全部自动豁免，确保平滑过渡，仅对新注册账号启用体验倒计时与强门禁
            c.execute("UPDATE users SET access_exempt=1, trial_source='legacy_exempt' WHERE access_exempt=0")
            c.execute("INSERT INTO site_config(key, value) VALUES('trial_schema_v1', '1')")
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


def _get_gate_settings(conn=None):
    """读取强门禁开关、默认体验天数与同 IP 日限额配置。"""
    def _read(c):
        rows = c.execute(
            "SELECT key, value FROM site_config WHERE key IN ('access_gate_enabled', 'trial_days', 'trial_max_per_ip_day')"
        ).fetchall()
        m = {r["key"]: r["value"] for r in rows}
        gate_on = m.get("access_gate_enabled", DEFAULT_SITE_CONFIG["access_gate_enabled"]) == "1"
        try:
            t_days = max(0, min(30, int(m.get("trial_days", DEFAULT_SITE_CONFIG["trial_days"]))))
        except ValueError:
            t_days = 3
        try:
            max_ip = max(1, min(50, int(m.get("trial_max_per_ip_day", DEFAULT_SITE_CONFIG["trial_max_per_ip_day"]))))
        except ValueError:
            max_ip = 2
        return gate_on, t_days, max_ip

    if conn is not None:
        return _read(conn)
    with _DB_LOCK, _conn() as c:
        return _read(c)


def _format_user(row, gate_enabled=None):
    """格式化用户公开字段，统一计算卡密正式态 / 体验态 / 豁免态 / 到期锁定态。"""
    now = int(time.time())
    keys = row.keys() if hasattr(row, "keys") else ()
    exp = int(row["vip_expire_at"] or 0)
    trial_exp = int(row["trial_expire_at"] or 0) if "trial_expire_at" in keys else 0
    trial_src = str(row["trial_source"] or "") if "trial_source" in keys else ""
    exempt = bool(row["access_exempt"]) if "access_exempt" in keys else False
    if gate_enabled is None:
        gate_enabled, _, _ = _get_gate_settings()

    if exp > now:
        status = "active"
    elif exempt:
        status = "exempt"
    elif trial_exp > now:
        status = "trial"
    else:
        status = "expired"

    access_exp = max(exp, trial_exp)
    remain_sec = max(0, access_exp - now) if access_exp > now else 0
    return {
        "id": row["id"],
        "username": row["username"],
        "vip_expire_at": exp,
        "is_pro": exp > now,
        "remain_days": max(0, (exp - now + 86399) // 86400) if exp > now else 0,
        "trial_expire_at": trial_exp,
        "trial_source": trial_src,
        "trial_remain_days": max(0, (trial_exp - now + 86399) // 86400) if trial_exp > now else 0,
        "access_exempt": exempt,
        "access_expire_at": access_exp,
        "access_remain_sec": remain_sec,
        "access_status": status,
        "has_access": (not gate_enabled) or (status != "expired"),
    }


def register_user(username, password, device_id="", ip=""):
    """注册新账号；满足设备与 IP 防刷校验时自动授予新用户免费体验期。"""
    u = (username or "").strip()
    p = (password or "").strip()
    if len(u) < 3 or len(u) > 24:
        raise ValueError("账号长度需为 3~24 位字符")
    if len(p) < 6 or len(p) > 64:
        raise ValueError("密码长度需为 6~64 位")

    dev = str(device_id or "")[:80].strip()
    cip = str(ip or "")[:64].strip()
    salt = secrets.token_hex(16)
    pwd_hash = _hash_pwd(p, salt)
    now = int(time.time())
    trial_granted = False
    trial_notice = ""

    with _DB_LOCK, _conn() as c:
        gate_enabled, t_days, max_ip = _get_gate_settings(c)
        trial_exp = 0
        trial_src = ""
        if t_days > 0:
            dup_dev = False
            if len(dev) >= 6:
                dup_dev = bool(c.execute("SELECT 1 FROM trial_grants WHERE device_id=? LIMIT 1", (dev,)).fetchone())
            ip_exceeded = False
            if not dup_dev and cip:
                cnt_ip = c.execute(
                    "SELECT COUNT(*) FROM trial_grants WHERE ip=? AND created_at>=?",
                    (cip, now - 86400),
                ).fetchone()[0]
                if cnt_ip >= max_ip:
                    ip_exceeded = True
            if dup_dev:
                trial_src = "denied_dup_device"
                trial_notice = "当前设备已领取过新用户免费体验，请直接兑换卡密解锁"
            elif ip_exceeded:
                trial_src = "denied_ip_limit"
                trial_notice = "当前网络今日体验名额已满，请直接兑换卡密解锁"
            else:
                trial_exp = now + t_days * 86400
                trial_src = "register"
                trial_granted = True
                trial_notice = f"已赠送 {t_days} 天全功能免费体验"

        try:
            cur = c.execute(
                "INSERT INTO users(username, pwd_hash, salt, vip_expire_at, trial_expire_at, trial_source, access_exempt, created_at) "
                "VALUES(?, ?, ?, 0, ?, ?, 0, ?)",
                (u, pwd_hash, salt, trial_exp, trial_src, now),
            )
        except sqlite3.IntegrityError:
            raise ValueError("该账号已被注册")
        uid = cur.lastrowid
        if trial_granted:
            c.execute(
                "INSERT INTO trial_grants(user_id, device_id, ip, days, created_at) VALUES(?, ?, ?, ?, ?)",
                (uid, dev, cip, t_days, now),
            )
        deliver_active_broadcasts_to_user(uid, conn=c)
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    user = _format_user(row, gate_enabled=gate_enabled)
    user["trial_granted"] = trial_granted
    user["trial_notice"] = trial_notice
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
        trial_exp = int(u_row["trial_expire_at"] or 0) if "trial_expire_at" in u_row.keys() else 0
        base_ts = max(now, int(u_row["vip_expire_at"] or 0), trial_exp)
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
    sync_watch_items_from_payload(user_id, merged)
    return now


def sync_watch_items_from_payload(user_id, payload):
    """根据用户同步快照中的影视收藏与书架，增量维护更新提醒订阅表。"""
    if not isinstance(payload, dict):
        return
    uid = int(user_id)
    now = int(time.time())
    buckets = []
    if isinstance(payload.get("like"), list):
        vod_items = {}
        for x in payload["like"][:200]:
            if not isinstance(x, dict):
                continue
            sid = str(x.get("srcId") or "").strip()
            vid = str(x.get("id") or "").strip()
            if not sid or not vid:
                continue
            key = f"{sid}:{vid}"[:220]
            vod_items[key] = (
                str(x.get("name") or "收藏影片")[:120],
                json.dumps({"srcId": sid, "id": vid, "name": x.get("name") or "", "pic": x.get("pic") or "", "remark": x.get("remark") or ""}, ensure_ascii=False)[:2048],
            )
        buckets.append(("vod", vod_items))
    if isinstance(payload.get("novel_shelf"), list):
        novel_items = {}
        for b in payload["novel_shelf"][:200]:
            if not isinstance(b, dict):
                continue
            bid = str(b.get("book_id") or "").strip()
            if not bid:
                continue
            novel_items[bid[:80]] = (
                str(b.get("title") or "书架小说")[:120],
                json.dumps({"book_id": bid, "title": b.get("title") or "", "author": b.get("author") or "", "cover": b.get("cover") or ""}, ensure_ascii=False)[:2048],
            )
        buckets.append(("novel", novel_items))
    if not buckets:
        return
    with _DB_LOCK, _conn() as c:
        for item_type, item_map in buckets:
            for item_key, (title, meta_json) in item_map.items():
                c.execute(
                    """
                    INSERT INTO user_watch_items(user_id, item_type, item_key, title, meta_json, updated_at)
                    VALUES(?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, item_type, item_key) DO UPDATE SET
                        title=excluded.title,
                        meta_json=excluded.meta_json,
                        updated_at=excluded.updated_at
                    """,
                    (uid, item_type, item_key, title, meta_json, now),
                )
            existing = [
                r["item_key"]
                for r in c.execute("SELECT item_key FROM user_watch_items WHERE user_id=? AND item_type=?", (uid, item_type)).fetchall()
            ]
            for old_key in existing:
                if old_key not in item_map:
                    c.execute("DELETE FROM user_watch_items WHERE user_id=? AND item_type=? AND item_key=?", (uid, item_type, old_key))


def set_watch_notify(user_id, item_type, item_key, enabled, title="", meta=None):
    """设置单部影视剧或单本小说的更新提醒开关。"""
    if item_type not in ("vod", "novel"):
        raise ValueError("不支持的关注类型")
    key = str(item_key or "").strip()[:220]
    if not key:
        raise ValueError("缺少作品标识")
    uid = int(user_id)
    now = int(time.time())
    meta_json = json.dumps(meta, ensure_ascii=False)[:2048] if isinstance(meta, dict) else "{}"
    safe_title = str(title or "")[:120]
    with _DB_LOCK, _conn() as c:
        c.execute(
            """
            INSERT INTO user_watch_items(user_id, item_type, item_key, title, meta_json, notify_enabled, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, item_type, item_key) DO UPDATE SET
                notify_enabled=excluded.notify_enabled,
                title=CASE WHEN excluded.title != '' THEN excluded.title ELSE user_watch_items.title END,
                updated_at=excluded.updated_at
            """,
            (uid, item_type, key, safe_title, meta_json, 1 if enabled else 0, now),
        )
    return {"item_type": item_type, "item_key": key, "notify_enabled": bool(enabled)}


def list_watch_items(user_id):
    """获取用户收藏/书架更新提醒偏好与检查水位线。"""
    with _DB_LOCK, _conn() as c:
        rows = c.execute(
            "SELECT item_type, item_key, title, meta_json, last_count, last_marker, notify_enabled, last_checked_at "
            "FROM user_watch_items WHERE user_id=? ORDER BY updated_at DESC",
            (int(user_id),),
        ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["meta_json"] or "{}")
        except Exception:
            meta = {}
        out.append({
            "item_type": r["item_type"],
            "item_key": r["item_key"],
            "title": r["title"],
            "meta": meta,
            "last_count": r["last_count"],
            "last_marker": r["last_marker"],
            "notify_enabled": bool(r["notify_enabled"]),
            "last_checked_at": r["last_checked_at"],
        })
    return out


def list_due_watch_targets(limit=8, min_interval=7200, user_id=None):
    """按作品去重返回到期需要检测更新的订阅目标。"""
    now = int(time.time())
    cutoff = now - max(0, int(min_interval))
    lim = max(1, min(30, int(limit or 8)))
    with _DB_LOCK, _conn() as c:
        if user_id is not None:
            rows = c.execute(
                """
                SELECT item_type, item_key, MAX(title) AS title, MIN(last_checked_at) AS oldest_check
                FROM user_watch_items
                WHERE user_id=? AND notify_enabled=1 AND last_checked_at <= ?
                GROUP BY item_type, item_key
                ORDER BY oldest_check ASC
                LIMIT ?
                """,
                (int(user_id), cutoff, lim),
            ).fetchall()
        else:
            rows = c.execute(
                """
                SELECT item_type, item_key, MAX(title) AS title, MIN(last_checked_at) AS oldest_check
                FROM user_watch_items
                WHERE notify_enabled=1 AND last_checked_at <= ?
                GROUP BY item_type, item_key
                ORDER BY oldest_check ASC
                LIMIT ?
                """,
                (cutoff, lim),
            ).fetchall()
    return [{"item_type": r["item_type"], "item_key": r["item_key"], "title": r["title"]} for r in rows]


def record_watch_check(item_type, item_key, new_count, new_marker=""):
    """记录作品最新集数/章数；若较基线有新增则合并生成站内更新通知。"""
    cnt = max(0, int(new_count or 0))
    marker = str(new_marker or "")[:120].strip()
    now = int(time.time())
    created = 0
    unit = "集" if item_type == "vod" else "章"
    with _DB_LOCK, _conn() as c:
        rows = c.execute(
            "SELECT user_id, title, last_count, notify_enabled FROM user_watch_items WHERE item_type=? AND item_key=?",
            (item_type, item_key),
        ).fetchall()
        for r in rows:
            uid = int(r["user_id"])
            old_cnt = int(r["last_count"] or 0)
            c.execute(
                "UPDATE user_watch_items SET last_checked_at=? WHERE user_id=? AND item_type=? AND item_key=?",
                (now, uid, item_type, item_key),
            )
            if cnt <= 0:
                continue
            if old_cnt == 0:
                # 首次巡检仅记录基线水位，不触发误报
                c.execute(
                    "UPDATE user_watch_items SET last_count=?, last_marker=? WHERE user_id=? AND item_type=? AND item_key=?",
                    (cnt, marker, uid, item_type, item_key),
                )
                continue
            if cnt > old_cnt:
                delta = cnt - old_cnt
                c.execute(
                    "UPDATE user_watch_items SET last_count=?, last_marker=? WHERE user_id=? AND item_type=? AND item_key=?",
                    (cnt, marker, uid, item_type, item_key),
                )
                if not r["notify_enabled"]:
                    continue
                unread_row = c.execute(
                    "SELECT id, delta_count FROM user_notifications WHERE user_id=? AND item_type=? AND item_key=? AND read_at=0 ORDER BY id DESC LIMIT 1",
                    (uid, item_type, item_key),
                ).fetchone()
                total_delta = delta + (int(unread_row["delta_count"] or 0) if unread_row else 0)
                tail = f" · 最新：{marker}" if marker else ""
                msg = f"更新了 {total_delta} {unit}{tail}"
                if unread_row:
                    c.execute(
                        "UPDATE user_notifications SET delta_count=?, message=?, title=?, created_at=? WHERE id=?",
                        (total_delta, msg, r["title"], now, unread_row["id"]),
                    )
                else:
                    c.execute(
                        "INSERT INTO user_notifications(user_id, item_type, item_key, title, message, delta_count, read_at, created_at) "
                        "VALUES(?, ?, ?, ?, ?, ?, 0, ?)",
                        (uid, item_type, item_key, r["title"], msg, total_delta, now),
                    )
                created += 1
    return created


def list_notifications(user_id, unread_only=False, limit=50):
    """查询用户站内更新通知与管理员推送列表，自动过滤已撤回推送。"""
    uid = int(user_id)
    lim = max(1, min(100, int(limit or 50)))
    now = int(time.time())
    valid_cond = "(n.item_type != 'admin' OR (am.id IS NOT NULL AND am.revoked_at = 0))"
    with _DB_LOCK, _conn() as c:
        unread_count = c.execute(
            f"""
            SELECT COUNT(*)
            FROM user_notifications n
            LEFT JOIN admin_messages am ON n.item_type='admin' AND n.item_key=CAST(am.id AS TEXT)
            WHERE n.user_id=? AND n.read_at=0 AND {valid_cond}
            """,
            (uid,),
        ).fetchone()[0]
        read_cond = "n.user_id=? AND n.read_at=0" if unread_only else "n.user_id=?"
        rows = c.execute(
            f"""
            SELECT n.id, n.item_type, n.item_key, n.title, n.message, n.delta_count, n.read_at, n.created_at,
                   w.meta_json,
                   am.id AS am_id, am.msg_type, am.display_mode, am.image_url,
                   am.action_type, am.action_label, am.action_value, am.expire_at
            FROM user_notifications n
            LEFT JOIN user_watch_items w ON w.user_id=n.user_id AND w.item_type=n.item_type AND w.item_key=n.item_key
            LEFT JOIN admin_messages am ON n.item_type='admin' AND n.item_key=CAST(am.id AS TEXT)
            WHERE {read_cond} AND {valid_cond}
            ORDER BY n.read_at ASC, n.created_at DESC, n.id DESC
            LIMIT ?
            """,
            (uid, lim),
        ).fetchall()
    items = []
    for r in rows:
        try:
            meta = json.loads(r["meta_json"] or "{}")
        except Exception:
            meta = {}
        if r["item_type"] == "admin":
            exp_at = int(r["expire_at"] or 0)
            meta = {
                "msg_id": r["am_id"],
                "msg_type": r["msg_type"] or "notice",
                "display_mode": r["display_mode"] or "inbox",
                "image_url": r["image_url"] or "",
                "action_type": r["action_type"] or "none",
                "action_label": r["action_label"] or "",
                "action_value": r["action_value"] or "",
                "expire_at": exp_at,
                "is_expired": bool(exp_at and exp_at <= now),
            }
        items.append({
            "id": r["id"],
            "item_type": r["item_type"],
            "item_key": r["item_key"],
            "title": r["title"],
            "message": r["message"],
            "delta_count": r["delta_count"],
            "read": bool(r["read_at"]),
            "read_at": r["read_at"],
            "created_at": r["created_at"],
            "meta": meta,
        })
    return {"unread_count": unread_count, "items": items}


def mark_notifications_read(user_id, notif_id=0):
    """将单条或全部未读通知标记为已读。"""
    uid = int(user_id)
    nid = int(notif_id or 0)
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        if nid > 0:
            c.execute("UPDATE user_notifications SET read_at=? WHERE id=? AND user_id=? AND read_at=0", (now, nid, uid))
        else:
            c.execute("UPDATE user_notifications SET read_at=? WHERE user_id=? AND read_at=0", (now, uid))
        unread_count = c.execute(
            """
            SELECT COUNT(*)
            FROM user_notifications n
            LEFT JOIN admin_messages am ON n.item_type='admin' AND n.item_key=CAST(am.id AS TEXT)
            WHERE n.user_id=? AND n.read_at=0
              AND (n.item_type != 'admin' OR (am.id IS NOT NULL AND am.revoked_at = 0))
            """,
            (uid,),
        ).fetchone()[0]
    return unread_count


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
    try:
        trial_days = max(0, min(30, int(cfg.get("trial_days", "3"))))
    except ValueError:
        trial_days = 3
    try:
        max_ip = max(1, min(50, int(cfg.get("trial_max_per_ip_day", "2"))))
    except ValueError:
        max_ip = 2
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
        "access_gate_enabled": cfg.get("access_gate_enabled", "1") == "1",
        "trial_days": trial_days,
        "trial_max_per_ip_day": max_ip,
        "redeem_guide_tip": cfg.get("redeem_guide_tip", DEFAULT_SITE_CONFIG["redeem_guide_tip"]),
        "redeem_buy_url": cfg.get("redeem_buy_url", ""),
        "redeem_qr_image": cfg.get("redeem_qr_image", ""),
        "public_announcements": list_public_announcements(3),
    }


def configure_site(body):
    if not isinstance(body, dict): raise ValueError('配置必须为对象')
    values = {}
    for key in DEFAULT_SITE_CONFIG:
        if key not in body: continue
        value = body[key]
        if key in ('ad_enabled', 'access_gate_enabled'):
            if not isinstance(value, bool): raise ValueError('开关配置必须为布尔值')
            value = '1' if value else '0'
        elif key == 'trial_days':
            try:
                td = int(value)
            except (TypeError, ValueError):
                raise ValueError('体验天数必须为整数')
            if td < 0 or td > 30:
                raise ValueError('体验天数需在 0 ~ 30 天之间')
            value = str(td)
        elif key == 'trial_max_per_ip_day':
            try:
                mp = int(value)
            except (TypeError, ValueError):
                raise ValueError('同 IP 每日体验上限必须为整数')
            if mp < 1 or mp > 50:
                raise ValueError('同 IP 每日体验上限需在 1 ~ 50 之间')
            value = str(mp)
        else:
            value = str(value or '').strip()
        max_len = 2048 if key in ('ad_url', 'ad_image', 'redeem_buy_url', 'redeem_qr_image') else (600 if key == 'redeem_guide_tip' else 500)
        if len(value) > max_len: raise ValueError('配置过长')
        if key in ('ad_url', 'ad_image', 'redeem_buy_url', 'redeem_qr_image') and value:
            try: p = urllib.parse.urlsplit(value)
            except ValueError: raise ValueError('外链地址无效')
            if p.scheme != 'https' or not p.hostname or p.username or p.password or any(ord(ch)<=32 for ch in value) or '\\' in value:
                raise ValueError('外链与二维码图片地址必须为 HTTPS 地址')
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


def touch_user_presence(user_id, device_id="", client_type="web", device_info="", ip="", logged_in=True):
    """记录或刷新用户设备在线心跳与最后活跃信息。"""
    uid = int(user_id)
    did = str(device_id or "default")[:64].strip() or "default"
    ctype = str(client_type or "web")[:24].strip() or "web"
    dinfo = str(device_info or "")[:120].strip()
    cip = str(ip or "")[:64].strip()
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        c.execute(
            """
            INSERT INTO user_presence(user_id, device_id, client_type, device_info, ip, logged_in, last_seen_at)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, device_id) DO UPDATE SET
                client_type=excluded.client_type,
                device_info=CASE WHEN excluded.device_info != '' THEN excluded.device_info ELSE user_presence.device_info END,
                ip=CASE WHEN excluded.ip != '' THEN excluded.ip ELSE user_presence.ip END,
                logged_in=excluded.logged_in,
                last_seen_at=excluded.last_seen_at
            """,
            (uid, did, ctype, dinfo, cip, 1 if logged_in else 0, now),
        )
    return now


def mark_user_offline(user_id, device_id=""):
    """标记用户指定设备（或全部设备）下线。"""
    uid = int(user_id)
    did = str(device_id or "")[:64].strip()
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        if did:
            c.execute(
                "UPDATE user_presence SET logged_in=0, last_seen_at=? WHERE user_id=? AND device_id=?",
                (now, uid, did),
            )
        else:
            c.execute(
                "UPDATE user_presence SET logged_in=0, last_seen_at=? WHERE user_id=?",
                (now, uid),
            )


def list_online_presence(window_sec=180, limit=200):
    """查询指定活跃窗口内在线的用户会话与去重在线人数。"""
    win = max(30, min(3600, int(window_sec or 180)))
    lim = max(1, min(500, int(limit or 200)))
    now = int(time.time())
    cutoff = now - win
    with _DB_LOCK, _conn() as c:
        online_users_cnt = c.execute(
            "SELECT COUNT(DISTINCT user_id) FROM user_presence WHERE logged_in=1 AND last_seen_at>=?",
            (cutoff,),
        ).fetchone()[0]
        rows = c.execute(
            """
            SELECT p.user_id, u.username, u.vip_expire_at, p.device_id, p.client_type,
                   p.device_info, p.ip, p.logged_in, p.last_seen_at
            FROM user_presence p
            JOIN users u ON u.id = p.user_id
            WHERE p.logged_in = 1 AND p.last_seen_at >= ?
            ORDER BY p.last_seen_at DESC
            LIMIT ?
            """,
            (cutoff, lim),
        ).fetchall()
    items = []
    for r in rows:
        exp = int(r["vip_expire_at"] or 0)
        items.append({
            "user_id": r["user_id"],
            "username": r["username"],
            "is_pro": exp > now,
            "device_id": r["device_id"],
            "client_type": r["client_type"],
            "device_info": r["device_info"] or r["client_type"],
            "ip": r["ip"] or "-",
            "logged_in": bool(r["logged_in"]),
            "online": True,
            "last_seen_at": r["last_seen_at"],
        })
    return {
        "window_sec": win,
        "online_users": online_users_cnt,
        "online_sessions": len(items),
        "items": items,
    }


def get_admin_dashboard(limit=200):
    """汇总站长后台统计指标、卡密台账、近期注册用户、在线用户与站点配置。"""
    now = int(time.time())
    presence = list_online_presence(window_sec=180, limit=50)
    with _DB_LOCK, _conn() as c:
        gate_enabled, _, _ = _get_gate_settings(c)
        total_users = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        pro_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at > ?", (now,)).fetchone()[0]
        exempt_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at <= ? AND access_exempt = 1", (now,)).fetchone()[0]
        trial_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at <= ? AND access_exempt = 0 AND trial_expire_at > ?", (now, now)).fetchone()[0]
        expired_users = c.execute("SELECT COUNT(*) FROM users WHERE vip_expire_at <= ? AND access_exempt = 0 AND trial_expire_at <= ?", (now, now)).fetchone()[0]
        unused_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NULL").fetchone()[0]
        used_codes = c.execute("SELECT COUNT(*) FROM redeem_codes WHERE used_by IS NOT NULL").fetchone()[0]
        synced_users = c.execute("SELECT COUNT(*) FROM user_sync").fetchone()[0]
        recent_rows = c.execute(
            "SELECT id, username, vip_expire_at, trial_expire_at, trial_source, access_exempt, created_at FROM users ORDER BY created_at DESC LIMIT 6"
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
        fmt_u = _format_user(ur, gate_enabled=gate_enabled)
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
            "trial_users": trial_users,
            "expired_users": expired_users,
            "exempt_users": exempt_users,
            "unused_codes": unused_codes,
            "used_codes": used_codes,
            "synced_users": synced_users,
            "db_size_bytes": db_size_bytes,
            "online_users": presence["online_users"],
            "online_sessions": presence["online_sessions"],
        },
        "online": presence,
        "recent_users": recent_users,
        "codes": codes,
        "config": get_public_config(),
    }


def list_admin_users(query="", status="all", limit=200, window_sec=180):
    """分页检索平台注册用户列表及其 Pro 状态、云端同步与最近在线状态。"""
    now = int(time.time())
    win = max(30, min(3600, int(window_sec or 180)))
    cutoff = now - win
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
    elif status == "trial":
        where.append("u.vip_expire_at <= ? AND u.access_exempt = 0 AND u.trial_expire_at > ?")
        params.extend([now, now])
    elif status == "expired":
        where.append("u.vip_expire_at <= ? AND u.access_exempt = 0 AND u.trial_expire_at <= ?")
        params.extend([now, now])
    elif status == "exempt":
        where.append("u.vip_expire_at <= ? AND u.access_exempt = 1")
        params.append(now)
    elif status == "online":
        where.append("EXISTS (SELECT 1 FROM user_presence op WHERE op.user_id=u.id AND op.logged_in=1 AND op.last_seen_at>=?)")
        params.append(cutoff)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(max(1, min(500, int(limit))))
    sql = f"""
        SELECT u.id, u.username, u.vip_expire_at, u.trial_expire_at, u.trial_source, u.access_exempt, u.created_at, us.updated_at AS last_sync_at,
               lp.last_seen_at, lp.ip AS last_ip, lp.device_info AS last_device,
               lp.client_type, lp.logged_in
        FROM users u
        LEFT JOIN user_sync us ON u.id = us.user_id
        LEFT JOIN user_presence lp ON lp.user_id = u.id AND lp.rowid = (
            SELECT p2.rowid FROM user_presence p2
            WHERE p2.user_id = u.id
            ORDER BY p2.logged_in DESC, p2.last_seen_at DESC
            LIMIT 1
        )
        {where_sql}
        ORDER BY u.created_at DESC
        LIMIT ?
    """
    with _DB_LOCK, _conn() as c:
        gate_enabled, _, _ = _get_gate_settings(c)
        rows = c.execute(sql, params).fetchall()
    result = []
    for r in rows:
        item = _format_user(r, gate_enabled=gate_enabled)
        last_seen = int(r["last_seen_at"] or 0)
        logged_in = bool(r["logged_in"]) if r["logged_in"] is not None else False
        item["created_at"] = r["created_at"]
        item["last_sync_at"] = r["last_sync_at"] or 0
        item["last_seen_at"] = last_seen
        item["last_ip"] = r["last_ip"] or ""
        item["last_device"] = r["last_device"] or r["client_type"] or ""
        item["client_type"] = r["client_type"] or ""
        item["logged_in"] = logged_in
        item["is_online"] = logged_in and last_seen >= cutoff
        result.append(item)
    return result


def admin_set_user_vip(user_id, action, days=0):
    """管理员手工管理用户权益：叠加 Pro 天数、补发体验、切换豁免或清零锁定。"""
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
            trial_exp = int(row["trial_expire_at"] or 0) if "trial_expire_at" in row.keys() else 0
            base_ts = max(now, int(row["vip_expire_at"] or 0), trial_exp)
            new_exp = base_ts + d * 86400
            c.execute("UPDATE users SET vip_expire_at=? WHERE id=?", (new_exp, uid))
        elif action == "trial":
            d = int(days)
            if d < 1 or d > 365:
                raise ValueError("体验天数需在 1 ~ 365 之间")
            base_ts = max(now, int(row["trial_expire_at"] or 0))
            new_trial = base_ts + d * 86400
            c.execute("UPDATE users SET trial_expire_at=?, trial_source='admin' WHERE id=?", (new_trial, uid))
        elif action == "exempt":
            c.execute("UPDATE users SET access_exempt=1, trial_source='admin_exempt' WHERE id=?", (uid,))
        elif action == "unexempt":
            c.execute("UPDATE users SET access_exempt=0 WHERE id=?", (uid,))
        elif action == "clear":
            c.execute("UPDATE users SET vip_expire_at=0, trial_expire_at=0, access_exempt=0 WHERE id=?", (uid,))
        else:
            raise ValueError("不支持的操作类型")
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


# ---------- 管理后台客户端消息推送与配图存储 ----------
ADMIN_MSG_TYPES = ("notice", "activity", "maintenance", "direct")
ADMIN_DISPLAY_MODES = ("inbox", "banner", "popup")
ADMIN_ACTION_TYPES = ("none", "redeem", "hotfix", "route", "url")
ADMIN_AUDIENCES = ("all", "trial", "expired", "pro", "online", "users")
ADMIN_ACTION_ROUTES = ("vod", "music", "novel", "me")
MAX_ADMIN_IMAGE_BYTES = 1_572_864


def detect_image_mime(raw: bytes) -> str:
    """按文件二进制魔数识别安全图片格式（仅允许 JPEG/PNG/WebP/GIF）。"""
    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 12:
        return ""
    head = bytes(raw[:16])
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return ""


def admin_save_message_image(raw: bytes) -> dict:
    """校验并持久化管理员上传的推送配图，返回站内图片访问路径。"""
    if not isinstance(raw, (bytes, bytearray)) or len(raw) == 0:
        raise ValueError("图片内容不能为空")
    data = bytes(raw)
    if len(data) > MAX_ADMIN_IMAGE_BYTES:
        raise ValueError("图片体积不能超过 1.5MB")
    mime = detect_image_mime(data)
    if not mime:
        raise ValueError("仅支持 PNG、JPG、WebP、GIF 格式图片")
    img_id = secrets.token_hex(10)
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        c.execute(
            "INSERT INTO admin_message_images(id, mime, data, size, created_at) VALUES(?, ?, ?, ?, ?)",
            (img_id, mime, sqlite3.Binary(data), len(data), now),
        )
    return {
        "id": img_id,
        "url": f"/api/messages/image/{img_id}",
        "mime": mime,
        "size": len(data),
    }


def get_message_image(img_id: str):
    """按 ID 查询站内推送配图二进制数据与 MIME。"""
    clean_id = str(img_id or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{16,32}", clean_id):
        return None
    with _DB_LOCK, _conn() as c:
        row = c.execute(
            "SELECT mime, data FROM admin_message_images WHERE id=?",
            (clean_id,),
        ).fetchone()
    if not row:
        return None
    return row["mime"], bytes(row["data"])


def _validate_admin_image_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if len(raw) > 600:
        raise ValueError("图片链接过长（最多 600 字符）")
    if re.fullmatch(r"/api/messages/image/[a-f0-9]{16,32}", raw):
        return raw
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("图片地址仅支持本后台上传或合法 HTTPS 图片链接")
    return raw


def _validate_admin_message_payload(payload: dict) -> dict:
    p = payload if isinstance(payload, dict) else {}
    msg_type = str(p.get("msg_type") or "notice").strip().lower()
    if msg_type not in ADMIN_MSG_TYPES:
        raise ValueError("无效的消息类型")
    display_mode = str(p.get("display_mode") or "inbox").strip().lower()
    if display_mode not in ADMIN_DISPLAY_MODES:
        raise ValueError("无效的展示方式")
    action_type = str(p.get("action_type") or "none").strip().lower()
    if action_type not in ADMIN_ACTION_TYPES:
        raise ValueError("无效的跳转动作")
    audience = str(p.get("audience") or "all").strip().lower()
    if audience not in ADMIN_AUDIENCES:
        raise ValueError("无效的推送对象")

    title = str(p.get("title") or "").strip()
    if not title or len(title) > 40:
        raise ValueError("消息标题长度需在 1 ~ 40 字之间")
    content = str(p.get("content") or "").strip()
    if not content or len(content) > 500:
        raise ValueError("消息正文长度需在 1 ~ 500 字之间")

    image_url = _validate_admin_image_url(p.get("image_url") or "")
    action_label = str(p.get("action_label") or "").strip()[:24]
    action_value = str(p.get("action_value") or "").strip()
    if action_type == "url":
        parsed = urllib.parse.urlparse(action_value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("外链动作必须为合法的 https:// 地址")
        if len(action_value) > 500:
            raise ValueError("跳转链接过长")
    elif action_type == "route":
        if action_value not in ADMIN_ACTION_ROUTES:
            raise ValueError("站内跳转模块无效")
    elif action_type == "none":
        action_label = ""
        action_value = ""
    else:
        action_value = ""

    try:
        ttl_hours = int(p.get("ttl_hours") if p.get("ttl_hours") is not None else 72)
    except (TypeError, ValueError):
        raise ValueError("有效期格式无效")
    if ttl_hours < 0 or ttl_hours > 8760:
        raise ValueError("有效期范围需在 0（长期）~ 8760 小时之间")

    targets = [x.strip() for x in re.split(r"[\s,，;；]+", str(p.get("target_usernames") or "")) if x.strip()]
    if audience == "users" and not targets:
        raise ValueError("定向推送请至少填写 1 个目标用户名")

    now = int(time.time())
    expire_at = (now + ttl_hours * 3600) if ttl_hours > 0 else 0
    return {
        "msg_type": msg_type,
        "display_mode": display_mode,
        "title": title,
        "content": content,
        "image_url": image_url,
        "action_type": action_type,
        "action_label": action_label,
        "action_value": action_value,
        "audience": audience,
        "target_usernames": ",".join(targets),
        "target_list": targets,
        "show_on_guest": 1 if (audience == "all" and p.get("show_on_guest")) else 0,
        "include_new_users": 1 if (audience == "all" and p.get("include_new_users", True)) else 0,
        "expire_at": expire_at,
        "now": now,
    }


def _resolve_audience_user_ids(conn, audience: str, target_list: list, now: int) -> list:
    if audience == "all":
        rows = conn.execute("SELECT id FROM users ORDER BY id ASC").fetchall()
        return [int(r["id"]) for r in rows]
    if audience == "pro":
        rows = conn.execute("SELECT id FROM users WHERE vip_expire_at > ? ORDER BY id ASC", (now,)).fetchall()
        return [int(r["id"]) for r in rows]
    if audience == "trial":
        rows = conn.execute(
            "SELECT id FROM users WHERE vip_expire_at <= ? AND access_exempt = 0 AND trial_expire_at > ? ORDER BY id ASC",
            (now, now),
        ).fetchall()
        return [int(r["id"]) for r in rows]
    if audience == "expired":
        rows = conn.execute(
            "SELECT id FROM users WHERE vip_expire_at <= ? AND access_exempt = 0 AND trial_expire_at <= ? ORDER BY id ASC",
            (now, now),
        ).fetchall()
        return [int(r["id"]) for r in rows]
    if audience == "online":
        cutoff = now - 180
        rows = conn.execute(
            "SELECT DISTINCT user_id AS id FROM user_presence WHERE logged_in=1 AND last_seen_at>=? ORDER BY user_id ASC",
            (cutoff,),
        ).fetchall()
        return [int(r["id"]) for r in rows]
    if audience == "users":
        placeholders = ",".join("?" for _ in target_list)
        rows = conn.execute(
            f"SELECT id FROM users WHERE username IN ({placeholders}) ORDER BY id ASC",
            tuple(target_list),
        ).fetchall()
        uids = [int(r["id"]) for r in rows]
        if not uids:
            raise ValueError("未找到匹配的目标用户")
        return uids
    return []


def _format_admin_message_row(r, now=None, delivered_count=None, read_count=None) -> dict:
    ts = int(now or time.time())
    exp = int(r["expire_at"] or 0)
    rev = int(r["revoked_at"] or 0)
    if rev > 0:
        status = "revoked"
    elif exp > 0 and exp <= ts:
        status = "expired"
    else:
        status = "active"
    return {
        "id": r["id"],
        "msg_type": r["msg_type"],
        "display_mode": r["display_mode"],
        "title": r["title"],
        "content": r["content"],
        "image_url": r["image_url"] or "",
        "action_type": r["action_type"],
        "action_label": r["action_label"],
        "action_value": r["action_value"],
        "audience": r["audience"],
        "target_usernames": r["target_usernames"],
        "show_on_guest": bool(r["show_on_guest"]),
        "include_new_users": bool(r["include_new_users"]),
        "expire_at": exp,
        "revoked_at": rev,
        "sent_count": int(r["sent_count"] or 0),
        "delivered_count": int(delivered_count if delivered_count is not None else (r["sent_count"] or 0)),
        "read_count": int(read_count or 0),
        "status": status,
        "created_at": r["created_at"],
    }


def admin_create_message(payload: dict) -> dict:
    """站长发布全员/分组/定向推送消息，并写入目标用户站内通知。"""
    v = _validate_admin_message_payload(payload)
    now = v["now"]
    with _DB_LOCK, _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        target_ids = _resolve_audience_user_ids(c, v["audience"], v["target_list"], now)
        cur = c.execute(
            """
            INSERT INTO admin_messages(
                msg_type, display_mode, title, content, image_url,
                action_type, action_label, action_value,
                audience, target_usernames, show_on_guest, include_new_users,
                expire_at, revoked_at, sent_count, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                v["msg_type"], v["display_mode"], v["title"], v["content"], v["image_url"],
                v["action_type"], v["action_label"], v["action_value"],
                v["audience"], v["target_usernames"], v["show_on_guest"], v["include_new_users"],
                v["expire_at"], len(target_ids), now,
            ),
        )
        msg_id = int(cur.lastrowid)
        if target_ids:
            key = str(msg_id)
            c.executemany(
                """
                INSERT INTO user_notifications(user_id, item_type, item_key, title, message, delta_count, read_at, created_at)
                VALUES(?, 'admin', ?, ?, ?, 1, 0, ?)
                """,
                [(uid, key, v["title"], v["content"], now) for uid in target_ids],
            )
        row = c.execute("SELECT * FROM admin_messages WHERE id=?", (msg_id,)).fetchone()
    return _format_admin_message_row(row, now=now, delivered_count=len(target_ids), read_count=0)


def deliver_active_broadcasts_to_user(user_id: int, conn=None) -> int:
    """将当前生效且勾选覆盖新用户的全员广播补发给新注册用户。"""
    uid = int(user_id)
    now = int(time.time())

    def _run(c):
        rows = c.execute(
            """
            SELECT id, title, content
            FROM admin_messages
            WHERE revoked_at=0 AND (expire_at=0 OR expire_at>?) AND audience='all' AND include_new_users=1
            ORDER BY id DESC
            LIMIT 5
            """,
            (now,),
        ).fetchall()
        delivered = 0
        for r in rows:
            key = str(r["id"])
            exists = c.execute(
                "SELECT 1 FROM user_notifications WHERE user_id=? AND item_type='admin' AND item_key=? LIMIT 1",
                (uid, key),
            ).fetchone()
            if exists:
                continue
            c.execute(
                """
                INSERT INTO user_notifications(user_id, item_type, item_key, title, message, delta_count, read_at, created_at)
                VALUES(?, 'admin', ?, ?, ?, 1, 0, ?)
                """,
                (uid, key, r["title"], r["content"], now),
            )
            c.execute("UPDATE admin_messages SET sent_count=sent_count+1 WHERE id=?", (r["id"],))
            delivered += 1
        return delivered

    if conn is not None:
        return _run(conn)
    with _DB_LOCK, _conn() as c:
        return _run(c)


def admin_list_messages(limit: int = 80) -> list:
    """查询站长历史推送消息与送达/已读效果统计。"""
    lim = max(1, min(200, int(limit or 80)))
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        rows = c.execute(
            """
            SELECT m.*,
                   COALESCE(s.delivered_cnt, 0) AS delivered_cnt,
                   COALESCE(s.read_cnt, 0) AS read_cnt
            FROM admin_messages m
            LEFT JOIN (
                SELECT item_key,
                       COUNT(*) AS delivered_cnt,
                       SUM(CASE WHEN read_at > 0 THEN 1 ELSE 0 END) AS read_cnt
                FROM user_notifications
                WHERE item_type = 'admin'
                GROUP BY item_key
            ) s ON s.item_key = CAST(m.id AS TEXT)
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (lim,),
        ).fetchall()
    return [
        _format_admin_message_row(r, now=now, delivered_count=r["delivered_cnt"], read_count=r["read_cnt"])
        for r in rows
    ]


def admin_revoke_message(msg_id) -> dict:
    """撤回指定管理员推送并同步清理所有用户尚未读取或已收到的站内投递。"""
    try:
        mid = int(msg_id)
    except (TypeError, ValueError):
        raise ValueError("无效的消息 ID")
    if mid <= 0:
        raise ValueError("无效的消息 ID")
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM admin_messages WHERE id=?", (mid,)).fetchone()
        if not row:
            raise ValueError("消息不存在")
        if int(row["revoked_at"] or 0) == 0:
            c.execute("UPDATE admin_messages SET revoked_at=? WHERE id=?", (now, mid))
        c.execute("DELETE FROM user_notifications WHERE item_type='admin' AND item_key=?", (str(mid),))
        updated = c.execute("SELECT * FROM admin_messages WHERE id=?", (mid,)).fetchone()
    return _format_admin_message_row(updated, now=now, delivered_count=0, read_count=0)


def list_public_announcements(limit: int = 3) -> list:
    """读取当前对未登录访客展示的全员公告列表。"""
    lim = max(1, min(10, int(limit or 3)))
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        rows = c.execute(
            """
            SELECT id, msg_type, display_mode, title, content, image_url,
                   action_type, action_label, action_value, created_at
            FROM admin_messages
            WHERE revoked_at=0 AND (expire_at=0 OR expire_at>?) AND audience='all' AND show_on_guest=1
            ORDER BY id DESC
            LIMIT ?
            """,
            (now, lim),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "msg_type": r["msg_type"],
            "display_mode": r["display_mode"],
            "title": r["title"],
            "message": r["content"],
            "image_url": r["image_url"] or "",
            "action_type": r["action_type"],
            "action_label": r["action_label"],
            "action_value": r["action_value"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_user_message_digest(user_id: int) -> dict:
    """获取当前用户未读计数及待触发的强弹窗、首页公告横幅摘要。"""
    uid = int(user_id)
    now = int(time.time())
    with _DB_LOCK, _conn() as c:
        unread_count = c.execute(
            """
            SELECT COUNT(*)
            FROM user_notifications n
            LEFT JOIN admin_messages am ON n.item_type='admin' AND n.item_key=CAST(am.id AS TEXT)
            WHERE n.user_id=? AND n.read_at=0
              AND (n.item_type != 'admin' OR (am.id IS NOT NULL AND am.revoked_at = 0))
            """,
            (uid,),
        ).fetchone()[0]
        rows = c.execute(
            """
            SELECT n.id, n.title, n.message, n.created_at,
                   am.id AS am_id, am.msg_type, am.display_mode, am.image_url,
                   am.action_type, am.action_label, am.action_value, am.expire_at
            FROM user_notifications n
            JOIN admin_messages am ON n.item_type='admin' AND n.item_key=CAST(am.id AS TEXT)
            WHERE n.user_id=? AND n.read_at=0 AND am.revoked_at=0 AND (am.expire_at=0 OR am.expire_at>?)
              AND am.display_mode IN ('popup', 'banner')
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT 10
            """,
            (uid, now),
        ).fetchall()
    latest_popup = None
    banners = []
    for r in rows:
        item = {
            "id": r["id"],
            "item_type": "admin",
            "title": r["title"],
            "message": r["message"],
            "created_at": r["created_at"],
            "meta": {
                "msg_id": r["am_id"],
                "msg_type": r["msg_type"] or "notice",
                "display_mode": r["display_mode"] or "inbox",
                "image_url": r["image_url"] or "",
                "action_type": r["action_type"] or "none",
                "action_label": r["action_label"] or "",
                "action_value": r["action_value"] or "",
                "expire_at": int(r["expire_at"] or 0),
                "is_expired": False,
            },
        }
        if r["display_mode"] == "popup" and latest_popup is None:
            latest_popup = item
        elif r["display_mode"] == "banner" and len(banners) < 2:
            banners.append(item)
    return {
        "unread_count": int(unread_count or 0),
        "latest_popup": latest_popup,
        "banners": banners,
    }
