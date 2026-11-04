# 定时任务

2026-11-03 已部署到 Worker `qqq-million-plan`，所有业务时间均为 Asia/Shanghai。

| 任务 | 执行位置 | 时间 |
| --- | --- | --- |
| 定投自动记账 | Cloudflare Cron | 每日 02:00 |
| 官方额度采集与校验 | 本机 Codex 自动化 `nasdaq-quota-ai-ingestion` | 每日 06:00 一次 |
| 额度回执巡检 | Cloudflare Cron | 每日 07:00，仅检查接收情况 |
| 基金净值 | Cloudflare Cron | 18:00–24:00，每小时一次（末次 23:00） |
| 基金概况 | Cloudflare Cron | 每周一 01:00 |

净值任务在其他时段不会自动补查。失败等到下一个晚间周期重试；本地开发服务使用相同小时窗口。用户主动刷新不受此定时窗口限制。原 Mac LaunchAgent 已停用，其 plist 备份在忽略提交的 `data/backups/scheduled-jobs-20261103/`；兼容脚本只打印停用说明，不读取凭证、不再请求云端。

## 额度采集与上传

Mac 必须开机、联网且 Codex 运行。云端巡检不能唤醒 Mac，也不会代替 AI 重新采集。

每次使用独立运行目录，顺序执行：

```sh
pnpm quota:run start /absolute/run-directory
# 按既有采集与独立校验规则，生成 run-directory/payload.json
pnpm quota:run finish /absolute/run-directory
pnpm quota:upload /absolute/run-directory/payload.json
```

失败采集用 `quota:run fail`；没有有效条目时只保存失败明细，不构造空的成功上传。采集状态可以离线保存；上传前脚本会补报 start/finish，并自动关联 collectionRunId。

`collection-run.json` 记录采集，`upload.json` 和每次上传回执记录实际接收。重试同一个冻结 payload，保留正文及幂等键；改变已冻结正文会被拒绝。每日任务可补传过去七天内的失败文件，每个文件最多三次，不重采历史、不改 observedAt。上传仍失败则保留 pending_upload。

网站按当天采集运行及实际 accepted observations 的不同基金/份额/渠道统计覆盖；重复上传不会增加覆盖，历史补传不算今天完成。采集状态本身不能声明上传成功。07:00 的审计会写入 scheduled_job_runs；页面实时读取回执，因此晚到的有效上传能自动清除缺失提示。失败、缺失或部分更新不清空旧额度，表格保留每条额度的核验时间。旧 observedAt 的迟到数据只能保留历史，不能覆盖新数据。

接口继续使用 QUOTA_INGEST_TOKEN 和 HTTPS 来源白名单；任务日志、文档和运行报告不包含凭证。

## 云端实现与运维

Wrangler 的 cron 为 UTC；周日 17:00 UTC 对应北京时间周一 01:00。使用 SUN 避免 Quartz 的星期编号与传统 cron 不一致。

净值使用一个 Cron，每晚北京时间 18:00、19:00、20:00、21:00、22:00、23:00 刷新，共六次。

净值每批四只基金，概况每批二十五只，经 JOBS_SELF Service Binding 调用独立 Worker invocation。每个净值批次保留抓取前后的日期比较，分别记录净值日期前进、未变化、失败；成功抓取旧净值不等于净值已更新。按 job/slot 原子抢占、成功去重，20 分钟过期的运行可重试；分批异常和快照异常均落失败/部分成功状态。

当前约 88 只基金需 22 个净值批次。单个 cron 最多执行 30 批，预留初始及快照 invocation，避免超过 Service Binding 的 32 次调用限制；超过 120 只同步基金时需要进一步分区或迁移队列，任务会明确失败，不会伪报全部完成。每个内部请求有三分钟超时，整体处理预算十分钟。Free 套餐 CPU/查询额度仍需结合 Cloudflare 日志监测。

定投沿用执行日去重和漏记恢复，不改变持仓确认规则。回执巡检只读额度并记录审计，不触发额度抓取或改写额度。

本次已完成：隔离数据库测试、Worker 本地运行时调度、云端构建与 dry-run、线上数据库备份及迁移演练、部署和接口/页面检查。完整晚间净值轮次及下一次 06:00 本地采集仍应以真实定时执行日志验收。
