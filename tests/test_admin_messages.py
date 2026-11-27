import base64
import gc
import json
import pathlib
import tempfile
import unittest
from unittest import mock

import db
import server


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class DummyMsgHandler(server.Handler):
    def __init__(self, headers=None, body=b"", ip="203.0.113.50", admin=False):
        self.headers = dict(headers or {})
        self.client_address = (ip, 34567)
        self._raw = body
        self.sent = []
        self.raw_written = b""
        self.resp_status = None
        self.resp_headers = {}
        self._admin_override = admin
        if body and "Content-Length" not in self.headers:
            self.headers["Content-Length"] = str(len(body))
        self.rfile = _BytesReader(body)

    def _is_admin(self):
        return bool(self._admin_override)

    def send_json(self, obj, status=200):
        self.sent.append((status, obj))

    def _read_json_body(self, max_bytes=1_048_576):
        if not self._raw:
            return {}
        return json.loads(self._raw.decode("utf-8"))

    def send_response(self, code, message=None):
        self.resp_status = code

    def send_header(self, keyword, value):
        self.resp_headers[keyword] = value

    def end_headers(self):
        if getattr(self, "_public_cache_hdr", False):
            self.resp_headers["Cache-Control"] = "public, max-age=86400"

    @property
    def wfile(self):
        handler = self

        class _W:
            def write(self, data):
                handler.raw_written += data

        return _W()


class _BytesReader:
    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    def read(self, n=-1):
        if n < 0:
            chunk = self._data[self._pos :]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk


class AdminMessagesTests(unittest.TestCase):
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

    def test_admin_endpoints_require_auth(self):
        h_get = DummyMsgHandler(admin=False)
        h_get.handle_admin_messages_get()
        h_post = DummyMsgHandler(admin=False, body=b"{}")
        h_post.handle_admin_messages_create()
        h_rev = DummyMsgHandler(admin=False, body=b'{"id":1}')
        h_rev.handle_admin_messages_revoke()
        h_img = DummyMsgHandler(admin=False, body=PNG_1X1)
        h_img.handle_admin_message_image_upload()
        for h in (h_get, h_post, h_rev, h_img):
            self.assertEqual(h.sent[0][0], 401)

    def test_image_upload_validation_and_serving(self):
        # 合法 PNG 上传与读取
        h_up = DummyMsgHandler(
            admin=True,
            headers={"Content-Type": "image/png"},
            body=PNG_1X1,
        )
        h_up.handle_admin_message_image_upload()
        self.assertEqual(h_up.sent[0][0], 200)
        res = h_up.sent[0][1]
        self.assertTrue(res["ok"])
        self.assertTrue(res["url"].startswith("/api/messages/image/"))
        img_id = res["id"]

        h_get = DummyMsgHandler()
        h_get.handle_message_image_get(img_id)
        self.assertEqual(h_get.resp_status, 200)
        self.assertEqual(h_get.resp_headers.get("Content-Type"), "image/png")
        self.assertEqual(h_get.resp_headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(h_get.raw_written, PNG_1X1)

        # 非法 SVG/HTML 与超大文件拒绝
        h_svg = DummyMsgHandler(admin=True, headers={"Content-Type": "image/svg+xml"}, body=b"<svg onload=alert(1)></svg>")
        h_svg.handle_admin_message_image_upload()
        self.assertEqual(h_svg.sent[0][0], 400)

        h_big = DummyMsgHandler(admin=True, headers={"Content-Length": str(2_300_000)}, body=b"x")
        h_big.handle_admin_message_image_upload()
        self.assertEqual(h_big.sent[0][0], 413)

    def test_broadcast_audience_new_user_digest_and_revoke(self):
        u_trial, tok_trial = db.register_user("u_trial", "secret123", device_id="dev_t_1", ip="198.51.100.1")
        u_exp, tok_exp = db.register_user("u_exp", "secret123", device_id="dev_t_1", ip="198.51.100.2")
        u_pro, tok_pro = db.register_user("u_pro", "secret123", device_id="dev_p_1", ip="198.51.100.3")
        db.admin_set_user_vip(u_pro["id"], "add", 30)

        # 上传配图并发布全员广播（带图片 + 访客可见 + 新用户自动补发）
        img_info = db.admin_save_message_image(PNG_1X1)
        msg_all = db.admin_create_message({
            "audience": "all",
            "msg_type": "activity",
            "display_mode": "banner",
            "title": "全员活动公告",
            "content": "点击下方按钮查看活动详情",
            "image_url": img_info["url"],
            "action_type": "url",
            "action_label": "立即前往",
            "action_value": "https://example.com/promo",
            "show_on_guest": True,
            "include_new_users": True,
            "ttl_hours": 72,
        })
        self.assertEqual(msg_all["sent_count"], 3)

        # 非法 javascript: 链接/图片必须被拒
        with self.assertRaises(ValueError):
            db.admin_create_message({
                "audience": "all",
                "title": "坏链接",
                "content": "bad",
                "action_type": "url",
                "action_value": "javascript:alert(1)",
            })
        with self.assertRaises(ValueError):
            db.admin_create_message({
                "audience": "all",
                "title": "坏图片",
                "content": "bad",
                "image_url": "http://insecure.example/a.png",
            })

        # /api/config 公开配置包含访客公告
        pub = db.get_public_config()
        self.assertEqual(len(pub["public_announcements"]), 1)
        self.assertEqual(pub["public_announcements"][0]["image_url"], img_info["url"])

        # 定向给体验到期用户发送强弹窗（即使被门禁锁住，登录后拉取 /api/notifications 依然收到且不返回 403）
        msg_direct = db.admin_create_message({
            "audience": "expired",
            "msg_type": "direct",
            "display_mode": "popup",
            "title": "体验已到期专享折扣",
            "content": "输入卡密即可继续畅看",
            "image_url": img_info["url"],
            "action_type": "redeem",
            "action_label": "去兑换",
            "ttl_hours": 24,
        })
        self.assertEqual(msg_direct["sent_count"], 1)

        h_exp = DummyMsgHandler(headers={"Authorization": f"Bearer {tok_exp}"})
        h_exp.handle_notifications_get({})
        self.assertEqual(h_exp.sent[0][0], 200)
        notif_data = h_exp.sent[0][1]
        self.assertEqual(notif_data["unread_count"], 2)
        self.assertEqual(notif_data["digest"]["latest_popup"]["title"], "体验已到期专享折扣")
        self.assertEqual(notif_data["digest"]["latest_popup"]["meta"]["image_url"], img_info["url"])
        self.assertEqual(len(notif_data["digest"]["banners"]), 1)

        # heartbeat 实时附带 notif_digest
        h_hb = DummyMsgHandler(headers={"Authorization": f"Bearer {tok_trial}"}, body=b'{"device_id":"d1"}')
        h_hb.handle_auth_heartbeat()
        self.assertEqual(h_hb.sent[0][0], 200)
        self.assertEqual(h_hb.sent[0][1]["notif_digest"]["unread_count"], 1)

        # 随后注册的新用户自动继承全员广播
        u_late, _ = db.register_user("u_late", "secret123", device_id="dev_l_1", ip="198.51.100.4")
        late_list = db.list_notifications(u_late["id"])
        self.assertEqual(late_list["unread_count"], 1)
        self.assertEqual(late_list["items"][0]["title"], "全员活动公告")

        # 撤回全员广播后，访客公告与所有用户收件箱立刻清除
        db.admin_revoke_message(msg_all["id"])
        self.assertEqual(len(db.get_public_config()["public_announcements"]), 0)
        self.assertEqual(db.list_notifications(u_late["id"])["unread_count"], 0)
        self.assertEqual(db.list_notifications(u_exp["id"])["unread_count"], 1)


if __name__ == "__main__":
    unittest.main()
