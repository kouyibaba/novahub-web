#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NovaHub · 星隅 一体化网关服务：静态托管 + 安全防盗刷代理 + 商业化会员/同步 + 无损曲库 + 实时流式小说。"""

import ast
import collections
import glob
import hashlib
import hmac
import html
import http.server
from html.parser import HTMLParser
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

import db
import safe_http
import source_probe
import catalog
import backup_db

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and str(sys.argv[1]).isdigit() else int(os.environ.get("PORT", "8765"))
ENGINE_PORT = int(os.environ.get("NOVEL_ENGINE_PORT", "18423"))
ENGINE_URL = f"http://127.0.0.1:{ENGINE_PORT}"
NOVEL_DATA_DIR = os.path.join(ROOT, "novel_engine")

CTX = safe_http.TLS_CONTEXT

UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
UA_MOBILE = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36"

# 目录与章节内存缓存
_DIR_CACHE = {}
_DIR_LOCK = threading.Lock()
_CH_MEM_CACHE = {}
_CH_LOCK = threading.Lock()

# 引擎守护锁与在途任务防重集合
_ENGINE_LOCK = threading.Lock()
_INFLIGHT_LOCK = threading.Lock()
_PREFETCHING_BOOKS = set()

# 轻量滑动窗口 IP 限流器
_RATE_BUCKETS = collections.defaultdict(collections.deque)
_RATE_LOCK = threading.Lock()

def _check_rate_limit(ip, bucket, limit, window_sec=60):
    """基于客户端 IP 的轻量滑动窗口限流。"""
    now = time.time()
    key = (ip, bucket)
    with _RATE_LOCK:
        dq = _RATE_BUCKETS[key]
        while dq and now - dq[0] > window_sec:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True


# ---------- 远程运维通道（HMAC 签名鉴权，删除密钥文件即整体关闭） ----------
OPS_KEY_FILE = os.path.expanduser("~/.novahub_ops_key")
OPS_HOME = os.path.realpath(os.path.expanduser("~"))
_OPS_FAILS = collections.defaultdict(collections.deque)
_OPS_SEEN = {}


def _ops_key():
    """读取运维密钥，缺失或过短则视为通道关闭。"""
    try:
        with open(OPS_KEY_FILE, "r", encoding="utf-8") as f:
            k = f.read().strip()
        return k if len(k) >= 32 else ""
    except OSError:
        return ""


def _ops_safe_path(p):
    """将路径限制在 Termux 家目录内，防止越界读写。"""
    full = os.path.realpath(os.path.join(OPS_HOME, os.path.expanduser(p or "")))
    if full != OPS_HOME and not full.startswith(OPS_HOME + os.sep):
        raise ValueError("路径越界")
    return full


def _is_safe_proxy_target(target_url):
    """防 SSRF 校验：拒绝代理内网与环回保留地址。"""
    try:
        safe_http.resolve_public(target_url)
        return True
    except Exception:
        return False


def _http_get_full(url, headers=None, timeout=8, max_bytes=4_194_304):
    """发起通用 HTTP/HTTPS GET 请求并返回状态码、字节流、Content-Type 与重定向后的最终 URL。"""
    return safe_http.request(url, headers=headers or {"User-Agent": UA_DESKTOP},
                             timeout=timeout, max_bytes=max_bytes)


def _http_get_bytes(url, headers=None, timeout=8, max_bytes=4_194_304):
    """发起通用 HTTP/HTTPS GET 请求并返回字节流与 Content-Type（带体积上限）。"""
    return _http_get_full(url, headers=headers, timeout=timeout, max_bytes=max_bytes)[:3]


def _find_engine_binary():
    """按优先级定位小说章节解密可执行文件。"""
    exe_name = "TomatoNovelDownloader.exe" if os.name == "nt" else "TomatoNovelDownloader"
    candidates = [
        os.path.join(NOVEL_DATA_DIR, exe_name),
        os.path.join(ROOT, exe_name),
    ]
    if os.name == "nt":
        candidates.append(r"C:\Users\kkkyyy\.gemini\antigravity\scratch\tomato-downloader-web\TomatoNovelDownloader.exe")
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def _is_engine_up():
    try:
        with socket.create_connection(("127.0.0.1", ENGINE_PORT), timeout=0.4):
            return True
    except OSError:
        return False


def ensure_novel_engine():
    """守护机制：按需自动拉起后台小说解密引擎并等待就绪。"""
    if _is_engine_up():
        return True
    with _ENGINE_LOCK:
        if _is_engine_up():
            return True
        exe_path = _find_engine_binary()
        if not exe_path:
            return False
        os.makedirs(NOVEL_DATA_DIR, exist_ok=True)
        try:
            subprocess.Popen(
                [exe_path, "--server", "--data-dir", NOVEL_DATA_DIR],
                cwd=NOVEL_DATA_DIR,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(30):
                time.sleep(0.2)
                if _is_engine_up():
                    return True
        except Exception:
            return False
    return _is_engine_up()


def _clean_loose_artifacts():
    for pat in ("*.txt", "*.epub"):
        for fp in glob.glob(os.path.join(NOVEL_DATA_DIR, pat)):
            try:
                if os.path.isfile(fp):
                    os.remove(fp)
            except OSError:
                pass


def _start_cold_cache_cleaner(ttl_days=30):
    """后台定时清理线程：每 24 小时淘汰超过 30 天未访问的冷门书籍缓存目录。"""
    def _loop():
        while True:
            try:
                if os.path.isdir(NOVEL_DATA_DIR):
                    cutoff = time.time() - ttl_days * 86400
                    for name in os.listdir(NOVEL_DATA_DIR):
                        if not re.fullmatch(r"\d{15,22}", name):
                            continue
                        full = os.path.join(NOVEL_DATA_DIR, name)
                        if os.path.isdir(full) and os.path.getmtime(full) < cutoff:
                            shutil.rmtree(full, ignore_errors=True)
            except Exception:
                pass
            time.sleep(86400)

    threading.Thread(target=_loop, daemon=True).start()


def _load_cached_chapters(book_id):
    jl_path = os.path.join(NOVEL_DATA_DIR, str(book_id), "downloaded_chapters.jsonl")
    if not os.path.isfile(jl_path):
        return {}
    try:
        st = os.stat(jl_path)
    except OSError:
        return {}

    with _CH_LOCK:
        cached = _CH_MEM_CACHE.get(book_id)
        if cached and cached["mtime"] == st.st_mtime and cached["size"] == st.st_size:
            return cached["by_id"]

        by_id = {}
        try:
            with open(jl_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        cid = str(obj.get("id") or "")
                        if cid and obj.get("content"):
                            by_id[cid] = obj
                    except Exception:
                        continue
        except OSError:
            return {}

        _CH_MEM_CACHE[book_id] = {"mtime": st.st_mtime, "size": st.st_size, "by_id": by_id}
        return by_id


def _fetch_book_directory(book_id):
    now = time.time()
    with _DIR_LOCK:
        hit = _DIR_CACHE.get(book_id)
        if hit and now - hit["ts"] < 600:
            return hit["chapters"]

    url = f"https://fanqienovel.com/api/reader/directory/detail?bookId={urllib.parse.quote(str(book_id))}"
    _, body, _ = _http_get_bytes(url, headers={"User-Agent": UA_DESKTOP}, timeout=8)
    data = json.loads(body.decode("utf-8", "ignore")).get("data") or {}
    vols = data.get("chapterListWithVolume") or []

    chapters = []
    idx = 1
    for vol in vols:
        if not isinstance(vol, list):
            continue
        for ch in vol:
            item_id = str(ch.get("itemId") or "").strip()
            if not item_id:
                continue
            chapters.append({
                "index": idx,
                "id": item_id,
                "title": str(ch.get("title") or f"第{idx}章").strip(),
                "volume": str(ch.get("volume_name") or "").strip(),
            })
            idx += 1

    if chapters:
        with _DIR_LOCK:
            _DIR_CACHE[book_id] = {"ts": now, "chapters": chapters}
    return chapters


def _run_engine_range_job(book_id, start_idx, end_idx, timeout_sec=18):
    if not ensure_novel_engine():
        raise RuntimeError("章节解析引擎暂未就绪")

    payload = json.dumps({
        "book_id": str(book_id),
        "format": "txt",
        "range_start": int(start_idx),
        "range_end": int(end_idx),
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{ENGINE_URL}/api/jobs",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        job_info = json.loads(resp.read().decode("utf-8", "ignore"))
    job_id = job_info.get("id")
    if not job_id:
        raise RuntimeError("创建章节解析任务失败")

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(0.14)
        try:
            with urllib.request.urlopen(f"{ENGINE_URL}/api/jobs", timeout=4) as r:
                jobs_data = json.loads(r.read().decode("utf-8", "ignore"))
            items = jobs_data.get("items", jobs_data if isinstance(jobs_data, list) else [])
            cur = next((x for x in items if x.get("id") == job_id), None)
            if not cur:
                break
            state = cur.get("state") or cur.get("status")
            if state in ("done", "completed"):
                break
            if state in ("failed", "cancelled"):
                raise RuntimeError("章节实时解析失败，请稍后重试")
        except RuntimeError:
            raise
        except Exception:
            pass

    _clean_loose_artifacts()


def _prefetch_next_chapters_async(book_id, chapters, from_idx, count=4):
    total = len(chapters)
    start_i = from_idx + 1
    end_i = min(total, from_idx + count)
    if start_i > total:
        return

    cached_map = _load_cached_chapters(book_id)
    missing = [i for i in range(start_i, end_i + 1) if chapters[i - 1]["id"] not in cached_map]
    if not missing:
        return

    with _INFLIGHT_LOCK:
        if book_id in _PREFETCHING_BOOKS:
            return
        _PREFETCHING_BOOKS.add(book_id)

    def _worker():
        try:
            _run_engine_range_job(book_id, min(missing), max(missing), timeout_sec=25)
            _load_cached_chapters(book_id)
        except Exception:
            pass
        finally:
            with _INFLIGHT_LOCK:
                _PREFETCHING_BOOKS.discard(book_id)

    threading.Thread(target=_worker, daemon=True).start()


def _sanitize_chapter_html(raw_html):
    if not raw_html:
        return ""
    class ChapterParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
            self.blocked = 0

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "iframe", "object"):
                self.blocked += 1
            elif not self.blocked and tag in ("p", "div", "br"):
                self.parts.append("\n")

        def handle_endtag(self, tag):
            if tag in ("script", "style", "iframe", "object"):
                self.blocked = max(0, self.blocked - 1)
            elif not self.blocked and tag in ("p", "div"):
                self.parts.append("\n")

        def handle_data(self, text):
            if not self.blocked:
                self.parts.append(text)

    parser = ChapterParser()
    parser.feed(raw_html)
    return "\n".join(f"<p>{html.escape(line.strip())}</p>"
                     for line in "".join(parser.parts).splitlines() if line.strip())


class Handler(http.server.SimpleHTTPRequestHandler):
    """统一 HTTP 处理器：静态托管 + 安全代理 + 商业化鉴权/卡密/同步 + 音乐/小说网关。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_head(self):
        # One allowlist shared by inherited GET and HEAD; no directory listing.
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        allowed = {"/", "/index.html", "/admin.html", "/app.js", "/auth_session.js", "/history_state.js", "/vod_client.js", "/style.css",
                   "/manifest.json", "/icon.svg", "/endpoint.json", "/apk-version.json",
                   "/apk/novahub-latest.apk"}
        relative = path[5:] if path.startswith("/docs/") else path
        translated = self.translate_path(self.path)
        if (relative not in allowed or "\\" in path or ".." in path.split("/")
                or os.path.realpath(translated) != os.path.abspath(translated)):
            self.send_error(403, "Forbidden")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listing disabled")
        return None

    def _client_ip(self):
        xf = self.headers.get("X-Forwarded-For") or self.headers.get("X-Real-IP")
        if xf:
            return xf.split(",")[0].strip()
        return self.client_address[0] if self.client_address else "127.0.0.1"

    def _touch_presence(self, user_id, body=None, logged_in=True):
        """提取客户端设备信息与 IP，更新用户在线活跃态。"""
        if not user_id:
            return
        body = body if isinstance(body, dict) else {}
        ua = self.headers.get("User-Agent") or ""
        did = str(body.get("device_id") or self.headers.get("X-Device-Id") or "").strip()
        if not did:
            did = "ua_" + hashlib.sha256(f"{self._client_ip()}|{ua}".encode("utf-8", "ignore")).hexdigest()[:16]
        ctype = str(body.get("client_type") or self.headers.get("X-Client-Type") or "").strip()
        if not ctype:
            ctype = "app" if ("NovaHub" in ua or "wv)" in ua or "; wv" in ua) else "web"
        dinfo = str(body.get("device_info") or self.headers.get("X-Device-Info") or "").strip()
        if not dinfo:
            if "Android" in ua:
                dinfo = "Android 设备"
            elif "Windows" in ua:
                dinfo = "Windows 浏览器"
            elif "Macintosh" in ua or "Mac OS" in ua:
                dinfo = "macOS 浏览器"
            elif "iPhone" in ua or "iPad" in ua:
                dinfo = "iOS / iPadOS"
            else:
                dinfo = ua[:60] or ctype
        db.touch_user_presence(user_id, did, ctype, dinfo, self._client_ip(), logged_in=logged_in)

    def _current_user(self):
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return db.verify_token(auth[7:].strip())
        return None

    def _media_user(self, qs):
        return self._current_user() or db.verify_token((qs.get("ticket") or [""])[0], role="media")

    def _is_admin(self):
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return db.verify_admin_token(auth[7:].strip())
        return False

    def _read_json_body(self, max_bytes=1_048_576):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > max_bytes:
            return {}
        raw = self.rfile.read(n).decode("utf-8", "ignore")
        return json.loads(raw) if raw.strip() else {}

    def _is_same_origin_request(self):
        """校验 /proxy 请求来源是否同源，防止外部第三方站点盗链刷流量。"""
        host = (self.headers.get("Host") or "").lower()
        ref = (self.headers.get("Referer") or "").lower()
        orig = (self.headers.get("Origin") or "").lower()
        if not ref and not orig:
            return True  # 允许本地脚本/健康探针直接调试
        if ("kouyibaba.github.io" in ref) or ("kouyibaba.github.io" in orig):
            return True
        if host and ((host in ref) or (host in orig)):
            return True
        return False

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Client-Type, X-Device-Info")
        self.end_headers()

    def _ops_auth(self, route, file_arg, body):
        """校验运维请求签名：时间戳 5 分钟窗口 + 防重放 + 失败封禁。返回错误文本或 None。"""
        ip = self._client_ip()
        now = time.time()
        with _RATE_LOCK:
            dq = _OPS_FAILS[ip]
            while dq and now - dq[0] > 600:
                dq.popleft()
            if len(dq) >= 8:
                return "失败次数过多，已临时封禁"
        key = _ops_key()
        if not key:
            return "运维通道未启用"
        ts = self.headers.get("X-Ops-Ts") or ""
        sig = (self.headers.get("X-Ops-Sig") or "").lower()
        ok = False
        try:
            if abs(now - int(ts)) <= 300:
                msg = f"{ts}\n{self.command}\n{route}\n{file_arg}\n{hashlib.sha256(body).hexdigest()}"
                exp = hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
                ok = hmac.compare_digest(exp, sig)
        except ValueError:
            ok = False
        with _RATE_LOCK:
            if not ok:
                _OPS_FAILS[ip].append(now)
                return "签名校验失败"
            for s, t in list(_OPS_SEEN.items()):
                if now - t > 600:
                    del _OPS_SEEN[s]
            if sig in _OPS_SEEN:
                return "重放请求被拒绝"
            _OPS_SEEN[sig] = now
        return None

    def handle_ops(self, route):
        """远程运维：exec 执行命令 / upload 上传文件 / download 下载文件。"""
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > 50 * 1024 * 1024:
            return self.send_json({"error": "请求体过大"}, 413)
        body = self.rfile.read(n) if n else b""
        file_arg = urllib.parse.unquote(self.headers.get("X-Ops-File") or "")
        err = self._ops_auth(route, file_arg, body)
        if err:
            return self.send_json({"error": err}, 403)
        try:
            if route == "/api/ops/exec":
                req = json.loads(body.decode("utf-8") or "{}")
                cmd = str(req.get("cmd") or "")
                cwd = _ops_safe_path(req.get("cwd") or "novahub")
                if req.get("detach"):
                    log_f = open(os.path.join(OPS_HOME, ".novahub_ops_detach.log"), "ab")
                    subprocess.Popen(cmd, shell=True, cwd=cwd, stdin=subprocess.DEVNULL,
                                     stdout=log_f, stderr=log_f, start_new_session=True)
                    return self.send_json({"ok": True, "detached": True})
                timeout = max(1, min(300, int(req.get("timeout") or 60)))
                r = subprocess.run(cmd, shell=True, cwd=cwd, stdin=subprocess.DEVNULL,
                                   capture_output=True, timeout=timeout)
                lim = 256 * 1024
                return self.send_json({
                    "code": r.returncode,
                    "stdout": r.stdout[-lim:].decode("utf-8", "replace"),
                    "stderr": r.stderr[-lim:].decode("utf-8", "replace"),
                })
            fpath = _ops_safe_path(file_arg)
            if route == "/api/ops/upload":
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                tmp = fpath + ".ops_tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, fpath)
                return self.send_json({"ok": True, "path": fpath, "size": len(body)})
            if route == "/api/ops/download":
                with open(fpath, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self.send_json({"error": "Not found"}, 404)
        except subprocess.TimeoutExpired:
            return self.send_json({"error": "命令执行超时"}, 504)
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- 商业化账号 / 卡密 / 云端同步 ----------
    def handle_auth_register(self):
        if not _check_rate_limit(self._client_ip(), "auth", 20, 60):
            return self.send_json({"error": "操作过于频繁，请 1 分钟后再试"}, 429)
        try:
            body = self._read_json_body(16384)
            user, token = db.register_user(body.get("username"), body.get("password"))
            self.send_json({"user": user, "token": token})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_auth_login(self):
        if not _check_rate_limit(self._client_ip(), "auth", 20, 60):
            return self.send_json({"error": "操作过于频繁，请 1 分钟后再试"}, 429)
        try:
            body = self._read_json_body(16384)
            user, token = db.login_user(body.get("username"), body.get("password"))
            self._touch_presence(user["id"], body, logged_in=True)
            self.send_json({"user": user, "token": token})
        except ValueError as e:
            self.send_json({"error": str(e)}, 401)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_auth_me(self):
        auth = self.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        try:
            user, token = db.refresh_user_session(token)
        except ValueError:
            return self.send_json({"error": "登录已失效，请重新登录", "user": None}, 401)
        self._touch_presence(user["id"], logged_in=True)
        self.send_json({"user": user, "token": token})

    def handle_auth_heartbeat(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        try:
            body = self._read_json_body(4096)
        except Exception:
            body = {}
        self._touch_presence(user["id"], body, logged_in=True)
        self.send_json({"ok": True, "server_time": int(time.time())})

    def handle_auth_logout(self):
        user = self._current_user()
        if not user:
            return self.send_json({"ok": True})
        try:
            body = self._read_json_body(4096)
        except Exception:
            body = {}
        did = str(body.get("device_id") or self.headers.get("X-Device-Id") or "").strip()
        db.mark_user_offline(user["id"], did)
        self.send_json({"ok": True})

    def handle_vip_redeem(self):
        if not _check_rate_limit(self._client_ip(), "redeem", 15, 60):
            return self.send_json({"error": "兑换过于频繁，请稍后再试"}, 429)
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号后再兑换卡密"}, 401)
        try:
            body = self._read_json_body(8192)
            updated, days = db.redeem_code(user["id"], body.get("code"))
            self.send_json({"user": updated, "days": days})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_sync_get(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        catalog.current().migrate_private(user['id'], db.get_legacy_sources(user['id']))
        snap = db.get_user_sync(user["id"])
        self.send_json({"sync": snap})

    def handle_sync_post(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        try:
            body = self._read_json_body(1_048_576)
            data = body.get("data") or body
            catalog.current().migrate_private(user['id'], data.get('source'))
            ts = db.save_user_sync(user["id"], data)
            self._touch_presence(user["id"], logged_in=True)
            self.send_json({"ok": True, "updated_at": ts, 'sync': db.get_user_sync(user['id'])})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    # ---------- 站长网页后台管理接口 ----------
    def handle_catalog(self, path, qs=None):
        is_admin = path.startswith('/api/admin/')
        if is_admin and not self._is_admin():
            return self.send_json({'error': '未授权'}, 401)
        user = self._current_user()
        owner = user['id'] if user else 0
        if not is_admin and not _check_rate_limit(self._client_ip(), 'catalog', 50, 60):
            return self.send_json({'error': '请求过于频繁'}, 429)
        try:
            cat = catalog.current()
            if self.command == 'GET':
                if is_admin: return self.send_json(cat.status())
                arg = lambda key: (qs.get(key) or [''])[0]
                if path in ('/api/vod/search', '/api/vod/home'):
                    return self.send_json(cat.search(arg('q') if path.endswith('search') else '', owner))
                if path == '/api/vod/detail':
                    return self.send_json(cat.detail(arg('source'), arg('id'), owner))
            body = self._read_json_body(32768)
            if path == '/api/vod/migrate':
                if not user: return self.send_json({'error': '请先登录'}, 401)
                cat.migrate_private(owner, body.get('sources'))
                return self.send_json({'ok': True})
            if path == '/api/vod/feedback':
                if not user: return self.send_json({'error': '请先登录'}, 401)
                return self.send_json({'ok': cat.feedback(owner, body)})
            if path == '/api/admin/subscriptions':
                cat.add_subscription(body.get('name'), body.get('url'), body.get('enabled', True))
            elif path == '/api/admin/sources':
                action = body.get('action')
                if action == 'toggle': cat.set_enabled(str(body.get('id') or ''), bool(body.get('enabled')))
                elif action == 'rollback': cat.rollback()
                elif action in ('check', 'refresh'):
                    return self.send_json({'started': cat.start_job(action), **cat.status()})
                elif action == 'add':
                    cat.ingest(catalog.parse_subscription([body]))
                else: raise ValueError('未知操作')
            else: raise ValueError('未知接口')
            return self.send_json(cat.status())
        except catalog.BusyError as exc:
            self.send_json({'error': str(exc)}, 429)
        except (ValueError, TypeError) as exc:
            self.send_json({'error': str(exc)}, 400)
        except Exception:
            self.send_json({'error': '片库暂不可用，请稍后重试'}, 502)

    def handle_admin_login(self):
        if not _check_rate_limit(self._client_ip(), "admin_auth", 12, 60):
            return self.send_json({"error": "尝试过于频繁，请 1 分钟后再试"}, 429)
        try:
            body = self._read_json_body(4096)
            self.send_json({"token": db.login_admin(body.get("password"))})
        except ValueError as e:
            self.send_json({"error": str(e)}, 401)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_admin_dashboard(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        data = db.get_admin_dashboard(200)
        tunnel_url = ""
        t_path = os.path.join(ROOT, ".current_tunnel_url")
        if os.path.exists(t_path):
            try:
                with open(t_path, "r", encoding="utf-8") as f:
                    tunnel_url = f.read().strip()
            except Exception:
                pass
        data["server_time"] = int(time.time())
        data["tunnel_url"] = tunnel_url
        self.send_json(data)

    def handle_admin_users(self, qs):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        q = (qs.get("q") or [""])[0]
        status = (qs.get("status") or ["all"])[0]
        try:
            limit = int((qs.get("limit") or ["200"])[0])
        except ValueError:
            limit = 200
        self.send_json({"users": db.list_admin_users(q, status, limit)})

    def handle_admin_online(self, qs):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            window_sec = int((qs.get("window") or ["180"])[0])
        except ValueError:
            window_sec = 180
        self.send_json(db.list_online_presence(window_sec=window_sec, limit=200))

    def handle_admin_user_vip(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(4096)
            user = db.admin_set_user_vip(
                body.get("user_id"),
                body.get("action"),
                body.get("days") or 0,
            )
            self.send_json({"ok": True, "user": user})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_admin_user_reset_pwd(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(4096)
            db.admin_reset_user_password(body.get("user_id"), body.get("new_password"))
            self.send_json({"ok": True})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_admin_delete_code(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(4096)
            db.delete_unused_code(body.get("code"))
            self.send_json({"ok": True})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_admin_gen_codes(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(8192)
            count = max(1, min(100, int(body.get("count") or 1)))
            days = max(1, min(36500, int(body.get("days") or 30)))
            note = str(body.get("note") or "")[:40]
            codes = db.generate_codes(count, days, note)
            self.send_json({"codes": codes, "days": days})
        except Exception as e:
            self.send_json({"error": str(e)}, 400)

    def handle_admin_config(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(16384)
            self.send_json({"ok": True, "config": db.configure_site(body)})
        except Exception as e:
            self.send_json({"error": str(e)}, 400)

    def handle_admin_password(self):
        if not self._is_admin():
            return self.send_json({"error": "未授权"}, 401)
        try:
            body = self._read_json_body(4096)
            db.set_admin_password(body.get("old_password"), body.get("new_password"))
            self.send_json({"ok": True})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    # ---------- 音乐曲库网关 ----------
    def handle_kuwo(self, qs):
        act = qs.get("act", [""])[0]
        if act == "url":
            user = self._current_user()
            if not user:
                return self.send_json({"error": "请先登录账号"}, 401)
            bitrate = (qs.get("br") or ["128"])[0]
            if bitrate not in ("128", "192", "320", "999"):
                return self.send_json({"error": "无效音质"}, 400)
            if bitrate in ("320", "999") and not user["is_pro"]:
                return self.send_json({"error": "该音质需要 Pro 会员"}, 403)
        try:
            if act == "search":
                q = urllib.parse.quote(qs.get("q", [""])[0])
                rn = int(qs.get("rn", ["40"])[0])
                # show_copyright_off=0 仅请求在架可播曲目，减少无版权或下架杂曲返回
                u = (
                    f"http://search.kuwo.cn/r.s?all={q}&ft=music&newsearch=1&alflac=1"
                    f"&itemset=web_2013&client=kt&cluster=0&pn=0&rn={rn}&vermerge=1"
                    f"&rformat=json&encoding=utf8&show_copyright_off=0&pcmp4=1&ver=mbox&vipver=MUSIC_8.7.6.0.BCS31"
                )
                _, raw_b, _ = _http_get_bytes(u, headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
                d = ast.literal_eval(raw_b.decode("utf-8", "ignore"))
                out = []
                for it in d.get("abslist", []):
                    # 过滤已下架或无音质流信息的不可播曲目
                    if str(it.get("ONLINE", "1")) == "0":
                        continue
                    if not str(it.get("N_MINFO", "")).strip():
                        continue
                    rid = str(it.get("MUSICRID", "")).replace("MUSIC_", "").strip()
                    if not rid:
                        continue
                    pic_s = it.get("web_albumpic_short", "")
                    pic = ("https://img2.kuwo.cn/star/albumcover/" + pic_s.replace("120/", "500/")) if pic_s else ""
                    clean = lambda s: html.unescape(s or "").replace("\u00a0", " ").strip()
                    out.append({
                        "id": rid,
                        "name": clean(it.get("SONGNAME") or it.get("NAME")),
                        "artist": clean(it.get("ARTIST")).replace("\\u0026", " / ").replace("&", " / ").strip(),
                        "album": clean(it.get("ALBUM")) or "单曲收录",
                        "source": "kuwo",
                        "pic": pic,
                        "url": "",
                        "lrc": "",
                    })
                self.send_json(out)
                return

            if act == "url":
                rid = urllib.parse.quote(qs.get("id", [""])[0])
                br_in = qs.get("br", ["128"])[0]
                # 高码率逐级降级至 128kmp3，并统一升级 HTTPS 避免浏览器混合内容拦截
                br_chains = {
                    "999": ["2000kflac", "320kmp3", "192kmp3", "128kmp3"],
                    "320": ["320kmp3", "192kmp3", "128kmp3"],
                    "192": ["192kmp3", "128kmp3"],
                    "128": ["128kmp3"],
                }
                to_https = lambda u: ("https://" + u[7:]) if str(u).startswith("http://") else str(u)
                for br_try in br_chains.get(br_in, ["320kmp3", "128kmp3"]):
                    try:
                        u = f"http://nmobi.kuwo.cn/mobi.s?f=web&user=0&type=convert_url_with_sign&rid={rid}&br={br_try}&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk"
                        _, raw_b, _ = _http_get_bytes(u, headers={"User-Agent": "okhttp/3.10.0"}, timeout=5)
                        d = json.loads(raw_b.decode("utf-8", "ignore"))
                        play_url = (d.get("data") or {}).get("url") or ""
                        if play_url:
                            self.send_json({"url": to_https(play_url), "br": (d.get("data") or {}).get("bitrate", 0)})
                            return
                    except Exception:
                        continue
                u2 = f"https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid={rid}&format=mp3"
                _, raw_b2, _ = _http_get_bytes(u2, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
                d2 = json.loads(raw_b2.decode("utf-8", "ignore"))
                self.send_json({"url": to_https(d2.get("url") or "")})
                return

            if act == "lrc":
                rid = urllib.parse.quote(qs.get("id", [""])[0])
                u = f"http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId={rid}"
                _, raw_b, _ = _http_get_bytes(u, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
                d = json.loads(raw_b.decode("utf-8", "ignore").strip())
                lrclist = ((d.get("data") or {}).get("lrclist")) or []
                lines = []
                for item in lrclist:
                    sec = float(item.get("time") or 0)
                    mm = int(sec // 60)
                    ss = sec - mm * 60
                    txt = html.unescape(item.get("lineLyric") or "").strip()
                    if txt:
                        lines.append(f"[{mm:02d}:{ss:05.2f}]{txt}")
                self.send_json({"lrc": "\n".join(lines)})
                return

            self.send_json({"error": "unknown act"}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    # ---------- 直播流 HLS 跨域重写代理 & 媒体流式下载 ----------
    def _live_headers(self, target_url):
        p = urllib.parse.urlsplit(target_url)
        origin = f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else ""
        h = {"User-Agent": UA_MOBILE, "Accept": "*/*"}
        if origin:
            h["Referer"] = origin + "/"
            h["Origin"] = origin
        return h

    def handle_media_download(self, qs):
        if not self._media_user(qs):
            return self.send_json({"error": "请先登录账号"}, 401)
        target = (qs.get("url") or [""])[0].strip()
        if not _is_safe_proxy_target(target):
            return self.send_json({"error": "Invalid download url"}, 400)
        raw_name = (qs.get("name") or ["novahub-media"])[0].strip()
        safe_name = re.sub(r'[\\/:*?"<>|\r\n\x00-\x1f]+', "_", raw_name)[:120].strip(" .") or "novahub-media"
        import http.client
        cur = target
        conn = None
        try:
            for _ in range(6):
                parsed, port, addresses = safe_http.resolve_public(cur)
                def connect_pinned(_dest, timeout=15, source_address=None):
                    last_err = None
                    for addr in addresses:
                        try:
                            return socket.create_connection((addr, port), 15, source_address)
                        except OSError as exc:
                            last_err = exc
                    raise last_err or OSError("No target address")
                conn = http.client.HTTPSConnection(parsed.hostname, port, timeout=15, context=CTX) if parsed.scheme == "https" else http.client.HTTPConnection(parsed.hostname, port, timeout=15)
                conn._create_connection = connect_pinned
                path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
                conn.request("GET", path, headers={"User-Agent": UA_MOBILE, "Accept": "*/*"})
                resp = conn.getresponse()
                if resp.status in (301, 302, 303, 307, 308):
                    loc = resp.getheader("Location")
                    conn.close(); conn = None
                    if not loc:
                        raise ValueError("Redirect without Location")
                    nxt = urllib.parse.urljoin(cur, loc)
                    if parsed.scheme == "https" and urllib.parse.urlsplit(nxt).scheme != "https":
                        raise ValueError("HTTPS downgrade rejected")
                    cur = nxt
                    continue
                if resp.status >= 400:
                    conn.close(); conn = None
                    return self.send_json({"error": f"上游返回 HTTP {resp.status}"}, 502)
                max_dl = 200 * 1024 * 1024
                cl = resp.getheader("Content-Length")
                if cl and cl.isdigit() and int(cl) > max_dl:
                    conn.close(); conn = None
                    return self.send_json({"error": "文件体积超出单次下载上限 (200MB)"}, 413)
                ctype = resp.getheader("Content-Type") or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                if cl and cl.isdigit():
                    self.send_header("Content-Length", cl)
                encoded_fn = urllib.parse.quote(safe_name, safe="")
                ascii_fallback = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_name) or "download"
                self.send_header("Content-Disposition", f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded_fn}')
                self.end_headers()
                sent = 0
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    sent += len(chunk)
                    if sent > max_dl:
                        break
                    self.wfile.write(chunk)
                conn.close(); conn = None
                return
            raise ValueError("Too many redirects")
        except Exception as e:
            if conn:
                try: conn.close()
                except Exception: pass
            try:
                self.send_json({"error": str(e)}, 502)
            except Exception:
                pass

    def handle_live_m3u8(self, qs):
        if not self._media_user(qs):
            return self.send_json({"error": "请先登录账号"}, 401)
        target = (qs.get("url") or [""])[0].strip()
        if not _is_safe_proxy_target(target):
            return self.send_json({"error": "Invalid live url"}, 400)
        try:
            status, data, ctype, final_url = _http_get_full(
                target, headers=self._live_headers(target), timeout=8, max_bytes=2_097_152
            )
            txt = data.decode("utf-8", "ignore")
            if "#EXTM3U" not in txt:
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            def rewrite_ref(raw_ref: str, is_playlist_hint: bool = False) -> str:
                abs_u = urllib.parse.urljoin(final_url, raw_ref.strip())
                if not _is_safe_proxy_target(abs_u):
                    return raw_ref
                path_low = urllib.parse.urlparse(abs_u).path.lower()
                route = "/api/live/m3u8" if (is_playlist_hint or path_low.endswith(".m3u8") or ".m3u8" in path_low) else "/api/live/seg"
                ticket = (qs.get("ticket") or [""])[0]
                suffix = "&ticket=" + urllib.parse.quote(ticket, safe="") if ticket else ""
                return f"{route}?url={urllib.parse.quote(abs_u, safe='')}{suffix}"

            out_lines = []
            prev_line = ""
            for line in txt.splitlines():
                s = line.strip()
                if not s:
                    out_lines.append("")
                    continue
                if s.startswith("#"):
                    if 'URI="' in s:
                        hint = s.startswith("#EXT-X-MEDIA")
                        s = re.sub(r'URI="([^"]+)"', lambda m: f'URI="{rewrite_ref(m.group(1), hint)}"', s)
                    out_lines.append(s)
                    prev_line = s
                    continue
                is_sub = prev_line.startswith("#EXT-X-STREAM-INF")
                out_lines.append(rewrite_ref(s, is_sub))
                prev_line = s

            body = ("\n".join(out_lines) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    def handle_live_seg(self, qs):
        if not self._media_user(qs):
            return self.send_json({"error": "请先登录账号"}, 401)
        target = (qs.get("url") or [""])[0].strip()
        if not _is_safe_proxy_target(target):
            return self.send_json({"error": "Invalid seg url"}, 400)
        try:
            status, data, ctype, _ = _http_get_full(
                target, headers=self._live_headers(target), timeout=10, max_bytes=12_582_912
            )
            self.send_response(status)
            self.send_header("Content-Type", ctype or "video/mp2t")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    # ---------- 小说实时在线直读网关 ----------
    def handle_novel_search(self, qs):
        raw_q = (qs.get("q") or [""])[0].strip()
        if not raw_q:
            return self.send_json({"items": []})

        id_match = re.search(r"(?:fanqienovel\.com/(?:page|reader)/|^)(\d{18,20})(?:\D|$)", raw_q)
        if id_match and ensure_novel_engine():
            bid = id_match.group(1)
            try:
                # Fixed loopback engine endpoint; never use the public proxy here.
                with urllib.request.urlopen(f"{ENGINE_URL}/api/preview/{bid}", timeout=6) as response:
                    pb = response.read(4_194_304)
                info = json.loads(pb.decode("utf-8", "ignore"))
                if info.get("book_id") or info.get("book_name"):
                    return self.send_json({
                        "items": [{
                            "book_id": str(info.get("book_id") or bid),
                            "title": info.get("book_name") or f"书籍 {bid}",
                            "author": info.get("author") or "未知作者",
                            "cover": "",
                            "category": info.get("category") or "精选",
                            "score": str(info.get("score") or ""),
                            "status": "已完结" if info.get("finished") else "连载中",
                            "abstract": info.get("description") or "",
                        }]
                    })
            except Exception:
                pass

        try:
            q_enc = urllib.parse.quote(raw_q)
            u = f"https://novel.snssdk.com/api/novel/channel/homepage/search/search/v1/?aid=1967&q={q_enc}"
            _, body, _ = _http_get_bytes(u, headers={"User-Agent": UA_MOBILE}, timeout=8)
            d = json.loads(body.decode("utf-8", "ignore"))
            ret_list = (d.get("data") or {}).get("ret_data") or []
            items = []
            seen = set()
            for it in ret_list:
                bid = str(it.get("book_id") or "").strip()
                if not bid or bid in seen:
                    continue
                title = re.sub(r"<[^>]+>", "", str(it.get("title") or "")).strip()
                if not title:
                    continue
                seen.add(bid)
                c_status = str(it.get("creation_status") or "")
                items.append({
                    "book_id": bid,
                    "title": html.unescape(title),
                    "author": html.unescape(re.sub(r"<[^>]+>", "", str(it.get("author") or "未知作者")).strip()),
                    "cover": str(it.get("thumb_url") or "").strip(),
                    "category": str(it.get("category") or "精选").strip(),
                    "score": str(it.get("score") or "").strip(),
                    "status": "已完结" if c_status == "0" else ("连载中" if c_status == "1" else ""),
                    "abstract": html.unescape(str(it.get("abstract") or "").strip()),
                })
            self.send_json({"items": items})
        except Exception as e:
            self.send_json({"items": [], "error": f"搜索请求失败: {e}"}, 502)

    def handle_novel_book(self, qs):
        book_id = (qs.get("book_id") or [""])[0].strip()
        if not re.fullmatch(r"\d{15,22}", book_id):
            return self.send_json({"error": "无效的 book_id"}, 400)
        try:
            chapters = _fetch_book_directory(book_id)
            self.send_json({
                "book_id": book_id,
                "total": len(chapters),
                "chapters": chapters,
            })
        except Exception as e:
            self.send_json({"error": f"获取章节目录失败: {e}"}, 502)

    def handle_novel_chapter(self, qs):
        book_id = (qs.get("book_id") or [""])[0].strip()
        try:
            index = int((qs.get("index") or ["1"])[0])
        except ValueError:
            index = 1

        if not re.fullmatch(r"\d{15,22}", book_id) or index < 1:
            return self.send_json({"error": "参数错误"}, 400)

        try:
            chapters = _fetch_book_directory(book_id)
            if not chapters:
                return self.send_json({"error": "未获取到该书章节列表"}, 404)
            if index > len(chapters):
                index = len(chapters)

            target = chapters[index - 1]
            item_id = target["id"]

            cached_map = _load_cached_chapters(book_id)
            ch_obj = cached_map.get(item_id)
            was_cached = ch_obj is not None

            if not ch_obj:
                _run_engine_range_job(book_id, index, index, timeout_sec=18)
                cached_map = _load_cached_chapters(book_id)
                ch_obj = cached_map.get(item_id)

            if not ch_obj or not ch_obj.get("content"):
                return self.send_json({"error": "章节内容解析为空，请重试"}, 502)

            _prefetch_next_chapters_async(book_id, chapters, index, count=4)

            self.send_json({
                "book_id": book_id,
                "index": index,
                "total": len(chapters),
                "id": item_id,
                "title": ch_obj.get("title") or target["title"],
                "volume": target.get("volume") or "",
                "content": _sanitize_chapter_html(ch_obj.get("content", "")),
                "cached": was_cached,
            })
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    # ---------- HTTP 路由入口 ----------
    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        if p in ('/api/admin/sources', '/api/admin/subscriptions', '/api/vod/migrate', '/api/vod/feedback'):
            return self.handle_catalog(p)
        if p == "/api/auth/register":
            return self.handle_auth_register()
        if p == "/api/auth/login":
            return self.handle_auth_login()
        if p == "/api/auth/heartbeat":
            return self.handle_auth_heartbeat()
        if p == "/api/auth/logout":
            return self.handle_auth_logout()
        if p == "/api/notifications/read":
            return self.handle_notifications_read()
        if p == "/api/notifications/prefs":
            return self.handle_notifications_prefs_post()
        if p == "/api/notifications/check":
            return self.handle_notifications_check()
        if p == "/api/vip/redeem":
            return self.handle_vip_redeem()
        if p == "/api/sync":
            return self.handle_sync_post()
        if p == "/api/admin/login":
            return self.handle_admin_login()
        if p == "/api/admin/codes":
            return self.handle_admin_gen_codes()
        if p == "/api/admin/codes/delete":
            return self.handle_admin_delete_code()
        if p == "/api/admin/config":
            return self.handle_admin_config()
        if p == "/api/admin/password":
            return self.handle_admin_password()
        if p == "/api/admin/user/vip":
            return self.handle_admin_user_vip()
        if p == "/api/admin/user/reset-pwd":
            return self.handle_admin_user_reset_pwd()
        if p.startswith("/api/ops/"):
            return self.handle_ops(p)
        self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if p == "/api/config":
            return self.send_json(db.get_public_config())
        if p == "/api/sources/live":
            return self.send_json({'items': [], 'managed': True})
        if p in ('/api/admin/sources', '/api/admin/subscriptions', '/api/vod/home', '/api/vod/search', '/api/vod/detail'):
            return self.handle_catalog(p, qs)
        if p == "/api/media/ticket":
            user = self._current_user()
            if not user:
                return self.send_json({"error": "请先登录账号"}, 401)
            try:
                ticket = db.sign_media_ticket(self.headers.get("Authorization", "")[7:].strip())
            except ValueError as exc:
                return self.send_json({"error": str(exc)}, 401)
            return self.send_json({"ticket": ticket})
        if p == "/api/auth/me":
            return self.handle_auth_me()
        if p == "/api/sync":
            return self.handle_sync_get()
        if p == "/api/admin/dashboard":
            return self.handle_admin_dashboard()
        if p == "/api/admin/users":
            return self.handle_admin_users(qs)
        if p == "/api/admin/online":
            return self.handle_admin_online(qs)
        if p == "/api/notifications":
            return self.handle_notifications_get(qs)
        if p == "/api/notifications/prefs":
            return self.handle_notifications_prefs_get()
        if p == "/api/media/download":
            return self.handle_media_download(qs)
        if p == "/api/ops/download":
            return self.handle_ops(p)
        if p == "/kw":
            return self.handle_kuwo(qs)
        if p == "/api/novel/search":
            return self.handle_novel_search(qs)
        if p == "/api/novel/book":
            return self.handle_novel_book(qs)
        if p == "/api/novel/chapter":
            return self.handle_novel_chapter(qs)

        if p == "/api/live/m3u8":
            return self.handle_live_m3u8(qs)
        if p == "/api/live/seg":
            return self.handle_live_seg(qs)

        if p == "/proxy":
            if not self._is_same_origin_request():
                return self.send_json({"error": "Forbidden origin"}, 403)
            if not _check_rate_limit(self._client_ip(), "proxy", 90, 60):
                return self.send_json({"error": "请求过于频繁"}, 429)
            target = qs.get("url", [""])[0]
            if not _is_safe_proxy_target(target):
                return self.send_json({"error": "Invalid target url"}, 400)
            try:
                status, data, ctype = _http_get_bytes(target, headers={"User-Agent": UA_MOBILE}, timeout=12)
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_json({"error": str(e)}, 502)
            return

        # send_head enforces the shared public-asset allowlist for GET and HEAD.
        super().do_GET()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/proxy":
            return self.send_json({"error": "Not found"}, 404)
        if not self._is_same_origin_request():
            return self.send_json({"error": "Forbidden origin"}, 403)
        if not self._current_user():
            return self.send_json({"error": "请先登录账号"}, 401)
        qs = urllib.parse.parse_qs(parsed.query)
        target = qs.get("url", [""])[0]
        if not _is_safe_proxy_target(target):
            return self.send_json({"error": "Invalid target url"}, 400)
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self.send_json({"error": "Invalid Content-Length"}, 400)
        if n < 0 or n > 1_048_576:
            return self.send_json({"error": "请求体过大"}, 413)
        body = self.rfile.read(n) if n else b""
        try:
            status, resp_body, ctype, _ = safe_http.request(
                target, body=body, method="PUT", timeout=20, max_bytes=100000,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Content-Type": self.headers.get("Content-Type", "application/json"),
                    "Authorization": self.headers.get("Authorization", ""),
                },
            )
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)


    def handle_notifications_get(self, qs):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        unread_only = (qs.get("unread") or ["0"])[0] == "1"
        try:
            limit = int((qs.get("limit") or ["50"])[0])
        except ValueError:
            limit = 50
        self.send_json(db.list_notifications(user["id"], unread_only=unread_only, limit=limit))

    def handle_notifications_read(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        try:
            body = self._read_json_body(4096)
        except Exception:
            body = {}
        unread_count = db.mark_notifications_read(user["id"], body.get("id") or 0)
        self.send_json({"ok": True, "unread_count": unread_count})

    def handle_notifications_prefs_get(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        self.send_json({"items": db.list_watch_items(user["id"])})

    def handle_notifications_prefs_post(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        try:
            body = self._read_json_body(8192)
            res = db.set_watch_notify(
                user["id"],
                body.get("item_type"),
                body.get("item_key"),
                bool(body.get("enabled", True)),
                title=body.get("title") or "",
                meta=body.get("meta"),
            )
            self.send_json({"ok": True, "pref": res})
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_notifications_check(self):
        user = self._current_user()
        if not user:
            return self.send_json({"error": "请先登录账号"}, 401)
        if not _check_rate_limit(f"{self._client_ip()}:{user['id']}", "notif_check", 2, 180):
            return self.send_json({"error": "检查过于频繁，请稍后再试"}, 429)
        targets = db.list_due_watch_targets(limit=6, min_interval=0, user_id=user["id"])
        checked, updated = _check_watch_targets(targets)
        res = db.list_notifications(user["id"], limit=50)
        self.send_json({"ok": True, "checked": checked, "updated": updated, **res})


def _check_watch_targets(targets):
    """低频巡检待查作品，比对集数/章节数变化并写入合并通知。"""
    checked = 0
    updated = 0
    for t in targets or []:
        itype = t.get("item_type")
        ikey = t.get("item_key") or ""
        try:
            if itype == "novel" and re.fullmatch(r"\d{15,22}", ikey):
                chapters = _fetch_book_directory(ikey)
                if chapters:
                    updated += db.record_watch_check("novel", ikey, len(chapters), chapters[-1].get("title") or "")
                checked += 1
            elif itype == "vod" and ":" in ikey:
                src_id, vod_id = ikey.rsplit(":", 1)
                detail = catalog.current().detail(src_id, vod_id, 0)
                eps = detail.get("episodes") or []
                if eps:
                    updated += db.record_watch_check("vod", ikey, len(eps), eps[-1].get("n") or "")
                checked += 1
        except Exception:
            pass
        time.sleep(0.5)
    return checked, updated


def _start_watch_update_checker():
    """后台守护线程：每 30 分钟巡检最多 8 个到期收藏/书架作品更新。"""
    def _loop():
        time.sleep(45)
        while True:
            try:
                targets = db.list_due_watch_targets(limit=8, min_interval=7200)
                if targets:
                    _check_watch_targets(targets)
            except Exception:
                pass
            time.sleep(1800)

    threading.Thread(target=_loop, name="watch-update-checker", daemon=True).start()


class ThreadedHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    db.init_db()
    catalog.current().start()
    backup_db.start_scheduler(db.DB_PATH, os.environ.get("NOVAHUB_BACKUP_DIR", os.path.join(os.path.dirname(db.DB_PATH), "backups")))
    _start_cold_cache_cleaner(ttl_days=30)
    _start_watch_update_checker()
    threading.Thread(target=ensure_novel_engine, daemon=True).start()
    print(f"NovaHub Gateway listening on http://0.0.0.0:{PORT}")
    ThreadedHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
