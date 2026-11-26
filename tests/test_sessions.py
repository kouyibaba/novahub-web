import gc
import json
import pathlib
import tempfile
import time
import unittest
from unittest import mock
import db


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='novahub-session-test-')
        self.patch = mock.patch.object(db, 'DB_PATH', str(pathlib.Path(self.temp.name)/'session.db'))
        self.patch.start()
        db.init_db()

    def tearDown(self):
        self.patch.stop()
        gc.collect()
        self.temp.cleanup()

    def test_same_database_upgrade_preserves_session(self):
        _, token = db.register_user('upgrade', 'fixture-password')
        db.init_db()
        self.assertIsNotNone(db.verify_token(token))

    def test_active_near_expiry_session_is_renewed(self):
        start = int(time.time())
        with mock.patch.object(db.time, 'time', return_value=start):
            user, token = db.register_user('renewal', 'fixture-password')
        with mock.patch.object(db.time, 'time', return_value=start+25*86400):
            current, renewed = db.refresh_user_session(token)
            self.assertEqual(current['id'], user['id'])
            self.assertNotEqual(renewed, token)
        with mock.patch.object(db.time, 'time', return_value=start+31*86400):
            self.assertIsNone(db.verify_token(token))
            self.assertIsNotNone(db.verify_token(renewed))

    def test_expired_and_revoked_sessions_cannot_renew(self):
        user, token = db.register_user('revoked', 'fixture-password')
        db.admin_reset_user_password(user['id'], 'changed-password')
        with self.assertRaises(ValueError):
            db.refresh_user_session(token)

    def test_password_reset_during_renewal_cannot_create_valid_session(self):
        user, token = db.register_user('race-renew', 'fixture-password')
        original = db._sign_token
        def reset(*args, **kwargs):
            db.admin_reset_user_password(user['id'], 'changed-password')
            return original(*args, **kwargs)
        with mock.patch.object(db.time, 'time', return_value=time.time()+25*86400), mock.patch.object(db, '_sign_token', side_effect=reset):
            _, renewed = db.refresh_user_session(token)
        self.assertIsNone(db.verify_token(renewed))
