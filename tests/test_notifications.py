import gc
import pathlib
import tempfile
import unittest
from unittest import mock

import db
import server


class NotificationTests(unittest.TestCase):
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

    def test_watch_sync_baseline_merge_and_toggle(self):
        user, _ = db.register_user("notif01", "secret123")
        uid = user["id"]

        db.save_user_sync(uid, {
            "like": [{"srcId": "c:a", "id": "101", "name": "测试剧集"}],
            "novel_shelf": [{"book_id": "7123456789012345678", "title": "测试小说"}],
        })

        # 第一次巡检建立基线，不发通知
        self.assertEqual(db.record_watch_check("vod", "c:a:101", 10, "第10集"), 0)
        self.assertEqual(db.record_watch_check("novel", "7123456789012345678", 100, "第100章"), 0)
        self.assertEqual(db.list_notifications(uid)["unread_count"], 0)

        # 有新集数 / 新章节时生成通知，连续未读更新合并
        self.assertEqual(db.record_watch_check("vod", "c:a:101", 12, "第12集"), 1)
        self.assertEqual(db.record_watch_check("vod", "c:a:101", 15, "第15集"), 1)
        self.assertEqual(db.record_watch_check("novel", "7123456789012345678", 103, "第103章"), 1)

        res = db.list_notifications(uid)
        self.assertEqual(res["unread_count"], 2)
        vod_n = next(x for x in res["items"] if x["item_type"] == "vod")
        self.assertEqual(vod_n["delta_count"], 5)
        self.assertIn("5 集", vod_n["message"])

        # 关闭该剧通知开关后，即使再更新也不产生新通知
        db.set_watch_notify(uid, "vod", "c:a:101", False)
        db.mark_notifications_read(uid, 0)
        self.assertEqual(db.list_notifications(uid)["unread_count"], 0)
        self.assertEqual(db.record_watch_check("vod", "c:a:101", 18, "第18集"), 0)
        self.assertEqual(db.list_notifications(uid)["unread_count"], 0)

    def test_notifications_api_requires_login(self):
        class DummyHandler(server.Handler):
            def __init__(self):
                self.headers = {}
                self.sent = []

            def send_json(self, obj, status=200):
                self.sent.append((status, obj))

        h = DummyHandler()
        h.handle_notifications_get({})
        self.assertEqual(h.sent[0][0], 401)
