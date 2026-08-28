# Accord 愿景架构与实施地图

> **Accord — 企业级受管 Agent 协作与可信交付平台**  
> **Enterprise Governed Agent Collaboration & Trusted Delivery Platform**

---

## 文档元数据

- `status`: PRODUCT_VISION
- `authority_level`: DIRECTIONAL
- `decision_owner`: 产品负责人
- `last_updated`: 2026-08-28
- `recommended_path`: `docs/product/VISION.md`
- `scope`: Accord 长期产品目标、逻辑架构、不变量、Agent Execution Plane 边界与能力实施地图
- `not_a_substitute_for`: Accepted Release、Delivery Spec、Ticket、Accepted ADR、当前代码和测试
- `current_release_fence`: R003/r1
- `external_reference_added`: Lody at `LodyAI/Lody@953759639c59aa567628cb352477502b9d104080`

---

# 0. 如何使用本文档

## 0.1 本文档是什么

本文档用于回答：

1. Accord 最终要解决什么问题；
2. Accord 的目标产品形态是什么；
3. Case、Blackboard、Workflow、Agent 和 Runtime 如何分工；
4. Agent 身份、执行位置、持续委派和一次执行如何分离；
5. MagicChat、Lody、pi-ticket-planning、HerdrHarness-lite、GitHub 和企业系统如何保持事实权威；
6. 已知路径、开放探索、人工授权和外部副作用如何组合；
7. 后续能力应按什么顺序建设；
8. AI 在实现局部任务时，哪些边界不能破坏。

本文档是**长期方向说明和架构导航**，不是一次性实施规格。

## 0.2 本文档不是什么

本文档不是：

- 对全部目标能力的立即实施授权；
- 当前代码已经具备全部能力的证明；
- 对生产数据库、消息队列、部署形态或所有 Runtime 的最终决定；
- Accepted Release、Delivery Spec、Ticket 或 ADR 的替代品；
- 要求每次开发任务加载的完整上下文；
- 把外部参考项目变成 Accord 依赖的决定；
- 对当前 R003 边界的扩张授权。

任何实际实现都必须先由 Accepted Release、Delivery Spec 或 Ticket 缩小范围，并服从适用的 Accepted ADR、当前代码和测试。

## 0.3 权威按关注点分工

仓库不存在一个覆盖全部问题的单一文档优先级。不同事实由不同来源拥有：

| 关注点 | 权威来源 |
|---|---|
| 当前任务应产生什么行为 | Accepted Release、Delivery Spec 或 Ticket |
| 当前实现实际上如何工作 | 当前代码、配置、类型、迁移和测试 |
| 承重技术决策 | 适用的 Accepted ADR |
| 全局且不可从代码发现的不变量 | 根目录 `AGENTS.md` |
| 当前 Issue、PR、Label 和依赖关系 | GitHub |
| 当前执行、Attempt、Reviewer 和恢复事实 | 配置的 Harness |
| 企业身份、会话和可见消息 | MagicChat |
| 长期目标和方向一致性 | 本文档 |
| 外部项目事实与设计启发 | 带日期和 Commit 的研究材料 |
| 原型证明的局部行为 | 对应 Release、原型和证据记录 |

如果两个权威来源对**同一关注点**发生冲突，AI 不得自行选择一个覆盖另一个；应明确指出冲突并交还给对应所有者。

## 0.4 状态标签

本文使用以下标签：

- **[INVARIANT]**：长期必须保持的架构约束；
- **[TARGET]**：目标态能力，可能尚未实现；
- **[EVIDENCE]**：已有 Release、原型、测试或运行证据支持；
- **[HYPOTHESIS]**：产品或技术假设，必须通过试点验证；
- **[DEFERRED]**：有意暂缓，当前不得顺手实现；
- **[REFERENCE]**：外部项目可借鉴的行为或实现，不构成 Accord 能力；
- **[FENCE]**：当前 Release 明确禁止跨越的边界。

## 0.5 AI 阅读规则

AI 只有在以下任务中需要读取本文档：

- 新增产品能力；
- 设计跨组件架构；
- 创建新的 Release、Delivery Spec 或 Epic；
- 修改 Case、Blackboard、Workflow、Agent、Runtime、Authority、Approval 或 Outcome 边界；
- 设计 Lody、ACP、Pi、Codex、Hermes 或其他 Runtime 接入；
- 判断局部方案是否符合 Accord 长期方向。

小型 Bug 修复、局部重构和边界明确的 Ticket，不应默认加载本文全部内容。

## 0.6 最小阅读路径

| 任务类型 | 最小阅读范围 |
|---|---|
| 判断产品方向 | 0、1、3、4、23、26 |
| 设计总体架构 | 0、3、5、6、7、12、17 |
| 实现 Case/Blackboard | 3、7.1、7.2、8、18 中 CAS/BRD |
| 实现 Workflow/Agent | 3、7.3–7.8、9、10、18 中 WF/AGT/RTO |
| 接入 Lody 或其他 Runtime | 3.2、7.4–7.9、10、11、20 |
| 接入 Planner/Harness/GitHub | 3、12、14.2、18 中 INT |
| 设计动态多 Agent | 3.2、8、9、18 中 ACT |
| 拆分 Release/Ticket | 17、18、21、22 |
| 安全与生产加固 | 3、10、15、18 中 SEC/OPS |
| 当前 R003 实现 | 当前代码、`contracts/`、`migrations/`、`test/`；16.3、19 和 Accepted ADR-0002/0003 |

---

# 1. 产品愿景

## 1.1 一句话愿景

> **让企业员工用自然语言提出复杂目标，由受管 Agent 团队在一个可追踪的 Case 中协作，形成有证据、可审查、可审批、可交付并可验证结果的闭环。**

## 1.2 产品定位

Accord 不是单纯的：

- 聊天机器人；
- Agent 群聊；
- Coding Agent 客户端；
- Session 管理器；
- 工作流编辑器；
- 代码执行器；
- 共享记忆；
- 任务看板；
- 多模型代理网关。

Accord 是连接以下能力的企业级受管协调平面：

```text
自然语言协作入口
        +
Case 范围内的受管多 Agent 协作
        +
结构化共享问题求解状态
        +
确定性 Workflow 控制
        +
稳定 Runtime Operation
        +
人工决策、持续委派与审批
        +
领域权威系统中的可信执行
```

用户看到的是一个企业任务协作空间；系统内部使用 Case、Board、Workflow、Agent Activity、Runtime Operation 和领域控制器完成任务。

## 1.3 Accord 最终交付的不是“Agent 对话”

Accord 的最终价值对象是：

```text
Case
├── 明确目标
├── 经追问补全的约束
├── 可追溯证据
├── 结构化中间判断
├── 未解决问题
├── 候选方案与批评
├── 受约束的 Agent Activities
├── 可恢复的 Runtime Operations
├── 人工决策与审批
├── 最终 Artifact
└── 外部权威系统确认的 Outcome
```

Agent 对话、Runtime Session、Worktree 和 PR 都只是形成或执行这些对象的方式，不是 Accord 产品本身。

## 1.4 北极星结果

一个高质量 Accord Case 应满足：

- 用户不必理解底层 Agent、Prompt、Runtime、黑板或机器；
- 系统能说明当前目标、进展、阻塞、负责人和需要用户完成的动作；
- 重要结论能够追溯到来源、验证和决策；
- 不同 Agent 不因顺序摘要而丢失关键事实；
- 不会由多个 Agent 同时对用户重复回复；
- 人工输入后恢复原 Case 和原 Workflow Run；
- 一次性 Agent 选择不会被误当成长期自动化授权；
- Runtime 配置变化不会改变已接受的执行；
- 崩溃、重试和重放不会重复创建逻辑 Operation、Artifact 或发布；
- Runtime、GitHub、Harness 和业务系统仍拥有各自事实；
- 最终产物能够被真实采用，而不只是“生成了一篇内容”。

---

# 2. 要解决的核心问题

## 2.1 企业员工侧

企业员工面对复杂任务时，通常存在：

- 需要在多个 AI 平台和工具之间切换；
- 不知道应该选择哪个 Agent；
- 不清楚 Agent 使用了哪些数据、工具、模型、机器和权限；
- 多次对话形成的结论难以复用；
- 无法区分“Agent 已回答”和“现实工作已完成”；
- 无法知道某个结果是否基于最新输入；
- 无法安全地暂停、恢复、取消或接管任务；
- 生成内容缺少证据、审查和责任边界；
- 从“形成方案”到“真实执行”之间没有可信交接。

## 2.2 企业治理侧

企业缺少：

- 可统一管理的 Agent 身份；
- Agent 身份与机器、模型、凭据、运行配置的分离；
- 可撤销、可过期、可审计的持续委派；
- 可版本化的 Skill、工具、模型和权限策略；
- 数据访问、外发和执行权限控制；
- 多 Agent 协作过程可见性；
- 对事实、判断、决策、执行和结果的区分；
- 对成本、质量、安全和失败恢复的统一治理；
- Runtime 配置变化和重试时的语义稳定性。

## 2.3 多 Agent 架构侧

仅使用主从式或固定消息流水线会产生：

- 中央 Agent 必须知道所有子 Agent 的真实能力；
- 任务路径一旦开放，预定义流程容易僵化；
- Agent 之间逐级摘要会损失关键实体和限定条件；
- 多个 Agent 容易重复研究、并发碰撞或同时回复；
- 所有上下文持续堆积，造成成本和上下文污染；
- “多个 Agent 达成一致”不等于结论正确；
- 子 Agent Session 树容易成为隐式、不可治理的任务系统；
- Runtime Session 状态容易被误当成 Case 或现实结果。

Accord 需要同时保留：

```text
Blackboard 的共享状态与开放探索能力
        +
Workflow 的确定性、恢复与审批能力
        +
RuntimeOperation 的稳定执行和重试边界
```

三者不能互相替代。

---

# 3. 第一性原理与长期不变量

## 3.1 事实不变量

### INV-01：每类现实事实只有一个权威所有者

**[INVARIANT]**

- MagicChat 拥有企业身份、会话、消息、App 和可见交互；
- GitHub 拥有 Repository、Issue、PR、Commit、CI 和 Merge；
- HerdrHarness-lite 拥有正式 Delivery Ticket 的 Attempt、Reviewer、恢复和交付控制；
- pi-ticket-planning 拥有产品规划过程和 Admission 产物；
- Lody 拥有其 Session、机器、Worktree 和工作空间执行状态；
- 外部企业系统拥有其业务对象和确认结果；
- Accord 拥有 Case、Board、Workflow Run、Agent Activity、Delegation Grant、Runtime Operation、Work Claim、Response Claim 和审计关联。

Accord 可以保存外部事实的引用和投影，但不能成为第二个权威。

### INV-02：聊天不是任务事实源

**[INVARIANT]**

聊天用于提出目标、补充信息、追问、解释、选择、审批和告知结果。

正式任务状态必须进入 Case、Board、Workflow Run、Decision Record、Runtime Operation 或外部权威系统。

### INV-03：Agent 输出默认是候选判断，不是事实

**[INVARIANT]**

Agent 可以产生：

- Observation；
- Claim；
- Hypothesis；
- Proposal；
- Critique；
- Verification Result；
- Artifact Draft；
- Runtime Result Candidate。

Agent 不得仅凭自身输出创建：

- Human Decision；
- Approval；
- Delegation Grant；
- External Outcome；
- GitHub/Harness 已完成事实；
- 更高权限。

### INV-04：共享内容中的数据不自动成为指令

**[INVARIANT]**

文件、网页、邮件、聊天、工具输出、Board Entry、Runtime 输出和 Lody Session History 默认都是数据。

只有经过明确授权和策略校验的内容，才能作为系统指令、Workflow Definition、Skill、Tool Policy、Approval 或 Operator Action。

## 3.2 协作不变量

### INV-05：一条用户可见消息原则上只有一个 Response Owner

**[INVARIANT]**

其他 Agent 可以观察、贡献、请求证据、提交候选结果和参与审查，但只有持有有效 Response Claim 且通过 Freshness Gate 的主体可以发布当前回复。

### INV-06：Agent Session 必须隔离

**[INVARIANT]**

至少按以下逻辑键隔离：

```text
tenant + agent_profile + case + conversation
```

Workflow Run、Agent Activity、Runtime Operation、Runtime Session 和 Delivery Attempt 使用各自稳定标识。

不同 Agent 不共享隐式模型历史，不允许 Persona、Skill、工具结果和授权串线。

### INV-07：动态协作必须是受限的

**[INVARIANT]**

Accord 不采用“所有 Agent 收到所有消息并自由抢答”。

动态参与必须经过：

- Capability Eligibility；
- 权限检查；
- Delegation 或当前调用授权；
- 并发上限；
- 成本预算；
- Work Claim / Lease；
- 重复工作检测；
- Deadline；
- Cancellation；
- Response Owner 约束。

### INV-08：一次性选择不等于持续委派

**[INVARIANT]**

以下动作必须区分：

```text
这一次使用某 Agent
≠
允许该 Agent 在本 Case 中持续自动执行
≠
允许该 Agent处理未来同类 Case
≠
允许该 Agent执行高风险或生产副作用
```

持续委派必须由显式、可撤销、可过期、可审计的 Delegation Grant 表达。

## 3.3 控制不变量

### INV-09：已知路径使用确定性控制，未知路径允许受控探索

**[INVARIANT]**

适合确定性 Workflow 的环节：

- 输入完整性检查；
- Human Approval；
- Delegation Grant；
- Reviewer Gate；
- Ticket Admission；
- Publication；
- Merge；
- 外部系统写操作；
- Runtime Operation 接受与结果提交。

适合黑板和动态探索的环节：

- 研究；
- 调查；
- 风险发现；
- 假设形成；
- 方案搜索；
- 多源证据关联；
- 专家补充。

### INV-10：高风险副作用不能由 Agent 共识直接触发

**[INVARIANT]**

修改生产系统、创建正式交付状态、合并代码、发布版本、下发安全策略、对外发送敏感内容、扩大权限等动作必须经过领域控制器和授权门。

### INV-11：恢复和幂等优先于“看起来已经完成”

**[INVARIANT]**

系统必须使用稳定业务标识和确定性幂等键。

投递 Event ID 只代表一次投递，不应被假设为跨重放稳定身份。

对没有幂等或结果恢复契约的外部 Runtime，不得声称物理 exactly-once。

## 3.4 Runtime 不变量

### INV-12：Runtime Session 只是执行引用

**[INVARIANT]**

Runtime Session、Lody Session、Pi Session、Codex Thread 或其他执行会话不能成为：

- Case；
- Workflow Run；
- Decision；
- Approval；
- Delegation；
- Accepted Artifact；
- External Outcome。

### INV-13：Runtime Operation 必须先持久接受，再执行

**[INVARIANT]**

任何可能产生费用、文件改动、外部状态或副作用的 Runtime 调用，必须先形成持久 `RuntimeOperation`。

### INV-14：Operation 接受后必须冻结有效配置

**[INVARIANT]**

至少冻结：

- Agent Profile revision；
- Runtime Binding revision；
- model / mode；
- Skill bindings；
- Tool policy；
- permission mode；
- credential reference；
- Context Digest；
- output contract；
- budget；
- deadline。

后续编辑 Profile、Role 或 Binding 不得改变已接受 Operation 的恢复和重试语义。

### INV-15：稳定 Operation ID 不得绑定不同输入

**[INVARIANT]**

```text
same operation_id + same canonical input fingerprint
    → 恢复或返回同一个逻辑 Operation

same operation_id + different fingerprint
    → 拒绝并报告 identity conflict
```

### INV-16：不可用必须显式失败，不得静默 fallback

**[INVARIANT]**

机器、Agent Config、模型、权限模式、凭据或 Runtime 不可用时，必须返回明确原因。

不得静默切换到：

- 另一机器；
- 另一 Agent；
- 另一模型；
- 更宽松权限；
- 另一凭据；
- 本地或云端的不同执行表面。

## 3.5 上下文和状态不变量

### INV-17：Agent 读取任务相关视图，不读取完整历史堆积

**[INVARIANT]**

每次 Agent 调用只获得当前目标、节点职责、必要约束、相关 Entry、必要 Source/Artifact、输出契约、当前权限和预算。

不得默认注入全部聊天、全部 Board、全部 Session History、全部 Skill 和全部工具日志。

### INV-18：CRDT 不拥有治理控制事实

**[INVARIANT]**

CRDT 或 local-first 文档可以保存协作草稿、评论、标注、画布和 Presence。

它不能拥有：

- Approval；
- Work Claim；
- Response Claim；
- Budget 消耗；
- Workflow Completion；
- Accepted Artifact Revision；
- Runtime Operation 幂等；
- 外部副作用确认。

### INV-19：不持久化原始隐藏推理过程

**[INVARIANT]**

系统持久化结论、简洁理由、证据引用、假设、决策摘要、工具和执行记录，不要求保存模型原始隐藏 Chain-of-Thought。

---

# 4. 目标产品边界

## 4.1 Accord 应负责

**[TARGET]**

- 将自然语言请求关联到现有 Case 或创建新 Case；
- 维护 Case 的目标、参与者、Board、Workflow 和最终产物；
- 管理 Agent Profile、Runtime Binding、Delegation Grant、Capability、Skill Binding 和 Runtime Port；
- 选择确定性执行、受限动态参与或 Human Choice；
- 管理 Message Claim、Work Claim、Response Claim 和 Freshness；
- 管理 Runtime Operation 的接受、冻结、Attempt、恢复、取消和结果仲裁；
- 提供结构化共享求解状态；
- 对 Human Input、Approval、Decision 和 Delegation 进行精确关联；
- 连接领域控制器并展示权威结果；
- 保留端到端审计、成本、质量和恢复证据；
- 提供企业用户可理解的 Case Workspace。

## 4.2 Accord 不应负责

**[INVARIANT]**

- 复制 MagicChat 的身份、组织和会话系统；
- 复制 Lody 的 Session、机器、Worktree 或共享工作空间事实；
- 复制 GitHub 的代码协作事实；
- 复制 HerdrHarness-lite 的正式交付执行状态机；
- 把所有领域能力收进一个“大一统 Agent”；
- 把 Agent 群聊或 Session 树当成任务系统；
- 把向量数据库、长期 Memory 或 CRDT 当成 Blackboard 权威；
- 让 LLM 成为唯一调度器、权限检查器或完成判定器；
- 让一个万能 Handoff Schema 统一所有领域；
- 将 Coding 专用字段变成所有 Case 的强制核心字段；
- 第一阶段建设开放 Agent 市场、Skill 市场或自主学习系统。

---

# 5. 目标逻辑架构

```text
┌──────────────────────────────────────────────────────────────┐
│               MagicChat 企业协作与人工治理平面                │
│ 用户 / 组织 / SSO / 会话 / 文件 / App / Choice / Approval     │
└────────────────────────────┬─────────────────────────────────┘
                             │ Message / Event / Action
┌────────────────────────────▼─────────────────────────────────┐
│                    Accord Case Coordinator                    │
│ Wake Router / Case Resolver / Work Router / Response Owner    │
│ Policy / Budget / Freshness / Dedup                           │
└───────────────┬───────────────────────┬───────────────────────┘
                │                       │
┌───────────────▼──────────────┐  ┌─────▼──────────────────────┐
│   Governed Case Blackboard   │  │ Deterministic Workflow     │
│ Evidence / Observation       │  │ Definition / Run           │
│ Question / Intent            │  │ Node / Wait / Resume       │
│ Claim / Proposal             │  │ Human Gate / Retry         │
│ Critique / Verification      │  │ Completion Predicate       │
│ Artifact / Outcome Ref       │  │ Publication Policy         │
└───────────────┬──────────────┘  └─────┬──────────────────────┘
                │                       │
┌───────────────▼───────────────────────▼──────────────────────┐
│        Agent Activation / Delegation / Claim Controller       │
│ Capability / Current Authorization / Delegation Grant         │
│ Work Claim / Lease / Heartbeat / Budget / Cancellation        │
└────────────────────────────┬─────────────────────────────────┘
                             │ AgentActivity Contract
┌────────────────────────────▼─────────────────────────────────┐
│                Runtime Operation Controller                   │
│ Accept / Fingerprint / Freeze / Attempt / Recover / Cancel    │
│ Result Arbitration / Usage / Error / Audit                    │
└────────────────────────────┬─────────────────────────────────┘
                             │ RuntimeOperation Port
┌────────────────────────────▼─────────────────────────────────┐
│                     Agent Execution Plane                     │
│ AgentProfile / RuntimeBinding / ContextAssembler              │
│ Native LLM / Pi / Codex / Lody / Hermes / Other Adapters      │
└────────────────────────────┬─────────────────────────────────┘
                             │ Typed Domain Handoff / Ref
┌────────────────────────────▼─────────────────────────────────┐
│                      Domain Authorities                       │
│ pi-ticket-planning / HerdrHarness-lite / GitHub               │
│ Release / CI / 工单 / 安全平台 / 企业知识库 / 业务系统          │
└──────────────────────────────────────────────────────────────┘

Cross-cutting:
Audit / Provenance / Security / Cost / Evaluation / Recovery
```

---

# 6. 各层职责

| 层 | 拥有的核心问题 | 不拥有的内容 |
|---|---|---|
| MagicChat | 人是谁、App 是谁、会话在哪里、谁可见、谁能做人工选择 | Agent 求解状态、正式交付事实 |
| Case Coordinator | 事件属于哪个 Case、谁参与、谁负责回复 | 领域执行结果 |
| Case Blackboard | 当前知道什么、依据是什么、还有什么未知、有哪些候选解 | 外部系统真实状态 |
| Workflow Run | 哪些步骤必须发生、当前等待什么、如何恢复和完成 | Agent 长期身份、GitHub/Harness 状态 |
| Activation Controller | 哪个 Agent 可以参加、当前是否获授权、如何 Claim | Human Approval 和领域完成事实 |
| Runtime Operation Controller | 本次执行是否被接受、配置是否冻结、如何恢复和提交结果 | 外部业务 Outcome |
| Agent Execution Plane | 如何调用模型、Skill、工具、机器和 Runtime | 企业身份、最终事实权威 |
| Lody | Coding Session、机器、Worktree、共享执行工作空间 | Accord Case、Approval、Harness/GitHub 权威 |
| Domain Authorities | 规划、代码、交付、CI 或业务操作真实发生了什么 | 通用 Agent 协作 |
| Audit/Evaluation | 如何证明过程、成本、质量和恢复结果 | 替代任何业务权威 |

---

# 7. 核心产品对象

## 7.1 Case

> **Case 是围绕一个用户目标形成的、可持续恢复的受管协作边界。**

一个 Case 可以跨越多条会话消息、多个 Agent、一个或多个 Workflow Run、多次 Human Input、多个 Runtime Operation、多个 Artifact 和多个外部领域对象。

概念模型：

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

Case 状态只提供粗粒度用户视图：

```text
OPEN
ACTIVE
WAITING_HUMAN
PAUSED
COMPLETED
CANCELLED
ARCHIVED
```

详细执行状态由 Workflow Run、Agent Activity、Runtime Operation 和领域系统拥有。

## 7.2 Board Entry

Board Entry 是 Case 范围内的结构化共享求解单元。

```text
BoardEntry {
  id
  tenant_id
  case_id
  type
  status
  payload
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

Agent 不能直接把 Entry 标记为 Human Decision、Approval 或 External Outcome。

## 7.3 Workflow Definition / Run

Workflow Definition 声明必须发生的步骤；Workflow Run 是具体 Case 中的持久实例。

```text
WorkflowDefinition {
  id
  version
  eligible_case_types
  nodes[]
  entry_conditions
  node_input_query
  node_output_contract
  human_gates
  side_effect_policy
  budget_policy
  failure_policy
  completion_predicate
  publication_policy
}
```

## 7.4 Agent Profile

Agent Profile 描述“它是谁、声明什么能力、受什么治理”，不直接包含执行机器和秘密。

```text
AgentProfile {
  id
  tenant_id
  name
  role
  description
  capabilities[]
  model_policy
  tool_policy
  memory_policy
  collaboration_policy
  skill_bindings[]
  visibility_scope
  status
  revision
  digest
}
```

角色用于人类理解，Capability 用于机器路由。

## 7.5 Runtime Binding

Runtime Binding 描述“它在哪里、通过什么 Runtime 可以执行”。

```text
RuntimeBinding {
  id
  tenant_id
  agent_profile_id
  runtime_adapter_id
  machine_or_pool_ref
  agent_config_ref
  supported_capabilities[]
  availability_state
  credential_ref
  permission_mode
  revision
  digest
}
```

`credential_ref` 指向受管秘密系统；共享 Profile、Board 或 Role 不保存秘密。

## 7.6 Delegation Grant

Delegation Grant 表达持续自动化授权：

```text
DelegationGrant {
  id
  tenant_id
  granted_by
  grantee_agent_profile_id
  scope
  allowed_case_types[]
  allowed_capabilities[]
  allowed_actions[]
  max_cost
  max_concurrency
  valid_from
  valid_until
  revocable
  policy_revision
  status
}
```

一次性调用授权可以存在于 Workflow Node 或 Agent Activity，不应自动创建持久 Delegation Grant。

## 7.7 Agent Activity

Agent Activity 表达某个 Agent 在 Case 中承担的一次受限贡献：

```text
AgentActivity {
  id
  case_id
  workflow_run_id
  node_id
  agent_profile_id
  purpose
  input_contract
  output_contract
  authorization_ref
  work_claim_ref
  state
  created_at
  completed_at
}
```

一个 Activity 可以产生一个或多个 Runtime Operation，但应有明确重试和并发策略。

## 7.8 Runtime Operation

Runtime Operation 是外部执行的稳定逻辑边界：

```text
RuntimeOperation {
  id
  tenant_id
  case_id
  workflow_run_id
  workflow_node_id
  agent_activity_id

  kind
  canonical_input
  input_fingerprint

  agent_profile_id
  agent_profile_revision
  runtime_binding_id
  runtime_binding_revision
  frozen_policy_snapshot
  context_digest
  output_contract_digest

  deadline
  budget
  state

  accepted_at
  materialized_at
  completed_at

  runtime_session_ref
  result_digest
  usage
  error
}
```

建议状态：

```text
ACCEPTED
MATERIALIZING
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
UNKNOWN
EXPIRED
```

物理执行重试使用 `RuntimeAttempt`，不改变逻辑 Operation 身份。

## 7.9 Runtime Session Ref

```text
RuntimeSessionRef {
  runtime_adapter_id
  external_session_id
  machine_ref
  workspace_ref
  worktree_ref
  transcript_ref
  status_observed_at
}
```

它只保存稳定引用和必要投影，不复制外部 Runtime 的完整事实。

## 7.10 Artifact 与 Outcome

Artifact 是 Accord 或 Agent 形成的产物；Outcome 是外部权威系统确认的现实结果。

```text
Artifact
    报告、方案、Delivery Spec、代码候选、Patch、PR Ref 等

ExternalOutcomeRef
    GitHub Merge、Harness Delivery Result、工单完成、策略下发结果等
```

Artifact 不因生成完成自动变成 Accepted；Outcome 不因 Agent 声称完成自动成立。

---

# 8. 受管 Case Blackboard

## 8.1 黑板的准确位置

> **黑板是 Case 范围内的结构化共享问题求解状态，不是全局聊天池、长期记忆库、CRDT 文档或所有数据的副本。**

它解决：

- 多 Agent 信息保真；
- 中间状态可见；
- 证据和判断分离；
- 开放问题渐进求解；
- 并行贡献；
- 冲突与验证；
- 最终产物可追溯。

## 8.2 逻辑区域

### Evidence Board

保存原始目标、文件、网页、数据库、工具来源、摘要、Digest、时间、权限、信任级别和外部事实引用。

### Reasoning Board

保存 Observation、Question、Intent、Claim、Hypothesis、Proposal、Critique、VerificationResult 和 Unknown。

### Control Board

保存 Work Opportunity、Work Claim、Lease、Heartbeat、Budget、Deadline、Freshness、Cancellation、Retry 和 Hold。

Control Board 主要由确定性程序管理。

### Decision Board

保存 Human Decision、Approval、Rejection、Accepted Artifact、External Outcome Ref 和领域 Gate 引用。

### Agent Private Workspace

保存 Agent 私有草稿、Runtime 临时文件和局部检索缓存。私有空间不能绕过 Case Policy 或直接产生正式 Decision。

### Response Board / Request Inbox

隔离结构化请求、候选响应、accept/decline 和重复检测，避免所有 Agent 相互读取未筛选响应。

## 8.3 Entry 类型

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
| `ApprovalRef` | 对审批记录的引用 | 高 |
| `ArtifactRef` | 产物引用 | 取决于状态 |
| `OutcomeRef` | 外部权威系统确认的结果 | 最高 |
| `ControlEvent` | Claim、Hold、Cancel、Budget 等控制事实 | 系统权威 |

## 8.4 生命周期

```text
PROPOSED
ACTIVE
CHALLENGED
VERIFIED
REJECTED
SUPERSEDED
EXPIRED
```

已有 Entry 原则上不原地覆盖。修订通过新版本、`supersedes` 和审计事件表达。

## 8.5 事实层级

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

## 8.6 Blackboard View 与 Context Assembler

Agent 不直接读取完整黑板。

Context Assembler 根据：

```text
Agent Profile
Runtime Operation Purpose
Current Case
Current Workflow Node
Objective
Capability
Tool / Skill Policy
Visibility
Trust Level
Relevant Entry Graph
Token / Cost Budget
Freshness Revision
```

构建最小视图，并记录选中的 Entry ID、revision、digest 和 Context Digest。

---

# 9. Workflow、Activation 与黑板的关系

## 9.1 三者职责

```text
Blackboard
    当前知道什么、还缺什么、有哪些候选解

Workflow Run
    哪些步骤必须发生、当前等待或执行什么

Activation Controller
    哪个 Agent 可以参加、本次是否获授权、如何 Claim
```

## 9.2 三种调度模式

### Deterministic Assignment

明确指定执行主体，适用于 Normalizer、Reviewer、Approval、Publication、Admission 和外部写操作。

### Bounded Opportunity

向有限 Agent 集合发布结构化机会，适用于 Research、Investigation、Evidence Discovery、Risk Analysis 和 Proposal Generation。

### Human Choice

由人选择 Agent、方案或下一步，适用于高风险、高成本、低置信度和边界不清场景。

## 9.3 Wait 与 Resume

Human Input、Approval 或外部回调必须恢复同一个 Run。

等待状态至少保存：

```text
run_id
case_id
waiting_node
expected_actor
expected_input_contract
correlation_key
expiration
resume_policy
```

## 9.4 Claim 类型

### Message Claim

谁负责处理当前消息事件。所有者：Case Coordinator。

### Work Claim

谁处理某个 Intent、Question 或 Opportunity。所有者：Activation Controller。

### Runtime Materialization Claim

谁负责把已接受 Operation 物化为外部 Runtime Session 或调用。所有者：Runtime Operation Controller。

### Delivery Ticket Claim

谁执行正式 Delivery Ticket。所有者：HerdrHarness-lite。

四者不得互相替代。

---

# 10. Runtime Operation 生命周期

## 10.1 接受顺序

```text
Workflow Node authorizes AgentActivity
        ↓
resolve AgentProfile + RuntimeBinding + current authorization
        ↓
assemble minimal context
        ↓
canonicalize operation command
        ↓
persist RuntimeOperation in ACCEPTED
        ↓
freeze revisions, policy, context, deadline and budget
        ↓
claim materialization
        ↓
create/invoke external Runtime
        ↓
persist external Session Ref
        ↓
collect bounded result
        ↓
validate schema and freshness
        ↓
commit one winning result
        ↓
write Board entries / Artifact refs
```

不得先创建 Session 或调用模型，再补写 Operation。

## 10.2 Operation Identity

Operation ID 必须稳定，并和 Case、Run、Node、Activity 关联。

规范化输入后生成 fingerprint。重复请求：

- 相同 ID 和 fingerprint：返回当前状态或恢复；
- 相同 ID 和不同 fingerprint：拒绝；
- 不同 ID：视为不同逻辑 Operation，即使 Prompt 相同。

## 10.3 配置冻结

Operation 接受时冻结：

```text
Agent Profile revision
Runtime Binding revision
Runtime Adapter version
machine / pool reference
agent config reference
model / mode
permission mode
Skill versions
Tool policy
credential reference
Context Digest
output schema
budget
deadline
```

冻结的是引用和有效配置，不是秘密明文。

## 10.4 Attempt 与未知结果

外部 Runtime 可能无法保证物理 exactly-once。

当超时或崩溃导致结果未知：

```text
Operation = UNKNOWN 或仍处于可恢复状态
Attempt = UNKNOWN
```

只有在 Release 的失败策略允许时，才能在同一逻辑 Operation 下创建有限的新 Attempt。

迟到、重复、分歧或过期结果保留为审计，不可再次写入 Board。

## 10.5 取消

取消必须区分：

- 请求停止外部运行；
- 本地不再接受结果；
- Session 是否仍存在；
- 文件改动是否需要回滚；
- 外部副作用是否已发生；
- Case/Workflow 如何进入 Hold、Failure 或 Human Review。

## 10.6 输出边界

Runtime 输出、Session History、Diff、日志和文件清单必须有大小限制。

截断必须明确包含：

- `truncated=true`；
- 省略量；
- 继续读取的引用或分页方式。

---

# 11. Lody 在 Accord 中的准确位置

## 11.1 Lody 是什么

**[REFERENCE]**

Lody 是面向 Coding Agent 的共享执行工作空间。其公开能力包括：

- ACP Agent 接入；
- 本地和远程机器；
- Session 创建、追加指令、状态、历史、取消和归档；
- Agent Role；
- Task 与 Session 关联；
- 机器侧任务自动化；
- Git Worktree；
- Diff、Preview、PR 和 CI 邻接体验；
- 桌面、Web、移动端和 CLI；
- 基于 Loro/Flock 的 local-first 协作方向。

## 11.2 正确定位

```text
Accord
    企业 Case 治理与可信协调平面

Lody
    可选 Coding Agent Runtime 与共享执行工作空间
```

Lody 可以成为 `AgentExecutionPlane` 的一个 Runtime Adapter，也可以为 Coding Case 提供用户可见执行面板。

Lody 不拥有：

- Accord Case；
- Governed Blackboard；
- Workflow Run；
- Human Approval；
- Delegation Grant；
- Accepted Artifact；
- Harness Delivery；
- GitHub Merge；
- External Outcome。

## 11.3 可借鉴的设计

- Task 表达意图、Session 表达执行；
- Agent Role 是版本化配置，不是活跃 Agent；
- Role 不保存秘密；
- 精确绑定机器与 Agent Config；
- 不可用时明确失败；
- Operation 接受后冻结配置；
- Stable Operation ID 和输入指纹；
- 后台机器侧调度；
- Session 批量创建、状态和结果查询；
- Worktree 隔离；
- Platform Capability 而不是 build-kind 分支；
- 工作空间和执行过程跨端可见。

## 11.4 不直接继承

- Session 作为 Accord 产品中心；
- Lody Task 直接替代 Case；
- Loro/Flock 作为治理控制平面权威；
- Coding 字段进入所有 Case 核心 Schema；
- Lody Review 替代 HerdrHarness-lite；
- Lody PR 状态替代 GitHub；
- 未公开托管后端成为 Accord 必选依赖；
- Lody 的内部表和 DTO 直接成为 Accord 跨进程协议。

## 11.5 Lody Adapter 最小接口

概念接口：

```text
AgentRuntimePort {
  acceptOperation(input) -> AcceptedOperation
  getOperation(operationId) -> OperationSnapshot
  cancelOperation(operationId) -> CancelResult
  collectResult(operationId) -> RuntimeResult
}
```

Lody Adapter 对 Accord 暴露：

```text
operation_id
runtime_status
external_session_ref
machine_ref
workspace_ref
worktree_ref
bounded_output
artifact_refs
usage
error
observed_at
```

不暴露或不要求 Accord 理解：

- Loro 内部结构；
- Flock row family；
- Daemon 私有 IPC；
-完整 Session 数据库；
-具体 Agent 的本地文件格式；
-私有 Cloud Backend。

## 11.6 CRDT 边界

Lody 的 local-first 和 CRDT 方向适合借鉴到：

- 协作草稿；
- 评论和行级标注；
- Case Canvas；
- Presence；
- 非权威用户偏好；
- 离线编辑。

治理事实仍由当前 Release 和 ADR 选定的事务权威拥有。

---

# 12. Domain Authority 与 Handoff

## 12.1 MagicChat

负责企业身份、组织、App、会话、消息、文件入口、Human Choice/Approval UI 和可靠事件投递。

Accord 通过正式 App 协议接入，不直接依赖 MagicChat 数据库完成应用行为。

## 12.2 pi-ticket-planning

负责产品目标到 Release、Scenario、Candidate Ticket 和 Admission Package 的规划领域状态。

Accord 启动、展示和关联 Planner 结果，不在通用 Board 中重建 Planner 状态机。

## 12.3 HerdrHarness-lite

负责正式 Delivery Ticket Claim、Worker/Reviewer/Analyst Attempt、阻塞、恢复、验证和 Merge 控制。

Accord 投影状态、承载精确 Operator Action，并关联 Ticket、Attempt、PR、Commit 和 Outcome。

## 12.4 GitHub

负责 Repository、Issue、PR、Commit、Branch、CI 和 Merge。

Accord 保存稳定引用、必要投影、读取时间和 Digest。

## 12.5 Lody

负责其 Workspace、Machine、Agent Config、Agent Role、Task、Session、Worktree 和执行过程。

Accord 通过 Adapter 引用这些对象，不直接写入或复制内部权威。

## 12.6 Handoff 类型

至少区分：

1. **Agent Collaboration Handoff**  
   Case 内围绕 Board Entry 的 consult、review、evidence-request。

2. **Runtime Operation Handoff**  
   Accord 向 Agent Runtime 提交稳定、冻结、可恢复的执行。

3. **Planning → Delivery Handoff**  
   Planner 产生 Admission Plan、Envelope、Manifest 和 Fingerprint。

4. **Delivery Attempt Handoff**  
   Harness 内 Worker、Reviewer、Analyst 之间的 Attempt Context。

5. **External System Action Handoff**  
   面向工单、安全设备或业务系统的授权动作契约。

所有 Handoff 引用权威对象，而不是复制其全部状态。

---

# 13. 用户产品形态

## 13.1 用户不应看到内部架构术语

用户核心对象建议命名为：

- `Case Workspace`
- 中文：`任务工作区`、`协作任务空间` 或场景化名称

用户不需要先理解 Blackboard、Runtime Operation、Lease 或 Adapter。

## 13.2 推荐界面结构

```text
┌──────────────┬──────────────────────────────┬──────────────┐
│ 对话与补充输入 │          Case Workspace      │ Agent 与控制  │
│              │                              │              │
│ 用户消息      │ 目标与当前状态                │ Response Owner│
│ Agent 追问    │ 已确认事实与来源              │ 参与 Agent    │
│ Human Choice │ 未解决问题                    │ Work Claim    │
│ Approval     │ 候选方案、批评与验证           │ 预算与进度     │
│              │ 决策与最终产物                │ 阻塞与等待     │
├──────────────┴──────────────────────────────┴──────────────┤
│ Timeline / Workflow / Operations / Audit / Outcomes         │
└─────────────────────────────────────────────────────────────┘
```

## 13.3 Coding Case 可选面板

当 Case 使用 Lody 或其他 Coding Runtime 时，可以增加：

- Session 状态；
- 机器和 Agent；
- Worktree；
- Diff；
- Preview；
- PR/CI 引用；
- 权限请求；
- Runtime 用量。

这些是可选领域面板，不是通用 Case 核心。

## 13.4 默认展示

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
- 外部 Outcome。

默认隐藏：

- 重复 Agent 消息；
- 低价值内部讨论；
- 原始隐藏推理；
- 无关工具日志；
- 已被 Supersede 的噪声；
- 私有 Runtime 临时文件；
- Adapter 内部实现细节。

---

# 14. 目标端到端场景

## 14.1 场景 A：内部决策方案

```text
用户在 MagicChat 提出目标
→ Case Resolver 创建 Case
→ 固定 Workflow
→ 信息不足，进入 WAITING_HUMAN
→ 用户补充，恢复同一 Case/Run
→ Researcher 写 Evidence
→ Analyst 写 Claim/Proposal
→ Reviewer 写 Critique/Verification
→ Writer 生成 Artifact
→ Human Approval
→ Response Claim + Freshness
→ 唯一发布
```

## 14.2 场景 B：产品规划到软件交付

```text
用户提出产品方向
→ Planning Case
→ pi-ticket-planning 形成 Release/Scenario/Ticket
→ Human 审查
→ Admission Package
→ GitHub 正式对象
→ HerdrHarness-lite 执行
→ PR / CI / Merge
→ Harness 返回 Outcome
→ Accord 展示目标到结果的证据链
```

## 14.3 场景 C：开放式安全研究

```text
用户定义 Origin、Goal、Scope 和授权
→ Case 建立 Evidence/Intent Graph
→ Activation Controller 发布受限机会
→ Agent 认领不同 Intent
→ 验证结果写回 Board
→ Reviewer/Verifier 处理冲突
→ 达到 Goal、预算耗尽或 Human Stop
→ 形成受控报告和证据
```

## 14.4 场景 D：受管 Coding Agent 执行

**[TARGET AFTER R003]**

```text
用户在 MagicChat 提出受限 Coding 目标
→ Accord 创建 Case
→ Workflow 形成 Coding AgentActivity
→ 检查一次调用授权或 DelegationGrant
→ 创建并持久化 RuntimeOperation
→ Lody Adapter 创建/恢复 ACP Session
→ Agent 在隔离 Worktree 中执行
→ Lody 返回 SessionRef、Diff/ArtifactRef
→ Reviewer 或 Harness 执行正式验证
→ Human Gate
→ GitHub/Harness 确认 PR、CI、Merge Outcome
→ Accord 发布唯一结果
```

关键约束：

- Lody Session 不是 Case；
- Lody Task 不是正式 Delivery Ticket；
- Runtime 完成不等于 Merge；
- Diff 是 Artifact Candidate；
- GitHub/Harness 仍拥有正式交付事实；
- 相同 Operation 重放不能创建第二个逻辑执行；
- Role 或 Binding 修改不能改变已接受 Operation；
- Runtime 不可用时不得静默切换。

---

# 15. 横切能力

## 15.1 安全与治理

目标能力：

- Tenant、Case、Agent、Entry、Operation 级授权；
- 数据分级和可见范围；
- Tool、Model、Skill、Runtime 白名单；
- Runtime Binding 和 Credential Reference；
- 网络外发和域名策略；
- Untrusted Content 标识；
- Prompt Injection 隔离；
- Board Poisoning 检测；
- Agent/Profile/Skill/Workflow/Binding 版本锁定；
- Human Approval；
- Delegation 管理；
- 全链路审计；
- 数据保留和清理。

## 15.2 可靠性

目标能力：

- Durable Inbox/Outbox；
- Stable Message/Case/Run/Activity/Operation ID；
- Input Fingerprint；
- Frozen Configuration；
- Deterministic Idempotency Key；
- 原子状态更新；
- Crash Recovery；
- Replay；
- Lease/Heartbeat；
- Retry Budget；
- Cancellation；
- Freshness Hold；
- Duplicate Publication Prevention；
- External Runtime Result Recovery；
- No Silent Fallback；
- Unknown Outcome Handling。

## 15.3 可观测性

每次 Case 至少可以关联：

```text
tenant
conversation
source_message
case
workflow_definition
workflow_run
node
agent_profile
runtime_binding
delegation_grant
agent_activity
runtime_operation
runtime_attempt
runtime_session_ref
skill
model
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

## 15.4 质量与产品指标

优先衡量：

- 最终产物采用率；
- 人工修改量；
- 关键事实保留率；
- 来源覆盖率；
- 引用正确率；
- 冲突发现率；
- 重复工作率；
- 路由正确率；
- Wait/Resume 成功率；
- 重复 Case/Run/Operation/回复率；
- Stale Output Hold 率；
- Runtime Unknown Outcome 率；
- 配置冻结一致性；
- 非法 fallback 拦截率；
- 越权读写和外发事件；
- 端到端成本与延迟；
- 外部 Outcome 完成率。

不应只衡量 Agent 数量、对话轮数、生成字数或多 Agent 的“热闹程度”。

---

# 16. 当前证据、Release 与目标态

## 16.1 R001

**[EVIDENCE] [HOLD]**

固定合成场景证明了追问、同 Run 恢复、Agent 节点、Human Approval 和唯一发布的逻辑原型。

## 16.2 R002

**[EVIDENCE] [HOLD r3]**

真实 MagicChat App WebSocket 边界证明了稳定身份、等待恢复、确定性回写和 post-send crash/replay 等外部可靠性语义。

证据包括稳定 Message ID/cursor 与可变 Event ID 的分离、原子 Run Store、确定性回写 ID、`message.send` 成功后崩溃的重放恢复，以及最终唯一 Run、逻辑 Stub Runtime 结果和用户可见消息。

后续 Release 继承外部行为约束，不继承 R002 Go Harness、Atomic JSON Store 和内部模块划分。

## 16.3 R003

**[FENCE] [COMMITTED]**

R003 精确范围：

```text
One Synthetic Case
One Fixed Workflow
One Typed Blackboard
Four Fixed Profiles
One Native LLM Turn Adapter
One Human Approval
One Response Owner
One Artifact
One Trace
One Process / One Replica / Accord-owned SQLite WAL
```

R003 不包含：

- Lody；
- ACP；
- Remote Machine；
- Worktree；
- CRDT；
- Agent Role catalog；
- Runtime Binding catalog；
- Delegation automation；
- Dynamic Agent Activation；
- Planner/Harness 正式集成；
- 通用 Runtime 平台；
- 多租户或多副本生产基础设施。

截至 `main@d932b21`，仓库已合入 TypeScript/SQLite authority core、MagicChat ingress/wait-resume 和 `RESEARCHER` → `ANALYST` Runtime recovery 三个实现切片。它们证明代码、契约、迁移和确定性测试语义，不证明 trusted local qualification、真实 MagicChat 资源、真实模型调用或 S1–S4，也不证明 R003 已完成。

## 16.4 Lody 研究证据

**[REFERENCE]**

基于 `LodyAI/Lody@953759639c59aa567628cb352477502b9d104080`，已确认其公开仓库具有：

- Session、Task、Agent Role 和 Worktree 概念；
- ACP 与多 Agent Config；
- Session create/chat/cancel/status/history 等 MCP 工具；
- Stable Operation Store、输入 fingerprint、冻结配置、deadline 和 completion delivery；
- 机器侧 Task 自动化；
- Loro/Flock local-first 协作；
- Code Review、Diff、PR 邻接能力。

这些事实只证明 Lody 的公开实现，不证明其适合 Accord、生产稳定、私有后端可部署或能满足企业治理要求。

## 16.5 尚未证明

**[HYPOTHESIS]**

- 真实员工采用率；
- Blackboard 相对顺序摘要的质量收益；
- 动态激活收益；
- 多 Runtime 恢复；
- Lody Adapter 的兼容性和可治理性；
- ACP Agent 在目标模型、机器和权限下的稳定性；
- Lody 与 Harness/GitHub 的正式权威分离；
- 多副本和生产持久化；
- 完整企业威胁模型；
- 长期成本和运维能力。

---

# 17. 实施总图

以下是能力实施顺序，不是 Accepted Release 编号：

```text
Phase 0  权威、外部行为约束与文档导航
   │
   ▼
Phase 1  Case + Typed Blackboard Foundation
   │
   ▼
Phase 2  Fixed Governed Collaboration（当前 R003）
   │
   ├──────────────► Phase 4A  Domain Authority Integrations
   │
   ▼
Phase 3  Blackboard Governance + Context Engineering
   │
   ├──────────────► Phase 4B  RuntimeOperation Foundation
   │                                  │
   │                                  ▼
   │                         Phase 4C  Lody Adapter Spike
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

原则：

- R003 先闭环，不因 Lody 研究扩张；
- RuntimeOperation Foundation 可以在 R003 后独立形成 Release；
- Lody Adapter 必须建立在稳定 Operation 契约之上；
- Domain Authority Integration 不要求先完成动态 Agent；
- CRDT 协作层只能在治理权威边界明确后引入。

---

# 18. 大块实现任务拆解

每个 Work Package 必须先编译成独立 Release/Delivery Spec，再拆成 Ticket。

## Phase 0：权威与导航

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

确保 README、AGENTS、VISION、Release、ADR 和研究材料职责清晰。

## Phase 1：Case 与 Blackboard

### CAS-01：Case Identity 与 Lifecycle

建立独立于 Conversation、Task、Workflow 和 Session 的 Case。

### BRD-01：Typed Board Entry

定义 Entry 类型、Provenance、Trust、Visibility、Instruction Authority 和关系。

### BRD-02：Append-only Board Store

支持 revision、冲突检测、Replay、Projection 和审计。

### BRD-03：Scoped Board View

按 Agent、节点、权限和相关图返回最小视图。

## Phase 2：固定受管协作

### WF-01：Workflow Definition / Run

持久节点、Wait/Resume、Retry/Cancel、Human Gate 和 Completion Predicate。

### AGT-01：固定 Agent Profile

支持 Researcher、Analyst、Reviewer、Writer，隔离 Session，锁定版本。

### CTX-01：Context Assembler V1

构建最小上下文并记录 Context Digest。

### HUM-01：Human Input / Approval

精确关联 Actor、Case、Run、Node、Artifact Revision 和 Expiration。

### RSP-01：Response Claim / Freshness / Dedup

保证唯一、最新、可恢复发布。

### PILOT-01：R003 固定内部决策闭环

只验证 R003 已承诺行为。

## Phase 3：治理与上下文工程

### GOV-01：Duplicate / Contradiction / Supersession

控制黑板污染和重复。

### GOV-02：Trust / Instruction Boundary

隔离 Prompt Injection 和不可信内容。

### CTX-02：Relevance / Compaction / Snapshot

控制长期 Case 上下文成本。

### OBS-01：Quality / Cost / Trace

建立可比较的质量、成本和恢复证据。

## Phase 4A：领域权威接入

### INT-01：MagicChat Production Adapter Boundary

### INT-02：pi-ticket-planning Adapter

### INT-03：GitHub Projection

### INT-04：HerdrHarness-lite Adapter

### INT-05：Planning-to-Delivery Trace

## Phase 4B：RuntimeOperation Foundation

### RTO-01：Runtime Operation Contract

**目标**

建立独立于具体 Runtime 的稳定执行对象。

**必须包含**

- Stable Operation ID；
- Canonical Input；
- Fingerprint；
- Frozen Config；
- Deadline / Budget；
- State；
- Attempt；
- Result Arbitration；
- Cancellation；
- Unknown Outcome；
- Audit。

**验收**

- 相同 ID 和输入恢复原 Operation；
- 相同 ID 和不同输入被拒绝；
- 外部调用前 Operation 已持久；
- Profile/Binding 修改不影响已接受 Operation；
- 迟到和重复结果不能二次提交；
- 无结果恢复能力时诚实标记 UNKNOWN。

### RTO-02：Agent Profile / Runtime Binding 分离

**验收**

- Profile 不保存秘密和机器；
- Binding 明确 Runtime、机器、Agent Config、权限和 Credential Ref；
- 不可用时不静默 fallback；
- Binding revision 进入 Operation Snapshot。

### DLG-01：Delegation Grant

**验收**

- 一次性选择与持续委派分离；
- Grant 有 Owner、Scope、限额、期限、撤销和审计；
- Agent 不能自授权；
- 高风险动作仍需要独立 Human Gate。

### RTO-03：Generic Runtime Adapter Port

定义 `accept/get/cancel/collect` 等窄契约，不统一各 Runtime 内部行为。

## Phase 4C：Lody Adapter Spike

### INT-06：Lody Runtime Adapter

**范围**

- 一个非生产 Coding Case；
- 一个固定 Agent Profile；
- 一个固定 Runtime Binding；
- 一个 Lody Agent Role 或 Agent Config；
- 一个 Worktree；
- 一个 Runtime Operation；
- 一个 Session；
- 一个受控结果；
- 一个失败和恢复路径。

**明确不做**

- 替代 Harness；
- 自动 Merge；
- Lody Task 成为 Case；
- Loro/Flock 成为 Accord DB；
- 动态 Agent；
- 多机器调度平台；
- Lody 核心 Fork；
- 依赖未公开 Cloud Backend。

### PILOT-03：Lody Integration Evidence

验证：

1. Operation 重放不创建第二个逻辑执行；
2. Role/Binding 修改不影响已接受 Operation；
3. Runtime 不可用不 fallback；
4. Accord 崩溃后能恢复原 Session 或诚实标记 UNKNOWN；
5. Cancel 语义明确；
6. Diff/文件作为 Artifact Candidate；
7. GitHub/Harness 继续拥有交付结果；
8. 秘密不进入共享 Role、Board 或审计明文；
9. 输出和 History 有边界；
10. Case 最终仍只有一个 Response Owner。

## Phase 5：受限动态激活

### ACT-01：Capability Registry

### ACT-02：Activation Policy

### ACT-03：Bounded Volunteer / Bid

### ACT-04：Lease / Fairness / Budget

### PILOT-02：动态研究对照试验

## Phase 6：企业加固

### SEC-01：Tenant / Case / Entry / Operation Authorization

### SEC-02：Secrets / Egress / Data Policy

### SEC-03：Adversarial Evaluation

### OPS-01：Durable Infrastructure

### OPS-02：SLO / Cost / Capacity

### ADM-01：Enterprise Control Plane

## Phase 7：明确暂缓

- Long-term Memory；
- Project Shared Memory；
- Idle Agenda；
- Proactive Wake；
- Agent 自主创建任务；
- Agent 自主学习 Skill；
- Agent/Skill/Workflow Marketplace；
- 自主创建 Agent Group；
- 自动策略优化；
- 全自动生产变更；
- 多组织联邦；
- 通用 MCTS 搜索引擎。

---

# 19. 当前 R003 边界

R003 的执行必须继续服从其 Release 和 ADR。

更新后的长期愿景不允许 R003：

- 将 Native LLM Adapter 替换成 Lody；
- 新增 ACP；
- 新增 Runtime Binding Catalog；
- 新增 Delegation 系统；
- 新增 Worktree；
- 新增 Task Board；
- 新增 CRDT；
- 新增动态 Agent；
- 新增 Planner/Harness 正式集成；
- 新增通用 Operation 平台；
- 重构成未来最终架构。

R003 可以保留未来兼容的命名和窄接口，但不得以此扩大行为范围或建设无当前消费者的抽象。

---

# 20. Post-R003 Lody Integration Spike

## 20.1 决策问题

> Accord 能否在不放弃 Case、Workflow、Approval 和领域权威的前提下，把 Lody 作为可选 Coding Agent Runtime，并获得可恢复、可观察、无静默 fallback 的执行能力？

## 20.2 最小闭环

```text
Synthetic Coding Goal
→ One Accord Case
→ One Fixed Workflow Node
→ One AgentActivity
→ One RuntimeOperation
→ One Lody Session
→ One Isolated Worktree
→ One Bounded Result / Diff
→ One Review or Human Gate
→ One ArtifactRef
→ One Final Response
```

## 20.3 必须保留的权威

- Accord：Case、Run、Activity、Operation、Approval、Response；
- Lody：Session、Machine、Worktree、Agent Config；
- GitHub：PR、CI、Merge；
- Harness：正式 Delivery Attempt 和 Merge Gate；
- Human：持续委派和高风险决定。

## 20.4 失败场景

至少覆盖：

- Lody daemon 不在线；
- Agent Config 被删除或移动；
- Role revision 在 Operation 接受后变化；
- Session 创建成功但 Accord 未收到确认；
- Prompt 已持久但 Agent 未启动；
- Agent 完成但结果读取超时；
- Accord 在结果写入前崩溃；
- Cancel 后 Runtime 迟到结果；
- Worktree 存在未提交改动；
- GitHub 不可用；
- 输出过大；
- Credential 或权限模式不可用。

## 20.5 退出条件

以下任一成立时停止扩大：

- 必须依赖未公开私有后端；
- 无法提供稳定 Operation Identity；
- 无法区分已接受、已物化和已完成；
- 必须静默 fallback；
- Session/Task 被迫成为 Case 权威；
- CRDT 被迫拥有 Approval/Claim；
- 无法限定秘密或数据外发；
- 无法在崩溃后恢复或诚实标记 UNKNOWN；
- Lody 与 Harness/GitHub 的事实边界无法明确。

---

# 21. Release 与 Ticket 拆分规则

## 21.1 先编译行为，再拆实现

```text
Vision Work Package
→ Release Frame
→ Scenario
→ State / Artifact Handoff
→ Minimum Evidence
→ ADR（需要时）
→ Delivery Spec
→ Candidate Tickets
→ Admission
→ Harness Execution
```

## 21.2 每个 Ticket 处理一个主要 Seam

合理 Seam：

- Case Resolver → Case Store；
- Board API → Board Store；
- Workflow Node → Context Assembler；
- AgentActivity → RuntimeOperation；
- RuntimeOperation → Lody Adapter；
- Response Gate → MagicChat；
- Planner → Admission Package；
- Harness → Case Projection。

避免一个 Ticket 同时修改：

```text
Schema + Router + Runtime + UI + Security + Deployment
```

## 21.3 Ticket 最小内容

```text
Objective
Authoritative Inputs
In Scope
Out of Scope
Owner
Producer
Consumer
Primary Seam
State / Artifact Handoff
Stable Identities
Failure Modes
Recovery
Acceptance Tests
Dependencies
Evidence to Return
```

## 21.4 Enabler 必须有消费者

任何基础设施或抽象 Ticket 必须声明具体 Consumer、退出条件和删除条件。

禁止为“以后可能有用”提前建设通用 Event Bus、Workflow DSL、Runtime Platform、Memory、Graph Engine、Marketplace 或 Multi-cloud Runtime。

---

# 22. AI 实现行为准则

## 22.1 开始任务前

AI 应：

1. 读取根 `AGENTS.md`；
2. 读取当前 Accepted Release、Delivery Spec 或 Ticket；
3. 只读取相关 ADR；
4. 检查当前代码、配置、类型和测试；
5. 仅在需要长期边界时读取本文；
6. 明确 Owner、Seam、Scenario 和副作用；
7. 对外部项目使用固定 Commit 的研究材料。

## 22.2 实现过程中

AI 必须：

- 保持事实权威分离；
- 使用稳定业务 ID；
- 在外部执行前持久 Operation；
- 冻结运行配置；
- 设计幂等、恢复、取消和 UNKNOWN；
- 把 Agent 输出视为候选；
- 使用 Typed Contract；
- 保存必要 Provenance；
- 控制上下文和权限；
- 不静默 fallback；
- 不把 Runtime Session 当成 Case；
- 不实现 Ticket 外的未来平台；
- 不把研究或原型冒充生产证据；
- 不静默改变 Non-goal。

## 22.3 完成任务后

AI 必须返回：

- 修改了哪些行为；
- 哪些行为未修改；
- 权威来源；
- 验证命令和结果；
- Stable ID / Fingerprint / Frozen Config 行为；
- Failure / Recovery / Cancel 测试；
- 产生的 Evidence；
- 未解决问题；
- 是否改变事实 Owner；
- 是否需要新 ADR；
- 是否影响后续 Ticket。

---

# 23. 常见错误方向

## 23.1 把 Lody Session 当成 Accord Case

错误：

```text
一个 Session = 一个企业任务
```

正确：

```text
一个 Case 可以包含多个 Activity、Operation 和 Runtime Session
```

## 23.2 把 Lody Task 当成正式 Delivery Ticket

错误：Lody Task 状态直接驱动正式代码交付完成。

正确：Lody Task 仅作为执行工作空间对象；正式 Delivery 由 Planner、Harness 和 GitHub 权威证明。

## 23.3 用 CRDT 管 Approval 或 Claim

错误：依靠最后写入或自动合并决定谁获批、谁持有执行权。

正确：Approval、Claim、Budget 和副作用确认使用明确的事务/CAS/唯一约束权威。

## 23.4 先创建 Session，后补 Operation

错误：调用 Runtime 成功后再记录任务。

正确：先持久接受、冻结、指纹化，再物化 Session。

## 23.5 静默 fallback

错误：模型或机器不可用时自动换一个“差不多”的配置。

正确：明确不可用并交给 Retry Policy 或 Human Choice。

## 23.6 把 Agent Role 当成 Agent 身份或授权

错误：Role 被选中即代表长期 Agent 身份和生产权限。

正确：Role/Binding 是运行配置；AgentProfile 是治理身份；DelegationGrant 是授权。

## 23.7 一个全局大黑板

正确结构：

```text
Tenant-scoped + Case-scoped + Policy-filtered Board
```

## 23.8 所有 Agent 监听所有消息

正确结构：

```text
Wake → Case → Eligibility → Authorization → Claim → One Response Owner
```

## 23.9 用 LLM 替代确定性控制

LLM 生成候选判断；程序和权威系统执行权限、幂等、审批、完成和副作用控制。

## 23.10 过早建设动态自治和通用 Runtime

先完成固定受管闭环，再验证 Operation，再做一个窄 Adapter，最后才考虑动态和多 Runtime。

---

# 24. 关键架构决策摘要

1. MagicChat-first，但产品核心对象是 Case。
2. Blackboard 保存 Case 内的结构化求解状态。
3. Workflow Run 保存必须发生的步骤、Wait/Resume 和 Human Gate。
4. AgentProfile、RuntimeBinding、DelegationGrant、AgentActivity、RuntimeOperation 和 RuntimeSessionRef 必须分离。
5. 任何外部执行先持久 RuntimeOperation，再创建 Session 或调用 Runtime。
6. Operation 接受后冻结有效配置；相同 ID 不得绑定不同输入。
7. Runtime 不可用时不得静默 fallback。
8. Lody 是可选 Coding Agent Runtime 和共享执行工作空间，不是 Accord 产品中心。
9. Lody Task/Session/CRDT 不拥有 Accord Case、Approval、Claim 或 Outcome。
10. Pi-ticket-planning、HerdrHarness-lite、GitHub 和企业系统保留领域事实。
11. Agent 可以研究、建议、执行和审查，但不能自行获得授权或制造现实结果。
12. Context Assembler 提供最小相关视图，不注入完整历史。
13. 用户可见输出必须经过 Response Claim、Freshness 和 Dedup。
14. 当前 R003 不因 Lody 研究扩张。
15. Lody 接入只能在 R003 后通过独立 Release、ADR、Spec 和证据试点推进。
16. 长期自治、Memory、Marketplace 和全自动生产变更后置。

---

# 25. 研究与参考方向

以下内容用于解释设计来源，不构成实现依赖或技术授权：

- MagicChat：企业身份、会话、App 和治理入口；
- Cumora：Agent Identity、Wake/Inbox、Freshness 和协作语义；
- Blackboard Architecture：共享状态和部分解；
- Cairn：Fact–Intent–Hint、OODA 和未知状态空间探索；
- Lody：Task/Session 分离、Agent Role、Stable Operation、ACP、机器和 Worktree；
- Hermes：可选 Runtime、Profile 和通用任务执行参考；
- pi-ticket-planning：产品规划与 Admission；
- HerdrHarness-lite：确定性交付、Reviewer、恢复和 Merge Gate；
- GitHub：代码和交付对象权威。

外部项目只提取契约和设计思想，不默认复制其基础设施、许可证义务或产品假设。

---

# 26. 最终北极星

```text
Conversation-first
Case-centered
Blackboard-informed
Workflow-governed
Operation-stabilized
Agent-executed
Human-authorized
Authority-separated
Evidence-backed
Failure-recoverable
Runtime-adaptable
```

中文概括：

> **Accord 以企业会话为入口，以 Case 为产品中心，以受管黑板承载证据和中间解，以持久 Workflow 约束关键步骤，以稳定 Runtime Operation 连接专业 Agent 执行环境，以人工授权控制持续委派和高风险决定，并由领域权威系统证明现实结果。**
