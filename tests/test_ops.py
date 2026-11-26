import contextlib
import gc
import importlib.util
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class BackupTests(unittest.TestCase):
    def test_online_backup_contains_uncheckpointed_wal_and_retains_latest(self):
        spec = importlib.util.spec_from_file_location("backup_db", ROOT / "backup_db.py")
        self.assertIsNotNone(spec)
        self.assertTrue((ROOT / "backup_db.py").exists(), "online backup tool is missing")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix="novahub-backup-test-") as temp:
            source = pathlib.Path(temp) / "live.db"
            output = pathlib.Path(temp) / "backups"
            with contextlib.closing(sqlite3.connect(source)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA wal_autocheckpoint=0")
                conn.execute("CREATE TABLE items(value TEXT)")
                conn.execute("INSERT INTO items VALUES('before')")
                conn.commit()
                module.backup_database(source, output, keep=1)
                conn.execute("INSERT INTO items VALUES('in-wal')")
                conn.commit()
                saved = module.backup_database(source, output, keep=1)
                self.assertEqual(len(list(output.glob("novahub-*.db"))), 1)
                with contextlib.closing(sqlite3.connect(saved)) as restored:
                    self.assertEqual(restored.execute("SELECT value FROM items").fetchall(), [("before",), ("in-wal",)])
                    self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            gc.collect()


class SourceProbeTests(unittest.TestCase):
    def test_only_valid_source_responses_are_published(self):
        import source_probe
        sources = [{"id": "good", "api": "https://good.example/api.php/provide/vod/"},
                   {"id": "bad", "api": "https://bad.example/api.php/provide/vod/"}]
        def fetch(url, **kwargs):
            body = b'{"list":[]}' if "good.example" in url else b'<html>not an API</html>'
            return 200, body, "application/json", url
        with mock.patch.object(source_probe.safe_http, "request", side_effect=fetch):
            source_probe.probe_once(sources)
        snapshot = source_probe.snapshot()
        self.assertEqual([item["id"] for item in snapshot["items"]], ["good"])
        self.assertIsInstance(snapshot["checked_at"], int)
        snapshot["items"][0]["id"] = "modified-copy"
        self.assertEqual(source_probe.snapshot()["items"][0]["id"], "good")

    def test_tunnel_publication_rejects_invalid_urls_before_network(self):
        spec = importlib.util.spec_from_file_location("auto_tunnel", ROOT / "ops" / "auto_tunnel.py")
        module = importlib.util.module_from_spec(spec)
        with mock.patch.dict(sys.modules, {"fcntl": mock.Mock()}):
            spec.loader.exec_module(module)
        with mock.patch.object(module.urllib.request, "urlopen", side_effect=AssertionError("network called")), mock.patch("builtins.print"):
            self.assertFalse(module.update_github_endpoint("", "fixture"))
            self.assertFalse(module.update_github_endpoint("https://untrusted.example", "fixture"))


if __name__ == "__main__":
    unittest.main()
