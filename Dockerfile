FROM python:3.11-slim

# 创建 Hugging Face Spaces 要求的非 root 用户 (UID 1000)
RUN useradd -m -u 1000 user

WORKDIR /app

# 安装 curl 用于下载 Linux 版小说章节解析引擎
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 拷贝核心前后端代码与配置
COPY server.py db.py safe_http.py sync_state.py catalog.py source_probe.py sources.json backup_db.py admin_cli.py index.html admin.html style.css app.js auth_session.js history_state.js vod_client.js manifest.json icon.svg ./
COPY novel_engine/config.yml ./novel_engine/config.yml

# 下载 Linux amd64 版章节实时解析引擎并赋予执行权限
RUN curl -fsSL -L \
    "https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/download/v2.4.18/TomatoNovelDownloader-Linux_amd64-v2.4.18" \
    -o /app/novel_engine/TomatoNovelDownloader \
    && chmod +x /app/novel_engine/TomatoNovelDownloader

# 创建数据目录并移交权限给 UID 1000 用户
RUN mkdir -p /app/data /app/novel_engine/logs \
    && chown -R user:user /app

USER user

ENV PORT=7860 \
    PYTHONUNBUFFERED=1 \
    NOVAHUB_DB_PATH=/app/data/novahub.db

EXPOSE 7860

CMD ["sh", "-c", "python3 server.py ${PORT:-7860}"]
