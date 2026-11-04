# 代码、文档与测试审查

后续状态：已按本报告完成一轮修复，变更与验证见 [优化实施记录](code-audit-remediation-2026-11-04.md)。下文保留修复前的审查证据，不代表修复后的现状。

审查日期：2026-11-04（Asia/Shanghai）。结论：存在可清理的旧组件、失真的文档、可复现的测试隔离缺陷，以及需要优先修复的定投写入认证缺口。本次执行评估与基线标记，未删除业务代码或修改既有测试。

## 1. 基线与范围

- 本地附注 tag：`audit/baseline-2026-11-04`。
- 指向提交：`1aa7deaf1c882fdcb0a65c304d9d8438f4009ae2`，分支 `main`。
- tag 只包含已提交版本，未推送远端，也不代表可发布认证。
- 检查对象为当前工作区，包含原有未提交修改：6 个已跟踪的界面文件，以及 `TODO.md`、个人额度文档、个人额度组件/服务/工具及两份测试，共 7 个未跟踪文件。这些内容不在 tag 内。
- 本次新增文件仅为本报告。未执行生产访问、部署、数据库清理或自动提交。
- 采用 TypeScript AST 导入图、仓库全文引用交叉检查、源码阅读、测试及静态检查；静态无引用结论不涵盖仓库外消费者。

## 2. 优先处理的问题

### P1：定投写入入口缺少服务端身份校验，测试遗漏该边界

定位：`src/server/dca/actions.ts:42` 起；`src/server/dca/actions.test.ts:25`；`src/app/dca/page.tsx:16`；`src/proxy.ts`。

页面会检查登录并将访客重定向到 `/quota`，但创建、编辑、执行、暂停、恢复、结束和删除定投的 Server Actions 未调用 `requireUser()`；其底层定投模块也没有用户认证。代理只做来源检查与缓存控制，不能替代登录检查。页面保护不自动覆盖独立的 Server Action 调用。

现有 Actions 测试未建立登录上下文，直接断言写入成功，因此全绿不能证明写入已受保护。建议统一服务端身份校验，并分别对本地/D1 分支验证：匿名及失效会话拒绝写入，数据库函数未被调用；已登录操作正常。无需删除已有补录、回滚和并发测试，应补齐认证前提与拒绝用例。此结论基于代码检查，未向线上发起未授权写入验证。

### P2：6 个测试文件存在执行顺序依赖

复现命令：

```bash
pnpm exec vitest run --sequence.shuffle --sequence.seed=42
```

结果：56 个测试文件中 6 个失败；315 条测试中 10 条失败、305 条通过。原始输出位于本机 `/tmp/person-dektop-audit-shuffle-20261104.log`，临时文件不属于 Git 基线。

| 文件 | 失败数 | 证据与处理建议 |
| --- | ---: | --- |
| `src/server/dca/create-d1.test.ts` | 1 | 回滚用例依赖其他用例先将 SQLite 从 WAL 改为 DELETE，再序列化为内存库；乱序时出现 `unable to open database file`。统一在每例 fixture 中完成数据库准备。 |
| `src/server/dca/edit-d1.test.ts` | 2 | 回滚和并发编辑用例存在同类序列化前置条件依赖。 |
| `src/server/dca/write-d1.test.ts` | 1 | 过期编辑/删除拒绝用例存在同类依赖。 |
| `src/server/ledger/pending-d1.test.ts` | 2 | 并发创建/取消和普通基金补录用例存在同类依赖。 |
| `src/server/funds/personal.test.ts` | 3 | 发现、失败恢复及分页用例共享基金缓存和持仓；后续用例依赖前面的发现/持仓操作。应各自创建必要数据或明确合并为一个生命周期场景。 |
| `src/server/market/nav-d1.test.ts` | 1 | `:58` 预期 10-28 净值，但另一用例已写入 10-31 净值；共享 observations 未恢复。每例应使用独立数据库/完整 fixture。 |

这些是测试装置和隔离问题，不应通过删除失败断言、固定执行顺序或放宽预期来掩盖。建议统一每例数据库初始化、连接关闭、环境恢复，并使单例运行及乱序运行都通过。

### P2：lint 扫描构建产物导致质量检查失效

定位：`eslint.config.mjs:10`。

`pnpm lint` 返回 550 errors、10035 warnings，输出包含大量 `.open-next/**` 生成文件；配置没有忽略 OpenNext 产物，Git ignore 不等于 ESLint ignore。限定源码及脚本范围后无 error。建议忽略 `.open-next/**`、`.wrangler/**` 及生成的 `worker-configuration.d.ts`，保留对业务源码和手写配置的检查。不要逐条修改生成文件。

## 3. 可移除的无引用组件

下列 9 个文件既无其他源码导入，经仓库全文搜索也未找到调用入口，不属于 Next.js 自动发现的页面或路由。建议作为第一批清理候选，删除后重新检查类型、测试和构建。

| 文件 | 内容 |
| --- | --- |
| `src/components/holdings/add-asset.tsx` | 旧资产类型添加控件 |
| `src/components/holdings/four-stats.tsx` | 旧四指标概览 |
| `src/components/holdings/lot-form.tsx` | 旧黄金/加密资产录入表单，另有未使用的 `hasSettled` 参数 |
| `src/components/holdings/nasdaq-entry.tsx` | 旧纳指录入表单，另有未使用的 `_props` 参数 |
| `src/components/holdings/nasdaq-index.tsx` | 旧纳指点位展示 |
| `src/components/holdings/nasdaq-lots.tsx` | 旧持仓分组展示 |
| `src/components/quota/quota-amount.tsx` | 无外部调用的 `QuotaMoney`、`QuotaCellValue`、`CoverageNote` |
| `src/components/status-badge.tsx` | 无外部调用的旧额度状态标签 |
| `src/components/ui/separator.tsx` | 无调用的 Separator 包装组件 |

删除这些文件不等于可以顺带删除其依赖的服务、类型、通用 UI 库或 CSS。应另查剩余引用，尤其 `globals.css` 已有未提交修改，不宜根据旧组件名称批量删除样式。

## 4. 不应误删的内容

- `src/server/cloudflare/sqlite-adapter.ts`：虽不在 `src` 导入图中，但被 `scripts/probe-workers-sql.mjs:52` 读取并用于诊断构建，不能判为无效文件。
- `scripts/cloud-jobs.mjs`、`scripts/run-cloud-jobs.sh` 及对应测试：明确保留为旧 LaunchAgent 的无副作用兼容入口。只有确认外部调度引用全部移除后，才适合整体退役。
- `src/server/market/mock.ts` 与 `config/nasdaq-market.mock.json`：仍被持仓服务和净值扫描调用，不是仅凭文件名即可删除的测试数据；应先评估实际运行路径及替代方案。
- `config/quota-snapshots.json`：由 `P0_TEST_DB` 条件下的测试数据库初始化使用。
- `db/migrations/001…048`：即使某些旧表随后被删除，历史迁移仍用于从空库重建及旧库升级，不应直接移除早期迁移。
- SQLite/D1 对照测试：覆盖双后端一致性，名称或结构相似不等于重复无效。当前不少 D1 测试使用 SQLite 模拟绑定，只能证明该模拟范围内的 SQL/行为一致，不能替代真实 D1 验证。
- `TODO.md` 的 FIN-001：记录的是尚待核实的业务口径，不应把 2,072.70 元直接写成固定正确答案，也不应为消除一分钱差异而删除舍入测试。

## 5. 文档清理建议

### 合并、纠正，而非整份删除

`docs/user-system-design.md`、`docs/user-system-plan.md`、`docs/user-system-implementation.md` 三份文档同时维护当前状态、旧计划和未来多用户方案，已经互相冲突：

- 文件开头仍称生产账号未初始化，后文却记载已创建并完成归属。
- 部分章节称定投页面匿名可用，与当前页面登录检查不符。
- “生产待办”的历史数据归属与同表“生产收尾完成”冲突。
- 未来多用户隔离要求与当前单账号能力混排，容易被误解为已经实现。

建议保留一份当前设计与使用说明，将实施过程和部署版本记录移入明确标注日期的历史记录；未来多用户任务单独列为未实现事项。`docs/deployment-options.md` 描述“按账号授权”时，也应准确区分页面保护与当前 Actions 校验缺口。本次没有访问生产确认历史部署状态，不能据旧文档推断线上现状。

### 删除或替换不存在的规格文档引用

| 引用处 | 不存在的目标 |
| --- | --- |
| `src/lib/formulas.ts:1` | `docs/spec-p0.md` |
| `src/lib/quota-math.ts:2`、`src/server/quota/index.ts:1` | `docs/spec-quota.md` |
| `src/lib/market.ts:1` | `docs/spec-jobs.md` |
| `src/lib/dca.ts:2` | `docs/spec-dca.md` |
| `src/lib/holdings.ts:1` | `docs/spec-holdings.md` |

应改成现存且适用的规则文档/代码注释，不要仅创建空文档来满足引用。`src/server/jobs/nav-scan.ts` 中“在途申购须手动结转”的概括也需与自动生成订单的结转逻辑区分。

其余计算精度、定投在途、基金目录、额度采集和定时任务文档仍有业务及运维用途，未发现足以支持整份删除的证据。

## 6. 验证记录与实施顺序

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 56 文件、315 条测试全部通过 |
| 全量乱序，seed 42 | 6 文件、10 条失败，见上表 |
| 单文件净值测试乱序，seed 42 | 复现 1 条净值日期断言失败 |
| `pnpm exec vitest run src/server/dca/create-d1.test.ts -t 'rolls back the plan'` | 单独运行仍失败：`unable to open database file`，确认依赖其他用例的初始化 |
| `pnpm exec tsc --noEmit --incremental false` | 通过 |
| 加 `--noUnusedLocals --noUnusedParameters` | 失败：`lot-form.tsx:22` 的 `hasSettled` 未使用 |
| `pnpm lint` | 失败：生成文件被扫描，550 errors、10035 warnings |
| 限定源码/脚本/根配置的 ESLint | 0 errors；旧组件参数和 Worker 默认导出等 warnings |

本次未运行生产构建、浏览器端到端测试或真实 D1 测试，也未证明所有未使用导出/样式均已穷尽。

建议顺序：先修复定投 Actions 认证及相应测试；修复测试 fixture 与 lint 范围；移除上述无引用组件；合并文档和修复断链；再执行默认测试、单例及乱序测试、lint、类型检查和隔离数据库构建。完成后提交清理结果并创建新的验收 tag，保留本次基线 tag 作为变更前参照。
