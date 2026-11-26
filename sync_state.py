"""Whitelisted snapshot merge with durable viewing-history tombstones."""
import time

KEYS = frozenset(('like', 'history', 'channels', 'music_favs', 'music_fav_groups', 'music_hist', 'm_br',
                  'progress', 'novel_shelf', 'novel_hist', 'novel_prog', 'novel_cfg',
                  'nh_shist_vod', 'nh_shist_music', 'nh_shist_novel', 'history_deleted', 'history_cleared_at'))


def merge(old, new):
    if not isinstance(new, dict): raise ValueError('同步数据必须为对象')
    old = old if isinstance(old, dict) else {}
    out = {k: v for data in (old, new) for k, v in data.items() if k in KEYS and v is not None}
    def stamp(value):
        try: return max(0, min(int(value or 0), int(time.time()*1000)+300000))
        except (TypeError, ValueError, OverflowError): return 0
    cleared = max(stamp(old.get('history_cleared_at')), stamp(new.get('history_cleared_at')))
    deleted = {}
    for data in (old, new):
        obj = data.get('history_deleted')
        if isinstance(obj, dict):
            for k, v in obj.items():
                if len(str(k)) <= 220: deleted[str(k)] = max(deleted.get(str(k), 0), stamp(v))
    if len(deleted) > 10000: raise ValueError('历史删除记录过多，请联系管理员归档')
    def allowed(key, value):
        return (not cleared or stamp(value.get('cleared_at')) >= cleared) and (not deleted.get(key) or stamp(value.get('deleted_at')) >= deleted[key])
    rows = {}; progress = {}
    for data in (old, new):
        history = data.get('history')
        if isinstance(history, list):
            for item in history[:200]:
                if not isinstance(item, dict): continue
                key = str(item.get('srcId') or '') + ':' + str(item.get('id') or '')
                if allowed(key, item) and stamp(item.get('at')) >= stamp(rows.get(key, {}).get('at')): rows[key] = item
        values = data.get('progress')
        if isinstance(values, dict):
            for key, value in list(values.items())[:2000]:
                if isinstance(value, dict) and allowed(key, value) and stamp(value.get('at')) >= stamp(progress.get(key, {}).get('at')): progress[key] = value
    out.update(history=sorted(rows.values(), key=lambda x: stamp(x.get('at')), reverse=True)[:100], progress=progress,
               history_deleted=deleted, history_cleared_at=cleared)
    return out
