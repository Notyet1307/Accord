# R003 C5：外部传输适配器与离线契约验证

## 状态与授权

- Revision：`R003-C5/r1.1`；范围已确认：C5 限定为两个传输适配器及离线验证。Spec 定义实施契约，实际请求定义授权，测试及交付记录定义完成证据。
- 实际请求：2026-09-09 用户确认 draft-2 的推荐方案 A，随后明确「先发布 Spec 和 GitHub 任务入口，再开始实现」。这授权依次发布本 Spec、对齐 #45、实施 C5 并进行离线验证；不授权 merge、真实服务/凭据使用、真实故障注入或扩大到 F1/F2/driver。
- 核验基线：`03a1b899e5a3a54a9f49dd997dfc9ecb62e75c4c`。这是代码基线，不是包含本草案的提交。
- 本文细化已有 R003，不创建或承诺 R004。工作区候选仍是后续方向。
- 历史入口：[C5 #45](https://github.com/Notyet1307/Accord/issues/45)、[真实执行 #40](https://github.com/Notyet1307/Accord/issues/40)。2026-09-09 读取时均已关闭，但末条备注为推迟到 C4 完成后；不能用关闭状态证明实现或真实验收。其原文、旧 Oracle 和执行图仅保留为历史材料。
- 唯一任务入口为 [#45](https://github.com/Notyet1307/Accord/issues/45)，发布时先保全历史正文，再将其对齐到本 Spec 的实际 Git 修订。GitHub 拥有实际远端状态；不重新激活历史子任务图。

## 权威输入

- [R003 Release](../product/releases/r003-governed-case-blackboard-walking-skeleton.md)：一个冻结合成内部决策 Case、四个非预置模型输出、人工审批、唯一发布及完整恢复证据。
- [ADR-0002](../adr/0002-production-coordination-runtime-language.md)、[ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md)：技术与外部系统边界。
- [C3 Spec](r003-c3-approval-publication.md)、[C4 Spec](r003-c4-recovery-trace-verification.md) 和上述基线的代码、契约及测试：审批、发布、恢复与 Trace 的已有实现。
- [Delivery gate](../agents/delivery-gate.md)、[tracker](../agents/issue-tracker.md)、[labels](../agents/triage-labels.md)：现行 OMP 交付规则。

ADR-0003 的 MagicChat 参考提交是 `chaitin/MagicChat@29dfa1c85377e69c3810e28b76a3f5580c3e198d`。2026-09-09 已通过 GitHub contents API 只读核对下列固定源；未核验实际部署或调用百智。不得把历史模型探针作为当前服务可用性或四角色质量证据。

| 固定源 | 本轮确认事实 |
| --- | --- |
| [App WebSocket handler](https://github.com/chaitin/MagicChat/blob/29dfa1c85377e69c3810e28b76a3f5580c3e198d/server/internal/httpserver/app_websocket_handlers.go) | `/api/app/ws`；`X-MagicChat-App-ID` 与 `Authorization: Bearer …`；App ID 为 UUID，鉴权成功后注册连接并再次鉴权才重放 |
| [RPC handlers](https://github.com/chaitin/MagicChat/blob/29dfa1c85377e69c3810e28b76a3f5580c3e198d/server/internal/httpserver/app_request_handlers.go) | ACK 累计更新并删除已确认 outbox；`message.send` 将 request.ID 交给 ClientMessageID |
| [Envelope](https://github.com/chaitin/MagicChat/blob/29dfa1c85377e69c3810e28b76a3f5580c3e198d/server/internal/realtime/protocol.go) 与 [连接](https://github.com/chaitin/MagicChat/blob/29dfa1c85377e69c3810e28b76a3f5580c3e198d/server/internal/realtime/connection.go) | 协议 v1；response 用 `reply_to` 关联请求，其自身 ID 是新 ID；服务端 ping/client pong 维护连接 |

Responses 字段参考 [OpenAI 官方 create 文档](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)，2026-09-09 核对：`max_output_tokens` 包括可见输出及 reasoning tokens；`store` 需显式关闭；usage 区分 input/output/total。这是字段定义参考，不是百智兼容性证据。请求不启用自动上下文截断、工具或服务端会话。

## Objective 与后续消费者

C5 的目标是把既有 MagicChat 协议及 ProviderPort 接到受限的传输实现，通过 fake I/O 验证编解码、身份关联、失败、时间与大小边界。C5 不提供可运行的真实 Case 入口，不扩展核心治理状态。

具体消费者是后续独立准备的 R003 单进程驱动：在持久冻结配置和 Reviewer 授权契约补齐后，用同一组 transport 运行冻结合成 Case。C5 完成只证明传输契约；R003 的真实四角色、人工审批和恢复闭环仍需独立证据。如果该消费者被取消或既有端口被替换，应删除未被消费的 transport，而非扩建为通用平台。

| 阶段 | 交付结果 | 完成证据 |
| --- | --- | --- |
| C5（已确认范围） | 既有协议与模型端口的受限传输实现；只通过 fake I/O 装配验证 | fake transport 契约和故障测试、原有回归、源码能力边界检查；不声称真实外部通过 |
| Live 准备（C5 外） | 持久化运行配置、真实模型目标的授权契约、显式最小驱动 | 配置漂移/缺失拒绝、非固定措辞目标的授权测试、单进程驱动恢复测试；尚非真实验收 |
| 独立受控真实验收 | 在已选环境中执行一个冻结 Case，包含人工决策与声明的恢复窗口 | 实际消息、provider 元数据、人工批准、SIGKILL/新 PID、唯一发布及脱敏证据关联 |
| R003 证据评估 | 对照 Release 最低证据判断满足项与缺口 | 不用 CI、适配器合入或模拟审批替代真实证据；可信 operator qualification 单独列明 |

真实验收计划需独立绑定环境、预算和授权；C5 的完成不得提前关闭该验收义务。真实输出被拒绝时记录实际失败，不能换入预置答案以制造成功。

## Owner、Producer、Consumer 与 Primary seam

| 关注点 | Owner / Producer | Consumer / seam |
| --- | --- | --- |
| MagicChat 消息、App、会话与已接受发送 | MagicChat | transport → 既有 `MagicChatProtocolAdapter.receive/dispatch/pendingRequests` |
| 模型调用结果与 usage | Baizhi | transport → 既有 `ProviderPort.complete` → Accord 仲裁 |
| Case、Run、Board、Attempt、审批、发布与审计 | Accord SQLite authority | 既有业务 API；transport 不直接写业务表 |
| 后续最小驱动（C5 外） | 显式 operator 入口 | 串行调用已有协议/运行 API；不复制 Workflow、仲裁或恢复决策 |
| 人类批准与运行范围（C5 外） | 发起人及环境/凭据所有者 | 精确 Artifact 的 choice response；与开发授权、运行授权分别记录 |

C5 包含两个可以独立验收的外部接缝。实现应按接缝分别交付，避免一次改动同时混入 transport、通用 Runtime、产品 UI 和治理重构；不建立新的任务依赖图。

## In scope / Out of scope

已确认范围：固定官方形状的 MagicChat 传输、Native Baizhi Responses 传输、显式配置/秘密参数边界、精确能力清单与离线故障测试。fake 参数中的 credential 只能使用测试 canary。配置文件 loader、真实凭据读取、单进程驱动、配置持久冻结、新 schema/迁移及 Reviewer 授权变化均不属于 C5。

保留一个 Case、一个固定 Workflow、四个固定 Profile、单进程 SQLite/WAL 和冻结合成资料。复用现有上下文与输出契约；模型产物仍是候选。

不包含：生产数据或部署、自由输入产品化、多租户、UI、新审批权威、动态 Agent、Lody/ACP、通用 Runtime 平台、Planner/Harness 集成、自动合并、替换既有数据库或修改历史 C1–C4 证据。

## State / Artifact handoff 与 Stable identities

- MagicChat transport 接收并验证外部 envelope，交给原协议；发送只能消费 authority 已持久化的请求和既有 dispatch gate，不能自己生成业务 request ID 或 ACK 状态。
- Provider transport 消费已冻结的 Invocation 与已接受的 Attempt。`complete` 返回受限的 primitive string，沿用现有 wire、schema、上下文和 Reviewer/Writer 输出绑定检查。
- Invocation、Attempt、Case、Run、Artifact revision/digest、Approval、Response Claim、request Envelope ID 的现有含义不变；同身份冲突必须拒绝。
- 先持久接受，再进行外部 I/O；传输完成不能自行选 winner、追加 Board、批准或发布。
- 同一发布请求重放复用原 ID；确认来自 MagicChat。模型端没有已证明的物理 exactly-once 或结果检索能力，不制造此类承诺。

## Failure modes 与 Recovery

| 失败 | 预期行为与需要验证的证据 |
| --- | --- |
| 非允许目的地、认证失败、重定向至未允许目标 | I/O 边界拒绝或停止；秘密不进入日志、持久上下文或 Trace |
| 消息重放、乱序、ACK 未确认、积压 choice event | 复用持久 Inbox 和既有恢复 API，不能越过未完成 cursor 或自动重复业务动作 |
| 模型超时、连接中断、响应过大、非法 schema | 区分明确失败与可能已执行的 UNKNOWN；SDK 自动重试关闭；复用有界 Attempt 仲裁 |
| 模型结果迟到或上下文过期 | 作为审计结果保留；不能二次提交或推进过期 Workflow |
| 发布已接受、Accord 未确认即崩溃 | 复用原请求身份和现有 freshness/恢复逻辑；不能以再次发送成功代替唯一消息证明 |
| 错误审批人、Artifact 不匹配、新输入或审批过期 | 现有 gate 拒绝或 hold，transport/驱动不得绕过 |
| 缺失 source、schema、恢复或启动驱动能力 | 明确列出缺口和主要接缝，先收敛 Spec；不在测试中直接构造业务完成状态 |

每个 Invocation 最多两个 Attempts 是已有 ADR/代码约束。字符或 wire 大小上限不等于 token、费用或运行时限；后者必须在运行配置中明确，不能把网络超时实现为隐式第三次模型调用。

## 无网络验证与真实执行的边界

当前静态检查扫描 `src`、`scripts`、`test` 并拒绝网络 API、ambient environment 和秘密读取。新增 transport 不能靠全目录豁免或关闭检查获得通过。

实施的精确能力清单如下；路径是待实施目标，不代表文件已经存在。核心不能反向 import 网络包装层；fake transport 测试不需要凭据、DNS 或真实网络。`runtime-capability-guard.mjs` 的既有拒绝能力和回归仍保留。

| 待实施文件 | 唯一新增能力 | 明确不拥有 |
| --- | --- | --- |
| `src/transports/magicchat-websocket.ts` | 通过注入 socket factory 编解码与收发；live factory 使用 `ws`，设置认证 headers、帧限制与连接策略 | 环境/秘密文件读取、业务 request ID、持久 ACK、自动业务重试 |
| `src/transports/baizhi-responses.ts` | 通过注入 HTTP sender 请求及映射；live sender 使用 Node 原生 fetch | 环境/秘密文件读取、Attempt 创建、结果仲裁、Board/审批写入 |
| `test/external-transports.conformance.test.ts` | 导入上述边界并注入内存 fake；不监听端口 | 网络或秘密读取豁免 |

静态检查只为上表两个源码文件开放相应 import/API 类别，保留 ambient environment/秘密读取拒绝；核心和其他测试仍禁止网络 import。检查核心到 wrapper 的直接及间接 import 边，不能只有按文本路径排除；新增回归证明扩大豁免、动态旁路或在测试中访问真实 I/O 失败。wrapper import 本身不连接、不读取配置；只有显式 factory 才可产生能力。普通 CI 的新增 transport 套件也在既有无网络 preload/权限下运行，不能只在 unrestricted Node 中验证。

MagicChat 需要自定义握手 headers，现有运行依赖没有相应 WebSocket client。本 Spec 选择唯一新增运行依赖 `ws@8.21.3`（2026-09-09 npm registry 查询），类型依赖 `@types/ws@8.18.1`。其 [固定版本文档](https://github.com/websockets/ws/blob/8.21.3/doc/ws.md) 支持 headers、握手超时、自动 pong、payload 限制及关闭重定向。百智侧复用原生 fetch，不新增模型 SDK。后续 lockfile 必须固定 integrity，并为可信离线验证提供实际只读缓存；不凭 registry 可达推断离线 qualification 可用。

live 入口、秘密文件 loader 和 driver 目前不在上述能力清单内；缺口解决后应在对应 Spec 逐文件列明，不能现在预留整个目录的权限。

显式真实入口与 `validate-ci.sh`、可信无网络 `validate-delivery.sh` 分开。不得复用 `ACCORD_VALIDATION_BOUNDARY` 将真实网络运行标成无网络 qualification。最低权限、目标允许清单、重定向策略、消息大小、超时、token 上限和错误脱敏须在实施前具体验收，不能留给实现者猜测。

## Transport 参数与失败契约

以下是本 Spec 固定在 transport 契约 v1 的工程限制，供后续批准的实现使用；不是已测得的服务容量，也不是本轮运行授权。修改值需要重验契约；后续具备配置持久化的 driver 还须刷新配置 digest，不能在恢复时静默采用新默认值。

| 参数 | v1 值/规则 |
| --- | --- |
| 金额限制 | `costLimitCny: null`，明确表示未设置；非 null 配置返回 `COST_LIMIT_NOT_IMPLEMENTED`，不能接受却不执行 |
| 模型输出预算 | `max_output_tokens: 8192`；请求明确发送，百智若不支持则停止，不能悄悄删除字段重试 |
| 模型请求体 | 编码后的完整 UTF-8 JSON 最多 131,072 bytes；超限在 Attempt 开始前预检，不截断证据 |
| 模型响应体 | 完整 HTTP body 最多 1,048,576 bytes；读取过程中限流计数，超限取消本地读取且不重发 |
| 内部 ProviderWire | 沿用 65,536 chars/UTF-8 bytes 及现有树/字符串限制；网络响应上限不扩大核心限制 |
| 模型时间 | 从调用到完整 body 读取最多 120 秒；到期 abort 本地请求，但不声称 provider 已取消或未计费 |
| 模型重试 | transport/SDK 自动重试为 0；429/5xx 也不隐式重发；每 Invocation 两 Attempt 的既有仲裁不变 |
| WebSocket 握手 / RPC 响应 | 分别 10 秒 / 30 秒；RPC deadline 从成功提交本地发送开始计时，不等于收到服务端确认 |
| WebSocket 消息 | 完整 UTF-8 文本消息最多 1,048,576 bytes；拒绝 binary，关闭 per-message compression，保留 UTF-8 校验与 ping/pong |
| WebSocket 内存待处理量 | 最多 64 个 envelope，累计最多 4,194,304 bytes；超过则关闭连接、停止接收且不提前 ACK，由既有持久协议恢复 |
| 重连与关闭 | transport 不自动重连/重发；显式 close 最多等待 5 秒后终止该 owned socket；恢复由后续 driver 契约调用已有 API 决定 |
| 目的地 | MagicChat 为显式批准的完整 `wss://…/api/app/ws`；百智通过必填 `responsesUrl` 接收完整 URL，scheme 必须 HTTPS、host 必须 `ai-api-gateway.app.baizhi.cloud`、有效端口必须 443，pathname 必须是配置中明确选择的 Responses endpoint。无默认 pathname、无 baseURL 拼接或探测 fallback；真实 endpoint 在环境准备时固定并纳入 F1 的配置 digest。两者拒绝 userinfo、fragment、query、重定向及 TLS 验证关闭 |

客户端不具备目标模型的权威 tokenizer，不能把 bytes 宣称为 input-token 上限。C5 通过固定合成上下文、完整请求体 byte cap 与显式输出 token cap 限定请求形状；记录 provider 实际 usage，缺失则拒绝成功映射。未来需要输入 token 硬预算时，应单独定义与具体模型匹配的计数与计价契约。

计时使用单调时钟控制进程内 timeout；provider `receivedAt` 由客户端完整接收时的实际时间生成，不能复用 C4 mock clock。请求前配置/编码检查明确失败；`executePreparedAttempt` 内出现异常时当前核心统一记录 UNKNOWN。适配器可以返回稳定脱敏错误码说明 401/429、网络异常或响应拒绝，但不能自行改写核心持久状态为“确定未执行”。

## MagicChat 接缝

1. 完整 URL 与 App UUID、credential 由显式参数传入；只发送所需两项认证 headers。原始 token 不写入异常、trace、配置 digest 或命令行。
2. 应答关联使用 `reply_to`，保留 response 自身 `id`；每个 pending ID 最多一个未决物理请求。未识别 response 或非法 envelope 不能被伪造成已确认结果。
3. 可靠事件保持原始 cursor 与 payload 交给已有协议。传输层不自行 ACK，不忽略有可靠 cursor 的未知事件；拒绝时留存脱敏诊断并保持该 cursor 未确认。
4. 发送只消费既有 `dispatch` 回调给出的请求；连接必须已 ready、本地缓冲可用。尤其最终发布必须在该同步回调内提交 socket.send，不能先通过 Freshness gate 再长时间 await 握手/排队。回调只表示本地发送接受，不表示远端确认。
5. RPC response 与后续可靠事件由接收回调进入同一个串行 authority 驱动。transport 只维护有界内存 I/O 关联，持久请求和恢复仍以 SQLite 为准。

## Responses 映射与角色输出

- 构造单次非流式 Responses 请求：明确 model、`store=false`、`stream=false`、`tools: []`、输出 token cap；省略 conversation/previous_response_id，不启用 background 或自动截断。
- Profile 指令与已授权 context 分开序列化；合成来源作为数据。角色 JSON 形状沿用当前契约，不能往 prompt 中塞入完整 C4 标准答案。
- 仅将 `status=completed`、无 error、一个 assistant message 内唯一 `output_text` 中的完整 JSON 候选映射为 `output`。拒绝工具调用、多个文本候选、refusal、incomplete、Markdown 修补及缺失 usage。独立 reasoning item 可排除在输出与存储外，其 token 仍按 provider usage 记录；不持久化隐藏推理。
- 包装为当前核心需要的 primitive JSON string：`providerMetadata / output / receivedAt / usage`。usage 映射 input/output/total 并通过现有整数与总和校验；不填造零用量。
- `providerMetadata.deploymentId` 定义为显式配置的部署标识，不宣称是 provider 返回值；v1 选择单一 HTTP header `x-request-id`（名称大小写不敏感），值须为一个非空、无控制字符且最多 512 字符的 opaque ID，多值/逗号合并值拒绝，不向其他 header fallback；`responseId` 来自 body.id。缺少任一所需身份，拒绝成功映射。这是本 adapter 的契约选择，百智是否返回该 header 仍待真实兼容性验收。
- `providerMetadata.modelId` 必须与已冻结 requested model 精确一致。当前 v1 没有单独记录 returned model 的位置，因此返回不同 alias/身份时返回 `PROVIDER_MODEL_IDENTITY_MISMATCH`，不能改写为配置值。真实服务如需支持 alias→返回版本映射，另行定义证据字段后才能放行。
- 每个角色仍使用既有 schema；Reviewer/Writer 的 `outputContract` 必须由治理层的授权上下文建立，transport 不能生成或替代它。

## Acceptance tests 与 Evidence to return

| ID | C5 验收标准 |
| --- | --- |
| C5-A1 | 绑定执行 base/head、Spec 修订和固定外部协议来源；实际部署与百智兼容性仍未验证时明确标注 |
| C5-A2 | MagicChat fake 验证目的地/认证参数拒绝、envelope/reply_to、显式重连后重放、稳定 request ID、ping/pong、所有大小与时间边界；既有协议控制 ACK、choice、Freshness 与去重，transport 不能旁路 |
| C5-A3 | Responses fake 验证请求字段、body/输出/token/timeout 边界、usage/身份/唯一 JSON 映射；缺身份、模型不匹配、工具、refusal、incomplete、非法 JSON 均拒绝；无 SDK/HTTP 隐式重试 |
| C5-A4 | 两个端口只通过 fake I/O 装配；不监听端口、不访问 DNS/网络或真实凭据；配置预检失败不进入 Attempt，调用后异常仍服从现有 UNKNOWN 仲裁 |
| C5-A5 | 精确源码能力例外、依赖方向和动态旁路有正反例；核心与其他测试保持网络/秘密访问拒绝；transport 套件在无网络 preload/权限下运行 |
| C5-A6 | C1–C4 适用回归及历史 handoff 不变；无 schema/迁移、Reviewer 授权、driver/loader/CLI 入口或业务状态改动；旧 `networkEnabled: false` 仍描述其原契约 |
| C5-A7 | 假凭据 canary 不出现在错误、日志或返回证据中；超时/关闭只操作本实例资源，没有全局进程或文件清理 |
| C5-A8 | 现有 `validate-ci.sh` 完整通过并纳入受限 transport 套件；PR 证据包含实际命令、结果、依赖锁定与 checked SHA，单独列明可信 operator qualification 和真实外部验收状态 |

后续实施需更新的验证接缝限于 `package.json`、`package-lock.json`、`scripts/check-no-external-seams.mjs`、`scripts/validate-ci.sh`、`scripts/validate-project.sh`、`test/contracts.test.ts` 的精确依赖版本断言以及 `test/validation-capabilities.integration.test.ts`，用于依赖固定、精确能力与测试入口。保留 `scripts/runtime-capability-guard.mjs` 的拒绝能力，不开放网络；保持 GitHub workflow/check 名称不变。若必须增加其他有网络/秘密能力的文件或放宽核心权限，返回 Spec 修订，不能自动扩大清单。

交付时必须实际执行固定 Node/npm 下的 `TMPDIR=/private/tmp ./scripts/validate-ci.sh`，其脚本应显式运行编译后的 `dist/test/external-transports.conformance.test.js` 并施加上述无网络限制。不新增默认 live 启动命令。可信 `validate-delivery.sh` 的依赖缓存/边界条件仍由 operator 建立，缺失时如实报告未验证。实际执行结果由当前代码 revision 的验证记录提供。r1.1 仅补充新增固定 WebSocket 依赖所需的精确版本断言位置，不修改冻结 Oracle 或 handoff。

后续 Live 准备另行要求 driver 的稳定等待、失败、恢复与完成；独立真实验收另留外部调用、精确人工批准、两处恢复窗口、唯一结果及 Trace。这些不属于 C5-A1–A8，也不能因 C5 通过被视为满足。

## 已确定决定与后续运行准备

费用决定及后续运行要求如下；不产生真实执行授权：

- **费用预算（已决定）**：用户明确「模型费用暂时不设置上限，我会后期统一规划，预留入口就好」。运行配置预留可选金额上限入口；当前未设置，必须如实表示“未设置金额上限”，不能当作零预算或擅自填入默认金额。设置金额上限后的计价、预估、预留与耗尽行为由后续预算规划定义，C5 不提前实现预算平台或声称费用硬上限已生效。保留 usage 与实际可获成本证据；缺失价格时标为未知。此决定不取消已有 Attempt 限制，也不授权真实调用。
- **试运行规模（建议）**：一个冻结 Case、四个角色各一次模型调用，加一次声明的未知结果恢复补跑；这不是已接受的全局五次调用策略，也不包含 MagicChat RPC。
- **C5 工程约束（已收敛）**：见 transport 参数、精确能力清单及 C5-A1–A8。F1/F2 是后续 live 启用前置，不再阻塞纯传输离线契约交付；不得借 C5 修复这些核心契约。
- **真实环境（执行准备阶段）**：专用 MagicChat 部署与版本、App/合成用户/审批人、允许目标、provider/model identity、凭据所有者、运行及清理责任。以实际资源核验为准；本文不请求或保存秘密。
- **真实执行（单独决定）**：运行窗口、token/墙钟限制、故障注入位置、允许的恢复与停止条件；金额限制沿用上面的用户决定，除非用户后续更改。该执行决定不由本草案或旧 Issue 关闭状态产生。

## C5 外：完整 live 入口的两个前置缺口

### F1：新运行配置没有持久冻结位置

`src/researcher-analyst.ts:201–206` 的 context digest 不含 endpoint、transport policy、token cap 或 timeout；输入精确只接受 `caseId/modelId/now/profile`。把新配置塞入 modelId、objective 或 permissionSummary 会破坏既有语义。仅保存进程内 config 或独立 JSON 文件也不能满足 SQLite 作为治理权威与跨进程恢复的要求。

建议后续以一个窄 SQLite 扩展绑定 Run、非秘密 transport 配置、policy 版本、digest 和每个 Invocation 的引用；在任何相关外部调用前持久化并验证。需一并定义迁移、启动完整性检查、缺失/漂移拒绝与 Trace 关联。凭据只保存稳定引用，不保存内容；更换实际认证身份不能伪装为无关的 secret rotation。该建议尚未定义 migration/schema 版本，更不是已获批准的 schema 变更。

### F2：固定英文既存在于 Oracle，也存在于授权检查

`src/contracts/researcher-analyst-handoff.ts:237–241` 要求 Analyst 产生 `Customer adoption is guaranteed.` 和 `Promise adoption.`。进一步追查发现 `src/reviewer-context.ts:168–169,208` 的授权图校验也绑定这两句。因此只新增 target selector 仍会被正确拒绝；直接放宽授权检查或把模型答案改成这两句都不是可接受修复。

建议单独定义真实候选到 Reviewer 目标的版本化契约：以实际 winner、Proposal/Claim 身份与 digest、完整 cited graph、明确的目标唯一性规则绑定；保留精确 Case/Run/Board/context 权限。缺失/多个目标必须有明确失败或选择规则，不能凭字符串猜测。历史 C1 Oracle 和固定契约保持其原有验证语义；新路径需要独立反例测试，防止变成接受任意目标的旁路。此处牵涉真实模型输出如何获得审查资格，须在实施前明确行为，而非把它藏进 transport。

### 已确认的范围选择

**2026-09-09，用户确认方案 A：分步准备与交付。** C5 限定为两个 transport 和离线测试；F1/F2 作为后续 live 准备的明确前置，分别细化到其主要 owner/seam，再准备 driver 与真实验收。没有 driver 时，C5 的网络 factory 不作为可直接运行的用户入口，不能对现有未冻结 Invocation 启用真实网络。

不采用将 SQLite 冻结配置、Reviewer 授权契约和 driver 一并纳入 C5 的方案 B。原因是其同时触及 persistence、上下文授权、运行驱动和网络边界，超出本次已确认接缝。此取舍不改变 R003 的完整目标或降低最终验收标准。

范围讨论已结束，不重复请求同一确认。按用户后续明确请求先发布 Spec/任务入口，再实施并绑定证据；merge 与真实执行仍未授权。没有新的术语冲突，不创建重复 CONTEXT；C5 不改变事实所有权或既有 ADR，无需新增 ADR。

## v3: Fetch-exposed request correlation field (2026-09-10)

User-authorized live diagnosis reproduced HTTP 200 from Grok with two physical `x-request-id` fields, of lengths 32 and 36, neither containing comma/control characters. Fetch exposes their combined value (70 characters including comma-space). The prior v1/v2 single-ID contract correctly rejects this. This observation does not identify which external hop owns either value.

Explicit `accord.baizhi-responses-transport/v3` instead defines `providerMetadata.requestId` as the complete Fetch-exposed response correlation field value. Preserve it verbatim: do not select, trim, split/rejoin, truncate, sort, deduplicate, or label individual values as gateway/upstream authority. It is not a single provider identity, proof of physical exactly-once execution, or an Accord idempotency key. Nonempty, maximum 512 characters, no leading/trailing whitespace and no control characters remain required. Body `responseId` keeps the existing strict single-ID validation. No fallback header or generated identity is allowed.

v1/v2 behavior remains unchanged. v3 is explicitly frozen into new configuration digests and requires the v2 cancellation/input-contract path. It shares v2's explicit UNKNOWN retry authorization and two-Attempt ceiling; startup/recovery cannot silently take the legacy retry path. Existing metadata fields and storage/digest semantics already preserve bounded strings, so no schema migration or providerPortVersion change is required. Old configurations/Attempts remain immutable.

Acceptance: v3 retains the exact combined field through transport and runtime/Trace; v1/v2 reject it; empty/oversized/control-bearing fields and multi-valued body IDs are rejected; v3 requires AbortSignal; UNKNOWN has no implicit second call, explicit retry authorization is durable/replayable and retains its ceiling. Run existing cancellation, credential-reflection, output, persistence and configuration-binding tests. Real qualification still requires a new explicitly configured run and actual Human Approval; this compatibility change cannot promote prior rejected results.
