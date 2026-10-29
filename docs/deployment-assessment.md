# 财务决策工作台部署评估

## 当前选择：Workers 免费版与本机定时任务

2026-10-29 后续：在本地 Workers 模拟器中，健康检查已使用 D1，Worker 不再启动进程内调度；访问保护要求设置 `SITE_ACCESS_TOKEN`（使用至少 32 字节随机数据的 base64url 编码，并通过 Cloudflare Secret 设置，不要放进源码）。未认证访问、静态资源、跨站写入及额度接口无令牌的拒绝已在模拟器验证。此保护与健康检查不代表业务数据库已改造，不能据此上线；本机定时任务 API 尚未完成。

2026-10-29：项目已升级 Next.js 到 16.4.1，加入 OpenNext / Wrangler、D1 绑定和 Cloudflare 构建命令。项目的 152 项现有测试通过，使用隔离测试数据库的 `pnpm run build:cloudflare` 构建通过。构建成功不等于运行时兼容：业务仍使用同步 better-sqlite3，不能连接 D1；认证、本机定时任务 API 及 Worker 实际运行仍待完成。`workers_dev` 保持关闭，避免误发布未受保护的应用。

2026-10-29：已在 Cloudflare 免费账户创建空的 D1 数据库 `personal-finance-db`（数据库 ID：`95316818-41ce-4af3-9763-1ae9bf886172`）。未导入任何用户数据，也未绑定 Worker。`node scripts/probe-d1-migrations.mjs` 在本机 D1 模拟器成功执行当前 37 个迁移文件中的 148 条 SQL；这不验证真实数据导入或应用业务行为。Next.js Worker、D1 异步访问改造、身份验证和本机任务 API 尚未完成。Wrangler 当前尚未授权。

2026-10-29：对本机旧备份做了隔离导入试验。SQLite 默认 dump 因表的外键依赖顺序不适用；使用 `scripts/export-d1-import.py` 按依赖排序导出后，本地 D1 模拟器导入了 33 张表，逐表内容、行数、自增序列、完整性及外键检查一致。仅为本地测试，不代表云端导入或新备份已验证。SQL 导出文件包含完整财务数据，必须作为敏感文件保护并在完成后安全清理。

用户确认云端部署两个资源：Cloudflare D1 数据库与运行 Next.js 的 Cloudflare Worker；定时任务在本机执行，通过受保护的 API 更新云端。网站可在 Mac 关机时访问，但行情及额度等定时更新依赖 Mac 开机联网。部署前仍须实现用户身份验证、任务 API 的独立认证、数据库迁移与恢复、并发和事务校验，以及现有功能的兼容性验证。

用户同意为适配云端数据库调整现有实现。采用独立的 Cloudflare D1 数据库作为目标方案；D1 使用 SQLite 语义，但访问 API 是异步的，现有同步数据库访问与事务需要改造和验证。此前 Durable Object 试验仅为可行性探索，并不是已部署的数据库。

当前可行性验证：`node scripts/probe-workers-sql.mjs` 在本机 Wrangler 模拟的 SQLite Durable Object 空库上依次执行了 37 个迁移，并检查嵌套事务、回滚、插入 ID 和命名参数。同步 SQLite 适配器已有初步实现，但尚未接入应用。在临时隔离副本中，使用该适配器和空库运行 OpenNext 的 Workers 模拟器，`/dca`、`/holdings/manage`、`/quota` 返回 HTTP 200；该结果仅验证空数据页面，不代表业务写入、并发、真实数据或生产环境已经验证。测试不读取或上传用户数据库。现有本机数据库经 `quick_check` 检查正常。Workers 免费版请求和存储存在限制，完整页面、数据导入及批量写入需要实测并按需拆分。

连接关系：浏览器访问受登录保护的 Next.js Worker，Worker 通过绑定访问 D1；本机定时任务通过独立认证的 Worker API 执行受限操作，不直接连接或暴露数据库。

本机任务需要独立的受限凭证和云端 API，覆盖定投到期记账、每日净值和额度同步、每周基金概况更新；需要保留失败重试、防止重复执行，并确保云端停止进程内调度。现有额度上报接口只覆盖其中一部分，不能视为任务迁移已完成。

迁移前可对 SQLite 在线备份执行 `node scripts/audit-cloud-migration.mjs <备份路径>`。该命令只读备份，检查完整性、外键、迁移记录和表列结构，不输出账本记录。2026-10-29 对当时备份的核验发现旧迁移 `014_xhs_nasdaq_discussion.sql` 对应的两张历史表不在当前迁移目录中；其中一张仍有数据。云端导入必须明确保留这些历史表及记录，并验证恢复，不能仅根据当前迁移创建空库后忽略它们。由于核验对象是当时的备份，正式迁移前需重新生成在线备份并重新检查。

## 原备选方案：Mac 主机与 Cloudflare Tunnel

首选受保护的单实例 Node.js 主机：应用和 SQLite 存放在同一台具有持久磁盘的主机，Cloudflare Tunnel 提供 HTTPS 入口，Cloudflare Access 在入口前校验身份。现有 Cloudflare 域 `wangxiaoxiao.ccwu.cc` 处于活动状态；可使用尚未配置的 `finance.wangxiaoxiao.ccwu.cc`，不改动现有根域和其他记录。此主机可以是这台 Mac，也可以是持续运行的服务器。使用 Mac 时，网站依赖 Mac 开机、联网且不睡眠；它并不是独立云托管。

这个项目依赖 `better-sqlite3`、本地可写的 SQLite 文件、Node 原生模块和进程内定时任务，不适合直接作为 Cloudflare Pages 静态站或现状下的 Workers 应用发布。Cloudflare 容器的本地磁盘默认是临时的，直接把 SQLite 放在容器内会有数据丢失风险；若要完全托管在云端，需要另行设计持久数据库、备份、事务和定时任务迁移。

## 部署顺序与约束

1. 启用 Cloudflare Zero Trust，并确认所需身份提供商可用。当前账户的免费版开通流程要求支付方式、同意服务条款和超额计费授权，需由账户所有者本人完成。
2. 在公开路由创建前，为 `finance.wangxiaoxiao.ccwu.cc` 建立仅允许账户所有者访问的 Access 策略；验证未认证请求被拒绝。Tunnel 应开启 Access token 校验，源站只监听本机回环地址，避免绕过身份验证。
3. 在选定主机启动一个生产 Node 实例，使用持久的 SQLite 数据目录和现有运行环境变量。停止或禁用其他实例中的定时任务，避免开发和生产进程对同一数据库并发执行计划任务。部署前使用 SQLite 在线备份，不能仅复制运行中 WAL 模式的主数据库文件。
4. 建立 Tunnel 并连接回环地址；只在 Access 生效后创建子域路由。验证未登录时无法进入，登录后定投、持仓和纳指雷达正常，计划读写、SQLite 持久性和定时任务正确。无授权不要公开访问或复制财务数据至其他第三方。
5. `/api/ingestion/quota` 被 Access 保护后，现有外部额度上报机器人需要单独配置受限的服务令牌或其他认证方案；不能为方便上报而绕开整个站点的身份验证。核对现有机器人后再实施。

## 本次核验

- 使用隔离测试数据库构建生产版本成功；本机回环地址上 `/dca`、`/holdings/manage`、`/quota` 均返回 HTTP 200。
- 当前本机开发服务器仍在运行，未停止或更改；不应在未处理定时任务竞争时再启动使用同一数据库的生产实例。
- 已使用 SQLite 在线备份 API 生成本机备份，并通过 `integrity_check`；生产数据未上传。
- 用户选择以这台 Mac 作为运行主机；已安装 Cloudflare 官方客户端 `cloudflared`，但尚未启动隧道。
- Cloudflare Access 尚未开通；本次未创建公开路由或修改现有 DNS。

参考：[Cloudflare Access 与 Tunnel 的自托管应用部署](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)、[Cloudflare Containers 磁盘持久性](https://developers.cloudflare.com/containers/faq/)。
