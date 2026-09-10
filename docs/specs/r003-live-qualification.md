# R003 本机真实联调与 operator qualification

Revision: R003-LIVE/r1。执行授权：2026-09-10 用户要求「真实 MagicChat/Baizhi 联调和可信 operator qualification 做一下吧」，随后明确由本会话本地部署 MagicChat、使用本机 OMP `baizhi-responses`，并自行选择合理的 operator launcher/profile 位置。此为本次授权执行；不重启旧 Controller，不把历史关闭 #40 的旧 Oracle 当当前执行规格。

## Objective / authority / owner / seam

Owner：用户授权的本地执行者；Human Approval 仍归实际用户。Producer：固定源码 MagicChat 真实服务、Baizhi Responses 真实返回；Consumer：独立验收证据。Primary seam：Accord Driver→官方 App WebSocket/Responses→SQLite authority→用户精确 Approval→唯一发布。

代码基线 `5e69f0216ec4c0d2cc490f584bdc925292e8f6c7`，Driver/r1.1、F1/F2、Accepted R003、ADR-0002/0003、delivery gate 为权威。历史 ADR 模型 deepseek-v4-pro 不在本机所选 provider 列表；本次依用户指定的 OMP 配置选择其已有 gpt-5.6-sol，冻结到四个 Profile，禁止 fallback，不宣称旧模型已验证。

## In scope / Out of scope

一个新合成 Case，专用 App/用户/会话与独立数据库；四次初始模型调用，无自动补跑。真实会话初始输入及追问答案可由测试执行者通过官方 REST 发送；Approval 由用户在 MagicChat 点击，Agent 不提交 Approval。保留在途/UNKNOWN 与审计证据，不因失败修改数据库、静默重试或创建第二 Case。

本次先验证正常端到端与真实审批；真实网络两个精确 crash window 不在未绑定故障点的情况下擅自执行，因此正常路径通过仍不等于完整 T17/R003 资格。现有真实子进程离线 crash 证据与真实网络证据分别标注。

## Frozen environment / identities

- MagicChat 源码：chaitin/MagicChat@29dfa1c85377e69c3810e28b76a3f5580c3e198d，独立 Docker project accord-r003-magicchat；仅本机 24443/24444。Postgres 独立 volume；不操作其他服务。
- App：`0e968855-e1b0-437c-80ce-e9162eb2b3e0`；Conversation：`cae8826a-bbc3-49a7-acb9-d12c6090bdcc`；User：`40a3b00a-3283-47e1-a7a1-3e5ac022d29b`。
- WebSocket：`wss://localhost:24443/api/app/ws`；Responses：`https://ai-api-gateway.app.baizhi.cloud/api/openai/responses`；模型：gpt-5.6-sol；凭据来源为用户明确指定 OMP provider，只复制该项至 0600 独立文件，禁止输出 token。
- 运行根目录：`/Users/yet/.local/share/accord-live/`；数据库 `case.sqlite`（新建）；配置 `config.json`；凭据 `credentials.json`。
- 配置文件 SHA-256：`de55946daa7f3748487c7bc5dae75646538c663564f65be6986c2b2344f923fa`；窗口 `2026-09-10T03:44:25.594Z` 至 `2026-09-10T04:30:25.594Z`；costLimitCny=null；没有自动重连或 SDK retry。
- TLS 使用专用 localhost 证书，经进程显式 NODE_EXTRA_CA_CERTS 文件扩展信任，不关闭 rejectUnauthorized、不修改系统证书库；证书 SHA-256：`1f6bb27b2d8c64fbf8ec0e32670cba81f1932380b8cb9426325fb11285ffda6a`。该环境变量仅 Node 启动加载公开证书，Driver 不扫描环境或秘密。

## Input / handoff / failure and recovery

合成输入：依据固定合成政策提出两周决策计划，包含“所有客户必然采用”的刻意无依据主张，要求评审隔离该主张。模型自行产出结构化结果；只在 instruction 中给出字段契约和来源引用元数据，不注入预制角色输出。Writer 只能使用 authority 选出的合格依据。

Runtime Operation/Invocation/Attempt、config digest、Board、H1、Artifact、Response Claim、cursor/ACK 复用原稳定身份。任何 UNKNOWN、格式/模型身份错误、超时、真实数据、非专用目标或审批不匹配均停止推进并保留证据。只有 authority completion predicate 成立才报告 live COMPLETE；不会在聊天中的一句“通过”后伪造 MagicChat choice。

## Operator qualification and evidence

独立无网络阶段：`/Users/yet/.local/share/accord-qualification/launcher.sh`，固定代码提交如上。在 repository shell 之前由 sandbox-exec 实际建立 profile，核验网络连接/监听、外部文件、cache 写入/改权限、launcher 写入拒绝以及私有 temp 允许，记录实际 BOUNDARY。此阶段不使用 live 凭据。

已执行结果归 operator-execution.json 和 qualification-01.log；不得覆盖。真实阶段记录 config/证书/镜像 ID、实际启动命令、退出码、SQLite Trace 与 redacted 输出；凭据文件/会话 cookie 不进入仓库或 Trace。结束关闭本实例 Driver；部署容器及数据保留供用户检查，不清理其他资源。

Acceptance：可信 launcher 实际退出0及299个离线测试；真实官方 App 连通、四个真实模型结果、用户 Approval 绑定唯一 Artifact、唯一发布及最终累计 ACK；分别列出未通过/未执行项，不能混合为全部 Release 验收通过。

## 首次真实运行发现的兼容性修复

2026-09-10 首次真实连接已创建一条追问，Accord 尚无模型 Attempt。C5 将 Node socket.write 的成功回调 `null` 误判为 MAGICCHAT_SEND_FAILED；原 fake 只返回 undefined，未覆盖真实回调契约。新增可复现红测试后，将共享发送错误判断改为同时接受 undefined/null 成功，仅非空 error 触发失败。没有修改请求 identity、数据库、重试策略或 TLS。修复提交需重新跑可信 qualification；先前 5e69f02 的证据只归原提交。恢复使用原 database/config/App/Case 和原请求 ID，由官方服务去重确认，禁止发出新的追问 identity。

## 显式 UNKNOWN 重试与诊断

2026-09-10 用户确认授权原 Researcher UNKNOWN 一次显式重试及脱敏诊断。原 Attempt `attempt_37cec0c84ca9a4b468b1776c1095cb615ca358123bd8f55f55d72c86671195b6`；保留原 Case/config/model/window，通过 Driver --retry-unknown 接受第二 Attempt，禁止自动第三次调用。Driver 仅报告固定白名单内的 provider 错误码，不输出任意异常文本、响应内容或凭据；诊断不改变 UNKNOWN 与结果晋升规则。HTTP 诊断仅记录状态码、固定网络错误码和有无 request-id，不记录响应 body。

## Grok 独立联调执行

2026-09-10 用户要求「换一个 grok试试呢」，grok-4.6 最小非流式 Responses 探测返回 HTTP 200/completed/OK 后，用户要求「继续」，授权新独立四角色合成联调。旧 gpt-5.6-sol Case/两次 UNKNOWN/FAILED 保留，不复活、不覆盖；Grok 新 App `f8b71be3-0457-4f99-92a1-3a3d1285009e`、Conversation `6ab0d1a5-8f34-44c4-b343-33a0ded32517`、独立数据库 `/Users/yet/.local/share/accord-live/grok/case.sqlite`。四角色统一 grok-4.6，仍为同一用户指定 provider/端点；四次初始调用，无自动重试，UNKNOWN 停止。

新配置 `/Users/yet/.local/share/accord-live/grok/config.json`，SHA-256 `b66560547759d7300dd870af1cfe72eea02c084085cb10efd31266ff5b65f2f3`，窗口 `2026-09-10T04:04:10.447Z` 至 `2026-09-10T04:50:10.447Z`。指令按现有实际契约修正 REVIEWER 枚举 INCONCLUSIVE_VERIFICATION，明确 WRITER 的 context.bases；没有更改代码接受契约或注入角色结果。复用 localhost 服务/证书及独立 test user，新 App secret 位于 grok/credentials.json (0600)。沿用同一合成输入/追问答案，Approval 仍须实际用户在 MagicChat 点击。脱敏 HTTP 诊断 preload 仅用于 operator 日志，不修改请求/响应/重试。
