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
   * `server.py`、`db.py`、`admin_cli.py`
   * `index.html`、`admin.html`、`style.css`、`app.js`、`manifest.json`、`icon.svg`
   * `novel_engine/config.yml`（先建 `novel_engine` 文件夹再放入 `config.yml`）
3. **强烈建议设置管理员密码 Secret**：
   * 进入 Space 顶部 **Settings → Variables and secrets → New secret**：
   * Name 填 `NOVAHUB_ADMIN_PWD`，Value 填您自定义的站长密码（不填则默认 `NovaAdmin888`）。
4. 等待右上角状态变为 **Running** 后即可访问：
   * 前台地址：`https://<你的用户名>-novahub.hf.space/`
   * 站长发卡后台：`https://<你的用户名>-novahub.hf.space/admin.html`

> **防休眠提示**：免费 Space 在 48 小时无人访问时会自动休眠，可在 [UptimeRobot](https://uptimerobot.com/) 或 Cron-job.org 添加一个免费监控，每 30 分钟请求一次 `https://<你的用户名>-novahub.hf.space/api/config` 即可 24 小时常驻在线。
