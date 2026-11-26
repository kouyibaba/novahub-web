# NovaHub · 星隅

当前源码版本：网页与 Android 壳 v2.4.4。实际发布版本以线上 APK 清单为准。

NovaHub 将影视、音乐与小说阅读整合在固定网页和 Android WebView 应用中，支持收藏与书架同步、原生媒体通知、离线中文听书和应用内升级。

## 公开入口

| 用途 | 地址 |
|---|---|
| 网页 | https://kouyibaba.github.io/novahub-web/ |
| 仓库 | https://github.com/kouyibaba/novahub-web |
| 最新 APK | https://kouyibaba.github.io/novahub-web/apk/novahub-latest.apk |
| 版本与 SHA-256 清单 | https://kouyibaba.github.io/novahub-web/apk-version.json |
| APK 构建记录 | https://github.com/kouyibaba/novahub-web/actions/workflows/build-apk.yml |

## 架构与目录

GitHub Pages 托管静态前端，Android 壳加载同一固定入口。前端读取 endpoint.json 获取后端地址；后端负责用户鉴权、数据同步、媒体代理与小说接口。部署路径、设备连接和恢复步骤保存在本机内部运维手册中。

| 文件或目录 | 职责 |
|---|---|
| docs/ | GitHub Pages 站点和 APK 分发文件 |
| index.html、app.js、style.css、admin.html | 与 docs/ 同名文件保持一致的静态前端 |
| android-app/ | 原生 WebView、Android 返回手势、媒体通知、中文 TTS 和 APK 升级 |
| server.py、db.py | Python 网关、用户与卡密、同步与站点配置 |
| safe_http.py | 上游 TLS 校验、DNS 地址固定、重定向与响应体限制 |
| source_probe.py、sources.json | 公共影视源探测与可用性缓存 |
| backup_db.py | SQLite 在线一致性备份、完整性检查和备份保留 |
| novel_engine/ | 小说内容接口与章节缓存 |
| ops/ | 守护与隧道脚本的受版本管理副本 |
| tests/ | 后端、鉴权、代理、备份、导航和听书回归检查 |

## 构建与发布约定

- APK 通过 GitHub Actions 构建。Android 代码变更时递增 versionCode 与 versionName，填写 RELEASE_NOTES.txt。
- 签名配置仅使用 GitHub Secrets。缺少配置、验签失败或发布失败时，构建必须失败，禁止分发未签名包。
- 同步根目录与 docs/ 静态资源，修改 JS/CSS 时更新入口资源版本参数。
- endpoint.json 由运行中的入口维护程序更新；APK 与版本清单由构建更新。提交源码前应拉取最新分支，避免覆盖这些自动生成文件。
- 部署前保存代码和数据库一致性备份；部署后核对文件哈希、健康检查、数据库完整性以及公网入口。源码推送与服务部署分别验收。
- 数据库、密钥、令牌、签名文件、内部交接文档和本机发布备份不进入公开仓库。

## 检查命令

```powershell
python -B -m unittest discover -s tests -v
node --test --test-isolation=none tests/navigation.test.cjs tests/novel_tts.test.cjs
node tests/test_frontend.cjs
node --check app.js
git diff --check
```

导航检查覆盖弹窗、阅读器目录、全屏、播放器、详情层级及重复返回；听书检查覆盖暂停续读、过期回调、章节续读失败和语音包缺失。Android 编译由 Actions 验证，真实设备的返回手势与语音体验仍需设备测试。
