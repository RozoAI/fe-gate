# 云端支付合成监控交付说明

代码已实现，生产未启用。此说明供老板审核。

新增每日 `real-money.yml`（01:37 UTC，即 10:37 JST）、每小时 checkout 报价探针、每小时 `contract-watch.yml`（:27 UTC）和 UPI 首页覆盖。真钱脚本使用现有 GitHub 钱包 secrets，代码没有创建、读取或上传私钥。

生产开关默认关闭：`FE_GATE_SYNTHETIC_ENABLED`、`FE_GATE_REAL_MONEY_ENABLED`、`FE_GATE_CONTRACT_WATCH_ENABLED`。合并不代表启用，也不代表验收完成。现有首页监控继续按原频率运行。

## 已核实的规格差异

payment-api 只读参数是 URL `?dryrun=true`，JSON `dryRun` 不是建单只读开关。Lightning preview 在 merchant payout 配置和数据库 INSERT 前返回，只有报价，不会生成 invoice/deposit；Base preview 返回 feeInfo 和空 deposit。因此这里测试真实报价契约，不能声称它单独覆盖 partner_fee 插入事故。

真实商户报价按 hosted checkout 通道发送 `Origin: https://checkout.rozo.ai`，遵守现有商户鉴权规则；若商户以后变成需要专用 key 的配置，探针会报错而不会绕过。新 app `fe_gate_canary` 还必须在现有 `EXTRA_ALLOWED_APP_IDS` 服务端配置中单独登记，执行器先用只读报价确认登记生效才允许建单。

SQL 插入契约由 rozo-intents-api 的 pg_cron 回滚子事务测试。该任务默认 inactive。只写告警日志不能保证云端手机投递，`contract-watch` 通过仅返回时间和布尔结果的 `payment_canary_status()` 检查失败或超过 90 分钟未运行，再走 Feishu。

## 启用顺序

1. 审核三个仓库 PR，先合入 ainative 内部 app/钱包登记。`fe_gate_canary` 不属于真实外部 GMV，也不进复购指标。
2. 老板批准后应用 rozo-intents-api 两个 migration（canary cron 与 `fe_gate_canary` 生产 analytics 分类），验证 `analytics_classify_kind('fe_gate_canary')='test'`，再按该仓 runbook 启用 pg_cron。由老板在既有 `EXTRA_ALLOWED_APP_IDS` 中追加 `fe_gate_canary`，保留其他已登记 app，不覆盖名单；这属于待批准的生产配置动作，本轮未执行。绝不把生产 DB 连接串放进 GitHub。
3. 老板在 GitHub 配置 `FEISHU_WEBHOOK`、公开用途的 `FE_GATE_SUPABASE_ANON_KEY`。后者仅用于读取状态 RPC，不是 service-role。两项值不进入聊天和日志。
4. 建立 GitHub environment `payment-synthetic-production`，限制 main 部署，首次验收启用必要审批。确认既有 `FE_GATE_EVM_PRIVATE_KEY`、`FE_GATE_STELLAR_SECRET` 对应 Base `0x4164...BC48` 和 Stellar `GCQ64C...MA3I`。脚本校验固定身份摘要。
5. 分别打开报价、SQL watchdog 开关。验收故障演练需要另外授权，并安排在通知时区 Asia/Singapore 的非静默时间。
6. 本金和 gas 检查完成、老板在电脑前批准真钱运行后，才把 `FE_GATE_REAL_MONEY_ENABLED` 设为 `true`。每日两段各 0.5 USDC，单段报价费上限 0.02 USDC。实际成本须以余额差和交易回执核算。

这两只云端钱包专供本 workflow 使用，不与 Mac mini smoketest、人工转账或其他定时任务并行共用，否则无法把余额差归因到本轮。更换用途前先关真钱开关。

## 验收证据

必须记录三个 schedule run URL，SQL `cron.job_run_details` 和状态表，真实两段 payment id、源/目的 tx hash、前后余额，以及一次故意错误 app 的红灯与 Feishu 手机收件。离线单测通过不能替代这些生产证据。`FEISHU_WEBHOOK` 缺失或接口拒收会报错，不再静默假成功。

通知按 workflow 稳定 key 留 GitHub issue，每 24 小时最多一次，23:00 至 06:00 Asia/Singapore 静默。投递前先保存 reservation，结果未知时保留证据并由人核实，不盲重发。成功运行不推送；余额低于 1 USDC 或 Base 0.0002 ETH 的预警也走去重。

## 异常与回滚

真钱只允许 main 上第一次 attempt，不允许直接 rerun。先写订单标识，再创建和支付；create/broadcast 没有自动重试。任一失败或取消会阻止后续运行，不能因为跨日而自行再付款。下载 `real-money-evidence` artifact，按 `fe-gate-UTC日期-腿号` 查询订单并核对链上余额和 tx。确认所有未决付款均有结论后，老板将 `FE_GATE_RECONCILED_RUN_ID` 设置为最新一次失败 run id（包括后来被守门拒绝的 run），再新建一次运行；不能只签更早的真钱 run，也不能跳过之前未核实的付款。建单前网络失败也会保守阻断，按同样流程核实没有订单再恢复。

关闭三个开关即可停止新增探针或付款。正在进行的链上交易不能撤回，先保留证据并等待确认；不要取消已付款运行然后马上重启。停用数据库 cron 按 API 仓 runbook。不要删除订单、状态表或告警审计记录。

## 尚未验证

本轮没有生产迁移、schedule 成功、真实余额往返、secret 配置、故障通知演练。SQL 本地 fixture 验证函数回滚及权限，未加载生产全部 triggers；启用前仍需生产事务 canary 和实际 cron 验证。
