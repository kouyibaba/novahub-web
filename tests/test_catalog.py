import concurrent.futures
import json
import pathlib
import tempfile
import threading
import time
import unittest
from unittest import mock

import catalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.temp.name) / 'catalog.db')
        self.seeds = [{'id': 'a', 'name': 'A', 'api': 'https://a.example/api.php/provide/vod'}]
        self.cat = catalog.Catalog(self.path, seeds=self.seeds, default_subscription=False)

    def tearDown(self):
        self.temp.cleanup()

    def test_seed_disable_survives_restart_and_subscription(self):
        self.cat.set_enabled('a', False)
        self.cat.ingest(self.seeds)
        other = catalog.Catalog(self.path, seeds=self.seeds, default_subscription=False)
        self.assertFalse(other.sources()[0]['enabled'])

    def test_formats_ignore_executable_sources_and_private_urls(self):
        data = {'sites': [{'key': 'ok', 'name': 'normal', 'type': 1, 'api': 'https://good.example/api.php'},
                          {'name': 'spider', 'type': 3, 'api': 'csp_Bad'},
                          {'name': 'local', 'api': 'http://127.0.0.1/api.php'}]}
        self.assertEqual(len(catalog.parse_subscription(data)), 1)
        with self.assertRaises(ValueError):
            catalog.parse_subscription({'sources': []})
        with self.assertRaises(ValueError):
            catalog.parse_subscription({'sources': self.seeds * 101})

    def test_failed_feed_retains_last_good_sources(self):
        self.cat.add_subscription('test', 'https://feed.example/list.json')
        with mock.patch.object(self.cat, '_request', return_value=(200, b'{"sources":[]}', '', '')):
            self.cat.refresh_subscriptions()
        self.assertEqual([x['id'] for x in self.cat.sources() if x['enabled']], ['a'])
        self.assertIn('ValueError', self.cat.status()['subscriptions'][0]['error'])

    def test_candidate_requires_two_separated_rounds_and_rollback(self):
        self.cat.ingest([{'name': 'B', 'api': 'https://b.example/api.php'}])
        candidate = next(x for x in self.cat.sources() if x['id'] != 'a')
        with mock.patch.object(self.cat, '_probe', return_value=(True, 100)):
            self.cat.check_sources(now=1000)
            self.cat.check_sources(now=1001)
            self.assertFalse(next(x for x in self.cat.sources() if x['id'] == candidate['id'])['enabled'])
            self.cat.check_sources(now=2801)
        self.assertTrue(next(x for x in self.cat.sources() if x['id'] == candidate['id'])['enabled'])
        self.cat.rollback()
        self.assertFalse(next(x for x in self.cat.sources() if x['id'] == candidate['id'])['enabled'])

    def test_private_alias_is_isolated_and_conflict_does_not_override(self):
        legacy = [{'id': 'custom', 'name': 'private', 'api': 'https://private.example/api.php'}]
        self.cat.migrate_private(7, legacy)
        private = self.cat.resolve('custom', 7)
        self.assertEqual(private['owner'], 7)
        self.assertIsNone(self.cat.resolve('custom', 8))
        self.assertIsNone(self.cat.resolve(private['id'], 8))
        self.cat.migrate_private(7, [{'id': 'custom', 'api': 'https://other.example/api.php'}])
        self.assertIsNone(self.cat.resolve('custom', 7), 'ambiguous alias must become unavailable')
        with self.cat.connection() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM catalog_alias_conflicts').fetchone()[0], 2)
        self.assertEqual(len(self.cat.sources()), 1)

    def test_search_cache_coalesces_and_redacts_source_urls(self):
        calls = []
        def fetch(*args, **kwargs):
            calls.append(args[0]); time.sleep(.04)
            return 200, json.dumps({'list': [{'vod_id': 1, 'vod_name': '测试', 'vod_year': '2026', 'type_name': '电影'}]}).encode(), '', ''
        with mock.patch.object(self.cat, '_request', side_effect=fetch):
            with concurrent.futures.ThreadPoolExecutor(4) as pool:
                results = list(pool.map(lambda _: self.cat.search('测试'), range(4)))
            self.cat.search('测试')
        self.assertEqual(len(calls), 1)
        self.assertEqual(results[0]['items'][0]['srcId'], 'c:a')
        self.assertNotIn('a.example', json.dumps(results))

    def test_search_budgets_and_shared_global_limit(self):
        self.cat.ingest([{'name': str(i), 'api': f'https://s{i}.example/api.php'} for i in range(12)])
        with self.cat.connection() as c:
            c.execute("UPDATE catalog_sources SET state='active'")
        lock = threading.Lock(); active = 0; peak = 0; calls = 0
        def fetch(*args, **kwargs):
            nonlocal active, peak, calls
            with lock: active += 1; peak = max(peak, active); calls += 1
            time.sleep(.025)
            with lock: active -= 1
            return 200, b'{"list":[]}', '', ''
        with mock.patch.object(catalog.safe_http, 'request', side_effect=fetch):
            self.cat.search('one')
            self.assertLessEqual(peak, 3); self.assertLessEqual(calls, 8)
            peak = 0
            with concurrent.futures.ThreadPoolExecutor(4) as pool:
                list(pool.map(self.cat.search, ['two', 'three', 'four', 'five']))
            self.assertLessEqual(peak, 6)

    def test_conservative_merge_keeps_unknown_year_and_different_seasons(self):
        items = [{'name': '剧', 'year': year, 'typeName': '剧集', 'lang': '国语', 'season': season, 'srcId': str(i), 'id': '1'}
                 for i, (year, season) in enumerate([('2026', '1'), ('2026', '1'), ('2026', '2'), ('', '1'), ('', '1')])]
        merged = catalog.merge_items(items)
        self.assertEqual(len(merged), 4)
        self.assertEqual(len(merged[0]['routes']), 2)

    def test_feedback_requires_recent_issued_ticket_and_only_once(self):
        self.assertFalse(self.cat.feedback(1, {'ticket': 'invented', 'ok': False}))
        self.assertEqual(self.cat.sources()[0]['failures'], 0)

    def test_empty_list_and_html_media_never_promote_candidate(self):
        with mock.patch.object(self.cat, '_api', return_value=[]):
            with self.assertRaises(ValueError): self.cat._probe(self.cat.sources()[0])
        row = {'vod_id': '1', 'vod_play_url': '正片$https://cdn.example/x.m3u8'}
        with mock.patch.object(self.cat, '_api', return_value=[row]), mock.patch.object(self.cat, '_request', return_value=(200, b'<html>blocked</html>', '', 'https://cdn.example/x.m3u8')):
            with self.assertRaises(ValueError): self.cat._probe(self.cat.sources()[0])

    def test_multiple_promotions_rollback_to_previous_whole_batch(self):
        self.cat.ingest([{'api': 'https://b.example/api.php'}, {'api': 'https://c.example/api.php'}])
        with mock.patch.object(self.cat, '_probe', return_value=(True, 10)):
            self.cat.check_sources(now=1000); self.cat.check_sources(now=2801)
        self.assertEqual(sum(x['enabled'] for x in self.cat.sources()), 3)
        self.cat.rollback()
        self.assertEqual(sum(x['enabled'] for x in self.cat.sources()), 1)

    def test_overload_queue_is_bounded(self):
        for _ in range(8): self.assertTrue(self.cat.query_slots.acquire(False))
        try:
            with self.assertRaises(catalog.BusyError): self.cat.search('overload')
        finally:
            for _ in range(8): self.cat.query_slots.release()

    def test_subscription_uses_conditional_requests_and_backoff(self):
        self.cat.add_subscription('test', 'https://feed.example/list.json')
        good=json.dumps({'sources':self.seeds}).encode()
        with mock.patch.object(self.cat,'_request',return_value=(200,good,'','',{'etag':'"v1"'})):
            self.cat.refresh_subscriptions()
        with mock.patch.object(self.cat,'_request',return_value=(304,b'','','',{})) as request:
            self.cat.refresh_subscriptions(force=True)
            self.assertEqual(request.call_args.kwargs['headers']['If-None-Match'],'"v1"')
        with mock.patch.object(self.cat,'_request',side_effect=ValueError('bad')):
            self.cat.refresh_subscriptions(force=True)
        with mock.patch.object(self.cat,'_request') as request:
            self.cat.refresh_subscriptions(force=True)
            request.assert_not_called()

    def test_search_stops_expanding_after_sufficient_results(self):
        self.cat.ingest([{'api':f'https://x{i}.example/api.php'} for i in range(8)])
        with self.cat.connection() as c:c.execute("UPDATE catalog_sources SET state='active'")
        payload=json.dumps({'list':[{'vod_id':i,'vod_name':f'film{i}'} for i in range(30)]}).encode()
        with mock.patch.object(self.cat,'_request',return_value=(200,payload,'','')) as request:
            self.cat.search('film')
            self.assertLessEqual(request.call_count,3)

    def test_canonical_search_identity_cannot_resolve_to_legacy_alias(self):
        self.cat.migrate_private(7,[{'id':'a','api':'https://private.example/api.php'}])
        row=catalog.Catalog._item({'vod_id':'1','vod_name':'public'},'a')
        self.assertEqual(self.cat.resolve(row['srcId'],7)['api'],self.seeds[0]['api'])
        self.assertEqual(self.cat.resolve('a',7)['owner'],7)

    def test_private_compatibility_sources_are_not_search_candidates(self):
        self.cat.migrate_private(7,[{'id':'private','api':'https://private.example/api.php'}])
        self.assertTrue(all(s['owner']==0 for s in self.cat._eligible(7)))

    def test_304_continues_persistent_subscription_batch(self):
        self.cat.add_subscription('large','https://feed.example/large.json')
        payload=json.dumps({'sources':[{'api':f'https://feed{i}.example/api.php'} for i in range(45)]}).encode()
        with mock.patch.object(self.cat,'_request',return_value=(200,payload,'','',{'etag':'v1'})):
            self.cat.refresh_subscriptions()
        self.assertEqual(len(self.cat.sources()),21)
        other=catalog.Catalog(self.path,seeds=self.seeds,default_subscription=False)
        with mock.patch.object(other,'_request',return_value=(304,b'','','',{})):
            other.refresh_subscriptions(force=True)
        self.assertEqual(len(other.sources()),41)

    def test_public_same_query_coalesces_across_accounts_and_bounds_waiters(self):
        started=threading.Event();release=threading.Event();calls=[]
        def request(*args,**kw):
            calls.append(args[0]);started.set();release.wait(2);return 200,b'{"list":[]}', '', ''
        with mock.patch.object(self.cat,'_request',side_effect=request), concurrent.futures.ThreadPoolExecutor(2) as pool:
            first=pool.submit(self.cat.search,'same',1);self.assertTrue(started.wait(1))
            for _ in range(16):self.assertTrue(self.cat.waiter_slots.acquire(False))
            try:
                with self.assertRaises(catalog.BusyError):self.cat.search('same',2)
            finally:
                for _ in range(16):self.cat.waiter_slots.release()
            second=pool.submit(self.cat.search,'same',2);release.set();first.result();second.result()
        self.assertEqual(len(calls),1)


if __name__ == '__main__':
    unittest.main()

