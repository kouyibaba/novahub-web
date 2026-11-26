# NovaHub 源库与升级登录保持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现已确认的后台源库、有限并发质量选线、广告预留、历史删除和覆盖升级会话保持。

**Architecture:** Python 标准库/SQLite 提供源库、调度与用户同步；网页通过聚合接口访问影视。Android 保持固定受信任入口，并按定位结果保障会话持久化与有效性。

**Tech Stack:** Python 3 标准库、SQLite、原生 Java Android WebView、原生 JavaScript、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-26-managed-catalog-session-design.md`

## Global Constraints

- 不增加付费 API 成本；普通用户既有基础播放、阅读、系统听书和云同步保留。
- 默认每查询3个在途请求、后台总并发6；每查询最多8源/8秒，每源4秒，缓存120秒。
- 源更新每日订阅、每6小时检测；持久化上版可用配置，更新失败不清空。
- 私有源按用户隔离、保留旧别名，不覆盖全站源库。
- 广告默认关闭，由管理后台配置；Pro免站内广告。
- 密码重置/撤销仍使会话立即失效；不能保存密码或绕过服务端鉴权。
- 根目录与docs前端保持一致；保留已有.gitignore改动；APK通过GitHub签名构建。

## Review Focus

- 升级遇到网页存储缺失、离线或旧鉴权请求晚到：有效新会话不被旧结果清除。
- 订阅出现空列表、恶意URL、格式变化或大量项目：保留旧可用源并限制资源。
- 多用户同时搜索/探测：在途请求不超过总预算，同查询合并，超载有界。
- 同名不同年份/季数与跨源同数字ID：不串影片/集数/收藏。
- 离线设备旧快照与删除后正在播放：已删除记录不被同步或进度计时复活。

## Task 1: 会话定位与持久化

Files: `db.py`, `server.py`, `app.js`, Android `MainActivity.java`及按需新建`SessionStore.java`，测试`tests/session.test.cjs`和`tests/test_sessions.py`。

Interfaces: `GET /api/auth/me`返回有效用户与按需续期token；无效会话明确401。前端集中`applyAuthSession`、`clearAuthSession`与`refreshAuthUser`，请求使用会话代数避免晚到响应覆盖。原生只向受信任主文档注入恢复回调，保存桥需每次导航nonce，不提供任意iframe可读取token的原生方法。

- [ ] 写行为测试，覆盖同数据库重新初始化、Token过期/撤销、有效续期、旧请求晚到、离线与主动退出。
- [ ] 运行测试确认新增行为缺失，再实现最小服务端会话续期与前端代数管理。
- [ ] 定位网页存储丢失路径；若需原生持久化，使用Keystore加密的无备份文件并测试损坏、退出和可信页面限制。
- [ ] 验证测试通过；记录真实覆盖升级是否具备设备条件，不能将单元检查声称为真实升级验证。

## Task 2: 持久化源库与有限调度

Files: 新建`catalog.py`，修改`source_probe.py`, `db.py`, `server.py`，测试`tests/test_catalog.py`。

Interfaces: `Catalog`管理源/订阅/别名/快照；`search(query,user_id)`、`detail(source_id,vod_id,user_id)`与`select/playback_feedback`为聚合业务边界。新增`/api/vod/home|search|detail|feedback`；管理员端`/api/admin/sources`、`/api/admin/subscriptions`与受鉴权的检查/回滚操作。客户端只发送来源ID，不发送任意上游URL。

- [ ] 写失败测试：种子迁移、有效订阅新增/重复、私有来源隔离、空/坏订阅保留旧源、管理员禁用不复活、两轮候选检测和回滚。
- [ ] 实现SQLite持久化、只读订阅解析与安全请求；验证实际外部订阅可更新。无法找到有效订阅则如实报告，不冒充已完成发现。
- [ ] 写失败测试：3/6并发上限、8秒截止/最多8源、缓存与在途合并、有界队列、保守去重、同ID不同来源、质量排序、限体积媒体检测。
- [ ] 实现调度、查询缓存、源健康度与质量评价。播放反馈只能影响已知来源的有效近期请求，避免任意健康度写入。
- [ ] 运行源库及网关测试通过，确认后台线程启动/异常不会清空持久化状态。

## Task 3: 前端聚合、历史删除与同步

Files: `app.js`, `style.css`, `index.html`, `db.py`, `server.py`；测试`tests/catalog_frontend.test.cjs`、`tests/history.test.cjs`与同步集成测试。

Interfaces: 前端消费上述影视接口；历史使用稳定复合键，删除以`history_deleted`和`history_cleared_at`等兼容字段进入服务端合并。私有来源迁移只在本人鉴权下发送旧配置，不纳入普通公共同步覆盖。

- [ ] 写失败测试：新搜索阻止旧结果覆盖、聚合详情选线、最多两次同集备用、换线保留进度。
- [ ] 将首页/搜索/详情改为后台聚合，移除用户源列表/导入入口，保留播放器现有导航和媒体通知。
- [ ] 写失败测试：单条/清空历史、来源ID冲突、删除保留收藏、活动播放器不重建已删记录、旧设备快照无法复活、私有来源旧ID可恢复。
- [ ] 实现历史管理UI、删除墓碑与服务器合并，旧公共源表退出用户同步，保留私有迁移所需别名。
- [ ] 测试通过后同步根目录与docs资源。

## Task 4: 后台管理、广告预留与权益显示

Files: `admin.html`, `app.js`, `db.py`, `server.py`, `style.css`及docs副本；相应鉴权与前端行为测试。

- [ ] 验证广告关闭无占位、示例配置迁为关闭、启用后普通用户展示/Pro免展示、非法跳转和任意脚本不执行。
- [ ] 实现后台源/订阅管理、手动检查、回滚及质量/任务时间诊断。
- [ ] 补广告位置/图片/按钮/供应商预留配置和预览，不引入广告SDK；统一会员文案及已拥有权益，不宣称未实现能力。
- [ ] 测试通过，检查失效会话/普通用户不能访问管理接口。

## Task 5: 全量验收、发布准备与统一更新

- [ ] 运行Python全部测试、前端授权/资源一致性、导航/听书及新测试、JS语法与diff检查。
- [ ] 请求一次独立全分支审阅，修复实质问题并复验受影响检查。
- [ ] 递增Android版本，写准确更新说明；准备代码和数据库备份、可重复迁移及回滚步骤。
- [ ] 按已授权范围统一推送，GitHub构建签名APK；部署后端与Pages并分别检查版本、健康、任务状态、播放及用户数据保存。
- [ ] 单独验证覆盖升级后登录保持；没有用户设备条件时明确未验证，不误报解决。
