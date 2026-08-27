# Accord

> **企业级受管 Agent 协作与可信交付平台**  
> **Enterprise Governed Agent Collaboration & Trusted Delivery Platform**

Accord 让企业员工通过自然语言提出复杂目标，由受管 Agent 团队在一个可追踪的 `Case` 中协作，形成有证据、可审查、可审批、可交付并可验证结果的闭环。

> **当前阶段：产品与架构证据阶段。**  
> 本仓库尚不是可用于生产的完整平台。现有 Release、原型和 ADR 用于逐步验证产品假设、系统边界、幂等恢复和可信交付路径。

## R003 executable authority core

The first R003 delivery slice is a single-process TypeScript modular core with
one Accord-owned SQLite database. The exact Node.js, npm, TypeScript, contract,
migration, and SQLite settings are pinned in the root toolchain files and in
[`contracts/r003-core-handoff.json`](contracts/r003-core-handoff.json).

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
capability boundary.
Network modules and globals remain unavailable at runtime, and executable bypass
regressions cover computed imports, bracketed environment access, and denied-file
reads. The gate emits the versioned `HANDOFF` line consumed by the next R003 ingress
ticket. These synthetic checks prove only local contract, migration, transaction,
replay, and recovery behavior;
they are not the R003 real MagicChat/model evidence window.

---

## Accord 要解决什么问题

企业使用 Agent 处理复杂任务时，常见问题不是“模型不会回答”，而是：

- 用户不知道应该选择哪个 Agent；
- 多个 Agent 的能力、权限和数据访问边界不可见；
- Agent 之间逐级传递自然语言摘要，关键事实容易丢失；
- 开放任务难以被固定流水线完整描述；
- 多个 Agent 可能重复工作、并发碰撞或同时回复；
- 人工补充信息后，系统无法可靠恢复原任务；
- 生成的结论缺少来源、审查和责任边界；
- 从“形成方案”到“真实执行”之间缺少可信交接；
- 聊天记录、Agent 记忆和现实系统状态容易混成多个事实源。

Accord 的目标不是让更多 Agent 同时说话，而是让复杂任务形成一个可治理、可恢复、可验证的过程。

---

## 产品模型

Accord 的核心产品对象不是 Chat、Agent 或 Workflow，而是：

```text
Case
├── Objective              用户目标与约束
├── Conversation Refs      会话入口和补充输入
├── Governed Blackboard    证据、问题、判断、方案和批评
├── Workflow Runs          必须发生的步骤、等待和恢复
├── Agent Activities       参与者、能力、Claim 和执行记录
├── Human Decisions        决策、审批和风险接受
├── Artifacts              报告、方案、Ticket、代码或其他产物
└── External Outcomes      外部权威系统确认的真实结果
```

用户看到的是一个企业任务协作空间；黑板、Workflow、Agent Runtime 和领域控制器是内部实现机制。

---

## 架构原则

Accord 的长期方向可以概括为：

```text
Conversation-first
Case-centered
Blackboard-assisted
Workflow-governed
Human-authorized
Authority-separated
```

含义如下：

- **Conversation-first**：用户从企业会话自然提出任务，不必先理解 Agent 或工作流。
- **Case-centered**：一个目标及其证据、协作、审批、产物和结果统一归属于 Case。
- **Blackboard-assisted**：开放问题通过结构化共享状态逐步求解，而不是只靠消息摘要传递。
- **Workflow-governed**：等待输入、审批、重试、恢复、发布等关键步骤由持久 Workflow 约束。
- **Human-authorized**：风险接受、生产授权和重要决策不能由 Agent 自行获得。
- **Authority-separated**：每类现实事实只有一个权威所有者，Accord 不复制其他系统的主权。

---

## 目标架构概览

```text
┌──────────────────────────────────────────────┐
│           MagicChat 企业协作与治理平面        │
│  身份 / 组织 / 会话 / 文件 / App / 审批入口   │
└──────────────────────┬───────────────────────┘
                       │ reliable message/event
┌──────────────────────▼───────────────────────┐
│                 Accord                       │
│                                              │
│  Case Coordinator                            │
│  Governed Case Blackboard                    │
│  Deterministic Workflow Run                  │
│  Agent Activation & Work Claim               │
│  Response Claim / Freshness / Dedup           │
│  Audit / Evaluation                          │
└───────────────┬──────────────────┬───────────┘
                │                  │
       ┌────────▼────────┐  ┌──────▼─────────────┐
       │ Agent Runtimes  │  │ Domain Authorities │
       │ LLM / Pi / Codex│  │ Planner / Harness  │
       │ optional runtime│  │ GitHub / Enterprise│
       └─────────────────┘  └────────────────────┘
```

详细愿景、逻辑边界和实施地图见 [`docs/product/VISION.md`](docs/product/VISION.md)。

---

## 系统职责

| 系统或层 | 主要职责 | 不应拥有 |
|---|---|---|
| MagicChat | 企业身份、组织、会话、消息、文件、App、审批入口 | Accord Case、交付执行事实 |
| Accord | Case、受管黑板、Workflow Run、Agent 激活、Claim、响应控制、审计关联 | GitHub、Harness 或业务系统的真实状态 |
| Agent Runtime | 调用模型、Skill 和工具，执行一个受约束的 Agent Activity | 用户授权、最终事实和外部执行结果 |
| pi-ticket-planning | 产品规划、Release 形成、Delivery Spec 和 Ticket Admission | 代码执行和 Merge 结果 |
| HerdrHarness-lite | Delivery Ticket 执行、Attempt、Reviewer、恢复和 Merge 控制 | 产品规划事实和通用会话状态 |
| GitHub | Repository、Issue、PR、Commit、CI 和 Merge 状态 | Accord Workflow 状态 |
| 企业业务系统 | 其业务对象、操作和结果 | Accord 内部推理状态 |

Cumora、Cairn、Hermes 等项目是重要设计参考，但不是 Accord 必须依赖的事实权威。

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
9. **愿景中的 Phase 和 Work Package 不是立即实施授权。**
10. **局部 Ticket 不得以“符合愿景”为理由顺手建设通用平台。**

---

## 当前状态

### R001：受管 Agent 团队内部决策方案

状态：`HOLD`

R001 使用固定合成场景验证了以下逻辑：

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

R002 在真实官方 MagicChat App WebSocket 边界上验证了一个狭窄的非生产闭环，包括：

- 稳定 Message ID/cursor 与可变化 Event ID 的区分；
- 一个持久 Workflow Run；
- 缺失信息追问和同一 Run 恢复；
- 一个逻辑 Stub Runtime 结果；
- 发起人审批；
- 确定性消息回写；
- `message.send` 成功后崩溃的重放恢复；
- 最终只有一个 Run、一个逻辑结果和一条最终消息。

R002 不证明真实 LLM 质量、真实企业数据安全、多副本生产运行或完整领域集成。

R002/r2 的验证结果与 ADR-0001 作为 R002 范围内的历史证据保留；R002/r3 已停止现有 Delivery Spec、Admission 和 Harness 路径。后续 Release 只能继承 stable identity、wait/resume、Human Approval、Response Claim、deterministic idempotency、Freshness、Dedup、crash recovery 和 audit 等外部行为约束，不继承 Go Reference Harness、Atomic JSON Store、R002 内部模块划分或固定本地部署作为生产架构。

参见：

- [`docs/product/releases/r002-non-production-architecture-walking-skeleton.md`](docs/product/releases/r002-non-production-architecture-walking-skeleton.md)
- [`docs/adr/0001-r002-non-production-walking-skeleton-boundary.md`](docs/adr/0001-r002-non-production-walking-skeleton-boundary.md)

---

## 尚未证明

当前仓库没有证据证明：

- 真实 LLM 能稳定完成目标任务；
- 多 Agent Blackboard 比固定 Workflow 更有产品价值；
- 企业员工愿意迁移并持续使用；
- 真实企业数据可以在完整威胁模型下安全处理；
- 动态 Agent 激活能够提高质量或降低成本；
- 多 Workflow、多 Runtime 和复杂分支能够可靠恢复；
- Planner、Harness、GitHub 和企业系统已经形成完整生产闭环；
- 当前架构能够满足生产级性能、可用性和多租户要求。

这些问题必须分别通过后续 Release 和可审查证据验证。

---

## 设计参考及其准确位置

| 参考对象 | Accord 主要借鉴 | Accord 不直接继承 |
|---|---|---|
| MagicChat | 企业身份、会话、App、审批和治理入口 | Accord Case、Blackboard 和交付事实 |
| Cumora | 一等 Agent、durable inbox、Wake/triage、Skill 渐进加载、Freshness | 广播所有 Agent、聊天即任务、通用 Workflow 假设 |
| Blackboard Architecture / Cairn | 共享状态、部分解、动态探索、Intent Claim | 完全机会式调度、无治理共享区、无审批执行 |
| Hermes | 可选 Runtime、Profile 和通用任务执行参考 | Accord 领域事实和正式交付控制 |
| pi-ticket-planning | 产品规划与 Ticket Admission | 通用 Agent 协调 |
| HerdrHarness-lite | 确定性交付、Reviewer、恢复和 Merge Gate | Case 与开放问题求解 |

Cumora 的实现核查见：

- [`docs/product/research/cumora-wake-and-first-class-agents.md`](docs/product/research/cumora-wake-and-first-class-agents.md)

---

## 仓库导航

| 需要回答的问题 | 应读取的来源 |
|---|---|
| Accord 最终要成为什么 | [`docs/product/VISION.md`](docs/product/VISION.md) |
| 当前 Release 承诺什么行为 | [`docs/product/releases/`](docs/product/releases/) |
| 某项承重技术决策为什么这样选 | [`docs/adr/`](docs/adr/) |
| AI 如何选择权威来源 | [`AGENTS.md`](AGENTS.md) |
| Delivery Ticket 如何进入执行 | [`docs/agents/delivery-gate.md`](docs/agents/delivery-gate.md) |
| Tracker、Label 和关系如何表达 | [`docs/agents/`](docs/agents/) |
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

`VISION.md` 中的 Phase 和 Work Package 只提供能力地图。它们必须先被缩小为一个有边界、有证据要求的 Release，才能继续拆成可执行 Ticket。

---

## 实现语言与技术栈

根 README 不拥有生产实现语言、数据库、消息队列或部署形态。

- R002/r2 的 Go 实现只作为已 HOLD Release 的历史非生产 Conformance 证据；
- 生产 Coordination Plane 的主要语言由 Accepted ADR-0002 决定；
- R003/r1 的首个最小实现边界由 Accepted ADR-0003 决定；
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
3. 只读取会改变当前决策的 ADR 和愿景章节；
4. 检查当前代码、配置、类型和测试；
5. 明确当前任务影响的 Owner、Seam、Scenario 和外部副作用；
6. 遇到权威冲突、权限缺失或未决定技术边界时停止扩大范围。

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
- 为未来假设提前设计的抽象层。

每项新增能力都必须有当前 Release、具体 Consumer、退出条件和验证方法。

---

## 项目成熟度声明

Accord 当前是一个以证据驱动方式形成中的产品和架构，不是已经完成的生产平台。

仓库中的愿景、研究、Release、原型和 ADR 应帮助人和 AI：

- 区分目标、事实、决定与假设；
- 只读取完成当前任务所需的最小上下文；
- 避免把外部参考误当成现成能力；
- 避免把实验结果夸大为生产证明；
- 按最小闭环逐步实现并验证 Accord。
