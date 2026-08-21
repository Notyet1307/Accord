# Accord 愿景架构与实施地图

> **Accord — 企业级受管 Agent 协作与可信交付平台**  
> **Enterprise Governed Agent Collaboration & Trusted Delivery Platform**

---

## 文档元数据

- `status`: PRODUCT_VISION
- `authority_level`: DIRECTIONAL
- `decision_owner`: 产品负责人
- `last_updated`: 2026-08-21
- `recommended_path`: `docs/product/VISION.md`
- `scope`: Accord 长期产品目标、逻辑架构、不变量与能力实施地图
- `not_a_substitute_for`: Accepted Release、Delivery Spec、Ticket、ADR、当前代码和测试

---

## 0. 如何使用本文档

### 0.1 本文档是什么

本文档用于回答：

1. Accord 最终要解决什么问题；
2. Accord 的目标产品形态是什么；
3. 各系统、组件和事实权威之间如何分工；
4. 黑板架构、Workflow、Agent Runtime 和领域控制器如何组合；
5. 后续能力应按什么顺序建设；
6. AI 在实现某个局部任务时，哪些边界不能破坏。

本文档是**长期方向说明和架构导航**，不是一次性实施规格。

### 0.2 本文档不是什么

本文档不是：

- 对全部目标能力的立即实施授权；
- 当前代码已经具备全部能力的证明；
- 对生产技术栈、数据库、消息队列或部署形态的最终决定；
- Accepted Release、Delivery Spec、Ticket 或 ADR 的替代品；
- 要求每次开发任务加载的完整上下文。

任何实际实现都必须先由 Accepted Release、Delivery Spec 或 Ticket 缩小范围，并服从适用的 Accepted ADR、当前代码和测试。

### 0.3 权威按关注点分工

仓库不存在一个可以覆盖所有问题的单一文档优先级。不同事实由不同来源拥有：

| 关注点 | 权威来源 |
|---|---|
| 当前任务应产生什么行为 | Accepted Release、Delivery Spec 或 Ticket |
| 当前实现实际上如何工作 | 当前代码、配置、类型和测试 |
| 承重技术决策 | 适用的 Accepted ADR |
| 全局且不可从代码发现的不变量 | 根目录 `AGENTS.md` |
| 当前 Issue、PR、Label 和依赖关系 | GitHub |
| 当前执行、Attempt、Reviewer 和恢复事实 | 配置的 Harness |
| 长期目标和方向一致性 | 本文档 |
| 背景说明和启发 | README、研究材料、原型、示例和历史记录 |

如果两个权威来源对**同一关注点**发生冲突，AI 不得自行选择一个覆盖另一个；应明确指出冲突并交还给对应所有者。本文档与任何实施权威冲突时，**不得擅自“按愿景重构”**。

### 0.4 状态标签

本文使用以下标签区分不同性质的信息：

- **[INVARIANT]**：长期必须保持的架构约束；
- **[TARGET]**：目标态能力，可能尚未实现；
- **[EVIDENCE]**：已有 Release、原型、测试或运行证据支持；
- **[HYPOTHESIS]**：产品或技术假设，必须通过试点验证；
- **[DEFERRED]**：有意暂缓，当前不得顺手实现或提前固化。

### 0.5 AI 阅读规则

AI 只有在以下任务中需要读取本文档：

- 新增产品能力；
- 设计跨组件架构；
- 创建新的 Release、Delivery Spec 或 Epic；
- 修改 Case、Blackboard、Workflow、Agent、Runtime、Authority 等核心边界；
- 判断某个局部方案是否符合 Accord 长期方向。

小型 Bug 修复、局部重构和明确 Ticket 的实现，不应默认加载本文全部内容。

### 0.6 最小阅读路径

为降低上下文成本，按任务选择章节：

| 任务类型 | 最小阅读范围 |
|---|---|
| 判断产品方向 | 0、1、3、4、22、24 |
| 设计总体架构 | 0、3、5、6、11、15、16 |
| 实现 Case/Blackboard | 3、7、8、17 中 CAS/BRD/GOV |
| 实现 Workflow/Agent | 3、9、10、17 中 WF/AGT/CTX/HUM/RSP |
| 接入 Planner/Harness/GitHub | 3、11、13.2、17 中 INT |
| 设计动态多 Agent | 3.2、8、9.3、10、17 中 ACT/PILOT-02 |
| 拆分 Release/Ticket | 15、16、17、18、19、20 |
| 安全与生产加固 | 3、8.4、14、17 中 SEC/OPS |

---

# 1. 产品愿景

## 1.1 一句话愿景

> **让企业员工用自然语言提出复杂目标，由受管 Agent 团队在一个可追踪的 Case 中协作，形成有证据、可审查、可审批、可交付并可验证结果的闭环。**

## 1.2 产品定位

Accord 不是单纯的聊天机器人、Agent 群聊、工作流编辑器、代码执行器或共享记忆。

Accord 是一个连接以下能力的企业级协调层：

```text
自然语言协作入口
        +
受管多 Agent 协作
        +
结构化共享问题求解状态
        +
确定性 Workflow 控制
        +
人工决策与审批
        +
领域权威系统中的可信执行
```

用户看到的是一个企业任务协作空间；系统内部使用 Agent、黑板、Workflow 和领域控制器完成任务。

## 1.3 Accord 最终交付的不是“Agent 对话”

Accord 的最终价值对象是：

```text
Case
├── 明确目标
├── 经过追问补全的约束
├── 可追溯证据
├── 结构化中间判断
├── 未解决问题
├── 候选方案与批评
├── 人工决策与审批
├── 最终 Artifact
└── 外部权威系统确认的 Outcome
```

Agent 对话只是产生这些对象的一种方式，不是产品本身。

## 1.4 北极星结果

一个高质量 Accord Case 应满足：

- 用户不必理解底层 Agent、Prompt、Runtime 或黑板；
- 系统能说明当前目标、进展、阻塞和负责人；
- 重要结论能够追溯到来源；
- 不同 Agent 不因顺序摘要而丢失关键信息；
- 不会由多个 Agent 同时对用户重复回复；
- 人工输入后恢复原 Case 和原 Workflow Run；
- 高风险操作必须经过明确授权；
- 崩溃、重试和消息重放不会重复创建 Case、执行或发布；
- GitHub、Harness 和企业业务系统仍拥有自己的事实；
- 最终产物能够被真实采用，而不只是“生成了一篇内容”。

---

# 2. 要解决的核心问题

## 2.1 企业员工侧

企业员工面对复杂任务时，当前通常存在：

- 需要在多个外部 AI 平台和工具之间切换；
- 不知道应该选择哪个 Agent；
- 不清楚 Agent 使用了哪些数据、工具和权限；
- 多次对话形成的结论难以复用；
- 生成内容缺少证据、审查和责任边界；
- 从“形成方案”到“真实执行”之间没有可信交接。

## 2.2 企业治理侧

企业缺少：

- 可统一管理的 Agent 身份；
- 可版本化的 Skill、工具和模型策略；
- 数据访问、外发和执行权限控制；
- 多 Agent 协作的过程可见性；
- 对事实、判断、决策和执行结果的区分；
- 对成本、质量、安全和失败恢复的统一治理。

## 2.3 多 Agent 架构侧

仅使用主从式或固定消息流水线会产生：

- 中央 Agent 必须知道所有子 Agent 的真实能力；
- 任务路径一旦开放，预定义流程容易僵化；
- Agent 之间逐级传递自然语言摘要会损失关键实体和限定条件；
- 多个 Agent 容易重复研究、并发碰撞或同时回复；
- 所有上下文持续堆积会导致成本和上下文污染；
- “多个 Agent 达成一致”并不等于结论正确。

Accord 需要同时保留：

```text
黑板的共享状态与开放探索能力
        +
Workflow 的确定性、恢复与审批能力
```

二者不能互相替代。

---

# 3. 第一性原理与长期不变量

## 3.1 事实不变量

### INV-01：每类现实事实只有一个权威所有者

**[INVARIANT]**

- MagicChat 拥有企业身份、会话、消息和 App 边界；
- GitHub 拥有 Repository、Issue、PR、Commit 和 CI 状态；
- HerdrHarness-lite 拥有正式 Delivery Ticket 的执行、Attempt、Reviewer、恢复和交付控制事实；
- pi-ticket-planning 拥有产品规划过程和 Admission 产物；
- 外部企业系统拥有其业务对象和执行结果；
- Accord 拥有 Case、Board、Workflow Run、Agent Activation、Work Claim、Response Claim 和审计关联。

Accord 可以保存外部事实的引用和投影，但不能成为第二个权威。

### INV-02：聊天不是任务事实源

**[INVARIANT]**

聊天用于：

- 提出目标；
- 补充信息；
- 追问；
- 解释；
- 决策；
- 审批；
- 告知结果。

正式任务状态必须进入 Case、Board、Workflow Run、Decision Record 或外部权威系统。

### INV-03：Agent 输出默认是候选判断，不是事实

**[INVARIANT]**

Agent 可以写入：

- Observation；
- Claim；
- Hypothesis；
- Proposal；
- Critique；
- Verification Result；
- Artifact Draft。

Agent 不得仅凭自身输出创建：

- Human Decision；
- Approval；
- External Outcome；
- GitHub/Harness 已完成事实；
- 更高权限。

### INV-04：共享内容中的数据不自动成为指令

**[INVARIANT]**

文件、网页、邮件、工具输出和 Board Entry 默认都是数据。

只有经过明确授权和策略校验的内容，才能作为：

- 系统指令；
- Workflow Definition；
- Skill；
- Tool Policy；
- Approval；
- Operator Action。

这用于隔离 Prompt Injection、恶意内容和数据投毒。

## 3.2 协作不变量

### INV-05：一条用户可见消息原则上只有一个 Response Owner

**[INVARIANT]**

其他 Agent 可以：

- 观察；
- 提供内部贡献；
- 请求证据；
- 提交候选结果；
- 参与审查。

但只有持有有效 Response Claim 且通过 Freshness Gate 的主体可以发布当前回复。

### INV-06：Agent Session 必须隔离

**[INVARIANT]**

至少按以下逻辑键隔离：

```text
tenant + agent + case + conversation
```

Workflow、Runtime Invocation 和 Delivery Attempt 需要进一步使用自己的稳定标识。

不同 Agent 不共享隐式模型历史，不允许 Persona、Skill、工具结果和授权串线。

### INV-07：动态协作必须是受限的

**[INVARIANT]**

Accord 不采用“所有 Agent 收到所有消息并自由抢答”。

动态参与必须经过：

- Capability Eligibility；
- 权限检查；
- 并发上限；
- 成本预算；
- Work Claim/Lease；
- 重复工作检测；
- Deadline；
- Cancellation；
- Response Owner 约束。

## 3.3 控制不变量

### INV-08：已知路径使用确定性控制，未知路径允许受控探索

**[INVARIANT]**

适合确定性 Workflow 的环节：

- 输入完整性检查；
- Human Approval；
- Reviewer Gate；
- Ticket Admission；
- 发布；
- Merge；
- 外部系统写操作。

适合黑板和动态探索的环节：

- 研究；
- 调查；
- 风险发现；
- 假设形成；
- 方案搜索；
- 多源证据关联；
- 专家补充。

### INV-09：高风险副作用不能由 Agent 共识直接触发

**[INVARIANT]**

以下动作必须经过领域控制器和授权门：

- 修改生产系统；
- 创建或改变正式交付状态；
- 恢复中断执行；
- 合并代码；
- 发布版本；
- 下发安全策略；
- 对外发送敏感内容；
- 扩大 Agent、Skill 或工具权限。

### INV-10：恢复和幂等优先于“看起来已经完成”

**[INVARIANT]**

系统必须使用稳定业务标识和确定性幂等键。

投递 Event ID 只代表一次投递，不应被假设为跨重放稳定身份。

对于没有幂等或结果恢复契约的外部 Runtime，不得声称物理 exactly-once。

## 3.4 上下文不变量

### INV-11：Agent 读取的是任务相关视图，不是完整历史堆积

**[INVARIANT]**

Case Blackboard 可以长期积累，但每次 Agent 调用只应获得：

- 当前目标；
- 当前节点职责；
- 必要约束；
- 相关 Board Entry；
- 必要 Source/Artifact；
- 明确输出契约；
- 当前权限和预算。

不得默认把全部聊天、全部黑板、全部 Skill 和全部历史注入每次模型调用。

### INV-12：不持久化原始隐藏推理过程

**[INVARIANT]**

系统持久化：

- 结论；
- 简洁理由；
- 证据引用；
- 假设；
- 决策摘要；
- 工具和执行记录。

系统不要求保存模型的原始隐藏 Chain-of-Thought。

---

# 4. 目标产品边界

## 4.1 Accord 应负责

**[TARGET]**

- 将自然语言请求关联到现有 Case 或创建新 Case；
- 维护 Case 的目标、参与者、Board、Workflow 和最终产物；
- 管理 Agent Profile、Capability、Skill Binding 和 Runtime Port；
- 选择确定性执行、受限动态参与或 Human Choice；
- 管理 Message Claim、Work Claim、Response Claim 和 Freshness；
- 提供结构化共享求解状态；
- 对 Human Input、Approval 和 Decision 进行关联；
- 连接领域控制器并展示权威结果；
- 保留端到端审计、成本、质量和恢复证据；
- 提供企业用户可理解的 Case Workspace。

## 4.2 Accord 不应负责

**[INVARIANT]**

- 复制 MagicChat 的身份、组织和会话系统；
- 复制 GitHub 的代码协作事实；
- 复制 HerdrHarness-lite 的正式交付执行状态机；
- 把所有领域能力收进一个“大一统 Agent”；
- 把 Agent 群聊当成任务系统；
- 把向量数据库或长期 Memory 当成黑板；
- 让 LLM 成为唯一调度器、权限检查器或完成判定器；
- 让一个万能 Handoff Schema 统一所有领域；
- 第一阶段建设开放 Agent 市场、Skill 市场或自主学习系统。

---

# 5. 目标逻辑架构

```text
┌──────────────────────────────────────────────────────────┐
│              MagicChat 企业协作与治理平面                 │
│                                                          │
│ 用户 / 组织 / SSO / 会话 / Topic / 文件 / App / 权限      │
│ Human Input / Choice / Approval / 可见消息                 │
└─────────────────────────┬────────────────────────────────┘
                          │ Message / Event / Action
┌─────────────────────────▼────────────────────────────────┐
│                  Accord Case Coordinator                  │
│                                                          │
│ Wake Router                                               │
│ Case Resolver                                             │
│ Work Router                                               │
│ Response Owner                                            │
│ Policy / Budget / Freshness / Dedup                       │
└───────────────┬──────────────────────┬───────────────────┘
                │                      │
┌───────────────▼──────────────┐  ┌────▼───────────────────┐
│   Governed Case Blackboard   │  │  Deterministic Workflow│
│                              │  │  Definition / Run       │
│ Evidence                     │  │                         │
│ Observation / Claim          │  │ Node State              │
│ Question / Intent            │  │ Wait / Resume           │
│ Hypothesis / Proposal        │  │ Branch / Join            │
│ Critique / Verification      │  │ Human Gate              │
│ Decision / Approval Ref      │  │ Retry / Cancel           │
│ Artifact / Outcome Ref       │  │ Completion Predicate     │
└───────────────┬──────────────┘  └────┬───────────────────┘
                │                      │
┌───────────────▼──────────────────────▼───────────────────┐
│            Agent Activation & Claim Controller            │
│                                                          │
│ Deterministic Assignment                                  │
│ Bounded Opportunity / Volunteer                           │
│ Human Choice                                              │
│ Capability Match / Lease / Heartbeat / Cancellation       │
└─────────────────────────┬────────────────────────────────┘
                          │ Invocation Contract
┌─────────────────────────▼────────────────────────────────┐
│                    Agent Execution Plane                   │
│                                                          │
│ Agent Profile / Skill Binding / Tool Policy               │
│ Context Assembler / Session Isolation                     │
│ Native LLM / Pi / Codex / Hermes / Other Runtime Adapters │
└─────────────────────────┬────────────────────────────────┘
                          │ Typed Domain Handoff
┌─────────────────────────▼────────────────────────────────┐
│                     Domain Authorities                     │
│                                                          │
│ pi-ticket-planning / HerdrHarness-lite / GitHub           │
│ Release / CI / 企业知识库 / 工单 / 安全平台 / 业务系统      │
└──────────────────────────────────────────────────────────┘

Cross-cutting:
Audit / Provenance / Security / Cost / Evaluation / Recovery
```

---

# 6. 各层职责

| 层 | 拥有的核心问题 | 不拥有的内容 |
|---|---|---|
| MagicChat | 人是谁、App 是谁、会话在哪里、谁可见、谁能审批 | Agent 求解状态、正式交付事实 |
| Case Coordinator | 这条事件属于哪个 Case、谁参与、谁负责回复 | 领域执行结果 |
| Case Blackboard | 当前知道什么、依据是什么、还有什么未知、有哪些候选解 | 外部系统真实状态 |
| Workflow Run | 哪些步骤必须发生、当前等待什么、如何恢复和完成 | Agent 的长期身份、GitHub/Harness 状态 |
| Activation Controller | 哪个 Agent 可以参加、如何 Claim、预算和并发 | 业务审批和领域执行 |
| Agent Execution Plane | 如何调用模型、Skill、工具和 Runtime | 企业身份、最终事实权威 |
| Domain Authorities | 规划、代码、交付、CI 或业务操作真实发生了什么 | 通用 Agent 协作 |
| Audit/Evaluation | 如何证明过程、成本、质量和恢复结果 | 替代任何业务权威 |

---

# 7. 核心产品对象：Case

## 7.1 Case 的定义

> **Case 是围绕一个用户目标形成的、可持续恢复的受管协作边界。**

一个 Case 可以跨越：

- 多条会话消息；
- 多个 Agent；
- 一个或多个 Workflow Run；
- 多次 Human Input；
- 多个 Artifact；
- 一个或多个外部领域对象。

Case 不等同于 Conversation，也不等同于 Workflow Run。

## 7.2 逻辑契约

以下为概念模型，不代表已选定实现语言或数据库 Schema：

```text
Case {
  id
  tenant_id
  title
  objective
  status
  created_by
  conversation_refs[]
  workflow_run_refs[]
  policy_ref
  board_revision
  final_artifact_refs[]
  external_outcome_refs[]
  created_at
  updated_at
}
```

## 7.3 Case 状态

Case 状态只提供粗粒度用户视图，详细执行状态由 Workflow Run 和领域系统拥有。

建议状态：

```text
OPEN
ACTIVE
WAITING_HUMAN
PAUSED
COMPLETED
CANCELLED
ARCHIVED
```

Case 状态应由底层事实投影得出，不应形成与 Workflow Run 冲突的第二套复杂状态机。

## 7.4 Case 的稳定身份

Case Resolver 必须区分：

- 新目标；
- 对现有追问的回答；
- 对已有 Case 的补充；
- Human Approval；
- 外部系统回调；
- 重放或重复消息。

任何自动关联都必须可解释、可审计，并允许人工纠正。

---

# 8. 受管 Case Blackboard

## 8.1 黑板在 Accord 中的准确位置

> **黑板是 Case 范围内的结构化共享问题求解状态，不是全局聊天池、长期记忆库或所有数据的副本。**

它解决：

- 多 Agent 信息保真；
- 中间状态可见；
- 证据和判断分离；
- 开放问题渐进求解；
- 并行贡献；
- 冲突与验证；
- 最终产物可追溯。

## 8.2 黑板的逻辑区域

### A. Evidence Board

保存：

- 原始用户目标与约束；
- 文件、网页、数据库和工具来源；
- 内容摘要和 Digest；
- 来源时间、权限和信任级别；
- 原始 Artifact 引用；
- 外部权威事实的引用或投影。

### B. Reasoning Board

保存：

- Observation；
- Question；
- Intent；
- Claim；
- Hypothesis；
- Proposal；
- Critique；
- Verification Result；
- Unknown。

这里允许同时存在冲突判断。

### C. Control Board

保存：

- Agent Eligibility；
- Work Opportunity；
- Work Claim；
- Lease；
- Heartbeat；
- Budget；
- Deadline；
- Freshness；
- Cancellation；
- Retry 和 Hold。

Control Board 主要由确定性程序管理，不应仅依赖 Agent 自述。

### D. Decision Board

保存：

- Human Decision；
- Approval；
- Rejection；
- Accepted Artifact；
- External Outcome Ref；
- Release/Delivery Gate 结果引用。

Decision Board 拥有最严格写权限。

### E. Agent Private Workspace

用于：

- Agent 私有工作文件；
- 尚未准备共享的草稿；
- Runtime 临时产物；
- 局部检索缓存。

私有空间不能绕过 Case Policy，也不能直接产生正式 Decision 或 Outcome。

### F. Response Board / Request Inbox

用于请求广播和候选响应隔离：

- 控制器发布结构化需求；
- 符合条件的 Agent 返回 accept、decline 或 candidate；
- 候选响应在进入共享黑板前经过选择、去重和策略检查；
- 避免所有 Agent 彼此读取未筛选响应并相互污染。

## 8.3 Board Entry 类型

| 类型 | 含义 | 默认权威级别 |
|---|---|---|
| `Observation` | 对输入或工具结果的原始观察 | 低 |
| `EvidenceRef` | 指向可验证来源 | 取决于来源 |
| `Question` | 当前未解决问题 | 工作状态 |
| `Intent` | 准备探索的方向 | 工作状态 |
| `Claim` | 待验证判断 | 候选 |
| `Hypothesis` | 可证伪假设 | 候选 |
| `Proposal` | 候选方案 | 候选 |
| `Critique` | 对 Claim/Proposal 的反驳 | 候选 |
| `VerificationResult` | 验证方法和结果 | 中高 |
| `Hint` | 人工注入的方向性提示 | 受来源约束 |
| `Decision` | 获授权人作出的选择 | 高 |
| `ApprovalRef` | 对外部审批记录的引用 | 高 |
| `ArtifactRef` | 报告、方案、代码、PR 等产物引用 | 取决于状态 |
| `OutcomeRef` | 外部权威系统确认的结果 | 最高 |
| `ControlEvent` | Claim、Hold、Cancel、Budget 等控制事实 | 系统权威 |

## 8.4 Board Entry 最小字段

```text
BoardEntry {
  id
  tenant_id
  case_id
  type
  status
  content_or_payload
  author_type
  author_id
  source_refs[]
  based_on[]
  contradicts[]
  supersedes[]
  visibility
  trust_level
  instruction_authority
  confidence
  policy_tags[]
  revision
  created_at
  expires_at
  integrity_digest
}
```

这是逻辑最小集。实现可以拆表或拆事件，但不能丢失对应语义。

## 8.5 Entry 生命周期

建议通用状态：

```text
PROPOSED
ACTIVE
CHALLENGED
VERIFIED
REJECTED
SUPERSEDED
EXPIRED
```

不同 Entry 类型可以限制可用状态。

已有 Entry 原则上不原地覆盖。修订应通过新版本、`supersedes` 和审计事件表达。

## 8.6 事实层级

从高到低：

```text
外部权威系统确认的 Outcome
        ↓
Human Decision / Approval
        ↓
经过验证且来源完整的 Evidence / Verification
        ↓
Agent Claim / Proposal / Critique
        ↓
Observation / Hint / Working Note
```

下层内容不得无条件覆盖上层内容。

## 8.7 冲突、重复和过期治理

黑板必须支持：

- 内容 Digest 和语义重复检测；
- `contradicts` 关系；
- `supersedes` 关系；
- 来源失效和 TTL；
- Cleaner/Compaction；
- 决策后冻结相关视图；
- 审计历史保留。

Cleaner 只能减少 Agent 读取视图中的噪声，不能删除必须保留的原始证据和审计事实。

## 8.8 Blackboard View 与 Context Assembler

Agent 不直接读取完整黑板。

Context Assembler 根据以下变量构建最小视图：

```text
Agent Profile
Current Case
Current Workflow Node
Objective
Capability
Tool/Skill Policy
Visibility
Trust Level
Relevant Entry Graph
Token/Cost Budget
Freshness Revision
```

输出至少包含：

- 当前目标；
- 当前职责；
- 已确认事实；
- 相关候选判断；
- 当前未决问题；
- 必要来源和 Artifact；
- 禁止事项；
- 输出 Schema；
- 当前 Board Revision。

---

# 9. Workflow 与黑板的关系

## 9.1 两者职责不同

```text
Blackboard
    表示“当前知道什么、还缺什么、有哪些候选解”

Workflow Run
    表示“哪些步骤必须发生、当前应该等待或执行什么”
```

Workflow 不应复制全部黑板内容；黑板也不应自己隐式决定所有流程状态。

## 9.2 Workflow Definition

每个 Workflow Definition 至少声明：

```text
id
version
eligible_case_types
entry_conditions
nodes[]
node_input_query
node_output_contract
completion_predicate
human_gates
side_effect_policy
budget_policy
failure_policy
publication_policy
```

## 9.3 Workflow Node 的三种调度模式

### Mode 1：Deterministic Assignment

控制器明确指定执行主体。

适用于：

- Normalizer；
- Reviewer；
- Human Approval；
- Publication；
- Ticket Admission；
- 外部写操作。

### Mode 2：Bounded Opportunity

控制器向有限 Agent 集合发布结构化 Work Opportunity。

Agent 可以返回：

```text
ACCEPT
OBSERVE
DECLINE
NEED_MORE_CONTEXT
CANDIDATE_RESPONSE
```

控制器根据 Capability、权限、负载、预算、历史效果和重复度选择参与者。

适用于：

- Research；
- Investigation；
- Evidence Discovery；
- Risk Analysis；
- Proposal Generation。

### Mode 3：Human Choice

由人选择 Agent、方案或下一步。

适用于：

- 高风险；
- 高成本；
- 多个候选都合理；
- 自动路由置信度不足；
- 权限边界不清；
- 冲突无法自动解决。

## 9.4 Wait 与 Resume

Human Input、Approval 或外部回调必须恢复同一个 Run，而不是创建新的隐式 Run。

等待状态至少保存：

- Run ID；
- Case ID；
- Waiting Node；
- Expected Actor；
- Expected Input Contract；
- Correlation Key；
- Expiration；
- Resume Policy。

---

# 10. Agent Coordination

## 10.1 Agent 是一等身份

Agent 不是同一模型临时切换 Prompt 的别名。

概念模型：

```text
AgentProfile {
  id
  tenant_id
  name
  role
  description
  capabilities[]
  runtime_ref
  model_policy
  tool_policy
  memory_policy
  collaboration_policy
  skill_bindings[]
  visibility_scope
  status
  version
}
```

角色用于人类理解，Capability 用于机器路由。

## 10.2 Skill 渐进披露

默认上下文只包含：

- Skill 名称；
- 简短描述；
- 版本；
- 风险级别；
- 允许工具摘要。

只有任务真正需要时才加载完整 Skill。

生产 Skill 必须：

- 由管理员发布；
- 版本锁定；
- 经过评估；
- 明确允许工具；
- 不得自动提升权限。

Agent 不得自主安装或修改生产 Skill。

## 10.3 Wake、Case 与 Work 三层路由

### Wake Router

回答：

```text
这条事件是否值得唤醒 Accord？
```

### Case Resolver

回答：

```text
这条事件属于哪个 Case，还是需要创建新 Case？
```

### Work Router / Activation Controller

回答：

```text
当前 Case 中需要哪类能力、采用哪种调度模式、允许哪些 Agent 参加？
```

不要用一个万能 Router 同时完成全部判断。

## 10.4 三种 Claim

### Message Claim

谁负责处理当前消息事件。

所有者：Case Coordinator。

### Work Claim

谁正在处理某个 Board Intent、Question 或 Workflow Opportunity。

所有者：Activation Controller。

### Delivery Ticket Claim

谁正在执行正式 GitHub Delivery Ticket。

所有者：HerdrHarness-lite。

三者不得互相替代。

## 10.5 Work Claim / Lease

最小字段：

```text
claim_id
case_id
work_item_id
agent_id
lease_version
acquired_at
expires_at
heartbeat_at
budget
status
cancel_reason
```

Claim 必须支持：

- 原子获取；
- 续租；
- 过期；
- 取消；
- 并发限制；
- 失联恢复；
- 重复 Claim 拦截。

## 10.6 Freshness 与发布

Agent Invocation 开始时生成 Freshness Token：

```text
case_id
conversation_id
trigger_message_id
context_max_seq
board_revision
workflow_run_revision
claim_id
agent_id
context_digest
```

发布前验证：

- Conversation 是否出现新消息；
- Case/Board Revision 是否仍适用；
- Claim 是否仍属于该 Agent；
- Workflow Node 是否仍允许输出；
- Human Decision 是否已经变化；
- 是否已有重复或更新的输出；
- 当前 Agent 是否仍是 Response Owner。

不满足时：

```text
HOLD
→ 追加新事件
→ 更新 Context
→ 重新判断
```

## 10.7 Runtime Adapter

Runtime Adapter 统一的是调用契约，不是所有 Runtime 的内部行为。

最小能力：

```text
prepare
invoke
heartbeat
cancel
resume_or_recover
collect_result
report_usage
```

外部 Runtime 必须使用稳定 Invocation ID。

如果 Runtime 不能按 Invocation ID 恢复已产生结果，则需要明确声明副作用和重复执行风险。

---

# 11. Domain Authority 与 Handoff

## 11.1 MagicChat

负责：

- 企业身份；
- 组织与租户；
- App 身份；
- 会话和消息；
- 用户可见交互；
- 文件入口；
- Human Choice 与 Approval 的用户界面；
- App 事件投递和消息持久幂等。

Accord 通过正式 App 协议接入，不直接依赖 MagicChat 内部数据库完成业务行为。

## 11.2 pi-ticket-planning

负责：

- 从产品目标形成可验证的规划对象；
- Release、Scenario、Candidate Ticket；
- Admission 输入；
- 规划到交付的结构化交接。

Accord 可以：

- 启动 Planner Case/Run；
- 展示 Planner 状态；
- 收集 Human Input；
- 保存规划 Artifact 引用；
- 将已授权的 Admission Package 交给后续系统。

Accord 不应在通用黑板中重新实现 Planner 的领域状态机。

## 11.3 HerdrHarness-lite

负责：

- 正式 Delivery Ticket Claim；
- Worker、Reviewer、Analyst Attempt；
- 执行、审查、阻塞、恢复和合并控制；
- Delivery Ledger；
- 可验证交付结果。

Accord 负责：

- 将 Harness 状态投影到 Case；
- 显示等待的 Operator Action；
- 将精确用户决定交还 Harness；
- 关联 Ticket、Attempt、PR、Commit 和 Outcome。

Accord 不得凭聊天或 Agent 判断直接把 Ticket 标记为完成。

## 11.4 GitHub

负责：

- Repository；
- Issue；
- Pull Request；
- Commit；
- Branch；
- CI Check；
- Merge 状态。

Accord 保存稳定引用、必要摘要、读取时间和 Digest。

## 11.5 Handoff 类型

不要用一个万能 `handoff.json` 统一所有场景。

至少区分：

1. **Agent Collaboration Handoff**  
   在 Case 内围绕 Board Entry 的 consult、review、evidence-request。

2. **Planning → Delivery Handoff**  
   Planner 产生的 Admission Plan、Envelope、Manifest 和 Fingerprint。

3. **Delivery Attempt Handoff**  
   Harness 内 Worker、Reviewer、Analyst 之间的 Attempt Context 和 Execution Snapshot。

4. **External System Action Handoff**  
   面向工单、安全设备或业务系统的授权动作契约。

所有 Handoff 都应引用权威对象，而不是复制其全部状态。

---

# 12. 用户产品形态

## 12.1 用户不应看到“黑板架构”

黑板是内部实现概念。

用户看到的核心对象建议命名为：

- `Case Workspace`
- 中文：`协作任务空间`、`研判空间` 或 `任务工作区`

## 12.2 推荐界面结构

```text
┌──────────────┬─────────────────────────────┬──────────────┐
│ 对话与补充输入 │         Case Workspace      │ Agent 与控制  │
│              │                             │              │
│ 用户消息      │ 目标与当前状态               │ Response Owner│
│ Agent 追问    │ 已确认事实与来源             │ 参与 Agent    │
│ Human Choice │ 未解决问题                   │ Work Claim    │
│ Approval     │ 候选方案、批评与验证          │ 预算与进度     │
│              │ 决策与最终产物               │ 阻塞与等待     │
├──────────────┴─────────────────────────────┴──────────────┤
│ Timeline / Workflow Run / Audit / External Outcomes       │
└───────────────────────────────────────────────────────────┘
```

## 12.3 默认展示原则

默认展示：

- 目标；
- 状态；
- 阻塞；
- 负责人；
- 已确认事实；
- 来源；
- 候选方案；
- 审查结论；
- 需要用户决定的内容；
- 最终 Artifact；
- 外部执行 Outcome。

默认隐藏：

- 重复 Agent 消息；
- 低价值内部讨论；
- 原始模型隐藏推理；
- 无关工具日志；
- 已被 Supersede 的噪声；
- 私有 Runtime 临时文件。

用户可以按需展开审计证据。

---

# 13. 目标端到端场景

## 13.1 场景 A：内部决策方案

```text
用户在 MagicChat 提出目标
→ Wake Router 接收事件
→ Case Resolver 创建 Case
→ Work Router 匹配“内部决策方案” Workflow
→ Normalizer 检查输入
→ 信息不足，Run 进入 WAITING_HUMAN
→ 用户在原会话补充
→ 恢复同一 Case 和同一 Run
→ Researcher 写 Evidence/Question
→ Analyst 写 Claim/Proposal
→ Reviewer 写 Critique/Verification
→ Writer 生成 Artifact Draft
→ Human 审批或退回
→ Response Claim + Freshness Gate
→ 原会话唯一发布
→ Case 保存 Artifact、Decision 和完整 Trace
```

成功不只代表生成文档，还应包括：

- 关键结论有来源；
- Reviewer 的反驳被处理；
- 人工修改量可接受；
- 最终只发布一次；
- 恢复和重放不创建重复 Run。

## 13.2 场景 B：产品规划到软件交付

```text
用户提出产品方向
→ Planner Case
→ pi-ticket-planning 形成 Release/Scenario/Candidate Ticket
→ Human 审查
→ Admission Package
→ GitHub 创建正式对象
→ HerdrHarness-lite 领取 READY Ticket
→ Worker / Reviewer / Analyst 执行
→ PR / CI / Merge
→ Harness 返回 Outcome
→ Accord Case 展示从目标到交付的完整可追溯链
```

关键约束：

- Planner、GitHub、Harness 各自保留事实权威；
- Accord 负责协调和投影，不重建它们的状态机；
- 人工授权点不得被 Agent 群聊替代。

## 13.3 场景 C：开放式安全研究

```text
用户定义 Origin、Goal、范围和授权
→ Case 建立 Evidence/Intent Graph
→ Activation Controller 发布受限 Work Opportunity
→ 多个符合条件的安全 Agent 认领不同 Intent
→ Agent 将验证结果写回 Board
→ 新 Fact 产生新 Intent
→ Reviewer/Verifier 处理冲突与证据质量
→ 达到 Goal、预算耗尽或 Human Stop
→ 形成受控报告和可追溯证据
```

此场景可以借鉴 Cairn 的 Fact–Intent–Hint 和 OODA 思路，但必须增加：

- 企业身份；
- Scope 和授权；
- Tool Policy；
- Work Claim；
- Evidence Trust；
- Human Gate；
- 外部副作用控制；
- 审计和租户隔离。

---

# 14. 横切能力

## 14.1 安全与治理

目标能力：

- 租户、Case、Agent、Board Entry 级授权；
- 数据分级和可见范围；
- Tool、Model、Skill、Runtime 白名单；
- 网络外发和域名策略；
- 凭据最小暴露；
- Untrusted Content 标识；
- Prompt Injection 隔离；
- Board Poisoning 检测；
- Agent/Skill/Workflow 版本锁定；
- Human Approval；
- 全链路审计；
- 数据保留和清理策略。

## 14.2 可靠性

目标能力：

- Durable Inbox/Outbox；
- Stable Message/Case/Run/Invocation ID；
- Deterministic Idempotency Key；
- 原子状态更新；
- Crash Recovery；
- Replay；
- Lease 和 Heartbeat；
- Retry Budget；
- Cancellation；
- Freshness Hold；
- Duplicate Publication Prevention；
- External Runtime Result Recovery。

## 14.3 可观测性

每次 Case 至少可以关联：

```text
tenant
conversation
source_message
case
workflow_definition
workflow_run
node
agent
skill
model
runtime_invocation
tool_call
board_entry
work_claim
human_decision
response_claim
artifact
external_outcome
cost
latency
```

## 14.4 质量与产品指标

优先衡量：

- 最终产物采用率；
- 人工修改量；
- 关键事实保留率；
- 来源覆盖率；
- 引用正确率；
- 冲突发现率；
- 重复工作率；
- 路由正确率；
- 错误 Workflow 匹配率；
- Human Wait/Resume 成功率；
- 重复 Run 和重复回复率；
- Stale Output Hold 率；
- 越权读写和外发事件；
- 端到端成本与延迟；
- 外部 Outcome 完成率。

不应只衡量：

- Agent 数量；
- 对话轮数；
- 生成字数；
- “多 Agent 看起来是否热闹”。

---

# 15. 当前证据与目标态的区分

## 15.1 已有证据

**[EVIDENCE]**

当前 Accord 已有文档和原型证明或部分证明：

- R001 固定合成场景中的消息、Workflow 匹配、追问、同一 Run 恢复、Agent 节点、Human Approval 和唯一发布逻辑；
- R002 跨真实官方 MagicChat App WebSocket 边界的非生产 Walking Skeleton；
- 稳定 Message ID/cursor 与可变化 Event ID 的差异；
- 原子 Run Store；
- 确定性回写 ID；
- `message.send` 成功后崩溃的重放恢复；
- 最终只有一个 Run、一个逻辑 Stub Runtime 结果和一条最终消息；
- R002 的 Go Harness 是非生产 Conformance Surface，不代表生产 Agent Hub 技术栈。
- R002/r3 已进入 HOLD；上述内容只作为历史证据，现有 Delivery Spec、Ticket 图和独立 Harness 交付不再是 active work。后续 Release 只能继承其外部行为约束，不继承 Go、Atomic JSON Store 或内部模块划分作为生产架构。

## 15.2 尚未证明

**[HYPOTHESIS]**

当前尚未由现有证据证明：

- 真实 LLM 质量；
- 真实员工采用率；
- 真实企业数据安全；
- 多 Agent 共享黑板的质量增益；
- 动态 Agent 激活的收益；
- 多 Workflow 和复杂分支；
- 多 Runtime 的恢复契约；
- 多副本和生产级持久化；
- 长期成本；
- Planner/Harness/GitHub 全链路；
- 企业生产部署。

后续每个 Capability Phase 必须明确它能证明什么、不能证明什么。

---

# 16. 实施总图

以下是建议的能力实施顺序，不是 Accepted Release 编号。

```text
Phase 0  继承外部行为约束与权威边界
   │
   ▼
Phase 1  Case + Typed Blackboard Foundation
   │
   ▼
Phase 2  Fixed Governed Collaboration
   │
   ├──────────────► Phase 4  Domain Authority Integrations
   │
   ▼
Phase 3  Blackboard Governance + Context Engineering
   │
   ▼
Phase 5  Bounded Dynamic Activation
   │
   └──────────────┐
                  ▼
Phase 6  Enterprise Hardening & Production Readiness

Phase 7  Memory / Proactive Behavior / Marketplace
         仅在前述阶段有充分证据后考虑
```

Phase 4 可以在 Phase 2 之后并行开始，不需要等待动态激活。

---

# 17. 大块实现任务拆解

每个 Work Package 都应先编译成独立 Release/Delivery Spec，再拆成可执行 Ticket。

## Phase 0：继承外部行为约束与权威边界

### FND-01：外部行为约束基线

**目标**

让后续已承诺 Release 能直接验证 R002 已证明的外部失败语义，而不继续交付或推广 R002 的实现结构。

**输入**

- R002/r3 HOLD Release 及其历史证据；
- 仅适用于 R002 的 ADR-0001；
- 后续已承诺 Release 明确选择的 production walking skeleton 边界。

**输出**

- stable identity、wait/resume 和 Human Approval 约束；
- Response Claim、deterministic idempotency、Freshness 和 Dedup 约束；
- crash recovery 和 audit 验收语义。

**验收**

- 适用的外部行为在新的 production walking skeleton 中直接验证；
- 不把 Event ID 当作跨重放稳定身份；
- Human Approval 前不能发布；
- 重试或重放不得产生重复副作用或重复发布；
- 未选择或暗示 Go Reference Harness、Atomic JSON Store 或 R002 内部模块是生产架构。

**明确不做**

- 继续现有 R002 Delivery Spec 或 Ticket 图；
- 独立交付 R002 Go Reference Harness；
- 继承 R002 的单进程、本地部署或内部模块划分；
- 在不满足 R002/r3 reopen condition 时重新打开 R002。

---

### FND-02：Vision / Authority Navigation

**目标**

让 AI 能快速找到长期愿景，但不把愿景误当实施授权。

**输出**

- 本文档；
- README 中的简短链接；
- 必要时在 `AGENTS.md` 增加一条“架构/产品方向任务才读取 VISION”的导航；
- 不复制 Release、ADR 和 Ticket 内容。

**验收**

- 小型实现任务不需要加载全文；
- 新架构任务能够明确找到本文；
- 权威冲突处理规则清晰。

---

## Phase 1：Case 与 Typed Blackboard 基础

### CAS-01：Case Identity 与 Lifecycle

**目标**

建立独立于 Conversation 和 Workflow Run 的 Case 对象。

**实现块**

1. Case Contract；
2. Create/Read/Update Status；
3. Conversation Reference；
4. Stable Correlation；
5. Case Audit；
6. Case Resume。

**验收**

- 新目标创建一个 Case；
- 追问回答恢复原 Case；
- 重复投递不创建第二个 Case；
- Case 不复制完整消息内容；
- Case 状态与 Workflow 状态不会形成双权威。

---

### BRD-01：Board Entry Contract

**目标**

定义最小 Typed Entry、SourceRef、ArtifactRef 和关系语义。

**实现块**

1. Entry Type 枚举；
2. Provenance；
3. Trust/Visibility；
4. `based_on`；
5. `contradicts`；
6. `supersedes`；
7. Revision/Digest；
8. Validation。

**验收**

- 无类型的自由文本不能直接进入正式共享黑板；
- 每条重要 Claim 能追溯到来源或明确标记无来源；
- Agent 输出不会被默认标记为 Verified；
- 数据和指令有明确区分。

---

### BRD-02：Append-only Board Store 与 Materialized View

**目标**

支持可靠写入、历史审计和高效读取当前视图。

**实现块**

1. Append Event；
2. Current Projection；
3. Revision；
4. Optimistic Concurrency；
5. Case-scoped Query；
6. Replay；
7. Snapshot/Compaction 接口。

**验收**

- 旧 Entry 不被无审计覆盖；
- 并发写入有冲突检测；
- 任一当前视图能回溯到事件；
- Board Store 不承载外部系统的第二份权威状态。

**技术说明**

具体数据库和消息基础设施属于后续 ADR 决策；本阶段只固定行为契约。

---

### BRD-03：Board Query 与 Scoped View

**目标**

按 Agent、节点、权限和目标返回最小相关视图。

**实现块**

1. Type Filter；
2. Relation Traversal；
3. Visibility Filter；
4. Trust Filter；
5. Source Resolution；
6. Revision Token；
7. Query Audit。

**验收**

- Agent 看不到无权限 Entry；
- Reviewer 可以读取被审查 Proposal 及其 Evidence；
- Writer 不必读取全部 Runtime 日志；
- 查询结果携带 Board Revision。

---

## Phase 2：固定受管协作闭环

### WF-01：Workflow Definition / Run Core

**目标**

建立固定 Workflow 的持久状态、Wait/Resume 和节点契约。

**实现块**

1. Versioned Definition；
2. Run Identity；
3. Node State；
4. Entry/Exit Contract；
5. Wait/Resume；
6. Retry/Cancel；
7. Human Gate；
8. Completion Predicate。

**验收**

- 一条消息只创建一个 Run；
- Human Input 恢复同一 Run；
- 节点不能跳过必须 Gate；
- Run 状态可崩溃恢复；
- Workflow 不复制 Board 内容。

---

### AGT-01：固定 Agent Profile 与 Runtime Port

**目标**

支持固定 Researcher、Analyst、Reviewer、Writer Profile。

**实现块**

1. AgentProfile；
2. Capability；
3. SkillBinding；
4. ToolPolicy；
5. RuntimePort；
6. Session Key；
7. Usage Report；
8. Version Lock。

**验收**

- 不同 Agent Session 不串线；
- Agent 只能使用绑定 Skill 和工具；
- Profile、Skill 和 Runtime 版本进入审计；
- Runtime 可先使用 Stub，再替换为真实 Adapter。

---

### CTX-01：Context Assembler V1

**目标**

从 Case、Board 和 Workflow Node 构建最小 Agent 上下文。

**实现块**

1. Objective；
2. Node Instructions；
3. Relevant Board View；
4. Source/Artifact References；
5. Output Schema；
6. Permission Summary；
7. Token Budget；
8. Context Digest。

**验收**

- 不注入完整聊天和完整 Board；
- Agent 输出可以验证 Schema；
- Invocation 可关联输入 Revision 和 Digest；
- Context 选择结果可审计。

---

### HUM-01：Human Input / Choice / Approval

**目标**

把自然会话中的人工输入转换为精确的 Run Resume 或 Decision。

**实现块**

1. Challenge；
2. Expected Actor；
3. Input Schema；
4. Correlation；
5. Expiration；
6. Approval Record；
7. Reject/Revise；
8. Resume。

**验收**

- 只有预期用户可以完成指定审批；
- 用户回复不会创建新 Run；
- Approval 关联精确 Case、Run、Node 和 Artifact Revision；
- 旧 Approval 不能授权新版本 Artifact。

---

### RSP-01：Response Claim、Freshness 与 Dedup

**目标**

保证用户可见输出唯一且基于最新状态。

**实现块**

1. Response Claim；
2. Freshness Token；
3. Conversation Check；
4. Board/Run Revision Check；
5. Duplicate Detection；
6. Hold；
7. Deterministic Send ID；
8. Replay Recovery。

**验收**

- 同一触发只允许一个 Response Owner；
- 新消息到达后旧结果不能直接发布；
- Crash Replay 不产生重复最终回复；
- Hold 后可以基于新上下文恢复。

---

### PILOT-01：固定内部决策 Workflow

**目标**

验证“固定角色 + Case Blackboard + Human Approval”的完整质量闭环。

**固定角色**

```text
Normalizer
Researcher
Analyst
Reviewer
Writer
Human Approver
```

**验收场景**

1. 信息不足时追问；
2. 回复后恢复；
3. Researcher 写 Evidence；
4. Analyst 写 Claim/Proposal；
5. Reviewer 提交 Critique/Verification；
6. Writer 仅使用可接受 Entry 生成 Artifact；
7. Human Approver 决定发布或退回；
8. 最终只发布一次。

**质量验收**

- 来源覆盖；
- 关键事实保留；
- Reviewer 问题闭合；
- 人工修改量；
- 最终采用结果；
- 成本和延迟。

---

### UX-01：Minimal Case Workspace

**目标**

让用户看到结构化进展，而不是 Agent 群聊噪声。

**首版只做**

- Case 标题和目标；
- 当前状态；
- 已确认事实；
- 未解决问题；
- Proposal 和 Review；
- 当前等待；
- Agent/Claim；
- Artifact；
- Timeline。

**明确不做**

- 完整可视化 Workflow Builder；
- Agent 市场；
- Skill 市场；
- 自定义仪表盘系统。

---

## Phase 3：黑板治理与上下文工程

### GOV-01：Duplicate / Contradiction / Supersession

**目标**

控制黑板污染和重复。

**验收**

- 重复 Evidence 有统一关联；
- 冲突 Claim 不会被静默覆盖；
- Superseded Entry 不进入默认 Agent View；
- 审计仍可查看历史。

---

### GOV-02：Trust 与 Instruction Boundary

**目标**

隔离不可信内容和 Prompt Injection。

**验收**

- Web/File/Tool 内容默认 `instruction_authority=NONE`；
- Agent 不会把来源中的命令当系统指令执行；
- 敏感或未知来源进入低信任区；
- Tool Call 前重新做 Policy Check。

---

### CTX-02：Relevance、Compaction 与 Snapshot

**目标**

控制长期 Case 的上下文成本。

**实现块**

- Relation-based Retrieval；
- Relevance Ranking；
- Verified Fact Snapshot；
- Decision Snapshot；
- Expiration；
- Cold History；
- Token Budget；
- Retrieval Evaluation。

**验收**

- Case 历史增长不导致每次 Prompt 线性增长；
- Snapshot 可回溯到原 Entry；
- Compaction 不改变事实权威；
- 关键事实保留率可量化。

---

### OBS-01：Quality / Cost / Trace

**目标**

建立架构效果的可测量证据。

**验收**

- 能比较消息传递、固定黑板和动态黑板三种配置；
- 能计算事实保留、重复工作、冲突发现、人工修改、成本和延迟；
- 每个最终结论能追溯到 Agent、Source 和 Board Entry；
- 指标结果不会被自动解释成产品成功。

---

## Phase 4：领域权威系统接入

### INT-01：MagicChat Production Adapter Boundary

**目标**

将 R002 Conformance 行为演进为正式 Accord 接入边界。

**验收**

- 只通过正式 App 协议工作；
- 稳定消息身份和 ACK 语义明确；
- Credentials 最小暴露；
- 消息重放和回写幂等；
- 不直接依赖 MagicChat DB 完成应用行为。

---

### INT-02：pi-ticket-planning Adapter

**目标**

把规划过程作为领域 Runtime/Controller 接入 Case。

**验收**

- Planner Session 与普通 Agent Session 隔离；
- Planning Artifact 有稳定引用和版本；
- Human Input 恢复原 Planning Case；
- Admission Package 有明确 Fingerprint；
- Accord 不复制 Planner 状态机。

---

### INT-03：GitHub Projection

**目标**

在 Case 中展示 Issue、PR、Commit、CI 和 Merge 的权威投影。

**验收**

- 每个投影包含读取时间和来源；
- 状态变化可更新但历史可审计；
- Accord 不自行推断 Merge/CI 完成；
- GitHub 不可用时诚实显示 Stale/Unknown。

---

### INT-04：HerdrHarness-lite Adapter

**目标**

把 Delivery 状态、阻塞和精确 Operator Action 投影到 Case。

**验收**

- 正式 Delivery Claim 仍由 Harness 拥有；
- Operator Decision 关联精确 Challenge 和 Version；
- Accord 不能直接改写 Harness Ledger；
- Ticket、Attempt、Reviewer、PR 和 Outcome 可关联；
- 重试不会创建重复执行。

---

### INT-05：Planning-to-Delivery Trace

**目标**

形成目标到真实交付的完整证据链。

**验收**

```text
User Goal
→ Planning Case
→ Release/Scenario
→ Admission Package
→ GitHub Ticket
→ Harness Attempt
→ PR/CI/Merge
→ External Outcome
```

每一跳都有稳定 ID、Owner 和 Digest。

---

## Phase 5：受限动态激活

### ACT-01：Capability Registry

**目标**

用结构化 Capability 描述 Agent 能做什么，而不是只靠角色名称和 Prompt。

**验收**

- Capability 有版本、输入、输出、权限和成本声明；
- Router 不需要读取完整 Agent Prompt 才能匹配；
- Capability 不授予工具权限。

---

### ACT-02：Activation Policy

**目标**

为每个 Workflow Node 选择：

```text
DETERMINISTIC
BOUNDED_OPPORTUNITY
HUMAN_CHOICE
```

**验收**

- 规则优先；
- LLM Triage 只在必要时使用；
- 决策原因可审计；
- 低置信度可以退回 Human Choice。

---

### ACT-03：Volunteer / Bid Contract

**目标**

让符合条件的 Agent 自主表达参与意愿，但不允许无边界抢答。

**Candidate Response 至少包含**

- Agent ID；
- Capability；
- 拟处理范围；
- 需要的权限；
- 预计成本；
- 预计时间；
- 重复度提示；
- 置信度；
- Decline Reason。

**验收**

- 控制器限制候选数量；
- 候选响应默认不彼此可见；
- 未被选择的 Agent 不执行；
- 参与意愿不等于权限或 Claim。

---

### ACT-04：Lease / Fairness / Budget

**目标**

支持有限并发、失联恢复和成本控制。

**验收**

- 每个 Work Item 有有限 Claim；
- Lease 可续约、过期和取消；
- 单 Agent、单 Case、单租户有并发上限；
- 达到预算后停止创建新工作；
- 已无价值的工作可以取消。

---

### PILOT-02：动态研究试点

**目标**

在 Research/Analysis 节点验证动态参与是否优于固定分配。

**对照组**

```text
A. 顺序消息传递
B. 固定 Workflow + Shared Blackboard
C. Shared Blackboard + Bounded Dynamic Activation
```

**只有在以下指标有明确收益时才继续扩大**

- 事实保留；
- 来源正确；
- 重复工作减少；
- 冲突发现；
- 最终采用；
- 成本和延迟可接受。

---

## Phase 6：企业加固与生产准备

### SEC-01：Tenant / Case / Entry Authorization

- 租户隔离；
- Case Membership；
- Entry Visibility；
- Agent/Tool Scope；
- Cross-tenant Negative Tests；
- Least Privilege。

### SEC-02：Secrets / Egress / Data Policy

- Secret Store；
- Runtime Credential Boundary；
- Network Egress Policy；
- Data Classification；
- Redaction；
- External Send Approval；
- Audit。

### OPS-01：Durable Infrastructure

- Durable Queue；
- Transactional Outbox；
- Multi-process Store；
- Lease Coordination；
- Recovery；
- Backup；
- Migration；
- Disaster Test。

### OPS-02：SLO / Cost / Capacity

- Availability；
- Queue Delay；
- Run Duration；
- Agent Invocation Failure；
- Cost Budget；
- Tenant Quota；
- Backpressure；
- Degraded Mode。

### ADM-01：Enterprise Control Plane

- Agent Catalog；
- Skill Catalog；
- Workflow Catalog；
- Version Promotion；
- Evaluation Gate；
- Policy Binding；
- Disable/Rollback；
- Audit Search。

### SEC-03：Adversarial Evaluation

覆盖：

- Prompt Injection；
- Board Poisoning；
- Malicious Agent；
- Compromised Tool Output；
- Cross-tenant Access；
- Approval Bypass；
- Stale Publication；
- Replay/Duplicate；
- Secret Leakage；
- Excessive Agency。

---

## Phase 7：明确暂缓能力

以下能力只有在前述阶段建立真实价值和安全证据后才考虑：

- Agent Long-term Memory；
- Project Shared Memory；
- Idle Agenda；
- Proactive Wake；
- Agent 自主创建任务；
- Agent 自主学习 Skill；
- Agent/Skill Marketplace；
- Workflow Marketplace；
- 自主创建 Agent Group；
- 自动策略优化；
- 全自动生产变更；
- 多组织联邦；
- 通用 MCTS 搜索引擎。

这些能力不得以“顺手补全架构”为由进入早期 Ticket。

---

# 18. 建议的第一个可执行增量

在 R002 基线上，下一条最小闭环建议只实现：

```text
One Case
One Fixed Workflow
One Typed Blackboard
Four Fixed Agent Profiles
One Human Approval
One Response Owner
One Artifact
One End-to-End Trace
```

具体范围：

1. 一条合成内部决策请求；
2. 一个 Case；
3. Evidence、Claim、Proposal、Critique、ArtifactRef 五类 Entry；
4. Researcher、Analyst、Reviewer、Writer 四个固定 Agent；
5. 一个固定 Workflow；
6. 一次信息追问和同 Run 恢复；
7. 一次 Human Approval；
8. Freshness + Dedup；
9. 一条最终回复；
10. 一个只读 Case 页面或调试视图。

明确不包含：

- 动态 Volunteer；
- 长期 Memory；
- Planner；
- Harness；
- GitHub；
- 多租户生产化；
- Agent/Skill 市场；
- 多副本；
- 通用 Workflow Builder。

这个增量的目标是验证：

> **共享 Typed Blackboard 是否比 Agent 间顺序摘要更能保留信息，并在不破坏 R002 可靠性边界的前提下形成可用 Artifact。**

---

# 19. AI 拆分 Release 和 Ticket 的规则

## 19.1 先编译行为，再拆实现

任何 Phase 或 Work Package 都不能直接变成一个“大 Ticket”。

顺序必须是：

```text
Vision Work Package
→ Release Frame
→ Scenario
→ Entry/Exit State or Artifact Handoff
→ Minimum Evidence
→ Delivery Spec
→ Candidate Tickets
→ Admission
→ Harness Execution
```

## 19.2 每个 Ticket 只处理一个主要 Seam

合理 Seam 示例：

- Case Resolver → Case Store；
- Board API → Board Store；
- Workflow Node → Context Assembler；
- Runtime Adapter → External Runtime；
- Response Gate → MagicChat Send；
- Planner → Admission Package；
- Harness → Case Projection。

避免一个 Ticket 同时修改：

```text
Schema + Router + Runtime + UI + Security + Deployment
```

## 19.3 Ticket 最小内容

每个实现 Ticket 至少包含：

```text
Objective
Authoritative Inputs
In Scope
Out of Scope
Producer
Consumer
State/Artifact Handoff
Failure Modes
Acceptance Tests
Rollback/Recovery
Dependencies
Evidence to Return
```

## 19.4 Ticket 大小约束

一个 Agent Ticket 应尽量满足：

- 一个主要行为目标；
- 一个主要状态所有者；
- 一到两个主要接口；
- 一个 Happy Path；
- 至少一个关键 Failure Path；
- 可独立验证；
- 不要求同时理解全部 Accord；
- 不引入没有消费者的抽象。

## 19.5 Enabler 必须有消费者

任何基础设施或抽象 Ticket 必须声明：

- 哪个后续 Scenario 使用它；
- Consumer Ticket；
- Exit Condition；
- 如果 Consumer 不再需要，是否删除。

禁止为“以后可能有用”提前建设：

- 通用 Event Bus；
- 通用 Workflow DSL；
- 通用 Agent Marketplace；
- 通用 Memory；
- 通用 Graph Engine；
- 通用 Multi-cloud Runtime。

## 19.6 AI 的停止条件

遇到以下情况，AI 应停止扩大实现并返回决策：

- Vision 与 Accepted ADR 冲突；
- 两个组件都声称拥有同一事实；
- 缺少明确 Human Approval Owner；
- 外部 Runtime 没有幂等或结果恢复契约；
- Board Entry 无法确定来源和信任级别；
- Ticket 同时跨越多个未决定技术边界；
- 需要选择生产技术栈但没有对应 Release/ADR；
- 需要真实数据、生产权限或外部写操作但没有授权；
- 为完成局部任务必须重写整个架构。

---

# 20. AI 实现行为准则

## 20.1 开始任务前

AI 应：

1. 读取根 `AGENTS.md`；
2. 读取当前 Accepted Release、Delivery Spec 或 Ticket；
3. 只读取相关 ADR；
4. 检查当前代码、配置、类型和测试；
5. 仅在需要长期边界时读取本文；
6. 明确任务影响哪个 Owner、Seam 和 Scenario。

## 20.2 实现过程中

AI 必须：

- 保持事实权威分离；
- 使用稳定业务 ID；
- 为副作用设计幂等和恢复；
- 把 Agent 输出视为候选；
- 使用 Typed Contract；
- 保存必要 Provenance；
- 控制上下文和权限；
- 不实现 Ticket 外的“完整未来架构”；
- 不把原型或研究结论冒充生产证据；
- 不静默改变 Non-goal。

## 20.3 完成任务后

AI 必须返回：

- 修改了哪些行为；
- 哪些行为未修改；
- 验证命令和结果；
- 产生的 Evidence；
- 失败和恢复测试；
- 未解决问题；
- 是否改变权威边界；
- 是否需要新 ADR；
- 是否影响后续 Ticket。

---

# 21. 常见错误方向

Accord 不应演变为以下形态：

## 21.1 一个全局大黑板

错误：

```text
所有租户、所有项目、所有 Agent 共用一个可读写状态池
```

正确：

```text
Tenant-scoped + Case-scoped + Policy-filtered Board
```

## 21.2 所有 Agent 监听所有消息

错误：

```text
用户发一句话 → 所有 Agent Wake → 所有 Agent 回复
```

正确：

```text
Wake → Case → Eligibility → Claim → One Response Owner
```

## 21.3 把黑板做成自由文本 Dump

错误：

```text
Agent 想写什么就写什么，后续把全部内容塞回 Prompt
```

正确：

```text
Typed Entry + Provenance + Relation + Trust + Scoped View
```

## 21.4 用 LLM 替代确定性控制

错误：

```text
LLM 决定权限、幂等、审批是否有效、执行是否完成
```

正确：

```text
LLM 生成候选判断；程序和权威系统执行控制
```

## 21.5 把 Case 做成另一个 Workflow

错误：

- Case 和 Workflow Run 同时拥有详细节点状态；
- 两套状态经常不一致。

正确：

- Case 是用户目标与协作容器；
- Workflow Run 是流程实例；
- Case 只投影粗粒度状态。

## 21.6 把 Memory 当作事实

错误：

- Agent 记忆覆盖 GitHub、Harness、Decision 或 Evidence。

正确：

- Memory 只帮助检索偏好、程序和历史线索；
- 使用前必须回到权威来源验证。

## 21.7 过早建设动态自治

错误：

- 第一阶段就允许 Agent 自主建群、装 Skill、创建任务和修改生产系统。

正确：

- 先建立固定受管闭环；
- 再用对照实验验证动态参与；
- 最后逐步扩大自治边界。

---

# 22. 关键架构决策摘要

1. **MagicChat-first，但产品核心对象是 Case。**
2. **Cumora 提供 Agent Identity、Wake、Claim、Session 和 Freshness 的协调语义。**
3. **黑板提供 Case 内的共享问题求解状态和开放探索能力。**
4. **Workflow Run 提供确定性步骤、Wait/Resume、Human Gate 和完成条件。**
5. **Cairn 的 Fact–Intent–Hint 适合开放探索，但 Accord 必须扩展为 Typed、Governed、Enterprise-safe Blackboard。**
6. **pi-ticket-planning 和 HerdrHarness-lite 保留领域事实与状态机。**
7. **GitHub 和外部企业系统继续拥有现实对象。**
8. **Agent 可以建议、研究和审查，但不能自行产生授权和现实结果。**
9. **动态参与采用 Bounded Opportunity，而不是无限广播和抢答。**
10. **Context Assembler 提供最小相关视图，不把完整历史注入模型。**
11. **所有用户可见输出必须经过 Response Claim、Freshness 和 Dedup。**
12. **长期自治、Memory 和 Marketplace 明确后置。**

---

# 23. 研究与参考方向

以下内容用于解释设计来源，不构成实现依赖或技术授权：

- Hayes-Roth：Blackboard Architecture for Control；
- LbMAS/bMAS：公共/私有黑板、动态 Agent 与控制单元；
- Data Science Blackboard：请求广播、能力自选和响应板隔离；
- SE-Blackboard：共享状态的信息保真度；
- Deterministic Blackboard Pipelines：共享状态与确定性调度的工业化组合；
- Terrarium：黑板的数据投毒、恶意 Agent 和通信攻击面；
- Cairn：Fact–Intent–Hint、OODA 和未知状态空间探索；
- Cumora：Agent Identity、Wake/Inbox、Freshness 和协作语义；
- MagicChat：企业身份、会话、App 和治理入口；
- Hermes：可选 Runtime、Profile 和通用任务板参考。

对外部项目只提取契约和设计思想，不默认复制其全部基础设施、License 义务或产品假设。

---

# 24. 最终北极星

```text
Conversation-first
Case-centered
Blackboard-informed
Workflow-governed
Agent-executed
Human-authorized
Authority-separated
Evidence-backed
Failure-recoverable
```

中文概括：

> **Accord 以企业会话为入口，以 Case 为产品中心，以受管黑板承载证据和中间解，以持久 Workflow 约束关键步骤，以专业 Agent 执行认知工作，以人工授权控制高风险决定，并由领域权威系统证明现实结果。**
