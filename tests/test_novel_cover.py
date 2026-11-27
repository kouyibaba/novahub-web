import unittest
from unittest.mock import patch

import server


class NovelCoverTests(unittest.TestCase):
    def test_normalize_novel_cover_rewrites_bytecdn_and_uses_fallback(self):
        fn = server.Handler._normalize_novel_cover
        self.assertEqual(
            fn("https://p6-tt.bytecdn.cn/novel-pic/abc~tplv-shrink:640:0.image"),
            "https://p6-novel.byteimg.com/novel-pic/abc~tplv-shrink:640:0.image",
        )
        self.assertEqual(
            fn("http://p3-tt.bytecdn.cn/novel-pic/xyz.image"),
            "https://p6-novel.byteimg.com/novel-pic/xyz.image",
        )
        self.assertEqual(
            fn("", "http://p3-novel.byteimg.com/img/novel-pic/fallback.image"),
            "https://p3-novel.byteimg.com/img/novel-pic/fallback.image",
        )
        self.assertEqual(fn("", ""), "")

    def test_novel_search_normalizes_cover_urls(self):
        payload = b'{"data":{"ret_data":[{"book_id":"7123456789012345678","title":"Test Book","author":"Author","thumb_url":"https://p6-tt.bytecdn.cn/novel-pic/demo~tplv-shrink:640:0.image","audio_thumb_uri":"https://p6-novel.byteimg.com/img/novel-pic/demo.image","category":"Fantasy","score":"9.5","creation_status":"1","abstract":"desc"}]}}'
        captured = {}

        class DummyHandler:
            _normalize_novel_cover = staticmethod(server.Handler._normalize_novel_cover)

            def _require_active_access(self):
                return True

            def send_json(self, obj, code=200):
                captured["obj"] = obj
                captured["code"] = code

        with patch.object(server, "_http_get_bytes", return_value=(200, payload, {})):
            server.Handler.handle_novel_search(DummyHandler(), {"q": ["Test"]})

        self.assertEqual(captured.get("code"), 200)
        items = captured["obj"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(
            items[0]["cover"],
            "https://p6-novel.byteimg.com/novel-pic/demo~tplv-shrink:640:0.image",
        )


if __name__ == "__main__":
    unittest.main()
