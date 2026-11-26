---
title: NovaHub
emoji: ✨
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# NovaHub · 星隅

私人影视放映、黑胶无损音乐与在线流式小说三合一 Web 终端（支持 Pro 会员卡密与动态赞助位）。

## Hugging Face Spaces 3 分钟部署指南

1. 登录 [Hugging Face](https://huggingface.co/new-space)，点击 **Create new Space**：
   * **Space name**：如 `novahub`
   * **Space SDK**：选择 **Docker** → **Blank**
   * **Visibility**：建议选 **Public**（方便手机免登录直接打开）
2. 将本目录的以下文件上传到该 Space 仓库（网页端 `Files → Add file → Upload files` 或 `git push` 均可）：
   * `Dockerfile`
   * `.dockerignore`
   * `README.md`
   * `server.py`、`db.py`、`safe_http.py`、`source_probe.py`、`sources.json`、`backup_db.py`、`admin_cli.py`
   * `index.html`、`admin.html`、`style.css`、`app.js`、`manifest.json`、`icon.svg`
   * `novel_engine/config.yml`（先建 `novel_engine` 文件夹再放入 `config.yml`）
3. **强烈建议设置管理员密码 Secret**：
   * 进入 Space 顶部 **Settings → Variables and secrets → New secret**：
   * Name 填 `NOVAHUB_ADMIN_PWD`，Value 填您自定义的站长密码（不填则默认 `NovaAdmin888`）。
4. 等待右上角状态变为 **Running** 后即可访问：
   * 前台地址：`https://<你的用户名>-novahub.hf.space/`
   * 站长发卡后台：`https://<你的用户名>-novahub.hf.space/admin.html`

> **防休眠提示**：免费 Space 在 48 小时无人访问时会自动休眠，可在 [UptimeRobot](https://uptimerobot.com/) 或 Cron-job.org 添加一个免费监控，每 30 分钟请求一次 `https://<你的用户名>-novahub.hf.space/api/config` 即可 24 小时常驻在线。

## 数据与维护

后端启动后自动执行 SQLite 在线一致性备份，每 24 小时生成一份，经完整性检查后保留最近 14 份；失败时每小时重试。默认备份目录为数据库所在目录下的 `backups/`，可用 `NOVAHUB_BACKUP_DIR` 指定。运行 `python3 backup_db.py --output-dir /你的备份目录 --keep 14` 可手工备份，支持包含 WAL 中的已提交数据。请将验证后的备份定期复制到另一台设备。

容器中的 `/app/data` 必须映射持久化存储；仅保存在容器可写层的数据库和备份不能抵御容器重建。可设置 `NOVAHUB_DB_PATH=/data/novahub.db` 及 `NOVAHUB_BACKUP_DIR=/data/backups`，并确保运行用户具有写权限。

Termux 使用已纳入版本管理的 `ops/auto_tunnel.py` 与 `ops/watchdog.py`。在平板完整代码目录运行 `bash ops/install_termux.sh` 安装代码，再按运维手册精准重启；脚本保留数据库、密钥及当前隧道状态，不自动重启。所有新增 Python 模块与 `sources.json` 必须和 `server.py` 一起更新。

本次安全更新后原有登录会话失效，需要重新登录；以后重置密码会立即撤销对应账号旧会话。直播代理使用独立的短期只读媒体票据。Android 正式发布必须配置签名密钥，缺少凭证或验签失败将终止构建。

本地验证：`python -B -m unittest discover -s tests -v` 与 `node tests/test_frontend.cjs`。
