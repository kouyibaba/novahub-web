#!/usr/bin/env python3
"""NovaHub 平板全链路看门狗守护进程（公网探活 + 自动清僵尸 + GitHub 断点补推）。"""

import base64
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

REPO = "kouyibaba/novahub-web"
FILE_PATH = "docs/endpoint.json"
TOKEN_FILE = os.path.expanduser("~/.novahub_gh_token")
WORK_DIR = os.path.expanduser("~/novahub")
LOCK_FILE = os.path.expanduser("~/.novahub_watchdog.lock")
CURRENT_URL_FILE = os.path.join(WORK_DIR, ".current_tunnel_url")
SYNCED_URL_FILE = os.path.join(WORK_DIR, ".synced_tunnel_url")
PORT = "11785"
MAX_LOG_BYTES = 5 * 1024 * 1024
KEEP_TAIL_BYTES = 200 * 1024
CHECK_INTERVAL = 15


def log(msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [Watchdog] {msg}", flush=True)


def read_state(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def write_state(path: str, value: str):
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(value.strip())
    except Exception:
        pass


def acquire_wake_lock():
    try:
        subprocess.run(["termux-wake-lock"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
    except Exception:
        pass


def proc_alive(cmd: list[str]) -> bool:
    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
        return res.returncode == 0
    except Exception:
        return False


def trim_logs():
    for name in ("server.log", "tunnel.log", "watchdog.log"):
        path = os.path.join(WORK_DIR, name)
        try:
            if os.path.exists(path) and os.path.getsize(path) > MAX_LOG_BYTES:
                with open(path, "rb") as f:
                    f.seek(-KEEP_TAIL_BYTES, os.SEEK_END)
                    tail = f.read()
                with open(path, "wb") as f:
                    f.write(b"--- trimmed ---\n" + tail)
                log(f"已截断超大日志: {name}")
        except Exception:
            pass


def ensure_sshd():
    if not proc_alive(["pgrep", "-x", "sshd"]):
        try:
            subprocess.Popen(["sshd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            log("已拉起 sshd")
        except Exception as e:
            log(f"拉起 sshd 失败: {e}")


def probe_url(url: str, timeout: int = 8) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "NovaHub-Watchdog"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def has_internet() -> bool:
    """确认平板自身是否具备公网连通性，避免断网期间误杀隧道触发 429。"""
    for test_url in ("https://www.baidu.com", "https://api.github.com", "https://1.1.1.1"):
        try:
            req = urllib.request.Request(test_url, headers={"User-Agent": "NovaHub-Watchdog"})
            with urllib.request.urlopen(req, timeout=5) as r:
                if r.status < 500:
                    return True
        except Exception:
            continue
    return False


def probe_server() -> bool:
    return probe_url(f"http://127.0.0.1:{PORT}/api/config", timeout=3)


def start_server():
    try:
        subprocess.run(["pkill", "-9", "-f", "python3 server.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
    except Exception:
        pass
    time.sleep(1)
    log_f = open(os.path.join(WORK_DIR, "server.log"), "a", encoding="utf-8")
    subprocess.Popen(
        [sys.executable, "server.py", PORT],
        cwd=WORK_DIR,
        stdin=subprocess.DEVNULL,
        stdout=log_f,
        stderr=log_f,
        start_new_session=True,
    )
    log("已重新拉起 server.py")


def sync_pending_endpoint() -> bool:
    """当本地当前隧道地址与已同步至 GitHub 的地址不一致时，主动补推 endpoint.json。"""
    cur = read_state(CURRENT_URL_FILE)
    synced = read_state(SYNCED_URL_FILE)
    if not cur or cur == synced or not os.path.exists(TOKEN_FILE):
        return True
    if not re.fullmatch(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", cur):
        log("拒绝补推非法隧道地址")
        return False
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            token = f.read().strip()
        api_url = f"https://api.github.com/repos/{REPO}/contents/{FILE_PATH}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "NovaHub-Watchdog",
        }
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            sha = json.loads(resp.read().decode("utf-8"))["sha"]
        payload = {"url": cur, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00")}
        content_b64 = base64.b64encode((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode("ascii")
        body = json.dumps({"message": f"chore: sync pending tunnel endpoint {cur}", "content": content_b64, "sha": sha, "branch": "main"}).encode("utf-8")
        put_req = urllib.request.Request(api_url, data=body, headers=headers, method="PUT")
        with urllib.request.urlopen(put_req, timeout=12) as resp:
            if resp.status in (200, 201):
                write_state(SYNCED_URL_FILE, cur)
                log(f"补推 GitHub 入口成功 -> {cur}")
                return True
    except Exception as e:
        log(f"补推 GitHub 入口暂失败: {e}")
    return False


def ensure_tunnel():
    has_auto = proc_alive(["pgrep", "-f", "auto_tunnel.py"])
    if not has_auto:
        # 清理可能残留的孤儿 cloudflared，确保由唯一 auto_tunnel 托管
        if proc_alive(["pgrep", "-f", "cloudflared tunnel"]):
            subprocess.run(["pkill", "-9", "-f", "cloudflared tunnel"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
            time.sleep(1)
        log_f = open(os.path.join(WORK_DIR, "tunnel.log"), "a", encoding="utf-8")
        subprocess.Popen(
            [sys.executable, "auto_tunnel.py"],
            cwd=WORK_DIR,
            stdin=subprocess.DEVNULL,
            stdout=log_f,
            stderr=log_f,
            start_new_session=True,
        )
        log("检测到隧道管理进程离线，已拉起 auto_tunnel.py")


def main():
    lock_fp = open(LOCK_FILE, "w", encoding="utf-8")
    try:
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return

    acquire_wake_lock()
    log("看门狗守护进程启动（支持公网端到端探活与断点补推）")
    fail_streak = 0
    tunnel_fail = 0
    last_sync_try = 0.0
    tick = 0

    while True:
        try:
            if tick % 20 == 0:
                trim_logs()
                acquire_wake_lock()
            ensure_sshd()
            server_ok = probe_server()
            if server_ok:
                fail_streak = 0
            else:
                fail_streak += 1
                if fail_streak >= 2:
                    log(f"server.py 连续 {fail_streak} 次无响应，准备重启")
                    start_server()
                    fail_streak = 0
            ensure_tunnel()

            cur_url = read_state(CURRENT_URL_FILE)
            synced_url = read_state(SYNCED_URL_FILE)
            if cur_url and cur_url != synced_url and time.time() - last_sync_try >= 30:
                last_sync_try = time.time()
                sync_pending_endpoint()

            # 每 4 轮（约 60 秒）探测一次公网隧道可达性，防止进程假死
            if tick > 0 and tick % 4 == 0 and server_ok and cur_url:
                if probe_url(f"{cur_url}/api/config", timeout=8):
                    tunnel_fail = 0
                elif has_internet():
                    tunnel_fail += 1
                    log(f"公网隧道探活失败 ({tunnel_fail}/3): {cur_url}")
                    if tunnel_fail >= 3:
                        log("判定公网隧道已假死，强制清理并重建...")
                        subprocess.run(["pkill", "-9", "-f", "cloudflared tunnel"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
                        tunnel_fail = 0
                else:
                    log("外网暂不可用，跳过隧道重启避免触发 429 限流")
        except Exception as e:
            log(f"巡检异常: {e}")
        tick += 1
        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
