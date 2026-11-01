# 用户系统改造计划

状态：首版代码已实现并完成本地试用；生产 Worker 与 D1 迁移已部署，生产账号初始化仍待完成。用户已确认仅本人登录，并将现有持仓、定投及个人快照归属到本人账号。日期：2026-10-30。

## 目标

为持仓管理和个人账本增加本人账号登录；定投管理保持公开可用，额度和公开行情保持共享。定投仍只记账，不发起交易。

## 已确认方案

- 仅本人使用，不开放注册或邀请其他用户。
- 使用账号和密码登录。首个管理员账号通过一次性初始化口令创建；初始化完成后接口拒绝再次创建账号。
- 首次初始化时，将 `positions`、`dca_plans`、`portfolio_snapshots` 中所有未归属记录迁移给本人账号。此数据映射已由用户明确确认。
- 密码以 PBKDF2-SHA256 哈希保存，会话使用随机不透明令牌，数据库仅保存令牌摘要；会话通过 HttpOnly Cookie 传输，支持退出和过期。
- 本地 SQLite 与 Cloudflare D1 使用同一套迁移结构；可信的定时任务仍使用独立机器认证。

## 实施范围

1. 增加用户、会话和归属字段及索引；用户首次初始化时回填历史数据，并为之后新增的账本行补充管理员归属。
2. 增加首次账号初始化、登录、登出及会话解析接口和登录页面。
3. 持仓页面及其 Server Actions 要求登录；定投页面及其 Server Actions 保持匿名可用。
4. 保留跨来源写入检查、私有缓存策略和独立后台任务认证。
5. 验证 SQLite 与 D1 迁移、账号初始化、数据认领、登录退出及核心页面构建。

## 生产启用状态

- D1 迁移前完整导出已保存至 `data/backups/personal-finance-db-before-users-2026-10-30.sql`，文件权限为仅当前用户可读写。
- `044_user_accounts.sql` 已应用到绑定的 Cloudflare D1，迁移 ID 已登记。
- Worker `qqq-million-plan` 已部署版本 `43fa70d8-8531-40b6-8ac5-c52d4d690db9`，并配置一次性 `INITIAL_OWNER_SETUP_TOKEN`。
- 线上匿名访问 `/dca` 已验证跳转 `/login`；`/login` 返回 200。
- 生产账号已初始化为 `wangxiaoxiao`，并核对 71 条持仓、10 个定投计划和 22 条组合快照全部归属到该账号；初始化口令已删除并重新部署。
- 最新生产 Worker 部署版本为 `1869ff20-df1a-4689-a290-43b0f07723f8`（部署记录 `e25425e1-7053-441f-81ef-8a01282ed68f`）；线上 `/login` 返回 200，初始化路由已部署。初始化完成并核对原 71/10/22 条账本记录归属后，删除 `INITIAL_OWNER_SETUP_TOKEN` Worker secret 并重新部署。
- 已验证登录、定投匿名访问、持仓归属和定时任务；`INITIAL_OWNER_SETUP_TOKEN` Worker secret 已删除。

迁移前导出保留作恢复点。不要把初始化口令写入源代码或发送到公开渠道。

## 本地试用状态

已创建隔离账本副本并完成账号初始化、登录、持仓保护和匿名定投页面访问；副本中历史账本已归属到唯一管理员，原 `data/ledger.sqlite` 未用于此次试用写入。

## 当前实施文件

- `db/migrations/044_user_accounts.sql`：用户、会话和个人账本归属字段。
- `src/server/auth/`：密码哈希、会话和身份上下文。
- `src/app/api/auth/` 与 `src/app/login/`：初始化、登录、退出 API 和界面。
- `src/app/dca/page.tsx`、`src/app/holdings/manage/page.tsx` 与业务 Actions：登录保护。
