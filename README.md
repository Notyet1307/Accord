# Accord

> **企业级受管 Agent 协作与可信交付平台**  
> **Enterprise Governed Agent Collaboration & Trusted Delivery Platform**

Accord 让企业员工通过自然语言提出复杂目标，由受管 Agent 团队在一个可追踪的 `Case` 中协作，形成有证据、可审查、可审批、可交付并可验证结果的闭环。

> **当前阶段：产品与架构证据阶段。**  
> 本仓库尚不是可用于生产的完整平台。现有 Release、原型、研究和 ADR 用于逐步验证产品假设、系统边界、可靠恢复和可信交付路径。

---

## 一句话定位

Accord 不是新的 Agent 聊天客户端，也不是 Coding Agent 工作台。

它是位于企业协作入口、Agent 执行环境和领域权威系统之间的**受管协调平面**：

```text
企业会话与人工决策
        ↓
Accord：Case / Blackboard / Workflow / Policy / Approval / Audit
        ↓
Agent Execution Plane：Native LLM / Pi / Codex / Lody / Hermes / Other
        ↓
领域权威系统：Planner / Harness / GitHub / 企业业务系统
```

Accord 负责回答：

```text
为什么做
依据什么
谁可以做
本次授权到什么范围
哪些步骤必须发生
何时必须等待人
哪个结果可以被接受
现实执行结果由谁证明
```

Agent Runtime 或执行工作空间负责回答：

```text
在哪里执行
用哪个 Agent、模型、机器和工作目录
如何运行一次受约束任务
如何返回状态、结果和用量
```

两者不能混为一个事实源。

---

## R003 executable authority and MagicChat ingress

R003 uses a single-process TypeScript modular core with one Accord-owned SQLite
database. Its second delivery slice adds an official-shaped MagicChat App
WebSocket adapter, serial durable Inbox/cumulative-ACK protocol, and deterministic
clarification wait/resume boundary. Exact contract, migration, and downstream
`RESEARCHER` handoff facts are pinned in
[`contracts/r003-magicchat-handoff.json`](contracts/r003-magicchat-handoff.json);
the unchanged Issue #10 prerequisite remains in
[`contracts/r003-core-handoff.json`](contracts/r003-core-handoff.json).

The third merged delivery slice (Issue #12) implements the fixed
`RESEARCHER` → `ANALYST` Board and Runtime Invocation pipeline, terminal
delivery recovery, and deterministic semantic-crash evidence. Its no-network
handoff is pinned in
[`contracts/r003-researcher-analyst-handoff.json`](contracts/r003-researcher-analyst-handoff.json).

The repository-owned canonical entry remains:

```sh
./scripts/validate-delivery.sh
```

For the R003 local-only staged qualification, an operator-owned launcher must
establish its no-network, secret-minimized filesystem boundary before this
repository shell is interpreted. The launcher supplies the boundary marker,
private `TMPDIR`, and read-only offline npm cache; direct invocation fails
closed. Launcher/profile hash verification and the `BOUNDARY` attestation are
Controller receipt evidence, not authority implemented by repository code.
The checked-in GitHub Actions workflow does not provide that trusted pre-shell
boundary and is explicitly outside this local-only qualification.

GitHub Actions instead calls `./scripts/validate-ci.sh`, a non-qualification
entrypoint that refuses the operator boundary marker. After the workflow installs
the pinned lockfile, this entrypoint runs the static seam inventory, typecheck,
build, contract, SQLite integration, runtime-capability, and conformance suites.
Its result is CI evidence only and cannot replace the trusted local qualification.

The trusted local gate installs only the exact lockfile artifacts from the
configured offline cache, then typechecks, builds, and runs deterministic contract
and SQLite tests inside a secret-minimized, filesystem-restricted pinned-Node
capability boundary. Network modules and globals remain unavailable at runtime,
and executable bypass regressions cover computed imports, bracketed environment
access, and denied-file reads. The gate defines the qualification mechanism; an
actual pass requires an exact-commit Controller receipt with matching launcher and
profile hashes plus `BOUNDARY` attestation.

The protocol suite uses only an in-memory deterministic simulator. It proves local
adapter shape, migration, transaction, replay, clarification, ACK ordering,
same-Run resume, and deterministic Runtime recovery. It creates no real MagicChat
resource, consumes no real model call, and does not establish scenarios S1–S4.
The complete R003 Release therefore remains unproven.

---

## Accord 要解决什么问题

企业使用 Agent 处理复杂任务时，常见问题不是“模型不会回答”，而是：

- 用户不知道应该选择哪个 Agent；
- 多个 Agent 的能力、权限、执行位置和数据访问边界不可见；
- Agent 之间逐级传递自然语言摘要，关键事实容易丢失；
- 开放问题难以被固定流水线完整描述；
- 多个 Agent 可能重复工作、并发碰撞或同时回复；
- 人工补充信息后，系统无法可靠恢复原任务；
- Agent 配置在任务进行中变化，导致重试和恢复语义漂移；
- 一次性选择某个 Agent 容易被误解为长期自动化授权；
- Runtime、Session、聊天记录和现实系统状态容易形成多个事实源；
- 生成结论缺少来源、审查、审批和责任边界；
- 从“形成方案”到“真实执行”之间缺少可信交接；
- 崩溃、超时和消息重放可能造成重复执行、重复计费或重复发布。

Accord 的目标不是让更多 Agent 同时说话，而是让复杂任务形成一个**可治理、可恢复、可验证、可授权**的过程。

---

## 核心产品模型

Accord 的核心产品对象不是 Chat、Agent、Session 或 Workflow，而是：

```text
Case
├── Objective                用户目标与约束
├── Conversation Refs        会话入口和补充输入
├── Governed Blackboard      证据、问题、判断、方案、批评和验证
├── Workflow Runs            必须发生的步骤、等待、恢复和完成条件
├── Agent Activities         谁在 Case 中承担了什么认知或执行活动
├── Runtime Operations       被接受、冻结、执行、恢复和完成的 Runtime 命令
├── Human Decisions          决策、审批、拒绝和风险接受
├── Artifacts                报告、方案、Ticket、代码、PR 或其他产物
└── External Outcomes        外部权威系统确认的真实结果
```

用户看到的是一个企业任务协作空间；黑板、Workflow、Agent Runtime、Runtime Operation 和领域控制器是内部实现机制。

### 对象关系

```text
Case
 ├── WorkflowRun
 │    └── WorkflowNode
 │          └── AgentActivity
 │                └── RuntimeOperation
 │                      └── RuntimeSessionRef
 ├── BoardEntry
 ├── HumanDecision
 ├── Artifact
 └── ExternalOutcomeRef
```

关键约束：

- `Case` 不等于 Conversation；
- `Case` 不等于 Task；
- `Case` 不等于 Workflow Run；
- `AgentActivity` 不等于 Runtime Session；
- `RuntimeOperation` 不等于外部系统结果；
- Runtime Session 只是执行引用，不拥有 Case、Decision、Approval 或 Outcome。

---

## 架构原则

Accord 的长期方向可以概括为：

```text
Conversation-first
Case-centered
Blackboard-assisted
Workflow-governed
Operation-stabilized
Agent-executed
Human-authorized
Authority-separated
Evidence-backed
Failure-recoverable
```

含义如下：

- **Conversation-first**：用户从企业会话自然提出任务，不必先理解 Agent 或工作流。
- **Case-centered**：一个目标及其证据、协作、审批、产物和结果统一归属于 Case。
- **Blackboard-assisted**：开放问题通过结构化共享状态逐步求解，而不是只靠消息摘要传递。
- **Workflow-governed**：等待输入、审批、重试、恢复、发布等关键步骤由持久 Workflow 约束。
- **Operation-stabilized**：任何外部 Runtime 执行先形成持久、稳定、可恢复的 `RuntimeOperation`。
- **Agent-executed**：Agent 承担受约束的研究、分析、审查、写作和执行活动。
- **Human-authorized**：风险接受、持续委派、生产授权和重要决策不能由 Agent 自行获得。
- **Authority-separated**：每类现实事实只有一个权威所有者，Accord 不复制其他系统的主权。
- **Evidence-backed**：重要结论和最终产物可以回溯到来源、验证和决策。
- **Failure-recoverable**：崩溃、超时、重放和重试不会静默改变任务语义或制造重复结果。

---

## 目标架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│             MagicChat 企业协作与人工治理平面                 │
│ 身份 / 组织 / 会话 / 文件 / App / Human Input / Approval     │
└────────────────────────────┬────────────────────────────────┘
                             │ reliable message / event
┌────────────────────────────▼────────────────────────────────┐
│                         Accord                              │
│                                                            │
│ Case Coordinator                                            │
│ Governed Case Blackboard                                    │
│ Deterministic Workflow Run                                  │
│ Agent Activation / Delegation / Work Claim                  │
│ Runtime Operation Controller                                │
│ Response Claim / Freshness / Dedup                          │
│ Policy / Budget / Audit / Evaluation                        │
└───────────────────┬────────────────────────┬────────────────┘
                    │                        │
       RuntimeOperation Port          Typed Domain Handoff
                    │                        │
┌───────────────────▼────────────────┐  ┌────▼─────────────────┐
│        Agent Execution Plane       │  │  Domain Authorities  │
│                                    │  │                      │
│ Native LLM / Pi / Codex / Hermes   │  │ pi-ticket-planning   │
│ Lody Coding Workspace / Other      │  │ HerdrHarness-lite    │
│                                    │  │ GitHub / Enterprise  │
└────────────────────────────────────┘  └──────────────────────┘
```

详细愿景、逻辑边界和实施地图见 [`docs/product/VISION.md`](docs/product/VISION.md)。

---

## Accord 与 Lody 的准确关系

Lody 是一个面向 Coding Agent 的共享执行工作空间，提供 ACP Agent 接入、跨机器 Session、Agent Role、任务委派、Worktree、Diff、Preview、PR/CI 可见性和本地优先协作能力。

Accord 可以借鉴或接入 Lody，但二者不应合并为同一个产品中心：

```text
Accord
    = 企业级 Case 治理、证据、Workflow、授权、审批、审计和结果关联

Lody
    = 可选的 Coding Agent Runtime 与共享执行工作空间
```

### Accord 从 Lody 借鉴

- Task 意图与 Session 执行分离；
- Agent Role 与运行中 Agent 分离；
- 稳定 Operation ID、输入指纹和冻结运行配置；
- Session 创建、追加指令、取消、状态和历史读取；
- 机器侧持续调度；
- Agent、机器和 Worktree 的显式绑定；
- 无静默 fallback；
- Platform Capability / Port；
- 跨桌面、Web、移动端的执行可见性；
- Coding 场景的 Worktree、Diff、Preview 和 PR 邻接体验。

### Accord 不从 Lody 继承

- 以 Session 或对话作为产品中心；
- 将 Lody Task 直接等同于 Accord Case；
- 使用 CRDT 作为 Approval、Claim、Workflow 或副作用确认的权威事实源；
- 将 Coding 专用状态机放入 Accord 通用核心；
- 依赖 Lody 未公开的托管后端作为 Accord 必选组件；
- 让 Lody 拥有 GitHub、Harness、Human Decision 或 External Outcome 的事实；
- 在当前 R003 中引入 ACP、Lody、Worktree、CRDT 或远程机器。

详细研究见：

- [`docs/product/research/lody-runtime-operation-and-coding-workspace.md`](docs/product/research/lody-runtime-operation-and-coding-workspace.md)

---

## 关键对象边界

### Agent Profile

描述“这个 Agent 是谁、声明什么能力、受什么治理”。

```text
AgentProfile
├── Identity
├── Capability Declarations
├── Skill Bindings
├── Tool Policy
├── Model Policy
├── Collaboration Policy
└── Revision
```

Agent Profile 不保存 API Key、登录 Cookie 或机器本地秘密。

### Runtime Binding

描述“这个 Agent 在哪里、通过什么 Runtime 可以执行”。

```text
RuntimeBinding
├── Runtime Adapter
├── Machine / Pool Reference
├── Agent Config Reference
├── Availability
├── Supported Capabilities
└── Revision
```

Profile 与 Binding 分离，避免把企业角色、执行机器、凭据和供应商配置混成一个对象。

### Delegation Grant

描述“谁在什么范围内明确授权哪个 Agent 自动执行什么”。

一次性选择 Agent 不等于持续委派。持续委派必须有独立、可撤销、可过期、可审计的 `DelegationGrant`。

### Runtime Operation

描述一次已被系统接受、输入和运行配置已冻结、可以恢复或查询的外部执行。

```text
RuntimeOperation
├── Stable Operation ID
├── Canonical Input + Fingerprint
├── Frozen Profile / Binding / Policy Revisions
├── Context Digest
├── Deadline / Budget
├── State
├── Runtime Session Reference
├── Completion / Failure
└── Audit Correlation
```

相同 Operation ID：

```text
相同 fingerprint
    → 返回或恢复同一个 Operation

不同 fingerprint
    → 冲突并拒绝
```

### Runtime Session Reference

只引用外部 Session、机器、Worktree 或执行历史。它不是 Accord 的 Case、Workflow、Decision 或 Outcome。

---

## 系统职责

| 系统或层 | 主要职责 | 不应拥有 |
|---|---|---|
| MagicChat | 企业身份、组织、会话、消息、文件、App、Human Input 和审批入口 | Accord Case、黑板求解状态、交付执行事实 |
| Accord | Case、受管黑板、Workflow Run、Agent Activity、Delegation、Runtime Operation、Claim、响应控制和审计关联 | GitHub、Harness、Lody Session 或业务系统的真实状态 |
| Agent Runtime | 调用模型、Skill 和工具，执行一个受约束的 Runtime Operation | 用户授权、最终事实、Human Decision 和外部执行结果 |
| Lody | 可选 Coding Agent 工作空间、ACP Session、机器和 Worktree 执行表面 | Accord Case、Approval、领域交付事实和最终 Outcome |
| pi-ticket-planning | 产品规划、Release 形成、Delivery Spec 和 Ticket Admission | 代码执行和 Merge 结果 |
| HerdrHarness-lite | Delivery Ticket 执行、Attempt、Reviewer、恢复和 Merge 控制 | 产品规划事实和通用 Case 状态 |
| GitHub | Repository、Issue、PR、Commit、CI 和 Merge 状态 | Accord Workflow、Runtime Operation 和 Human Approval 状态 |
| 企业业务系统 | 其业务对象、操作和结果 | Accord 内部推理状态和 Agent 候选判断 |

---

## 核心不变量

1. **每类现实事实只有一个权威所有者。**
2. **聊天不是任务状态、审批或执行结果的唯一事实源。**
3. **Agent 输出默认是候选判断，不是已验证事实。**
4. **Case Blackboard 是结构化问题求解状态，不是无限聊天记录或全局长期记忆。**
5. **高风险操作必须经过确定性门禁和明确授权。**
6. **一条用户可见消息原则上只有一个 `Response Owner`。**
7. **副作用必须具备稳定身份、幂等、持久确认和恢复路径。**
8. **外部系统状态只能被引用或投影，不能在 Accord 中形成第二个权威。**
9. **Runtime Session 只是执行引用，不得成为 Case、Decision、Approval 或 Outcome 的权威。**
10. **Runtime Operation 必须先持久接受，再发起可能产生费用或副作用的执行。**
11. **Operation 接受后必须冻结 Profile、Binding、Model、Skill、Tool 和 Policy 版本。**
12. **一次性 Agent 选择不等于持续委派或生产授权。**
13. **Runtime、机器、Agent Config 或模型不可用时不得静默 fallback。**
14. **CRDT 可用于协作草稿，但不得拥有 Approval、Claim、Budget、Workflow Completion 或副作用确认。**
15. **愿景中的 Phase、Work Package 和参考项目不是立即实施授权。**
16. **局部 Ticket 不得以“符合愿景”为理由顺手建设通用平台。**

---

## 当前状态

### R001：受管 Agent 团队内部决策方案

状态：`HOLD`

R001 使用固定合成场景验证了：

- 自然消息进入固定 Workflow；
- 信息不足时追问；
- 用户补充后恢复同一 Run；
- Agent 节点和 Human Approval；
- 单一 Response Owner；
- 最终只发布一次。

这些结果来自逻辑原型，不证明真实模型质量、真实员工采用率或生产安全。

参见：

- [`docs/product/releases/r001-managed-internal-decision-brief.md`](docs/product/releases/r001-managed-internal-decision-brief.md)
- [`docs/product/prototypes/r001-agent-coordination-state.logic-prototype.html`](docs/product/prototypes/r001-agent-coordination-state.logic-prototype.html)
- [`docs/product/prototypes/r001-architecture-smoke.logic-prototype.html`](docs/product/prototypes/r001-architecture-smoke.logic-prototype.html)

### R002：非生产基础架构 Walking Skeleton

状态：`HOLD (r3)`

R002 在真实官方 MagicChat App WebSocket 边界上验证了稳定身份、等待恢复、确定性回写和崩溃重放等外部可靠性语义。

R002/r2 的验证结果与 ADR-0001 作为 R002 范围内的历史证据保留；R002/r3 已停止现有 Delivery Spec、Admission 和 Harness 路径。后续 Release 只能继承 stable identity、wait/resume、Human Approval、Response Claim、deterministic idempotency、Freshness、Dedup、crash recovery 和 audit 等外部行为约束，不继承 Go Reference Harness、Atomic JSON Store、R002 内部模块划分或固定本地部署作为生产架构。

参见：

- [`docs/product/releases/r002-non-production-architecture-walking-skeleton.md`](docs/product/releases/r002-non-production-architecture-walking-skeleton.md)
- [`docs/adr/0001-r002-non-production-walking-skeleton-boundary.md`](docs/adr/0001-r002-non-production-walking-skeleton-boundary.md)

### R003：Governed Case Blackboard Walking Skeleton

状态：`COMMITTED`

当前 `main` 已合入 TypeScript/SQLite authority core、MagicChat ingress/wait-resume 和
`RESEARCHER` → `ANALYST` Runtime recovery 三个实现切片。这些是代码、契约、迁移和确定性测试证据；真实 MagicChat 资源、真实模型调用、trusted local qualification 和 S1–S4 仍未被证明，因此不能声称 R003 已完成。

R003 的精确边界是：

```text
One Synthetic Case
One Fixed Workflow
One Typed Blackboard
Four Fixed Profiles
One Native LLM Turn Adapter
One Human Approval
One Response Owner
One Artifact
One End-to-End Trace
One Process / One Replica / SQLite WAL
```

R003 负责验证 Case、Typed Blackboard、四个固定非预置模型 Profile、Evidence-to-Artifact 链、Approval、Freshness、Dedup 和崩溃恢复。

**R003 不引入 Lody、ACP、远程机器、Worktree、CRDT、动态 Agent、Planner/Harness 正式集成或通用 Runtime 平台。**

参见：

- [`docs/product/releases/r003-governed-case-blackboard-walking-skeleton.md`](docs/product/releases/r003-governed-case-blackboard-walking-skeleton.md)
- [`docs/adr/0002-production-coordination-runtime-language.md`](docs/adr/0002-production-coordination-runtime-language.md)
- [`docs/adr/0003-r003-governed-case-blackboard-boundary.md`](docs/adr/0003-r003-governed-case-blackboard-boundary.md)

---

## 当前方向与后续顺序

```text
先完成并验证 R003
        ↓
建立通用 RuntimeOperation / RuntimeBinding 契约
        ↓
以独立 Release 做 Lody Adapter Integration Spike
        ↓
验证 Operation 恢复、配置冻结、无静默 fallback 和权威分离
        ↓
再决定是否扩大到正式 Coding Case、团队工作空间或多 Runtime
```

Lody 不是 R003 的实现依赖，也不是当前编码授权。

任何 Lody 接入必须先形成：

1. 有边界的 Release Frame；
2. 具体用户场景；
3. Runtime Operation 契约；
4. 权限与秘密边界；
5. 失败和恢复模型；
6. 外部事实 Owner；
7. 可执行 Acceptance Tests；
8. 必要的 ADR；
9. Delivery Spec 和 Admission。

---

## 尚未证明

当前仓库没有证据证明：

- 真实 LLM 能稳定完成目标任务；
- 多 Agent Blackboard 比固定 Workflow 更有产品价值；
- 企业员工愿意迁移并持续使用；
- 真实企业数据可以在完整威胁模型下安全处理；
- 动态 Agent 激活能够提高质量或降低成本；
- 多 Workflow、多 Runtime 和复杂分支能够可靠恢复；
- Lody 可以在 Accord 场景下提供稳定、兼容、可治理的 Runtime；
- Lody Operation 与 Accord RuntimeOperation 已经形成正式契约；
- Planner、Harness、GitHub 和企业系统已经形成完整生产闭环；
- 当前架构能够满足生产级性能、可用性和多租户要求。

这些问题必须分别通过后续 Release 和可审查证据验证。

---

## 设计参考及其准确位置

| 参考对象 | Accord 主要借鉴 | Accord 不直接继承 |
|---|---|---|
| MagicChat | 企业身份、会话、App、Human Input 和审批入口 | Accord Case、Blackboard 和交付事实 |
| Cumora | 一等 Agent、durable inbox、Wake/triage、Skill 渐进加载、Freshness | 广播所有 Agent、聊天即任务、通用 Workflow 假设 |
| Blackboard Architecture / Cairn | 共享状态、部分解、动态探索、Intent Claim | 完全机会式调度、无治理共享区、无审批执行 |
| Lody | Task/Session 分离、Agent Role、稳定 Operation、ACP Runtime、远程机器、Worktree、代码协作和 Capability Port | Session 产品中心、CRDT 治理事实源、Coding 模型侵入通用核心、未公开 Cloud Backend |
| Hermes | 可选 Runtime、Profile 和通用任务执行参考 | Accord 领域事实和正式交付控制 |
| pi-ticket-planning | 产品规划与 Ticket Admission | 通用 Agent 协调 |
| HerdrHarness-lite | 确定性交付、Reviewer、恢复和 Merge Gate | Case 与开放问题求解 |
| GitHub | 代码、PR、CI 和 Merge 权威状态 | Accord Workflow、审批和 Runtime Operation |

研究材料：

- [`docs/product/research/cumora-wake-and-first-class-agents.md`](docs/product/research/cumora-wake-and-first-class-agents.md)
- [`docs/product/research/lody-runtime-operation-and-coding-workspace.md`](docs/product/research/lody-runtime-operation-and-coding-workspace.md)

---

## 仓库导航

| 需要回答的问题 | 应读取的来源 |
|---|---|
| Accord 最终要成为什么 | [`docs/product/VISION.md`](docs/product/VISION.md) |
| 当前 Release 承诺什么行为 | [`docs/product/releases/`](docs/product/releases/) |
| 某项承重技术决策为什么这样选 | [`docs/adr/`](docs/adr/) |
| AI 如何选择权威来源和避免越界 | [`AGENTS.md`](AGENTS.md) |
| Delivery Ticket 如何进入执行 | [`docs/agents/delivery-gate.md`](docs/agents/delivery-gate.md) |
| Tracker、Label 和关系如何表达 | [`docs/agents/`](docs/agents/) |
| Lody 在 Accord 中的准确位置 | [`docs/product/research/lody-runtime-operation-and-coding-workspace.md`](docs/product/research/lody-runtime-operation-and-coding-workspace.md) |
| 外部项目和技术路线的事实依据 | [`docs/product/research/`](docs/product/research/) |
| 交互与状态原型 | [`docs/product/prototypes/`](docs/product/prototypes/) |
| 试点、基线和评价模板 | [`docs/product/pilots/`](docs/product/pilots/) |
| 当前实现实际上如何工作 | 当前代码、配置、类型和测试 |

---

## 从愿景到实现

Accord 的开发路径是：

```text
Product Vision
    ↓
Release Frame
    ↓
Evidence Protocol / Pilot
    ↓
Accepted ADR（仅在需要承重技术决定时）
    ↓
Delivery Spec + Scenario IDs
    ↓
Candidate Tickets + Handoffs
    ↓
Admission Review
    ↓
Harness Execution
    ↓
Independent Verification
    ↓
Evidence-backed Release Decision
```

`VISION.md` 中的 Phase、Work Package、Runtime Adapter 和外部参考只提供能力地图。它们必须先被缩小为一个有边界、有证据要求的 Release，才能继续拆成可执行 Ticket。

---

## 实现语言与技术栈

根 README 不拥有生产实现语言、数据库、消息队列或部署形态。

- R002/r2 的 Go 实现只作为已 HOLD Release 的历史非生产 Conformance 证据；
- 生产 Coordination Plane 的主要语言由 Accepted ADR-0002 决定；
- R003/r1 的首个最小实现边界由 Accepted ADR-0003 决定；
- Lody 的 TypeScript、Loro/Flock、ACP、SQLite 或 Worktree 实现不能自动成为 Accord 技术决定；
- 后续 Lody Adapter、RuntimeOperation、CRDT 协作层或多机器执行必须由对应 Release 和 ADR 决定；
- Delivery Spec 和 Ticket 应引用 ADR，不应复制其理由；
- 当前代码、锁文件和工具链配置拥有实际版本事实。

参见：

- [`docs/adr/0002-production-coordination-runtime-language.md`](docs/adr/0002-production-coordination-runtime-language.md)
- [`docs/adr/0003-r003-governed-case-blackboard-boundary.md`](docs/adr/0003-r003-governed-case-blackboard-boundary.md)

---

## 开发规则

开始任何实现前：

1. 阅读根 [`AGENTS.md`](AGENTS.md)；
2. 确认当前 Accepted Release、Delivery Spec 或 Ticket；
3. 只读取会改变当前决策的 ADR、愿景章节和研究材料；
4. 检查当前代码、配置、类型和测试；
5. 明确当前任务影响的 Owner、Seam、Scenario 和外部副作用；
6. 区分 `AgentProfile`、`RuntimeBinding`、`DelegationGrant`、`AgentActivity`、`RuntimeOperation` 和外部 Session；
7. 任何 Runtime 调用先定义稳定 Operation ID、输入指纹、冻结配置和恢复路径；
8. 遇到权威冲突、权限缺失、静默 fallback 或未决定技术边界时停止扩大范围。

---

## 非目标

当前阶段不应顺手建设：

- 通用 Agent Marketplace；
- Agent 自主安装或修改生产 Skill；
- 无限长期 Memory；
- 完全机会式多 Agent 自治；
- 通用 Workflow DSL；
- 通用 Event Bus；
- 多云 Runtime 平台；
- 自动生产变更；
- MagicChat 核心 Fork；
- Lody 核心 Fork；
- 将 Lody Task、Session 或 CRDT 文档作为 Accord Case/Workflow 权威；
- 在 R003 中接入 ACP、远程机器、Worktree 或 Coding Workspace；
- 为未来假设提前设计的通用抽象层。

每项新增能力都必须有当前 Release、具体 Consumer、退出条件和验证方法。

---

## 项目成熟度声明

Accord 当前是一个以证据驱动方式形成中的产品和架构，不是已经完成的生产平台。

仓库中的愿景、研究、Release、原型和 ADR 应帮助人和 AI：

- 区分目标、事实、决定与假设；
- 区分 Case 治理平面和 Agent 执行平面；
- 区分 Agent 身份、Runtime 绑定、持续委派和一次执行；
- 只读取完成当前任务所需的最小上下文；
- 避免把外部参考误当成现成能力；
- 避免把 Runtime Session、聊天或 CRDT 当成权威任务状态；
- 避免把实验结果夸大为生产证明；
- 按最小闭环逐步实现并验证 Accord。
