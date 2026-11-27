import gc
import json
import pathlib
import tempfile
import time
import unittest
from unittest import mock

import catalog
import db
import server


class PresenceAndCatalogTests(unittest.TestCase):
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

    def test_presence_heartbeat_timeout_and_logout(self):
        user, _ = db.register_user("alice01", "secret123")
        db.touch_user_presence(user["id"], "dev-app", "app", "Android App v2.4.6", "1.2.3.4", logged_in=True)
        online = db.list_online_presence(window_sec=180)
        self.assertEqual(online["online_users"], 1)
        self.assertEqual(online["items"][0]["username"], "alice01")
        self.assertEqual(online["items"][0]["ip"], "1.2.3.4")

        users_online = db.list_admin_users(status="online", window_sec=180)
        self.assertEqual(len(users_online), 1)
        self.assertTrue(users_online[0]["is_online"])

        # 模拟超时（将 last_seen_at 调到 10 分钟前）
        with db._conn() as c:
            c.execute("UPDATE user_presence SET last_seen_at=?", (int(time.time()) - 600,))
        self.assertEqual(db.list_online_presence(window_sec=180)["online_users"], 0)
        self.assertEqual(len(db.list_admin_users(status="online", window_sec=180)), 0)

        # 重新心跳后主动登出立即下线
        db.touch_user_presence(user["id"], "dev-app", "app", "Android App v2.4.6", "1.2.3.4", logged_in=True)
        self.assertEqual(db.list_online_presence(window_sec=180)["online_users"], 1)
        db.mark_user_offline(user["id"], "dev-app")
        self.assertEqual(db.list_online_presence(window_sec=180)["online_users"], 0)

    def test_empty_catalog_search_is_not_cached_and_paused_sources_fallback(self):
        cat_path = str(pathlib.Path(self.tmp.name) / "cat.db")
        cat = catalog.Catalog(
            cat_path,
            seeds=[{"id": "a", "name": "A", "api": "https://a.example/api.php/provide/vod"}],
            default_subscription=False,
        )
        calls = 0

        def fake_api(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise TimeoutError("transient timeout")
            return [{"vod_id": 9, "vod_name": "恢复影片", "vod_year": "2026", "type_name": "电影"}]

        with mock.patch.object(cat, "_api", side_effect=fake_api):
            first = cat.search("")
            self.assertEqual(first["items"], [])
            # 第二次应当再次请求而不是命中空缓存
            second = cat.search("")
            self.assertEqual(len(second["items"]), 1)
            self.assertEqual(second["items"][0]["name"], "恢复影片")

        # 若所有未手动禁用的源被标记为 paused，_eligible 仍能兜底返回非禁用源
        with cat.connection() as c:
            c.execute("UPDATE catalog_sources SET state='paused', disabled=0 WHERE id='a'")
        self.assertEqual([s["id"] for s in cat._eligible(0)], ["a"])
        cat.set_enabled("a", False)
        self.assertEqual(cat._eligible(0), [])

    def test_paused_fallback_source_allows_detail_and_recovers_active(self):
        cat_path = str(pathlib.Path(self.tmp.name) / "cat_detail.db")
        cat = catalog.Catalog(
            cat_path,
            seeds=[{"id": "a", "name": "A", "api": "https://a.example/api.php/provide/vod"}],
            default_subscription=False,
        )
        with cat.connection() as c:
            c.execute("UPDATE catalog_sources SET state='paused', disabled=0, failures=3 WHERE id='a'")
        fake_row = {
            "vod_id": "101",
            "vod_name": "测试影片",
            "vod_play_url": "第1集$https://cdn.example/1.m3u8",
        }
        with mock.patch.object(cat, "_api", return_value=[fake_row]):
            d = cat.detail("c:a", "101", 0)
        self.assertEqual(len(d["episodes"]), 1)
        self.assertEqual(cat.sources()[0]["state"], "active")
        self.assertEqual(cat.sources()[0]["failures"], 0)

        cat.set_enabled("a", False)
        with self.assertRaises(ValueError):
            cat.detail("c:a", "101", 0)

    def test_media_download_requires_auth_and_blocks_private_targets(self):
        class DummyHandler(server.Handler):
            def __init__(self, headers, path):
                self.headers = headers
                self.path = path
                self.sent = []
                self.client_address = ("8.8.8.8", 12345)

            def send_json(self, obj, status=200):
                self.sent.append((status, obj))

        # 未登录应返回 401
        h1 = DummyHandler({}, "/api/media/download?url=https://cdn.example/a.mp3")
        h1.handle_media_download({"url": ["https://cdn.example/a.mp3"]})
        self.assertEqual(h1.sent[0][0], 401)

        # 登录后请求内网地址应返回 400
        _, tok = db.register_user("dluser01", "secret123")
        h2 = DummyHandler({"Authorization": f"Bearer {tok}"}, "/api/media/download?url=http://127.0.0.1/a.mp3")
        h2.handle_media_download({"url": ["http://127.0.0.1/a.mp3"]})
        self.assertEqual(h2.sent[0][0], 400)
