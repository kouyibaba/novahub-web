"""Cached MacCMS source health, refreshed on startup and every six hours."""
import concurrent.futures
import json
from pathlib import Path
import threading
import time

import safe_http

_LOCK = threading.Lock()
_ITEMS = []
_CHECKED_AT = None


def load_sources():
    with (Path(__file__).parent / "sources.json").open(encoding="utf-8") as stream:
        return json.load(stream)


def snapshot():
    with _LOCK:
        return {"items": [dict(item) for item in _ITEMS], "checked_at": _CHECKED_AT}


def probe_once(sources=None):
    def probe(source):
        started = time.monotonic()
        url = source["api"].rstrip("/") + "/?ac=detail&pg=1"
        try:
            status, body, _, _ = safe_http.request(url, timeout=5, max_bytes=4_194_304)
            data = json.loads(body)
            if status != 200 or not isinstance(data, dict) or not isinstance(data.get("list"), list):
                return None
            return {**source, "enabled": True, "latency_ms": round((time.monotonic() - started) * 1000)}
        except Exception:
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        items = [item for item in pool.map(probe, load_sources() if sources is None else sources) if item]
    items.sort(key=lambda item: item["latency_ms"])
    global _ITEMS, _CHECKED_AT
    with _LOCK:
        _ITEMS = items
        _CHECKED_AT = int(time.time())


def start():
    def run():
        time.sleep(8)
        while True:
            try:
                probe_once()
            except Exception as exc:
                print(f"[Sources] Probe failed: {type(exc).__name__}", flush=True)
            time.sleep(6 * 3600)
    threading.Thread(target=run, name="source-probe", daemon=True).start()
