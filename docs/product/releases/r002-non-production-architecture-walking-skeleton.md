# R002: 非生产基础架构 Walking Skeleton

## Metadata
- status: HOLD
- revision: r3
- owner: 产品负责人
- product_stage: EVIDENCE
- delivery_stage: STOPPED_BEFORE_ADMISSION
- delivery_evidence_alignment: UNKNOWN

## Evidence ledger

| Type | Claim | Source and date | Limitation |
| --- | --- | --- | --- |
| FACT | R001/r5 的纯逻辑架构冒烟测试六项断言全部通过，最终状态为 `RUN-SMOKE-001 / PUBLISHED`，最终回复数为 1。 | `docs/product/releases/r001-managed-internal-decision-brief.md` 与 `docs/product/prototypes/r001-architecture-smoke.logic-prototype.html`，2026-08-20 | 固定合成数据、纯内存、无网络、无模型、无 MagicChat/Runtime 集成。 |
| FACT | Cumora 在固定 commit 中实现统一 Participant、durable inbox、Wake/triage、独立 Agent 工作区与发送前 Freshness；普通群聊通常广播 Wake，未发现通用 Workflow Definition/Run 引擎。 | `docs/product/research/cumora-wake-and-first-class-agents.md`；`yetone/cumora@90fd9ae8bc42a477168eb109717291dd567993f5`，2026-08-20 | 只适用于该 commit；Accord 仍需自行设计 Work Router、Workflow Run 和唯一 Response Claim。 |
| DECISION | R001 进入 HOLD；R002 只验证非生产基础架构 Walking Skeleton，不验证真实质量、采用率或生产安全。 | 产品负责人决定，2026-08-20 | R002 通过不能自动重新开启或证明 R001 成功。 |
| DECISION | R002 必须跨越真实、完整的官方 MagicChat 本地核心和真实 App WebSocket 边界，不接受本地协议 Mock 冒充跨边界成功。 | 产品负责人决定，2026-08-20 | 官方 Assistant、LLM、MCP、S3 和 ASR 不属于本轮通过边界。 |
| FACT | 官方 MagicChat 源码固定在 `chaitin/MagicChat@0cc474e560020491eb5f9ff3abe557559eba22a7`；本地原生 `arm64` 构建并运行 PostgreSQL、Server、Document Server 和 Caddy，客户端、管理端、健康检查、管理员登录及数据库迁移均通过。 | `local-evidence:magicchat-r002/DEPLOYMENT-R002.md`；`20260820T113551Z-final-validation`，2026-08-20 | 本地 Caddy CA 未受 macOS 信任；上游基础镜像标签可变；文件存储和官方 Assistant 未启用。 |
| FACT | MagicChat App 重放保持消息 ID 和 outbox cursor，但会生成新的 WebSocket envelope Event ID；最终故障测试的原 Event ID 为 `1b43a3a0-8dd5-4f41-9f6f-4a090301bc08`，重放 Event ID 为 `01890342-2535-42eb-bc3a-d9188f1ca4fb`，cursor 均为 `54`。 | `20260820T113643Z-after-send-replay/replay-correlation.txt` 与 `EVIDENCE.md`，2026-08-20 | Event ID 只能标识一次投递，不能单独作为跨重放幂等键。 |
| DECISION | R002 的幂等身份改为稳定 Message ID/cursor、Run ID 和确定性 RPC/client-message ID 组合；Event ID 仅保留为投递审计字段。 | R002 故障证据与产品架构决定，2026-08-20 | 未来若接入没有持久幂等契约的外部 Runtime，仍需额外的 invocation result recovery。 |
| DECISION | R002/r2 不再是 active Release；R002 进入 HOLD，停止现有 Delivery Spec、Admission 和 Harness 路径。 | 产品负责人决定，2026-08-21 | 保留 R002 证据和 ADR-0001 作为历史；后续 Release 只能继承明确列出的外部行为约束。 |
| FACT | 真实 happy path 完成固定合成请求、一次追问、同一 Run 恢复、一次逻辑 Stub Runtime、发起人审批和唯一最终回复；Run 最终为 `PUBLISHED`，App outbox 为 0。 | `20260820T113621Z-happy-final`，2026-08-20 | 只覆盖一个固定 Workflow、一个会话、一个 Run 和合成数据。 |
| FACT | 在最终 `message.send` 已被 MagicChat 持久接受、但 Stub App 尚未提交本地完成状态和 ACK 前注入崩溃；重启后使用新 Event ID 重放，恢复原 Pending Action，复用确定性 request/client-message ID，最终只有一个 Run、一个逻辑 Runtime 结果、一条最终消息记录且 outbox 为 0。 | `20260820T113643Z-after-send-replay`；最终技术独立审查，2026-08-20 | 证明的是当前单进程 Stub 与 MagicChat 持久消息幂等；不声称外部 Runtime 的物理 exactly-once。 |
| FACT | Stub App 以非 Root 用户运行，无新增主机端口；容器只接收非敏感 App ID、只读 App secret 文件和专用可写状态目录，不能读取核心、管理员、数据库或合成用户凭据。 | `20260820T113551Z-final-validation/container-boundary.json`；最终技术独立审查，2026-08-20 | 仍是本地非生产容器边界，不是生产威胁模型或安全认证。 |
| FACT | 最终独立审查对稳定重放、持久幂等、Run Store、审批、唯一回复、审计、密钥边界、健康状态和证据哈希给出 `PASS`。 | 最终 reviewer gate；`20260820T114810Z-documentation-correction`，2026-08-20 | 仅接受本 Release 定义的狭窄非生产 Walking Skeleton。 |

## Release frame

- actor_and_trigger: 平台构建者使用一个合成普通用户，在本地非生产 MagicChat App 会话发送固定“内部决策”任务，需要确认架构不再只是单文件内部状态推演。
- observed_problem:
  - R001/r5 只证明纯逻辑状态链可运行。
  - R002/r1 尚未证明消息入口、路由、Run Store、Runtime Adapter 和 Response Gate 能跨真实接口协作。
  - 原假设错误地把 Event ID 视为跨重放稳定身份；真实 MagicChat 证明 Event ID 会变化。
- target_outcome: 一条非生产合成消息跨越真实 MagicChat App WebSocket 和独立模块接口，创建并恢复一个 Workflow Run，调用一次逻辑 Stub Runtime，经 Human Approval 后在原会话只返回一次结果，并生成可追踪、可故障恢复的端到端记录。
- solution_hypothesis: 以官方 MagicChat 本地核心作为真实消息边界，由独立 Wake Router、Work Router、原子 JSON Run Store、Stub Runtime Adapter、Human Approval Gate 和 Response Gate 完成一个固定 Workflow；使用 Message ID/cursor 与确定性 RPC/client-message ID 实现跨重放恢复。
- smallest_closed_loop: MagicChat 合成消息 → 投递 Event ID 与稳定 Message ID/cursor → 幂等接收 → Wake Router → Work Router → 唯一 Workflow Run → 缺失信息追问 → 原会话回复恢复同一 Run → Stub Runtime Adapter 一个逻辑结果 → Human Approval → 持久 Response Claim → 确定性 `message.send` → 原会话唯一回复 → 累积 ACK → Audit Trace。
- included_scenarios:
  - 一个本地非生产 MagicChat 部署和一个合成用户拥有的 App 会话。
  - 一条固定合成任务和一个固定 Workflow Definition。
  - 一个缺失输入及一次追问/回复。
  - 一个单进程原子 JSON Run Store 和一个 Run。
  - 一个纯确定性 Stub Runtime 逻辑调用。
  - 一个发起人 Human Approval。
  - 一个最终回复和一条完整 Trace。
  - 一次 `message.send` 成功后、本地完成提交及 ACK 前的真实崩溃与重放。
- non_goals:
  - 真实 LLM、百智云配置或模型质量。
  - 官方 MagicChat Assistant、MCP、S3、ASR。
  - 真实企业数据、生产凭据或生产环境。
  - 性能、扩缩容、多副本和成本优化。
  - 多 Workflow、多 Runtime、复杂 branch/join/retry。
  - Memory、主动行为、Skill 市场。
  - Planner、Admission、Harness 或正式软件交付。
  - Ticket 拆分和生产实现。
- success baseline: R001/r5 单文件纯逻辑冒烟测试已通过，但没有跨模块接口。
- primary_signal: 一次真实 happy path 和一次真实故障重放均返回 `PASS`；全程共享同一 Run identity；Stub Runtime 只有一个已提交逻辑结果；Human Approval 前不发布；最终只回写一次。
- guardrail: 只使用合成数据和本地非生产边界；零外部数据发送、零生产写入、零重复 Run、零重复最终回复。
- evidence_window: 一次最终静态/边界验证、一次固定 happy path、一次最终回写崩溃重放。
- minimum_evidence:
  - 输入投递包含 Event ID、稳定 Message ID 和 outbox cursor；不同 Event ID 的重复投递不创建第二个 Run。
  - 全程只有一个 Workflow Run ID。
  - 缺失输入前不提交 Stub Runtime 结果；回复后恢复原 Run。
  - Run 状态通过原子 Run Store 写入和重新读取，而不是只在调用栈中传递。
  - 纯 Stub Runtime 只有一个已提交逻辑 invocation/result。
  - Human Approval 前 Response Gate 不允许最终发布，且只有发起人能批准匹配 Run。
  - 最终 `message.send` 使用确定性 request/client-message ID；崩溃重放后数据库仍只有一条最终消息。
  - 累积 ACK 在持久处理后发送，并保留 Intent/Confirmed 审计。
  - Trace 关联 Event delivery、Message、cursor、Conversation、Run、Runtime、Approval、RPC 和最终 Message ID。
- risks:
  - value: 技术链路通过仍不证明员工愿意使用或方案有价值。
  - usability: 固定追问和审批语法正确但不代表真实会话自然。
  - feasibility: 单进程 JSON Store 和纯 Stub Runtime 不能直接扩展为生产多副本或外部 Runtime。
  - viability: Walking Skeleton 被误当成生产框架，过早固化技术栈和抽象。
  - evidence_durability: 原始证据和实现目前位于本机 sandbox、未进入版本化交付仓库，清理前必须单独保存。
- appetite: 一个真实入口适配器、一个 Wake Router、一个 Work Router、一个 Run Store、一个固定 Workflow、一个 Stub Runtime Adapter、一个 Human Approval、一个 Response Gate、两个端到端场景；不选择生产栈，不做质量优化。
- blocking_unknowns:
  - 无阻止本轮 Commit 决策的未知项。
  - 百智云 LLM 协议、外部 Runtime 幂等、多副本存储和生产安全均保留为后续 Release 问题。
- false_positive_completion: 只让单进程函数或 Mock 变绿，未跨真实 MagicChat App WebSocket、未验证不同 Event ID 重放、未写入 Run Store、未经过 Human Approval、未证明持久回写幂等或缺少跨模块 Trace。

### Controlled boundary

- protected_assets_and_data: 仅固定合成消息、合成回复、本地非生产 App/用户凭据、Run Store 和测试 Trace；未使用真实企业内容。
- blast_radius: 一个本地 MagicChat 部署、一个随机命名合成用户、一个带所有权 marker 的合成 App 和对应会话。
- pre_release_verification: 官方源码固定 commit；服务仅本地访问；App 容器无主机端口；凭据最小挂载；S3/LLM/MCP/ASR 未启用；所有 side effect 有固定合成目标。
- rollback_or_recovery: 使用守卫脚本停止 Stub 或完整核心；只在精确所有权 manifest 匹配时删除合成 App/用户；数据和镜像清理要求显式确认；不得在 `cd` 或 Compose shutdown 失败后继续删除。
- approval_owners: 产品负责人和本机 MagicChat 环境所有者；当前均为同一获授权操作者。
- staged_release: 先启动四服务核心，再通过 profile 启动 Stub App；未向普通员工或生产网络开放。
- smoke_and_stop_conditions: 触达生产、需要真实数据、非所有权资源发生修改、重复创建 Run/最终回复、无法恢复同一 Run、无法关联原会话或无法清理时立即停止。
- audit_evidence: Delivery Event ID、stable Message ID、cursor、Conversation ID、Run ID、Runtime Invocation ID、Approval Message ID、RPC request/client-message ID、最终 Message ID、ACK intent/confirmed 和时间顺序。

## Evidence result

- decision_question: 是否能在真实官方 MagicChat 本地核心和 App WebSocket 边界上，以最小独立模块完成可持久恢复、人工审批和唯一回写的 Walking Skeleton。
- riskiest_assumption: MagicChat 消息入口和回写边界能够提供足够的稳定身份与持久幂等，使 Run 在回写中断后恢复而不重复发布。
- result: PASS
- key_correction: WebSocket envelope Event ID 在 outbox 重放时变化；稳定恢复依赖 Message ID/cursor 和确定性 RPC/client-message ID。
- authorization: 产品负责人已批准真实 MagicChat 核心、Stub App、合成资源创建和证据运行；百智云 LLM 配置明确延期手工完成。
- evidence_sets:
  - `local-evidence:20260820T113551Z-final-validation`
  - `local-evidence:20260820T113621Z-happy-final`
  - `local-evidence:20260820T113643Z-after-send-replay`
  - `local-evidence:20260820T114810Z-documentation-correction`
- executable_source_hash: `sha256:5299cad18c999be0cd256565262963781a31ac8e2426582b780d5f3c8fb304f1`
- official_magicchat_commit: `0cc474e560020491eb5f9ff3abe557559eba22a7`
- independent_review: PASS
- main_cost: 本机容器、合成账号/App、单进程 Stub 实现和故障证据；无外部模型费用或生产写入。
- safest_default: 保持 R001 为 HOLD；在新的明确 Release 决策前，不把本 Skeleton 扩张为生产实现或模型试点。

## Prior readiness (r2)

- verdict: READY_TO_COMMIT
- reason: 狭窄非生产目标已跨真实 MagicChat 边界和关键回写崩溃窗口验证，最终独立审查为 PASS，且残余限制均明确在非目标内。
- commit_effect: 仅确认 R002 Walking Skeleton 证据成立；不解除 R001 HOLD，不授权 SPEC、Ticket、生产化、真实数据或百智云 LLM 接入。
- preservation_warning: 原始实现和证据位于本机未版本化 sandbox；清理前必须保留所需副本和哈希。

## Prior commitment (r2)

- decision: COMMITTED
- decided_by: 产品负责人
- decided_at: 2026-08-20
- committed_revision: R002/r2
- approved_candidate_sha256: `24553d7241862cc0368922b3af551892cfba2c4c57c370994d07cff2be685ff2`
- commitment_scope: 仅确认真实官方 MagicChat 本地核心与 R002 Stub App 构成的狭窄非生产 Walking Skeleton 值得进入正式交付准备。
- retained_boundaries: R001 继续 HOLD；百智云 LLM、官方 Assistant、MCP、S3、ASR、真实数据、生产化、外部 Runtime 物理 exactly-once 和多副本存储均未获授权。
- next_gate: Commitment 时仓库尚未建立 Git 基线；进入 SPEC 前必须先通过 `setup-delivery-repository` 将本精确 Release 放入首个 accepted delivery base，并完成技术边界复核。

## HOLD decision (r3)

- decision: HOLD
- decided_by: 产品负责人
- decided_at: 2026-08-21
- superseded_active_revision: R002/r2
- reason: 本次输入构成 material product-direction drift；R002 的狭窄非生产验证不再作为当前交付方向继续推进。
- next_evidence_action: NONE
- reopen_condition: 只有未来某个已承诺 Release 明确需要独立验证 MagicChat App WebSocket、ACK、确定性回写和 post-send crash/replay 行为，并且这些行为无法在新的 production walking skeleton 中直接验证时，才重新打开 R002。
- delivery_disposition: GitHub Delivery Spec #1 和子 Issue #2～#5 关闭为 `not planned / superseded`；不进入 Admission 或 Harness。
- historical_artifacts: 保留本 Release 的全部修订、ADR-0001 和已有证据引用，不删除或改写历史技术结论。
- inheritable_external_behavior_constraints: stable identity、wait/resume、Human Approval、Response Claim、deterministic idempotency、Freshness、Dedup、crash recovery、audit。
- not_inherited: Go Reference Harness 的交付或生产使用、Atomic JSON Store、R002 内部模块划分、单进程本地部署、固定依赖与 MagicChat commit、现有 Delivery Spec 和 Ticket 图；ADR-0001 不适用于 R002 之外的生产架构。

## Revision history

- r1: 定义候选 Walking Skeleton 与真实 MagicChat/本地模拟器边界决策。
- r2: 采用并验证官方 MagicChat 本地核心 + R002 Stub App；记录 happy path、回写后崩溃重放、Event ID 非稳定修正、最终独立审查和 `READY_TO_COMMIT` 建议。
- r3: 记录产品方向重置后的 HOLD 决定、`next_evidence_action: NONE`、重新打开条件、历史保留边界和现有交付图终止方式。
