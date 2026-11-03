# AI 额度上报

采集完成后，先将通过官方证据和代销校验的记录保存为 `payload.json`，再执行：

```bash
pnpm quota:upload /absolute/path/to/run/payload.json --dry-run
pnpm quota:upload /absolute/path/to/run/payload.json
```

默认上报地址和允许的证据来源见 `config/quota-ingestion.json`；生产 Worker 的相同来源白名单在 `wrangler.jsonc` 的 `QUOTA_SOURCE_HOSTS` 中配置。增加来源时应同时更新这两处并同步云端配置。采集者不需要自己提供已配置的项目地址。

脚本按进程环境、`.env.local`、`.env` 的优先级读取 `QUOTA_INGEST_URL`、`QUOTA_INGEST_TOKEN`、`QUOTA_SOURCE_HOSTS`。没有环境令牌时，从被 Git 忽略的 `data/quota-ingestion/token` 读取，或使用 `QUOTA_INGEST_TOKEN_FILE` 指定文件。令牌必须是至少 43 位的 base64url 字符串；本地文件权限应为 600，目录为 700。令牌通过 curl 标准输入传递，不进入进程参数或结果文件。

首次配置由维护者生成随机 32 字节专用令牌，保存到本地文件，并通过 `pnpm exec wrangler secret put QUOTA_INGEST_TOKEN --name qqq-million-plan` 的标准输入设置同一个值。不要复用任务接口令牌或提交令牌文件。现有云端令牌不能读取；有其他采集端时，轮换前应协调它们。

脚本使用原始文件字节提交，复用同目录 `upload.json` 中的幂等键和 SHA-256；正文改变时拒绝使用旧运行目录。新批次按北京时间日期和正文哈希生成稳定键。服务端继续验证基金目录、份额、币种、状态、日期和证据字段；脚本不会绕过鉴权或直接写数据库。

只有 HTTP 成功且接口明确返回 `ok: true`、完整的 `accepted` 数量，才记录 `uploaded`。缺少令牌、网络失败、401、422 或部分接受均记录 `pending_upload` 并返回非零退出码。每次提交保留独立的 `upload-attempt-*.json`，最新结果写入 `upload.json`。重试使用同一正文和幂等键，避免重复写入。`--dry-run` 只核对地址、来源及冻结正文，不提交、不改结果文件，也不代表服务端校验通过。

自动化应在每次采集后直接调用此脚本，将响应同步到本次报告与渠道结果；不能仅检查进程环境缺少变量就跳过已配置的本地凭证。`validation_failed`、`pending_validation` 和官方证据缺失的渠道不得加入 `payload.json`。


## 每日调度与采集回执

每日 06:00 的本地自动化、采集 start/finish、冻结上传重试与云端 07:00 巡检见 [定时任务说明](scheduled-jobs.md)。采集完成和上传接收分别记录；当天覆盖率仅依据真实 accepted 回执。
