# 全量体验优化、在线状态、音视频下载与 ADB 优先部署交接记录

日期：2026-11-27（Asia/Shanghai）  
负责人：Gemini  
分支与基线：main（基于 dbc57d4）  

## 1. 范围与改动文件
- **后端核心**：`catalog.py`、`db.py`、`server.py`、`sync_state.py`
- **前端与管理后台**：`index.html`、`app.js`、`style.css`、`history_state.js`、`admin.html`（及同步副本 `docs/` 下同名文件）
- **Android 端**：`android-app/app/src/main/java/com/novahub/app/MainActivity.java`、`AppUpdater.java`、`android-app/app/build.gradle`、`android-app/RELEASE_NOTES.txt`
- **运维工具**：`ops/deploy_pad.ps1`（及本地 `.gitignore` 内的 `pad.ps1`）
- **自动化测试与调研文档**：`tests/test_presence_and_download.py`、`tests/test_sync_state.py`、`tests/history.test.cjs`、`tests/player_and_cache.test.cjs`、`docs/development/2026-11-27-feature-research.md`

## 2. 完成内容
1. **移除「片库正在更新」+ 首页缓存复用**：
   - `catalog.py` 禁止缓存空搜索/首页结果，且当所有非禁用源被标为 `paused` 时兜底回退非禁用源；
   - `app.js` 新增 `_homeVodCache`（5 分钟 TTL + `sessionStorage` 持久化），返回首页直接复用已有片单不重复请求、不闪骨架屏，并支持手动刷新按钮。
2. **加载动画优化 + 三端搜索 loading**：
   - 修复 `#homeGrid` 嵌套 `.sk-grid` 导致的单列挤压 Bug，改为直接填充 12 张骨架卡对齐 3/4/6 列网格；
   - 新增居中搜索加载面板 `.search-loading-box`，影视/音乐/小说三个搜索入口统一展示清晰加载态。
3. **播放器控制与手势增强（含自定义跳过片头片尾）**：
   - 新增 `+30s`、`+1m`、`下一集`、全屏选集侧边抽屉 `#fsEpDrawer`、`片头尾` 自定义设置、`下载` 按钮；
   - 支持按剧集自定义跳过片头/片尾时长（可一键设为当前播放位置）并随 `skip_cfg` 云同步；
   - 重构 `.player-box` 手势状态机：支持双击暂停/播放、长按左半屏连续快退（-5s/260ms）、长按右半屏 3.0x 倍速快进（松手保留进度并恢复原状态），并与单击控栏/滑动调进度/亮度音量手势完全隔离无冲突。
4. **多设备播放进度同步（App 端优先）**：
   - `history_state.js` 与 `sync_state.py` 统一实现 `src === 'app'` 优先于非 App 端进度的合并策略，同端按最新时间戳 `at` 合并，并保留墓碑删除语义；
   - `app.js` 暂停/切集/关闭播放器立即同步、播放中每 10 秒节流同步、切回前台/进详情自动拉取，且 App 端发现本地进度胜出时主动回写服务端。
5. **修复电视直播源**：
   - 实测内置 24 路源，移除 SSL 异常的失效频道（浙江国际），递增 `CH_VER = "20261127-v5"`；
   - 新增 `mergeLiveChannels()` 防止云端或文件恢复旧失效频道；修复 `hls.min.js` async 竞态；增强 `server.py` 直播代理防盗链头与容灾提示。
6. **音乐与影视可下载选项**：
   - `server.py` 新增 `/api/media/download`（登录鉴权 + SSRF 拦截 + 200MB 分块流式转发 + `Content-Disposition: attachment`）；
   - `MainActivity.java` 新增 `NovaNative.downloadMedia` 与 `DownloadListener` 接入系统 `DownloadManager`；
   - 前端音乐列表/播放页与影视详情/播放器均新增下载按钮，支持音频直链、视频直链及 M3U8 客户端并发拉片合并下载（含进度弹窗与取消）。
7. **推送更新优先 ADB**：
   - `pad.ps1` 与 `ops/deploy_pad.ps1` 检测在线 ADB 设备后优先通过 `adb forward tcp:11785` 或 `adb install -r` 走 USB 本地更新（不走网络），不可用时回退公网隧道（支持 `-NoFallback`）；
   - `AppUpdater.java` 优先以 1200ms 超时探测 `http://127.0.0.1:18766/apk-version.json`（配合 `adb reverse`），不可达或失败时自动回退公网更新。
8. **后台管理用户在线状态**：
   - `db.py` 新增 `user_presence` 表与 `touch_user_presence` / `mark_user_offline` / `list_online_presence`，`server.py` 新增 `POST /api/auth/heartbeat`、`POST /api/auth/logout`、`GET /api/admin/online`；
   - 前端每 60 秒心跳、后台以 180 秒窗口判定在线；`admin.html` 总览页与用户管理页新增实时在线列表、在线筛选、设备类型、IP 与最后活跃时间展示。
9. **收藏更新提醒（站内消息中心 + Android 原生轮询通知）**：
   - `db.py` 新增 `user_watch_items` 与 `user_notifications` 表，随云同步增量维护收藏影视与书架小说，首次建基线不误报，新增集/章时自动合并去重生成未读提醒；
   - `server.py` 新增低频后台巡检线程 `_start_watch_update_checker` 及 `/api/notifications`、`/api/notifications/read`、`/api/notifications/prefs`、`/api/notifications/check` 接口；
   - 前端顶栏新增消息中心红点与弹窗清单，影视详情与小说详情页新增单作品提醒开关；
   - Android 新增 `UpdatePollService`（`JobScheduler` 每 2 小时轮询未读提醒，去重并合并推送系统通知，点击直达站内消息中心），版本升至 `v2.4.7 (10)`。
10. **方案调研**：完成任务 9 与任务 10 调研并落盘 `docs/development/2026-11-27-feature-research.md`。

## 3. 接口与数据库迁移变化
- SQLite `init_db()` 新增 `user_presence` 表及索引 `idx_user_presence_seen`（无损增量创建，兼容既有生产库）。
- `progress[vodKey]` 新增可选字段 `src`（`'app'` / `'web'`），旧数据缺省视为非 `'app'`，向后完全兼容。
- 新增 HTTP 接口：
  - `POST /api/auth/heartbeat`（用户鉴权）
  - `POST /api/auth/logout`（用户鉴权/幂等）
  - `GET /api/admin/online`（管理员鉴权）
  - `GET /api/media/download`（用户鉴权或 media ticket）

## 4. 部署与未完成项说明
- 后端与静态网页已通过 **USB ADB 本地转发通道（127.0.0.1:11785）** 推送至平板 `~/novahub/` 并精准重启验证（未走公网）。
- `android-app/`（`MainActivity.java`、`AppUpdater.java`）代码已更新并递增至 `v2.4.6 (9)`，需推送至 GitHub 由 `.github/workflows/build-apk.yml` 完成签名构建后，再经 `.\pad.ps1 -InstallApk` 走 ADB 覆盖安装验证。
