import gc
import io
import json
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

import db
import server


class DummyCastHandler(server.Handler):
    def __init__(self, headers=None, body=None, ip="127.0.0.1"):
        self.headers = headers or {}
        self.client_address = (ip, 12345)
        self._body = body
        self.sent = []

    def send_json(self, obj, status=200):
        self.sent.append((status, obj))

    def _read_json_body(self, max_bytes=1_048_576):
        if self._body is None:
            return {}
        return json.loads(self._body.decode("utf-8"))


class CastRoomTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(pathlib.Path(self.tmp.name) / "test.db")
        self.patch = mock.patch.object(db, "DB_PATH", self.db_path)
        self.patch.start()
        db.init_db()
        with server._CAST_LOCK:
            server._CAST_ROOMS.clear()

    def tearDown(self):
        with server._CAST_LOCK:
            server._CAST_ROOMS.clear()
        self.patch.stop()
        gc.collect()
        self.tmp.cleanup()

    def test_room_create_poll_secret_and_command_flow(self):
        _, token = db.register_user("castuser1", "secret123")

        h_create = DummyCastHandler()
        h_create.handle_cast_room_create()
        self.assertEqual(h_create.sent[0][0], 200)
        room = h_create.sent[0][1]
        code = room["code"]
        secret = room["secret"]
        self.assertEqual(len(code), 4)
        self.assertTrue(secret)

        # 未登录用户不能推送投屏指令
        h_unauth = DummyCastHandler(
            body=json.dumps({"code": code, "action": "play"}).encode("utf-8")
        )
        h_unauth.handle_cast_command()
        self.assertEqual(h_unauth.sent[0][0], 401)

        # 错误 secret 轮询返回 403
        h_bad_sec = DummyCastHandler()
        h_bad_sec.handle_cast_poll({"code": [code], "secret": ["wrong"], "since": ["0"]})
        self.assertEqual(h_bad_sec.sent[0][0], 403)

        # 登录用户下发 load + seek 指令
        auth_headers = {"Authorization": f"Bearer {token}"}
        h_load = DummyCastHandler(
            headers=auth_headers,
            body=json.dumps({
                "code": code.lower(),
                "action": "load",
                "payload": {
                    "url": "https://cdn.example.com/demo/index.m3u8",
                    "proxy_url": "https://node.example.com/api/live/m3u8?url=1&ticket=abc",
                    "title": "星际穿越",
                    "episode": "HD",
                    "position": 125,
                },
            }).encode("utf-8"),
        )
        h_load.handle_cast_command()
        self.assertEqual(h_load.sent[0][0], 200)
        self.assertEqual(h_load.sent[0][1]["seq"], 1)

        h_seek = DummyCastHandler(
            headers=auth_headers,
            body=json.dumps({"code": code, "action": "seek", "payload": {"delta": 30}}).encode("utf-8"),
        )
        h_seek.handle_cast_command()
        self.assertEqual(h_seek.sent[0][0], 200)
        self.assertEqual(h_seek.sent[0][1]["seq"], 2)

        # 增量轮询 since=0 与 since=1
        h_poll0 = DummyCastHandler()
        h_poll0.handle_cast_poll({"code": [code], "secret": [secret], "since": ["0"]})
        self.assertEqual(h_poll0.sent[0][0], 200)
        self.assertEqual(len(h_poll0.sent[0][1]["commands"]), 2)
        self.assertEqual(h_poll0.sent[0][1]["commands"][0]["payload"]["title"], "星际穿越")

        h_poll1 = DummyCastHandler()
        h_poll1.handle_cast_poll({"code": [code], "secret": [secret], "since": ["1"]})
        self.assertEqual(h_poll1.sent[0][0], 200)
        self.assertEqual(len(h_poll1.sent[0][1]["commands"]), 1)
        self.assertEqual(h_poll1.sent[0][1]["commands"][0]["action"], "seek")

    def test_invalid_url_rejected_and_tv_html_in_allowlist(self):
        _, token = db.register_user("castuser2", "secret123")
        h_create = DummyCastHandler()
        h_create.handle_cast_room_create()
        code = h_create.sent[0][1]["code"]

        h_bad = DummyCastHandler(
            headers={"Authorization": f"Bearer {token}"},
            body=json.dumps({
                "code": code,
                "action": "load",
                "payload": {"url": "javascript:alert(1)"},
            }).encode("utf-8"),
        )
        h_bad.handle_cast_command()
        self.assertEqual(h_bad.sent[0][0], 400)

        # 确认 /tv.html 在静态白名单中且不被 403 拦截
        httpd = server.ThreadedHTTPServer(("127.0.0.1", 0), server.Handler)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            import urllib.request
            with urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/tv.html", timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                text = resp.read().decode("utf-8")
                self.assertIn("Nova", text)
                self.assertIn("/api/cast/room", text)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_kuwo_lrc_falls_back_to_gdstudio_when_upstream_fails(self):
        _, token = db.register_user("castuser_lrc", "secret123")
        h = DummyCastHandler(headers={"Authorization": f"Bearer {token}"})
        with mock.patch.object(server, "_http_get_bytes", side_effect=OSError("502 Bad Gateway")), \
             mock.patch.object(h, "_fetch_gdstudio_lrc", return_value="[00:01.00]天黑黑 欲落雨") as mock_fb:
            h.handle_kuwo({"act": ["lrc"], "id": ["12345"], "name": ["天黑黑"], "artist": ["孙燕姿"]})
        self.assertEqual(h.sent[0][0], 200)
        self.assertIn("天黑黑", h.sent[0][1]["lrc"])
        mock_fb.assert_called_once_with("天黑黑", "孙燕姿")
