import gc
import json
import pathlib
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

import db
import server


class DummyGateHandler(server.Handler):
    def __init__(self, headers=None, body=None, ip="203.0.113.10"):
        self.headers = headers or {}
        self.client_address = (ip, 23456)
        self._body = body
        self.command = "GET"
        self.sent = []

    def send_json(self, obj, status=200):
        self.sent.append((status, obj))

    def _read_json_body(self, max_bytes=1_048_576):
        if self._body is None:
            return {}
        return json.loads(self._body.decode("utf-8"))


class TrialAndAccessGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(pathlib.Path(self.tmp.name) / "test.db")
        self.patch = mock.patch.object(db, "DB_PATH", self.db_path)
        self.patch.start()
        db.init_db()

    def tearDown(self):
        self.patch.stop()
        gc.collect()
        self.tmp.cleanup()

    def test_new_user_gets_3_day_trial_and_anti_abuse_blocks_dup_device_and_ip(self):
        u1, _ = db.register_user("trial01", "secret123", device_id="and_device_aaa111", ip="198.51.100.1")
        self.assertTrue(u1["trial_granted"])
        self.assertEqual(u1["access_status"], "trial")
        self.assertTrue(u1["has_access"])
        self.assertFalse(u1["is_pro"])
        self.assertGreaterEqual(u1["trial_remain_days"], 3)

        # 同设备二次注册即使换 IP 也不再赠送体验
        u2, _ = db.register_user("trial02", "secret123", device_id="and_device_aaa111", ip="198.51.100.2")
        self.assertFalse(u2["trial_granted"])
        self.assertEqual(u2["access_status"], "expired")
        self.assertFalse(u2["has_access"])
        self.assertEqual(u2["trial_source"], "denied_dup_device")

        # 同 IP 默认日上限 2 次，第 2 个不同设备可领，第 3 个被限
        u3, _ = db.register_user("trial03", "secret123", device_id="and_device_bbb222", ip="198.51.100.1")
        self.assertTrue(u3["trial_granted"])
        u4, _ = db.register_user("trial04", "secret123", device_id="and_device_ccc333", ip="198.51.100.1")
        self.assertFalse(u4["trial_granted"])
        self.assertEqual(u4["trial_source"], "denied_ip_limit")
        self.assertFalse(u4["has_access"])

    def test_strict_access_gate_blocks_expired_and_redeem_unlocks_and_stacks(self):
        u1, tok1 = db.register_user("gate01", "secret123", device_id="dev_gate_1", ip="198.51.100.8")
        # 体验期内提前兑换 30 天卡密，应在 3 天体验期之后再叠加 30 天
        before_trial_exp = u1["trial_expire_at"]
        code_30 = db.generate_codes(1, 30, "test")[0]
        u1_after, days = db.redeem_code(u1["id"], code_30)
        self.assertEqual(days, 30)
        self.assertEqual(u1_after["access_status"], "active")
        self.assertTrue(u1_after["is_pro"])
        self.assertEqual(u1_after["vip_expire_at"], before_trial_exp + 30 * 86400)

        # 同设备再注册直接进入到期锁死态
        u2, tok2 = db.register_user("gate02", "secret123", device_id="dev_gate_1", ip="198.51.100.9")
        self.assertEqual(u2["access_status"], "expired")

        # 未登录请求全部内容接口返回 401 AUTH_REQUIRED
        h_anon = DummyGateHandler()
        h_anon.handle_catalog("/api/vod/home", {})
        h_anon.handle_kuwo({"act": ["search"], "q": ["周杰伦"]})
        h_anon.handle_novel_search({"q": ["测试"]})
        h_anon.handle_novel_book({"book_id": ["7123456789012345678"]})
        h_anon.handle_novel_chapter({"book_id": ["7123456789012345678"], "index": ["1"]})
        h_anon.handle_media_download({"url": ["https://cdn.example/a.mp3"]})
        for st, body in h_anon.sent:
            self.assertEqual(st, 401)
            self.assertEqual(body["code"], "AUTH_REQUIRED")

        # 已到期账号请求内容接口返回 403 ACCESS_EXPIRED
        hdr_exp = {"Authorization": f"Bearer {tok2}"}
        h_exp = DummyGateHandler(headers=hdr_exp)
        h_exp.handle_catalog("/api/vod/home", {})
        h_exp.handle_kuwo({"act": ["search"], "q": ["周杰伦"]})
        h_exp.handle_novel_search({"q": ["测试"]})
        h_exp.handle_novel_book({"book_id": ["7123456789012345678"]})
        h_exp.handle_novel_chapter({"book_id": ["7123456789012345678"], "index": ["1"]})
        h_exp.handle_media_download({"url": ["https://cdn.example/a.mp3"]})
        h_exp_cast = DummyGateHandler(headers=hdr_exp, body=b'{"code":"ABCD","action":"play"}')
        h_exp_cast.handle_cast_command()
        for st, body in h_exp.sent + h_exp_cast.sent:
            self.assertEqual(st, 403)
            self.assertEqual(body["code"], "ACCESS_EXPIRED")

        # 到期用户核销卡密后立即解封放行
        code_7 = db.generate_codes(1, 7, "unlock")[0]
        u2_unlocked, _ = db.redeem_code(u2["id"], code_7)
        self.assertTrue(u2_unlocked["has_access"])
        self.assertEqual(u2_unlocked["access_status"], "active")
        h_ok = DummyGateHandler(headers=hdr_exp)
        with mock.patch.object(server.catalog, "current", return_value=mock.Mock(search=lambda q, o: {"items": []})):
            h_ok.handle_catalog("/api/vod/home", {})
        self.assertEqual(h_ok.sent[0][0], 200)

    def test_gate_hot_toggle_and_admin_actions(self):
        u, tok = db.register_user("gate_toggle", "secret123", device_id="dev_t1", ip="198.51.100.11")
        db.admin_set_user_vip(u["id"], "clear")
        h = DummyGateHandler(headers={"Authorization": f"Bearer {tok}"})
        h.handle_novel_book({"book_id": ["bad"]})
        self.assertEqual(h.sent[0][0], 403)

        # 关闭门禁总开关后，即使到期账号也立即放行
        db.configure_site({"access_gate_enabled": False})
        h2 = DummyGateHandler(headers={"Authorization": f"Bearer {tok}"})
        h2.handle_novel_book({"book_id": ["bad"]})
        self.assertEqual(h2.sent[0][0], 400)  # 放行并进入参数校验

        # 非法非 HTTPS 购卡外链与二维码被拒绝
        with self.assertRaises(ValueError):
            db.configure_site({"redeem_buy_url": "http://insecure.example/buy"})
        with self.assertRaises(ValueError):
            db.configure_site({"redeem_qr_image": "javascript:alert(1)"})

    def test_legacy_users_are_exempt_after_upgrade(self):
        # 模拟升级前的旧数据库结构与存量老用户
        tmp_legacy = tempfile.TemporaryDirectory()
        legacy_path = str(pathlib.Path(tmp_legacy.name) / "legacy.db")
        try:
            conn = sqlite3.connect(legacy_path)
            try:
                conn.executescript(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        pwd_hash TEXT NOT NULL,
                        salt TEXT NOT NULL,
                        vip_expire_at INTEGER NOT NULL DEFAULT 0,
                        created_at INTEGER NOT NULL
                    );
                    CREATE TABLE site_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    INSERT INTO users(username, pwd_hash, salt, vip_expire_at, created_at)
                    VALUES('olduser', 'hash', 'salt', 0, 1700000000);
                    """
                )
                conn.commit()
            finally:
                conn.close()
            with mock.patch.object(db, "DB_PATH", legacy_path):
                db.init_db()
                dash = db.get_admin_dashboard()
                self.assertEqual(dash["stats"]["exempt_users"], 1)
                users = db.list_admin_users(status="exempt")
                self.assertEqual(len(users), 1)
                self.assertEqual(users[0]["username"], "olduser")
                self.assertTrue(users[0]["has_access"])
                self.assertEqual(users[0]["access_status"], "exempt")
        finally:
            gc.collect()
            tmp_legacy.cleanup()
