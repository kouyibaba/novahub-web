import gc
import tempfile
from pathlib import Path
import unittest
from unittest import mock
import db

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.patch=mock.patch.object(db,'DB_PATH',str(Path(self.tmp.name)/'test.db'));self.patch.start();db.init_db()
    def tearDown(self):
        self.patch.stop();gc.collect();self.tmp.cleanup()
    def test_old_snapshot_cannot_restore_deleted_history_or_progress(self):
        db.save_user_sync(1,{'history':[],'history_deleted':{'a:1':100},'progress':{}})
        db.save_user_sync(1,{'history':[{'srcId':'a','id':'1','at':10}],'progress':{'a:1':{'time':30}}})
        data=db.get_user_sync(1)['data'];self.assertEqual(data['history'],[]);self.assertEqual(data['progress'],{})
        self.assertEqual(data['history_deleted']['a:1'],100)
    def test_merge_ignores_auth_privilege_source_and_unknown_fields(self):
        db.save_user_sync(1,{'nh_token':'evil','vip':True,'source':[{'api':'https://x.example'}],'like':[1]})
        data=db.get_user_sync(1)['data'];self.assertNotIn('nh_token',data);self.assertNotIn('vip',data);self.assertNotIn('source',data);self.assertEqual(data['like'],[1])
    def test_clear_prevents_undated_old_device_and_retains_favorites(self):
        db.save_user_sync(1,{'history_cleared_at':100,'like':[1]})
        db.save_user_sync(1,{'history':[{'srcId':'a','id':'1'}],'progress':{'a:1':{'time':3}}})
        data=db.get_user_sync(1)['data'];self.assertEqual(data['history'],[]);self.assertEqual(data['progress'],{});self.assertEqual(data['like'],[1])

    def test_offline_playback_and_reopen_without_observing_delete_cannot_resurrect(self):
        db.save_user_sync(1,{'history_deleted':{'a:1':100}})
        db.save_user_sync(1,{'history':[{'srcId':'a','id':'1','at':999}], 'progress':{'a:1':{'time':42,'at':999}}})
        state=db.get_user_sync(1)['data'];self.assertEqual(state['history'],[]);self.assertEqual(state['progress'],{})
        db.save_user_sync(1,{'history':[{'srcId':'a','id':'1','at':1000,'deleted_at':100}], 'progress':{'a:1':{'time':42,'at':1000,'deleted_at':100}}})
        state=db.get_user_sync(1)['data'];self.assertEqual(len(state['history']),1);self.assertEqual(state['progress']['a:1']['time'],42)
