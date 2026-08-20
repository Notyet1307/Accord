# R001: 受管 Agent 团队产出内部决策方案

## Metadata
- status: HOLD
- revision: r5
- owner: 产品负责人
- product_stage: EVIDENCE
- delivery_stage: NOT_STARTED
- delivery_evidence_alignment: EVIDENCE_AHEAD

## Evidence ledger

| Type | Claim | Source and date | Limitation |
| --- | --- | --- | --- |
| FACT | 企业员工正在各自选择的平台上处理工作，Agent 能力不明，协作流程混乱。 | 产品负责人报告，2026-08-20 | 尚无独立统计、任务样本和量化基线。 |
| DECISION | 长期平台同时包含通用 Agent 团队、可信规划交付和企业 Agent 治理。 | 产品负责人决定，2026-08-20 | 这是产品方向，不是实施授权。 |
| DECISION | 第一轮先跑通通用 Agent 团队，首个工作负载为内部研究与方案产出。 | 产品负责人决定，2026-08-20 | 暂不进入完整规划交付和平台治理。 |
| DECISION | 第一轮固定产物为内部决策方案。 | 产品负责人决定，2026-08-20 | 纯研究报告和可执行实施方案暂不覆盖。 |
| DECISION | 首轮使用完全合成资料，不接触真实企业数据。 | 产品负责人决定，2026-08-20 | 只能验证协作状态和交互，不能验证真实任务质量、采用率或真实数据安全。 |
| FACT | Cumora 使用统一 Participant、durable inbox、事件 Wake、小模型 triage、群聊/私聊、Agent 独立工作区和发送前 Freshness Hold；普通群聊通常广播 Wake，且未发现通用 Workflow Definition/Run 引擎。 | `docs/product/research/cumora-wake-and-first-class-agents.md`，官方 `yetone/cumora@90fd9ae8bc42a477168eb109717291dd567993f5`，2026-08-20 | 只适用于固定 commit；不证明 Cumora 的生产规模、企业合规或后续版本。 |
| DECISION | 用户只需在群聊或 Bot 私聊中自然提出任务；平台自动匹配设计好的工作流，信息不足时在原会话追问并恢复同一 Run，过程中按节点调用 Human 与 Agent。 | 产品负责人决定，2026-08-20 | 这是 R001 用户交互方向，不是实现或生产授权。 |
| FACT | 产品负责人完成 R001/r3 原型的五个引导场景并给出 PASS。 | 产品负责人报告，2026-08-20；`docs/product/prototypes/r001-agent-coordination-state.logic-prototype.html`，`sha256:4929bcffaea77929549c146f408bce4688d06f67867e780427ccfe311e8a713b` | 完全合成、单一评审者、无模型、无网络、无真实数据。 |
| DECISION | 在合成交互原型通过后，下一步进入一个真实内部决策任务与脱敏固定资料包的受控影子试点。 | 产品负责人决定，2026-08-20 | 已由后续 R001/r5 决定暂缓；未发生实际运行或数据授权。 |
| DECISION | 当前只运行一个固定合成数据的基础架构冒烟测试，先证明消息、路由、追问、同一 Run 恢复、Agent 节点、Human Approval 和唯一发布能够连通；质量、安全深化和真实数据试点后置。 | 产品负责人决定，2026-08-20 | 该测试只能建立纯逻辑可行性，不是产品价值、真实集成或生产安全证据。 |
| DECISION | 暂缓 R001 的真实质量、采用和数据安全验证，下一轮改为 R002 非生产基础架构 Walking Skeleton。 | 产品负责人决定，2026-08-20 | HOLD 只适用于 R001；R002 的技术可运行不能替代 R001 的产品价值证据。 |
| FACT | R001/r5 基础架构冒烟测试的六项断言全部通过；最终状态为 `RUN-SMOKE-001 / PUBLISHED`，最终回复数为 1。 | `docs/product/prototypes/r001-architecture-smoke.logic-prototype.html`，`sha256:5a43188f119e778f0f2e40ab3ff2d28d71a291fcb5d66309384ac88d17484431`；确定性执行，2026-08-20 | 固定合成数据、纯内存、无网络、无模型、无 MagicChat/Runtime/生产集成。 |
| ASSUMPTION | 受管 Agent 团队可以在保护企业数据的同时，达到员工愿意从外部平台迁回的质量和便利性。 | 当前产品假设，2026-08-20 | 需要后续真实受控任务验证；不由本次架构冒烟测试闭合。 |

## Release frame

- actor_and_trigger: 企业员工需要针对一个内部待决问题完成研究、比较并形成建议。
- observed_problem:
  - 工作分散在员工自行选择的平台。
  - Agent 能力、工具权限、数据边界和协作过程不可见。
  - 企业无法稳定复用高质量 Subagent 与工作流。
- target_outcome: 员工能够在企业自建协作平台内完成可直接用于内部决策的方案，并能追溯依据、参与 Agent、数据访问和审查过程。
- solution_hypothesis: 以 MagicChat 为企业入口，由事件驱动的 Wake Router 和 Work Router 匹配版本化 Workflow Definition；茉莉作为可见的默认负责人，Workflow Run 负责补充信息、恢复、Agent/Human 节点和最终发布。
- smallest_closed_loop: Human 或 Agent 在群聊或私聊提出任务 → Wake Router 投递事件 → Work Router 匹配工作流或已有 Run → 信息不足时在原会话追问 → 回复恢复同一 Run → Researcher、Analyst、Reviewer、Writer 与 Human 节点协作 → Response Claim、Freshness 和 Dedup 校验 → 唯一负责人发布内部决策方案 → 保留审计记录。
- included_scenarios:
  - 一个内部团队和一种内部决策方案 Workflow Definition。
  - 群聊与 Bot 私聊中的自然语言入口。
  - 信息完整时自动启动 Workflow Run。
  - 信息不足时进入 `WAITING_FOR_INPUT` 并在原会话恢复同一 Run。
  - 显式 `@Agent` 与工作流匹配的可解释路由。
  - 一个批准的只读数据域。
  - 固定版本的 Agent、Skill 和 Workflow。
  - Agent 节点、Human Review、唯一发布与完整审计。
- non_goals:
  - 完整产品规划到软件交付闭环。
  - 开放 Agent 或 Skill 市场。
  - Agent 自主安装或修改 Skill。
  - 长期 Memory 和主动行为。
  - 自动执行方案或修改生产系统。
  - 完整多 Runtime 生态。
- success baseline: UNKNOWN。
- primary_signal: 方案能够直接支持内部决策，仅需轻量人工修改，并优于或不低于当前工作方式。
- guardrail: 零越权读取、零未授权外发、零跨租户访问，引用和 Agent 执行记录完整。
- evidence_window: 一个固定合成数据、纯内存、无网络和无模型调用的基础架构冒烟测试。
- minimum_evidence: 一条消息完成消息持久化、Workflow 匹配、缺失信息追问、同一 Run 恢复、一个 Researcher 节点、Human Approval 和唯一发布；六项架构断言全部通过。
- risks:
  - value: 内建平台的质量或便利性不足，员工继续使用外部平台。
  - usability: Work Router 误匹配、重复追问或不透明指派，使自然对话比手工选择 Agent 更困难。
  - feasibility: Run correlation、等待输入、恢复、Subagent Handoff、Freshness 和唯一发布无法可靠组合。
  - viability: 模型成本、工作流维护、能力目录和治理成本过高。
- appetite: 一个新的自包含 HTML 文件、一个固定 Workflow、一条合成任务、一个 Researcher 节点、一个 Human Approval 节点、一个最终回复和一次确定性执行；不选择技术栈，不连接真实系统。
- blocking_unknowns:
  - 一条自然消息能否只创建一个 Workflow Run。
  - 信息不足时能否在调用专业 Agent 前追问，并在回复后恢复原 Run。
  - 是否只有一个 Response Owner，且 Human Approval 前不能发布。
  - 最终是否只产生一次回复并保留完整事件记录。
  - 真实质量、数据安全、性能和生产集成保留为后续未知，不阻塞本次冒烟测试。
- false_positive_completion: 系统生成了一份文档，但启动了错误工作流、追问后创建了重复 Run、由错误负责人发布、决策者需要大幅重写、无法验证依据，或过程中发生越权和未授权数据外发。

### Controlled boundary

- protected_assets_and_data: 仓库外脱敏资料包、提示词、模型输入输出、工具结果、基线、凭据边界和审计记录。
- blast_radius: 隔离试点环境内的一个团队、一个任务和一个只读资料目录；质量试点与合成安全挑战分开。
- pre_release_verification: Manifest 摘要、只读权限、网络外发阻断、无凭据和生产连接、Agent/Skill/Workflow/Runtime 版本锁定、Human Approval、Freshness、Dedup、Attempt 隔离和审计完整性检查。
- rollback_or_recovery: 停用工作流、撤销 Agent/Skill/工具绑定、清理试点副本、验证访问已终止，并按批准策略保留脱敏审计摘要。
- approval_owners: 产品负责人、资料所有者和数据安全负责人。
- staged_release: 先冻结基线和真实质量包，再执行一次影子运行；合成安全挑战独立执行；不向生产用户启用。
- smoke_and_stop_conditions: 出现越权访问、未授权外发、跨租户读取、关键事实编造、Manifest 或版本漂移、Human Approval 绕过或审计缺失时立即停止。
- audit_evidence: Agent、工具、Source ID、Handoff、Attempt、Hold、Human Approval、发布、清理和评价记录。

## Current evidence protocol

- decision_question: 基础架构逻辑是否已经形成一个可执行的最小端到端闭环，足以结束纸面状态设计并保留后续优化空间。
- blocking_unknown: 消息、Workflow 匹配、缺失信息追问、同一 Run 恢复、Agent 节点、Human Approval、Response Claim 和唯一发布能否在一个确定性状态模型中连续通过。
- truth_owner: 自包含逻辑原型的确定性状态机和六项运行断言。
- selected_method: 一个固定合成数据的基础架构冒烟测试。
- smoke_artifact: docs/product/prototypes/r001-architecture-smoke.logic-prototype.html
- prior_prototype_artifact: docs/product/prototypes/r001-agent-coordination-state.logic-prototype.html
- deferred_pilot_kit: docs/product/pilots/r001/
- research_artifact: docs/product/research/cumora-wake-and-first-class-agents.md
- why_this_method: 它以最低成本直接运行核心状态链，不引入真实数据、模型质量、技术栈或生产集成变量。
- can_establish: 这一个固定闭环是否只创建一个 Run、补充信息后恢复原 Run、只建立一个 Response Owner、Human Approval 前不发布、最终只回复一次并保留完整审计。
- cannot_establish: 真实 MagicChat 集成、意图识别、模型质量、企业数据安全、性能、多 Runtime、复杂分支、长期采用或生产稳定性。
- scope_and_appetite: 一个自包含 HTML、一个固定 Workflow、一条合成任务、一个 Researcher 节点、一个 Human Approval 节点、一个最终回复和一次确定性执行；纯内存、无网络、无持久化、无模型调用。
- assertions:
  - 全程只有一个 Workflow Run。
  - 信息补全前没有调用专业 Agent。
  - 用户回复恢复原 Run。
  - 只有一个 Response Owner。
  - Human Approval 后才允许发布。
  - 最终只回复一次且有完整审计。
- pass_threshold: 六项断言全部通过，测试序列没有未预期的 DENIED 或非法状态。
- fail_or_stop_threshold: 任一断言失败，或测试需要真实数据、网络、模型、凭据、生产连接或第二个 Workflow 才能成立。
- cleanup_or_discard_condition: 记录结论后保留原型作为该逻辑证据；不得把 HTML 外壳作为生产实现来源。
- authorization: AUTHORIZED
- result: PASS
- completed_on: 2026-08-20
- validation_output: A1–A6 全部 PASS；`RUN-SMOKE-001` 最终为 `PUBLISHED`；最终回复数为 1。
- finding: 消息、工作流匹配、追问、同一 Run 恢复、单一 Agent 节点、Human Approval、Response Claim 和唯一发布在该确定性原型中可以连续通过。
- closeout: COMPLETED
- return_to: R001/r5 Candidate Frame

## Readiness

- verdict: NOT_READY
- reason: 交互状态原型和基础架构冒烟测试已通过；真实产品价值、数据安全、模型/Runtime 和生产集成仍未验证，因此当前产品目标尚未达到确认值得进入交付的条件。

## Commitment

- decision: HOLD
- decided_by: 产品负责人
- decided_on: 2026-08-20
- reason: 先建立能够承载后续真实产品验证的最小非生产技术表面。
- next_evidence_action: NONE
- reopen_condition: R002 的非生产 Walking Skeleton 已通过端到端验证，且产品负责人明确重新开启 R001。
