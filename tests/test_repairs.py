import ast
import concurrent.futures
import contextlib
import gc
import http.client
import importlib.util
import json
import pathlib
import socket
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
with mock.patch.object(sys, "argv", ["server.py"]):
    import server
import db


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="novahub-test-")
        self.root = pathlib.Path(self.temp.name)
        for name in ("index.html", "app.js", "server.py", "novahub.db", "PAD_SSH_PASSWORD.md"):
            (self.root / name).write_text("fixture", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "HEAD").write_text("fixture", encoding="utf-8")
        self.root_patch = mock.patch.object(server, "ROOT", str(self.root))
        self.db_patch = mock.patch.object(db, "DB_PATH", str(self.root / "fixture.sqlite"))
        self.root_patch.start()
        self.db_patch.start()
        db.init_db()
        self.httpd = server.ThreadedHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        server._RATE_BUCKETS.clear()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.db_patch.stop()
        self.root_patch.stop()
        gc.collect()
        self.temp.cleanup()

    def request(self, path, token="", method="GET"):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        headers = {"Authorization": "Bearer " + token} if token else {}
        try:
            conn.request(method, path, headers=headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_static_public_assets_remain_available(self):
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/app.js", method="HEAD")[0], 200)

    def test_missing_index_does_not_enable_directory_listing(self):
        (self.root / "index.html").unlink()
        self.assertEqual(self.request("/")[0], 403)

    def test_sensitive_files_are_denied_for_get_and_head(self):
        for path in ("/server.py", "/server%2epy", "/novahub%2edb", "/.git/HEAD",
                     "/PAD_SSH_PASSWORD.md", "/docs/../server%2epy", "/%2e%2e/server.py"):
            for method in ("GET", "HEAD"):
                with self.subTest(path=path, method=method):
                    self.assertIn(self.request(path, method=method)[0], (403, 404))

    def test_music_url_requires_login(self):
        with mock.patch.object(server, "_http_get_bytes", return_value=(200, b'{"data":{"url":"https://example.com/audio"}}', "application/json")):
            self.assertEqual(self.request("/kw?act=url&id=1&br=999")[0], 401)

    def test_free_user_cannot_request_pro_bitrate(self):
        _, token = db.register_user("free-user", "temporary-pass")
        with mock.patch.object(server, "_http_get_bytes", return_value=(200, b'{"data":{"url":"https://example.com/audio"}}', "application/json")):
            self.assertEqual(self.request("/kw?act=url&id=1&br=999", token)[0], 403)
            self.assertEqual(self.request("/kw?act=url&id=1&br=128", token)[0], 200)

    def test_live_proxy_requires_login(self):
        self.assertEqual(self.request("/api/live/seg?url=https://example.com/x.ts")[0], 401)

    def test_source_route_exists_without_login(self):
        status, body = self.request("/api/sources/live")
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(body)["items"], list)

    def test_catalog_admin_is_protected_and_public_status_redacts_apis(self):
        self.assertEqual(self.request('/api/admin/sources')[0], 401)
        _, token = db.register_user('catalog-free', 'temporary-pass')
        self.assertEqual(self.request('/api/admin/subscriptions', token)[0], 401)
        status, body = self.request('/api/sources/live')
        self.assertEqual(status, 200)
        self.assertNotIn('api.php', body.decode())
        status, body = self.request('/api/admin/sources', db.sign_admin_token())
        self.assertEqual(status, 200)
        self.assertIn('subscriptions', json.loads(body))

    def test_media_ticket_only_authorizes_media_and_propagates_to_segments(self):
        user, token = db.register_user("media-user", "temporary-pass")
        status, body = self.request("/api/media/ticket", token)
        self.assertEqual(status, 200)
        ticket = json.loads(body)["ticket"]
        self.assertIsNone(db.verify_token(ticket))
        self.assertEqual(db.verify_token(ticket, role="media")["id"], user["id"])
        playlist = b'#EXTM3U\n#EXTINF:4,\npart.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n'
        with mock.patch.object(server, "_is_safe_proxy_target", return_value=True), mock.patch.object(
            server, "_http_get_full", return_value=(200, playlist, "application/vnd.apple.mpegurl", "https://example.com/live.m3u8")
        ):
            status, body = self.request("/api/live/m3u8?url=https://example.com/live.m3u8&ticket=" + ticket)
        self.assertEqual(status, 200)
        self.assertEqual(body.decode().count("ticket=" + ticket), 2)
        db.admin_reset_user_password(user["id"], "new-media-pass")
        self.assertEqual(self.request("/api/live/seg?url=https://example.com/part.ts&ticket=" + ticket)[0], 401)

    def test_user_password_reset_revokes_old_token(self):
        user, token = db.register_user("reset-user", "temporary-pass")
        db.admin_reset_user_password(user["id"], "new-temporary-pass")
        self.assertIsNone(db.verify_token(token))
        self.assertIsNotNone(db.verify_token(db.login_user("reset-user", "new-temporary-pass")[1]))

    def test_session_endpoint_is_explicit_about_invalid_auth_and_keeps_valid_auth(self):
        self.assertEqual(self.request('/api/auth/me')[0], 401)
        _, token = db.register_user('upgrade-api-user', 'temporary-pass')
        db.init_db()
        status, body = self.request('/api/auth/me', token)
        self.assertEqual(status, 200)
        session = json.loads(body)
        self.assertEqual(session['user']['username'], 'upgrade-api-user')
        self.assertIsNotNone(db.verify_token(session['token']))

    def test_reset_between_login_validation_and_signing_cannot_grant_session(self):
        user, _ = db.register_user("race-user", "temporary-pass")
        original = db._sign_token
        def reset_before_sign(*args, **kwargs):
            db.admin_reset_user_password(user["id"], "new-race-password")
            return original(*args, **kwargs)
        with mock.patch.object(db, "_sign_token", side_effect=reset_before_sign):
            _, token = db.login_user("race-user", "temporary-pass")
        self.assertIsNone(db.verify_token(token))

    def test_admin_password_change_revokes_only_admin_token(self):
        _, user_token = db.register_user("keep-user", "temporary-pass")
        token = db.sign_admin_token()
        db.set_admin_password("NovaAdmin888", "new-temporary-admin")
        self.assertFalse(db.verify_admin_token(token))
        self.assertTrue(db.verify_admin_token(db.sign_admin_token()))
        self.assertIsNotNone(db.verify_token(user_token))

    def test_admin_reset_during_signing_cannot_grant_old_password_session(self):
        original = db.sign_admin_token
        def reset_before_sign(*args, **kwargs):
            db.set_admin_password("NovaAdmin888", "new-race-admin-pass")
            return original(*args, **kwargs)
        with mock.patch.object(db, "sign_admin_token", side_effect=reset_before_sign):
            token = db.login_admin("NovaAdmin888")
        self.assertFalse(db.verify_admin_token(token))

    def test_media_reset_during_signing_cannot_refresh_revoked_session(self):
        user, token = db.register_user("media-race-user", "temporary-pass")
        original = db._sign_token
        def reset_before_sign(*args, **kwargs):
            db.admin_reset_user_password(user["id"], "new-media-race-pass")
            return original(*args, **kwargs)
        with mock.patch.object(db, "_sign_token", side_effect=reset_before_sign):
            ticket = db.sign_media_ticket(token)
        self.assertIsNone(db.verify_token(ticket, role="media"))

    def test_code_can_only_be_redeemed_once(self):
        user, _ = db.register_user("redeem-user", "temporary-pass")
        code = db.generate_codes(1, 30)[0]
        def redeem(_):
            try:
                db.redeem_code(user["id"], code)
                return True
            except ValueError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(redeem, range(4))).count(True), 1)

    def test_chapter_content_cannot_execute_html(self):
        result = server._sanitize_chapter_html('<p>Hello<img src=x onerror=alert(1)></p>')
        self.assertNotIn("<img", result)
        self.assertIn("Hello", result)


class ProxyTests(unittest.TestCase):
    def test_dns_alias_to_loopback_is_rejected(self):
        with mock.patch.object(socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))]):
            self.assertFalse(server._is_safe_proxy_target("http://example.com/"))

    def test_shared_address_space_is_rejected(self):
        self.assertFalse(server._is_safe_proxy_target("http://100.64.0.1/"))

    def test_upstream_tls_verification_enabled(self):
        self.assertTrue(server.CTX.check_hostname)
        self.assertEqual(server.CTX.verify_mode, 2)


class TunnelTests(unittest.TestCase):
    def test_dns_failure_never_publishes_empty_endpoint(self):
        source = (ROOT / "ops" / "auto_tunnel.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run_once")
        calls = []
        class Process:
            stdout = ['Post "https://api.trycloudflare.com/tunnel": lookup api.trycloudflare.com failed\n']
            def wait(self, **kwargs):
                return 1
        namespace = {
            "ensure_server": lambda: None,
            "shutil": types.SimpleNamespace(which=lambda _: "mock-cloudflared"),
            "subprocess": types.SimpleNamespace(Popen=lambda *a, **kw: Process(), PIPE=-1, STDOUT=-2),
            "PORT": "11785", "re": __import__("re"),
            "time": types.SimpleNamespace(time=lambda: 1000),
            "update_github_endpoint": lambda url, token: calls.append(url) or True,
            "write_state": lambda *a: None, "CURRENT_URL_FILE": "fixture",
            "DIAL_ERR_KEYWORDS": (), "print": lambda *a, **kw: None,
        }
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "tunnel", "exec"), namespace)
        namespace["run_once"]("fixture")
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
