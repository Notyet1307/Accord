# R003: Governed Case Blackboard Walking Skeleton

## Metadata
- status: CANDIDATE
- revision: r1
- owner: 产品负责人
- product_stage: FRAME
- delivery_stage: NOT_STARTED
- delivery_evidence_alignment: UNKNOWN

## Evidence ledger

| Type | Claim | Source and date | Limitation |
| --- | --- | --- | --- |
| FACT | accepted base 尚无可执行的 Case、Typed Blackboard 或四 Agent 协作实现。 | `main@f52f3908d97546724ca2201e4dcf6d78eddaf93e`，2026-08-21 | 只说明当前实现缺口，不证明客户价值。 |
| FACT | R001/r5 证明了固定合成逻辑中的追问、同 Run 恢复、审批和唯一发布。 | `docs/product/releases/r001-managed-internal-decision-brief.md` | 纯逻辑、无网络、无真实模型。 |
| FACT | R002/r2 证明了真实 MagicChat App 边界上的稳定身份、等待恢复、确定性回写和 post-send crash/replay。 | R002 历史证据，2026-08-20 | 本地、单进程、Stub Runtime、合成数据。 |
| FACT | 产品负责人报告当前产品方向来自既往用户调研。 | 产品负责人陈述，2026-08-21 | 暂无可追溯的需求对应关系，不能证明任何具体用户价值。 |
| DECISION | R002/r3 为 HOLD；后续 Release 继承外部可靠性约束，不继承其实现结构。 | R002/r3，2026-08-21 | ADR-0001 仍只适用于 R002。 |
| DECISION | Accord 采用 Conversation-first、Case-centered、Governed-Blackboard-assisted、Workflow-governed、Human-authorized、Authority-separated 的产品方向。 | 产品负责人，2026-08-21 | 产品方向，不是客户价值事实。 |
| DECISION | 先建设最小可观察实现，再通过实验校正需求映射。 | 产品负责人，2026-08-21 | 本 Release 只能证明可运行性和有限语义完整性。 |
| DECISION | 选择 Evidence-to-Artifact Integrity Frame；四个固定 Profile 均产生非预置模型输出。 | 产品负责人，2026-08-21 | 不等于选择生产模型、Runtime 或实现语言。 |
| ASSUMPTION | 一个带缺失信息和预置矛盾的合成 Case 足以暴露首轮 Blackboard、审查和 Trace 缺陷。 | R003 Candidate Frame | 单 Case 不能证明普遍质量或相对优势。 |

## Release frame

- actor_and_trigger: 平台评价者在隔离的 MagicChat 非生产环境中提交一条合成内部决策任务，需要观察新产品模型能否形成可信 Artifact。
- observed_problem: accepted base 没有可执行表面来观察 Case、Typed Blackboard、四 Agent、Approval、Artifact 和恢复语义如何组合。
- target_outcome: 平台评价者能够完成一个合成 Case，并确认最终 Artifact 的重要内容可追溯到 Evidence、Claim、Review 和 Human Approval。
- solution_hypothesis: 一个固定 Workflow 配合九类 Typed Board Entry、四个固定 Agent Profile 和确定性治理门，可以形成可恢复、可审查且唯一发布的 Artifact。
- smallest_closed_loop: MagicChat 合成请求 → 创建一个 Case 和 Workflow Run → 写入 Question 并等待 → 用户回复后恢复同一 Case/Run → Researcher 写 Intent、Observation 和 EvidenceRef → Analyst 写 Claim 和 Proposal → Reviewer 写 Critique 或 VerificationResult → Writer 写 ArtifactRef → Human Approval → Freshness、Dedup 和 Response Claim → 唯一发布 → 保存完整 Trace。
- included_scenarios:
  - 一个合成内部决策任务和一个冻结资料包。
  - 一个缺失约束和一次原会话追问/恢复。
  - 一个预置矛盾或无依据重要 Claim。
  - 一个 Case、一个固定 Workflow、一个 Typed Blackboard。
  - Researcher、Analyst、Reviewer、Writer 四个固定 Profile。
  - 四个 Profile 均产生非预置模型输出。
  - 一个 Human Approval、一个 Response Owner、一个 Artifact。
  - 一个端到端 Trace及同一 Case 上的受控崩溃恢复。
- non_goals:
  - 动态 Agent 志愿或竞标。
  - 长期 Memory、主动 Agenda、Skill Marketplace。
  - 多 Workflow、多租户生产部署、多副本扩缩容。
  - Planner/Harness 正式集成、GitHub 自动交付。
  - 生产数据、生产凭据、自主生产变更。
  - 证明客户采用率或 Blackboard 优于顺序摘要。
  - 选择生产实现语言、数据库、队列或部署结构。
- success baseline: R001/R002 已有可靠性历史证据，但没有 Case、九类 Typed Blackboard 或四个非预置模型 Profile 的执行证据。
- primary_signal:
  - 最终 Artifact 的全部重要陈述都有到 EvidenceRef 或 VerificationResult 的可审计路径。
  - 预置矛盾或无依据 Claim 在 Approval 前被 Reviewer 识别并闭合或明确拒绝。
  - 最终只有一个 Case、一个 Run、一个获批 Artifact 和一次用户可见发布。
- guardrail:
  - 只使用合成非生产数据。
  - Human Approval 前不得发布。
  - 过期输出不得绕过 Freshness。
  - 重放、重试或崩溃不得创建重复 Case、Run、Artifact 或消息。
  - Agent 输出不得自动提升为事实、Decision 或 Approval。
- evidence_window: 一个冻结合成 Case，从首次消息到崩溃恢复后的唯一发布。
- minimum_evidence:
  - 九类 Entry 均有 Schema、稳定 ID、Provenance、关系和 Revision。
  - 四次 Agent Invocation 均记录 Profile、模型、Runtime、输入 Revision、Context Digest 和非预置输出。
  - Writer 不能读取未授权或不相关的完整历史。
  - Approval 绑定精确 Case、Run 和 Artifact Revision。
  - Runtime 和发布副作用使用稳定 Invocation/Idempotency identity。
  - wait/resume、Freshness、Dedup 和 crash-safe recovery 有可执行断言。
  - Trace 关联 Conversation、Message、Case、Run、Node、Agent、Invocation、Board Entry、Approval、Artifact、Response Claim 和最终消息。
- risks:
  - value: 不能证明真实用户需要或采用该产品。
  - usability: 单个合成 Case 不能证明真实会话自然或 Artifact 易用。
  - feasibility: 非确定模型输出、Runtime result recovery 和 Board Revision 可能导致恢复或审查不稳定。
  - viability: 可能把证据启用面过早扩张成通用平台。
- appetite: 严格限制为一个 Case、一个 Workflow、一个 Blackboard、四个 Profile、一个 Approval、一个 Artifact、一个 Trace 和一个受控非生产环境；出现第二 Workflow、动态路由、生产依赖或通用平台抽象时停止。
- blocking_unknowns:
  - 无阻止 Candidate Frame 成立的产品未知。
  - 模型/Runtime、持久化和生产语言属于 Commitment 后的 Solution Shaping；在形成 Spec 前不得由下游猜测。
- false_positive_completion: 使用预置 Agent 输出、绕过 Blackboard 直接生成 Artifact、Reviewer 未发现预置问题、Approval 未绑定 Artifact Revision、只跑 Happy Path、崩溃后重复执行或发布、Trace 在事后拼装。

### Controlled boundary

- authority_and_scope: 产品负责人仅授权规划一个合成、隔离、非生产的 R003 Candidate。
- protected_assets_and_data: 模型凭据、Runtime 配置、合成资料包、模型输入输出和审计 Trace。
- blast_radius: 一个非生产环境、一个合成会话、一个 Case 和受限模型预算。
- pre_release_verification: 合成资料 Manifest/Digest、无生产连接、凭据不进入 Git、允许的模型与网络目标明确、Profile/Workflow/Runtime 版本冻结。
- rollback_or_recovery: 停止 Workflow 和 Runtime、撤销临时凭据或网络授权、清理有所有权标记的合成资源，并保留脱敏 Trace。
- approval_owners: 产品负责人、非生产环境所有者和模型凭据所有者。
- staged_release: 先验证无模型的控制门，再启用合成资料上的四个非预置模型 Invocation，最后运行唯一端到端 Case。
- smoke_and_stop_conditions: 出现真实数据、生产连接、未授权外发、凭据暴露、Approval 绕过、重复副作用或审计缺失时立即停止。
- audit_evidence: 保存版本、Digest、Invocation、Board Revision、Approval、恢复和发布关联；不保存隐藏 Chain-of-Thought。

## Current evidence protocol

- decision_question: R003 是否能在一个合成 Case 中形成来源完整、经过批评和验证、经人工批准且可崩溃恢复的唯一 Artifact。
- blocking_unknown: 四个非预置模型 Profile 与 Typed Blackboard 能否在继承可靠性约束的同时形成完整 Evidence-to-Artifact 链。
- truth_owner: 隔离非生产 Runtime、冻结合成资料和可执行端到端 Trace。
- selected_method: 一个受控合成端到端 Pilot。
- why_this_method: 它能直接观察 Agent 输出、Board 关系、审批、恢复和发布，而不是依赖设计推断。
- can_establish: 该固定输入和环境中的语义完整性与技术可行性。
- cannot_establish: 客户价值、采用率、生产安全、普遍模型质量或相对顺序摘要的优势。
- scope_and_appetite: 仅执行 Release frame 中的一个 Case 和一个 Trace。
- stop_condition: 达到全部最低证据，或触发任一安全/范围停止条件。
- return_to: R003/r1 Evidence ledger 和 Readiness review。
