import gc
import tempfile
from pathlib import Path
import unittest
from unittest import mock
import db

class AdTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.patch=mock.patch.object(db,'DB_PATH',str(Path(self.tmp.name)/'test.db'));self.patch.start();db.init_db()
    def tearDown(self):
        self.patch.stop();gc.collect();self.tmp.cleanup()
    def test_default_is_off_and_empty(self):
        config=db.get_public_config();self.assertFalse(config['ad_enabled']);self.assertEqual(config['ad_title'],'')
    def test_legacy_demo_migrates_off_once_and_keeps_content(self):
        with db._conn() as c:
            c.execute("DELETE FROM site_config WHERE key='ad_schema_v2'")
            c.execute("UPDATE site_config SET value='1' WHERE key='ad_enabled'")
            c.execute("UPDATE site_config SET value='赞助支持 NovaHub · 星隅' WHERE key='ad_title'")
        db.init_db();self.assertFalse(db.get_public_config()['ad_enabled'])
        self.assertEqual(db.get_public_config()['ad_title'],'赞助支持 NovaHub · 星隅')
        db.configure_site({'ad_enabled':True,'ad_title':'真实赞助','ad_url':'https://sponsor.example/'})
        db.init_db();self.assertTrue(db.get_public_config()['ad_enabled'])
    def test_scripts_non_https_and_invalid_slots_are_rejected_atomically(self):
        for data in ({'ad_url':'javascript:alert(1)'},{'ad_image':'http://unsafe.example/x.png'},{'ad_provider':'<script>'},{'ad_slots':'unknown'}):
            with self.assertRaises(ValueError):db.configure_site({'ad_title':'bad',**data})
            self.assertEqual(db.get_public_config()['ad_title'],'')
    def test_manual_provider_slots_and_safe_image_roundtrip(self):
        db.configure_site({'ad_enabled':True,'ad_title':'合作','ad_slots':'home,novel','ad_provider':'manual','ad_image':'https://cdn.example/banner.png'})
        cfg=db.get_public_config();self.assertEqual(cfg['ad_slots'],['home','novel']);self.assertEqual(cfg['ad_provider'],'manual');self.assertTrue(cfg['ad_enabled'])
