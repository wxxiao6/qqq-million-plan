# 审查优化实施记录

日期：2026-11-04。依据 [审查报告](code-audit-2026-11-04.md) 实施，保留修复前的本地 tag `audit/baseline-2026-11-04`（`1aa7dea`）。优化版本标记为 `audit/optimized-2026-11-04`，包含本轮修复及一同验证的个人额度和界面改动；基线 tag 不包含这些变更。本文的验证记录不等于生产部署验收。

## 已完成

- 7 个定投 Server Actions 均在业务校验和写入前执行 `requireUser()`，覆盖创建/编辑、记录执行、暂停、恢复、结束、删除及修正。新增两种后端下的拒绝写入和已登录正常分派测试，以及匿名页面不读取账本的测试。
- 为 6 个问题测试文件引入统一隔离账本 fixture：临时数据库迁移后统一使用 DELETE journal，避免序列化副本依赖 WAL；每例用 savepoint 隔离并回滚数据，套件结束关闭连接和恢复环境。缺失的基金、持仓与计划由各自用例建立，保留原有业务断言。
- 删除审查报告列明的 9 个无引用组件，共 750 行。保留仍被脚本使用的适配器、兼容调度入口、mock 数据和全部历史迁移。
- ESLint 忽略 `.open-next/**`、`.wrangler/**` 和生成的 `worker-configuration.d.ts`，继续检查源码与手写配置。
- 当前账号与权限说明集中在 `user-system-design.md`；旧实施记录归档，原计划保留导航入口；多人扩展要求明确标为未实现事项。
- 替换 5 类失效规格引用，并纠正净值扫描对手工确认与自动估算的注释。
- 原有个人额度和界面改动保留，未修改 FIN-001 业务口径或实际账本。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 56 个文件，349 条全部通过 |
| `pnpm exec vitest run --sequence.shuffle --sequence.seed=42` | 56 个文件，349 条全部通过；审查时的 10 条乱序失败已消除 |
| 单独运行 `create-d1.test.ts` 的 `rolls back the plan` | 通过，其余 2 条由名称过滤跳过 |
| `pnpm lint` | 0 errors；保留 `worker.mjs:7` 原有的 1 条匿名默认导出 warning |
| `pnpm exec tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters` | 通过 |
| 使用 `/tmp` 独立 `P0_TEST_DB` 执行 `DISABLE_JOBS=1 pnpm build` | Next.js 生产构建通过 |
| `git diff --check` | 通过 |

类型检查最终在构建结束后单独运行，避免与 Next.js 重建 `.next/types` 同时发生。构建未使用原本地账本。本轮未执行浏览器端到端、Cloudflare 打包部署或真实 D1 验证。

认证测试覆盖服务端入口是否调用认证及拒绝后是否停止写入；D1 业务测试仍为 SQLite 模拟绑定，不将其描述为真实云端验收。生产生效需后续发布；FIN-001、多人隔离与旧调度外部引用确认仍属于各自后续工作。
