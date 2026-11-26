#!/usr/bin/env python3
"""NovaHub 平板常驻隧道与自动更新 GitHub Pages 入口脚本（TCP HTTP/2 防假死版）。"""

import base64
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

REPO = "kouyibaba/novahub-web"
FILE_PATH = "docs/endpoint.json"
TOKEN_FILE = os.path.expanduser("~/.novahub_gh_token")
LOCK_FILE = os.path.expanduser("~/.novahub_tunnel.lock")
WORK_DIR = os.path.expanduser("~/novahub")
CURRENT_URL_FILE = os.path.join(WORK_DIR, ".current_tunnel_url")
SYNCED_URL_FILE = os.path.join(WORK_DIR, ".synced_tunnel_url")
PORT = "11785"

DIAL_ERR_KEYWORDS = (
    "network is unreachable",
    "Failed to dial",
    "Unable to establish connection",
    "context deadline exceeded",
)


def acquire_wake_lock():
    """申请 Termux 唤醒锁，忽略未安装报错。"""
    try:
        subprocess.run(["termux-wake-lock"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
    except Exception:
        pass


def write_state(path: str, value: str):
    """写入单行状态文件，供看门狗进程协同探活。"""
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(value.strip())
    except Exception:
        pass


def ensure_server():
    """确保 NovaHub 后端服务正在运行。"""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/config", timeout=2)
        return
    except Exception:
        pass
    print("[NovaHub] 正在启动后端服务...", flush=True)
    log_f = open(os.path.join(WORK_DIR, "server.log"), "a", encoding="utf-8")
    subprocess.Popen(
        [sys.executable, "server.py", PORT],
        cwd=WORK_DIR,
        stdin=subprocess.DEVNULL,
        stdout=log_f,
        stderr=log_f,
        start_new_session=True,
    )
    time.sleep(2)


def update_github_endpoint(new_url: str, token: str) -> bool:
    """通过 GitHub REST API 更新 docs/endpoint.json（支持 3 次重试），返回是否同步成功。"""
    if not re.fullmatch(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", new_url or ""):
        print("[GitHub] 拒绝发布空值或非法隧道地址", flush=True)
        return False
    api_url = f"https://api.github.com/repos/{REPO}/contents/{FILE_PATH}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "NovaHub-AutoTunnel",
    }

    last_err = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(api_url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                info = json.loads(resp.read().decode("utf-8"))
                sha = info["sha"]

            payload_obj = {
                "url": new_url,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
            }
            content_b64 = base64.b64encode(
                (json.dumps(payload_obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            ).decode("ascii")

            body = json.dumps(
                {
                    "message": f"chore: update tunnel endpoint to {new_url}",
                    "content": content_b64,
                    "sha": sha,
                    "branch": "main",
                }
            ).encode("utf-8")

            put_req = urllib.request.Request(api_url, data=body, headers=headers, method="PUT")
            with urllib.request.urlopen(put_req, timeout=15) as resp:
                if resp.status in (200, 201):
                    write_state(SYNCED_URL_FILE, new_url)
                    print(f"[GitHub] 已自动更新固定入口 -> {new_url}", flush=True)
                    return True
        except Exception as e:
            last_err = e
            print(f"[GitHub] 第 {attempt}/3 次更新失败: {e}", flush=True)
            if attempt < 3:
                time.sleep(5)
    if last_err:
        print(f"[GitHub] 自动更新暂失败，将在后台继续补推: {last_err}", flush=True)
    return False


def run_once(token: str) -> int:
    """运行一轮 cloudflared（强制 HTTP/2 + IPv4 规避 QUIC 切网死锁），返回建议重连秒数。"""
    ensure_server()
    cf_bin = shutil.which("cloudflared") or "/data/data/com.termux/files/usr/bin/cloudflared"
    print(f"[Tunnel] 正在启动 cloudflared 隧道（HTTP/2 + IPv4, bin={cf_bin}）...", flush=True)
    proc = subprocess.Popen(
        [cf_bin, "tunnel", "--protocol", "http2", "--edge-ip-version", "4", "--url", f"http://127.0.0.1:{PORT}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    current_url = ""
    synced = False
    last_sync_try = 0.0
    err_streak = 0
    hit_rate_limit = False
    pattern = re.compile(r"https://(?!api\.)[a-z0-9-]+(?:-[a-z0-9]+)+\.trycloudflare\.com")

    for line in proc.stdout:
        print(line, end="", flush=True)
        if "429" in line and ("Tunnelstore" in line or "provisioning failed" in line):
            hit_rate_limit = True
        if "Registered tunnel connection" in line:
            err_streak = 0
        if not current_url and not any(bad in line for bad in ("failed to request", 'Post "', "lookup ")):
            m = pattern.search(line)
            if m:
                current_url = m.group(0)
                write_state(CURRENT_URL_FILE, current_url)
                last_sync_try = time.time()
                synced = update_github_endpoint(current_url, token)
        elif current_url and not synced and time.time() - last_sync_try >= 30:
            last_sync_try = time.time()
            synced = update_github_endpoint(current_url, token)

        if any(k in line for k in DIAL_ERR_KEYWORDS):
            err_streak += 1
            if err_streak >= 6:
                print("[Tunnel] 检测到连续建连错误，主动终止并重建隧道...", flush=True)
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break

    code = proc.wait()
    print(f"[Tunnel] 进程退出 (code={code})，hit_rate_limit={hit_rate_limit}", flush=True)
    return 180 if hit_rate_limit else 10


def main():
    lock_fp = open(LOCK_FILE, "w", encoding="utf-8")
    try:
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("[Tunnel] 已有 auto_tunnel 实例运行，退出。")
        return

    if not os.path.exists(TOKEN_FILE):
        print(f"[错误] 未找到 Token 文件: {TOKEN_FILE}")
        sys.exit(1)
    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
        token = f.read().strip()

    acquire_wake_lock()
    while True:
        try:
            wait_sec = run_once(token)
        except Exception as e:
            print(f"[Tunnel] 运行异常: {e}", flush=True)
            wait_sec = 15
        print(f"[Tunnel] {wait_sec} 秒后自动重连...", flush=True)
        time.sleep(wait_sec)


if __name__ == "__main__":
    main()
