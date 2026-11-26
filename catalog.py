"""Persistent managed MacCMS catalog. Standard library only; no remote code execution."""
import concurrent.futures as futures
import contextlib
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
import urllib.error

import safe_http

DEFAULT_SUBSCRIPTION = 'https://gist.githubusercontent.com/Shupian0510/2d02c1377bcec7c4cbb4abdc7cee0baa/raw/libretv-33-sources.json'
_POOL = futures.ThreadPoolExecutor(max_workers=6, thread_name_prefix='catalog-http')
_SLOTS = threading.BoundedSemaphore(24)
_FOREGROUND = 0
_ACTIVITY_LOCK = threading.Lock()


class BusyError(ValueError):
    pass


def normalize_url(value):
    value = str(value or '').strip()
    if len(value) > 2048 or any(ord(ch) <= 32 for ch in value) or '\\' in value:
        raise ValueError('Invalid URL')
    p = urllib.parse.urlsplit(value)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or p.fragment:
        raise ValueError('Only public HTTP URLs are supported')
    if p.port not in (None, 80, 443):
        raise ValueError('Unsupported port')
    if p.hostname.lower() in ('localhost',) or p.hostname.endswith(('.local', '.internal')) or '%' in p.hostname:
        raise ValueError('Private URL')
    try:
        ip = ipaddress.ip_address(p.hostname)
    except ValueError:
        ip = None
    if ip and not ip.is_global:
        raise ValueError('Private URL')
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path.rstrip('/'), p.query, ''))


def parse_subscription(data):
    entries = data if isinstance(data, list) else (data.get('sources') or data.get('sites')) if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries or len(entries) > 100:
        raise ValueError('Subscription must contain 1–100 entries')
    out = []; seen = set()
    for item in entries:
        if not isinstance(item, dict) or str(item.get('type', '1')) in ('3', '4'):
            continue
        name = str(item.get('name') or item.get('key') or '未命名')[:60]
        if re.search(r'成人|色情|丝袜|老鸭|黑木耳|三级片|av资源', name, re.I):
            continue
        try:
            api = normalize_url(item.get('api') or item.get('url'))
        except ValueError:
            continue
        if api not in seen:
            out.append({'name': name, 'api': api}); seen.add(api)
    if not out:
        raise ValueError('No supported direct JSON APIs')
    return out


def fingerprint(item):
    # Unknown discriminators deliberately prevent merging across upstreams.
    values = tuple(str(item.get(k) or '').strip().casefold() for k in ('name', 'year', 'typeName', 'lang', 'season'))
    return values if all(values) else None


def merge_items(items):
    out = []; groups = {}
    for item in items:
        item = dict(item)
        route = {'srcId': item['srcId'], 'id': item['id']}
        key = fingerprint(item)
        if key and key in groups:
            groups[key]['routes'].append(route)
        else:
            item['routes'] = [route]; out.append(item)
            if key: groups[key] = item
    return out


class Catalog:
    def __init__(self, path, seeds=None, default_subscription=True):
        self.path = str(path)
        self.lock = threading.RLock()
        self.jobs_lock = threading.Lock()
        self.cache = {}; self.pending = {}; self.tickets = {}
        self.query_slots = threading.BoundedSemaphore(8)
        self.waiter_slots = threading.BoundedSemaphore(16)
        self.last_job = {}; self.started = False
        with self.connection() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS catalog_sources(
                    id TEXT PRIMARY KEY, owner INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL,
                    api TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'candidate', disabled INTEGER NOT NULL DEFAULT 0,
                    successes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
                    first_good INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0,
                    latency REAL NOT NULL DEFAULT 4000, quality REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
                    UNIQUE(owner,api));
                CREATE TABLE IF NOT EXISTS catalog_aliases(owner INTEGER, legacy TEXT, source_id TEXT,
                    PRIMARY KEY(owner,legacy));
                CREATE TABLE IF NOT EXISTS catalog_alias_conflicts(owner INTEGER, legacy TEXT, source_id TEXT,
                    PRIMARY KEY(owner,legacy,source_id));
                CREATE TABLE IF NOT EXISTS catalog_subscriptions(id TEXT PRIMARY KEY, name TEXT, url TEXT UNIQUE,
                    enabled INTEGER DEFAULT 1, checked_at INTEGER DEFAULT 0, error TEXT DEFAULT '');
                CREATE TABLE IF NOT EXISTS catalog_meta(key TEXT PRIMARY KEY, value TEXT);
            ''')
            for table, fields in {'catalog_sources': {'completeness':'INTEGER DEFAULT 0', 'media_ok':'INTEGER DEFAULT 0'},
                                  'catalog_subscriptions': {'etag':"TEXT DEFAULT ''", 'modified':"TEXT DEFAULT ''", 'failures':'INTEGER DEFAULT 0', 'next_at':'INTEGER DEFAULT 0', 'payload':"TEXT DEFAULT ''"}}.items():
                existing = {r['name'] for r in c.execute(f'PRAGMA table_info({table})')}
                for name, definition in fields.items():
                    if name not in existing: c.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
            seeded = c.execute("SELECT 1 FROM catalog_meta WHERE key='seeded'").fetchone()
            if not seeded:
                if seeds is None:
                    seeds = json.loads((Path(__file__).parent / 'sources.json').read_text(encoding='utf-8'))
                for item in seeds:
                    try: api = normalize_url(item['api'])
                    except (ValueError, KeyError): continue
                    c.execute("INSERT OR IGNORE INTO catalog_sources(id,name,api,state,disabled) VALUES(?,?,?,'active',?)",
                              (item['id'], item.get('name', item['id']), api, int(not item.get('enabled', True))))
                c.execute("INSERT INTO catalog_meta VALUES('seeded','1')")
                if default_subscription:
                    c.execute('INSERT OR IGNORE INTO catalog_subscriptions(id,name,url) VALUES(?,?,?)',
                              ('community-json', '社区 JSON 订阅', DEFAULT_SUBSCRIPTION))

    @contextlib.contextmanager
    def connection(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            with c: yield c
        finally:
            c.close()

    def sources(self, owner=0):
        with self.connection() as c:
            rows = c.execute('SELECT * FROM catalog_sources WHERE owner=? ORDER BY quality DESC,latency,id', (owner,)).fetchall()
        return [dict(r, enabled=r['state'] == 'active' and not r['disabled']) for r in rows]

    def resolve(self, source_id, owner=0):
        source_id = str(source_id)
        canonical = source_id.startswith('c:')
        if canonical: source_id = source_id[2:]
        with self.connection() as c:
            if not canonical and owner and c.execute('SELECT 1 FROM catalog_alias_conflicts WHERE owner=? AND legacy=?', (owner, source_id)).fetchone():
                return None
            # New results use canonical IDs; only legacy bookmarks consult private aliases.
            row = c.execute('SELECT s.* FROM catalog_aliases a JOIN catalog_sources s ON s.id=a.source_id WHERE a.owner=? AND a.legacy=?',
                            (owner, source_id)).fetchone() if owner and not canonical else None
            if not row:
                row = c.execute('SELECT * FROM catalog_sources WHERE id=? AND owner IN (0,?)', (str(source_id), owner)).fetchone()
        return dict(row) if row else None

    def ingest(self, entries, owner=0, limit=20):
        added = []
        with self.connection() as c:
            count = c.execute('SELECT count(*) FROM catalog_sources WHERE owner=?', (owner,)).fetchone()[0]
            for item in entries:
                if len(added) >= limit or count >= (500 if not owner else 40): break
                try: api = normalize_url(item.get('api') or item.get('url'))
                except ValueError: continue
                source_id = 's_' + hashlib.sha256(f'{owner}:{api}'.encode()).hexdigest()[:20]
                cur = c.execute('INSERT OR IGNORE INTO catalog_sources(id,owner,name,api,state) VALUES(?,?,?,?,?)',
                                (source_id, owner, str(item.get('name') or '私人线路')[:60], api, 'active' if owner else 'candidate'))
                if cur.rowcount: added.append(source_id); count += 1
        return added

    def migrate_private(self, owner, entries):
        if not owner or not isinstance(entries, list): return
        for item in entries[:100]:
            if not isinstance(item, dict) or not item.get('id'): continue
            try: api = normalize_url(item.get('api'))
            except ValueError: continue
            with self.connection() as c:
                public = c.execute('SELECT id FROM catalog_sources WHERE owner=0 AND api=?', (api,)).fetchone()
            if public: sid = public['id']
            else:
                self.ingest([item], owner=owner)
                with self.connection() as c:
                    row = c.execute('SELECT id FROM catalog_sources WHERE owner=? AND api=?', (owner, api)).fetchone()
                if not row: continue
                sid = row['id']
            with self.connection() as c:
                legacy = str(item['id'])[:100]
                existing = c.execute('SELECT source_id FROM catalog_aliases WHERE owner=? AND legacy=?', (owner,legacy)).fetchone()
                if existing and existing['source_id'] != sid:
                    c.executemany('INSERT OR IGNORE INTO catalog_alias_conflicts VALUES(?,?,?)',
                                  [(owner,legacy,existing['source_id']),(owner,legacy,sid)])
                c.execute('INSERT OR IGNORE INTO catalog_aliases VALUES(?,?,?)', (owner, legacy, sid))

    def set_enabled(self, source_id, enabled):
        with self.connection() as c:
            c.execute('UPDATE catalog_sources SET disabled=? WHERE id=? AND owner=0', (int(not enabled), source_id))
        with self.lock: self.cache.clear()

    def add_subscription(self, name, url, enabled=True):
        url = normalize_url(url)
        if not url.startswith('https://'): raise ValueError('订阅必须使用 HTTPS')
        with self.connection() as c:
            if c.execute('SELECT count(*) FROM catalog_subscriptions').fetchone()[0] >= 10 and not c.execute('SELECT 1 FROM catalog_subscriptions WHERE url=?', (url,)).fetchone():
                raise ValueError('最多 10 个订阅')
            sid = hashlib.sha256(url.encode()).hexdigest()[:20]
            c.execute('INSERT INTO catalog_subscriptions(id,name,url,enabled) VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET name=excluded.name,enabled=excluded.enabled',
                      (sid, str(name or 'JSON 订阅')[:60], url, int(bool(enabled))))

    def status(self):
        with self.connection() as c:
            subs = [dict(r) for r in c.execute('SELECT * FROM catalog_subscriptions')]
            for sub in subs: sub.pop('payload', None)
            meta = {r['key']: r['value'] for r in c.execute("SELECT * FROM catalog_meta WHERE key!='previous'")}
        return {'items': self.sources(), 'subscriptions': subs, 'job': dict(self.last_job), 'timers': meta,
                'limits': {'per_query': 3, 'global': 6, 'sources': 8, 'seconds': 8, 'cache_seconds': 120}}

    def _request(self, url, timeout=4, max_bytes=2_097_152, background=False, headers=None, include_headers=False):
        if background:
            with _ACTIVITY_LOCK:
                if _FOREGROUND: raise BusyError('Foreground work has priority')
        if not _SLOTS.acquire(blocking=False): raise BusyError('Upstream queue full')
        try:
            future = _POOL.submit(safe_http.request, url, timeout=timeout, max_bytes=max_bytes, headers=headers, include_headers=include_headers)
        except Exception:
            _SLOTS.release(); raise
        future.add_done_callback(lambda _: _SLOTS.release())
        try: return future.result(timeout=timeout + .2)
        except futures.TimeoutError:
            future.cancel(); raise TimeoutError('Upstream deadline')

    def refresh_subscriptions(self, force=False):
        with self.connection() as c:
            subs = [dict(r) for r in c.execute('SELECT * FROM catalog_subscriptions WHERE enabled=1')]
        remaining = 20
        for sub in subs:
            now = int(time.time())
            if sub['next_at'] > now and (sub['failures'] or not force): continue
            error = ''; failures = 0; next_at = now + 86400
            etag = sub['etag']; modified = sub['modified']; payload = sub['payload']
            try:
                headers = {}
                if etag: headers['If-None-Match'] = etag
                if modified: headers['If-Modified-Since'] = modified
                response = self._request(sub['url'], timeout=8, background=True, headers=headers, include_headers=True)
                status, body = response[:2]
                metadata = response[4] if len(response) > 4 else {}
                if status == 200:
                    items = parse_subscription(json.loads(body))
                    payload = json.dumps(items, ensure_ascii=False)
                    etag = str(metadata.get('etag') or '')[:500]; modified = str(metadata.get('last-modified') or '')[:200]
                elif status != 304: raise ValueError('Unexpected subscription response')
                else: items = parse_subscription(json.loads(payload))
                if remaining: remaining -= len(self.ingest(items, limit=remaining))
            except BusyError: return
            except Exception as exc:
                error = type(exc).__name__; failures = sub['failures'] + 1
                delay = min(86400, 3600 * (2**min(failures-1,5)))
                if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                    try: delay = max(delay, min(86400,int(exc.headers.get('Retry-After','0'))))
                    except (ValueError, TypeError): pass
                next_at = now + delay
            with self.connection() as c:
                c.execute('UPDATE catalog_subscriptions SET checked_at=?,error=?,etag=?,modified=?,failures=?,next_at=?,payload=? WHERE id=?',
                          (now,error,etag,modified,failures,next_at,payload,sub['id']))
        self._meta('subscription_at', int(time.time()))

    def _meta(self, key, value):
        with self.connection() as c:
            c.execute('INSERT INTO catalog_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))

    def _api(self, source, params, background=False, timeout=4):
        p = urllib.parse.urlsplit(source['api'])
        query = dict(urllib.parse.parse_qsl(p.query)); query.update(params)
        url = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(query), ''))
        status, body, _, _ = self._request(url, timeout=timeout, background=background)
        data = json.loads(body)
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get('list'), list): raise ValueError('Not a JSON catalog')
        return data['list'][:100]

    def _probe(self, source):
        start = time.monotonic()
        items = self._api(source, {'ac': 'detail', 'pg': '1'}, background=True)
        if not items: raise ValueError('Empty list')
        details = self._api(source, {'ac': 'detail', 'ids': str(items[0].get('vod_id') or '')}, background=True)
        if not details: raise ValueError('Missing detail')
        episodes = self._episodes(details[0])
        if not episodes: raise ValueError('No direct media')
        url = episodes[0]['url']
        status, body, _, final = self._request(url, max_bytes=262144, background=True, headers={'Range': 'bytes=0-65535'})
        if status not in (200, 206) or not body: raise ValueError('Unplayable media')
        if '.m3u8' in url.lower():
            text = body.decode('utf-8-sig', errors='replace')
            if not text.lstrip().startswith('#EXTM3U'): raise ValueError('Invalid playlist')
            media = next((l.strip() for l in text.splitlines() if l.strip() and not l.startswith('#')), '')
            if not media: raise ValueError('Empty playlist')
            _, sample, _, _ = self._request(urllib.parse.urljoin(final, media), max_bytes=262144, background=True, headers={'Range': 'bytes=0-65535'})
            if not sample or sample.lstrip().lower().startswith((b'<html', b'<!doctype')): raise ValueError('Invalid media sample')
        elif body.lstrip().lower().startswith((b'<html', b'<!doctype')): raise ValueError('Invalid media sample')
        with self.connection() as c:
            c.execute('UPDATE catalog_sources SET completeness=?,media_ok=1 WHERE id=?', (len(episodes),source['id']))
        return True, (time.monotonic() - start) * 1000

    def check_sources(self, now=None):
        now = int(time.time() if now is None else now)
        saved_previous = False
        before = [{'id': s['id'], 'state': s['state']} for s in self.sources()]
        for source in self.sources():
            if source['disabled']: continue
            if source['state'] == 'paused' and now - source['checked_at'] < 21600: continue
            try: ok, latency = self._probe(source); error = ''
            except BusyError: return
            except Exception as exc: ok = False; latency = 4000; error = type(exc).__name__
            with self.connection() as c:
                row = c.execute('SELECT * FROM catalog_sources WHERE id=?', (source['id'],)).fetchone()
                state = row['state']; success = row['successes']; first = row['first_good']; failures = row['failures']
                if ok:
                    failures = 0
                    if not first: first = now; success = 1
                    elif now - first >= 1800: success = max(2, success + 1)
                    if state != 'active' and success >= 2:
                        if not saved_previous:
                            c.execute("INSERT INTO catalog_meta VALUES('previous',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(before),))
                            saved_previous = True
                        state = 'active'
                else:
                    failures += 1; success = 0; first = 0
                    if failures >= 3: state = 'paused'
                quality = (row['quality'] * .7 + (100 if ok else 0) * .3)
                c.execute('UPDATE catalog_sources SET state=?,successes=?,failures=?,first_good=?,checked_at=?,latency=?,quality=?,error=? WHERE id=?',
                          (state, success, failures, first, now, latency, quality, error, source['id']))
        self._meta('health_at', now)
        with self.lock: self.cache.clear()

    def rollback(self):
        with self.connection() as c:
            row = c.execute("SELECT value FROM catalog_meta WHERE key='previous'").fetchone()
            if not row: raise ValueError('没有可回滚的上版源库')
            snapshot = json.loads(row['value'])
            c.execute("UPDATE catalog_sources SET state='candidate' WHERE owner=0")
            for item in snapshot:
                c.execute('UPDATE catalog_sources SET state=? WHERE id=? AND owner=0', (item['state'], item['id']))
        with self.lock: self.cache.clear()

    def _eligible(self, owner):
        items = self.sources()
        return sorted((s for s in items if s['enabled']), key=lambda s: (-(s['quality']*.8+min(s['completeness'],100)*.1+s['media_ok']*10), s['latency']))[:8]

    def search(self, query, owner=0):
        query = str(query or '').strip()[:80]
        key = query.casefold()
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > time.monotonic(): return json.loads(cached[1])
            pending = self.pending.get(key)
            leader = pending is None
            if leader:
                if not self.query_slots.acquire(blocking=False): raise BusyError('搜索繁忙，请稍后再试')
                pending = futures.Future(); self.pending[key] = pending
        if not leader:
            if not self.waiter_slots.acquire(blocking=False): raise BusyError('搜索等待队列已满')
            try: return json.loads(pending.result(timeout=8.5))
            finally: self.waiter_slots.release()
        global _FOREGROUND
        with _ACTIVITY_LOCK: _FOREGROUND += 1
        try:
            deadline = time.monotonic() + 8
            sources = iter(self._eligible(owner)); inflight = {}; items = []; errors = 0
            # Per-query workers are bounded by 8 admitted queries and only submit 3 at a time.
            pool = futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix='catalog-query')
            def one(source):
                start = time.monotonic()
                try:
                    rows = self._api(source, {'ac': 'detail', **({'wd': query} if query else {'pg': '1'})}, timeout=min(4, max(.1, deadline-time.monotonic())))
                    self._observed(source['id'], True, (time.monotonic()-start)*1000)
                    return [self._item(r, source['id']) for r in rows if isinstance(r, dict) and r.get('vod_id') is not None and r.get('vod_name')]
                except Exception:
                    self._observed(source['id'], False, 4000); return None
            def submit():
                if time.monotonic() >= deadline or len(items) >= 24: return
                source = next(sources, None)
                if source: inflight[pool.submit(one, source)] = source
            for _ in range(3): submit()
            while inflight and time.monotonic() < deadline:
                done, _ = futures.wait(inflight, timeout=max(0, deadline-time.monotonic()), return_when=futures.FIRST_COMPLETED)
                if not done: break
                for future in done:
                    inflight.pop(future)
                    rows = future.result()
                    if rows is None: errors += 1
                    else: items.extend(rows)
                    submit()
            for future in inflight: future.cancel()
            pool.shutdown(wait=False, cancel_futures=True)
            # Stable quality order, independent of which request happened to finish first.
            rank = {'c:'+s['id']: i for i, s in enumerate(self._eligible(owner))}
            items.sort(key=lambda x: rank.get(x['srcId'], 99))
            result = {'items': merge_items(items), 'partial': bool(inflight or errors), 'managed': True}
            encoded = json.dumps(result, ensure_ascii=False)
            with self.lock:
                if len(self.cache) >= 128: self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (time.monotonic()+120, encoded)
            pending.set_result(encoded)
            return json.loads(encoded)
        except Exception as exc:
            pending.set_exception(exc); raise
        finally:
            with self.lock: self.pending.pop(key, None)
            with _ACTIVITY_LOCK: _FOREGROUND -= 1
            self.query_slots.release()

    def _observed(self, sid, ok, latency):
        with self.connection() as c:
            c.execute('UPDATE catalog_sources SET quality=quality*.9+?,latency=latency*.8+? WHERE id=?', (10 if ok else 0, latency*.2, sid))

    @staticmethod
    def _item(row, source_id):
        return {'id': str(row['vod_id'])[:100], 'srcId': 'c:'+source_id, 'name': str(row.get('vod_name') or '')[:200],
                'pic': str(row.get('vod_pic') or '')[:2048], 'remark': str(row.get('vod_remarks') or '')[:80],
                'year': str(row.get('vod_year') or '')[:10], 'typeName': str(row.get('type_name') or '')[:40],
                'lang': str(row.get('vod_lang') or '')[:30], 'season': str(row.get('vod_season') or '')[:20], 'from': '优选线路'}

    @staticmethod
    def _episodes(row):
        groups = str(row.get('vod_play_url') or '').split('$$$')
        parsed = []
        for group in groups[:12]:
            episodes = []
            for value in group.split('#')[:1000]:
                title, sep, url = value.partition('$')
                if not sep: url = title; title = '正片'
                if not re.search(r'\.(m3u8|mp4|flv|m4v|webm)(\?|$)', url, re.I): continue
                try: url = normalize_url(url)
                except ValueError: continue
                episodes.append({'n': title[:80], 'url': url})
            if episodes: parsed.append(episodes)
        return max(parsed, key=len, default=[])

    def detail(self, sid, vod_id, owner=0):
        source = self.resolve(sid, owner)
        if not source or source['disabled'] or source['state'] != 'active': raise ValueError('该记录的线路暂不可用，请重新搜索')
        vod_id = str(vod_id)
        if not re.fullmatch(r'[\w-]{1,100}', vod_id): raise ValueError('Invalid media ID')
        rows = self._api(source, {'ac': 'detail', 'ids': vod_id})
        row = next((r for r in rows if str(r.get('vod_id')) == vod_id), None)
        if not row: raise ValueError('影片详情暂不可用')
        ticket = secrets.token_urlsafe(24)
        with self.lock:
            now = time.monotonic()
            self.tickets = {k: v for k, v in self.tickets.items() if v[2] > now}
            if len(self.tickets) >= 512: self.tickets.pop(next(iter(self.tickets)))
            self.tickets[ticket] = (int(owner), source['id'], now+600)
        return {'item': self._item(row, source['id']), 'episodes': self._episodes(row),
                'description': re.sub('<[^>]+>', '', str(row.get('vod_content') or ''))[:3000], 'ticket': ticket}

    def feedback(self, owner, body):
        with self.lock: value = self.tickets.get(str(body.get('ticket') or ''))
        if not value or value[0] != int(owner) or value[2] < time.monotonic() or not isinstance(body.get('ok'), bool): return False
        with self.lock: self.tickets.pop(body['ticket'], None)
        self._observed(value[1], body['ok'], min(4000, max(0, float(body.get('latency_ms') or 1000))))
        return True

    def start_job(self, action='check'):
        if action not in ('check', 'refresh'): raise ValueError('未知任务')
        if not self.jobs_lock.acquire(blocking=False): return False
        self.last_job = {'running': True, 'action': action, 'started_at': int(time.time())}
        def work():
            try:
                if action == 'refresh': self.refresh_subscriptions(force=True)
                self.check_sources()
                self.last_job['error'] = ''
            except Exception as exc: self.last_job['error'] = type(exc).__name__
            finally:
                self.last_job.update(running=False, finished_at=int(time.time())); self.jobs_lock.release()
        threading.Thread(target=work, name='catalog-maintenance', daemon=True).start()
        return True

    def start(self):
        if self.started: return
        self.started = True
        def run():
            time.sleep(10)
            while True:
                try:
                    timers = self.status()['timers']; now = time.time()
                    subscriptions = self.status()['subscriptions']
                    if any(s['enabled'] and s['next_at'] <= now for s in subscriptions): self.start_job('refresh')
                    elif now-int(timers.get('health_at', 0)) >= 21600: self.start_job('check')
                except Exception: pass
                time.sleep(60)
        threading.Thread(target=run, name='catalog-scheduler', daemon=True).start()


_INSTANCE = None
_INSTANCE_LOCK = threading.Lock()


def current():
    global _INSTANCE
    import db
    with _INSTANCE_LOCK:
        if _INSTANCE is None or _INSTANCE.path != str(db.DB_PATH): _INSTANCE = Catalog(db.DB_PATH)
        return _INSTANCE
