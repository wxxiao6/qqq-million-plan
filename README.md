# qqq-million-plan

面向用户的财务决策工作台产品，提供三个一级模块：定投管理 · 持仓管理 · 纳指雷达。

用户资产可手填；纳指清单及市场数据由公开来源更新，基金页面只读。

## 定投管理

新增持仓和定投计划以购买平台与基金代码的组合作为唯一标识。同一基金可在不同平台分别记录；同平台同基金的已有持仓需编辑，已有定投计划需编辑或恢复（已结束计划允许重新创建）。定投执行的多笔扣款仍作为独立记录保留。

创建计划后，工作台在计划日按配置自动生成记账记录；不会向购买渠道发起真实交易。暂停或结束计划也不会更改购买渠道的设置，结束后的计划与历史记录保留。打开工作台时会补记运行中错过的期次，暂停期间不补记。可在执行记录中修正金额或标记失败、撤单。

计划日历按计划频率推算，当前每日计划仅排除周末，节假日与实际交易以购买渠道为准。自动记账金额和份额均是估算，可按实际情况核对修正。

## 数据同步

`config/nasdaq-funds.json` 是纳斯达克基金的唯一范围。程序每天北京时间 22:00 使用天天基金接口同步全部场外基金的最新净值、日涨跌和代销额度；基金概况仍由独立的低频必盈任务同步，需要配置 `BIYING_LICENCE`。净值和交易规则通过独立数据源适配器接入，后续可替换供应商。可用 `FUND_DATA_CONCURRENCY` 调整并发。

持仓购买成本、定投申购手续费和纳指基金持有管理费对账口径见[持仓成本文档](docs/holding-costs.md)。

必盈与天天基金接口的时效、稳定性和全量测试结果见[数据源方案评估](docs/data-source-evaluation.md)。

外部机器人通过 `POST /api/ingestion/quota` 上报可投额度。请求需要 `Authorization: Bearer <QUOTA_INGEST_TOKEN>`、`Idempotency-Key`，并提交结构化 JSON；系统会把记录写入额度历史和当前额度。`QUOTA_SOURCE_HOSTS` 是逗号分隔的 HTTPS 来源域名白名单，未配置时拒绝额度写入。

额度证据随每条记录保存：`sourceUrl` 可以是官方公告 PDF，`sourceType` 支持 `announcement_pdf`、`official_page` 和 `api`，并可附带公告发布时间 `sourcePublishedAt`、页码或条款定位 `evidenceLocator` 以及 PDF 内容哈希 `sourceHash`。PDF 来源的域名也必须加入 `QUOTA_SOURCE_HOSTS`。

## 如何跑

需要 Node 22+ 与 pnpm。

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动会创建 `data/ledger.sqlite`。

| 路径 | 模块 |
| --- | --- |
| `/` | 重定向到纳指额度 |
| `/dca` | 定投管理 |
| `/holdings` | 重定向到定投管理（旧入口） |
| `/holdings/overview` | 重定向到定投管理（旧入口） |
| `/holdings/manage` | 持仓管理 |
| `/quota` | 纳斯达克 QDII 基金清单 |

备份：复制 `data/ledger.sqlite`。不要提交该文件。

## 纳斯达克 QDII 清单

`config/nasdaq-funds.json` 是唯一的基金成员目录，记录基金代码、名称、管理人、主题、份额类别、币种和市场类型。启动时同步到 `nasdaq_funds`；纳指雷达、行情刷新、定投候选和持仓选择都以这张表决定基金范围。额度当前值与历史记录使用 `quota_current` 和 `quota_observations`。旧搜索快照是历史取样证据，不参与目录导入。可运行 `python3 scripts/audit_nasdaq_catalog.py` 与天天基金公开代码索引比对新代码；新增候选需核对名称和产品类型后写入唯一目录。

公募基金统一信息披露平台的核验记录保存在 `config/csrc-catalog-evidence.json`，销售机构核验记录保存在 `config/nasdaq-sales-audit-2026-09-24.tsv`。这些是证据，不是第二份成员清单。某份额只在天天基金可查时仍可列入目录，并保留尚未核验的渠道状态。

点击“更新净值与额度”通过天天基金获取正式单位净值、日涨跌和代销交易规则，并直接写入 `quota_current` 的 `agency` 维度。外部机器人仍通过额度上报 API 写入 `direct` 或人工校正数据，不会被天天基金任务覆盖。公告来源可以作为外部机器人提交的证据链接保存，项目不下载或解析公告内容。场内 ETF 的买入量和手续费由证券账户及券商决定。美元份额独立列在页面末尾。
