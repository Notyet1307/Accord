长亭协序——企业级智能体协作与可信交付平台

Chaitin Accord — Enterprise Agent Coordination & Trusted Delivery Platform


> **MagicChat-first，但 Agent Coordination 应当 Cumora-first。**
>
> MagicChat 负责企业身份、组织、会话、审批和应用治理；
> Cumora 提供多 Agent 成为“真实同事”所需的协作语义；
> Hermes 主要提供可选 Runtime、Profile 和通用 Kanban 实现参考；
> pi-ticket-planning 与 HerdrHarness-lite 继续拥有各自领域事实。

不是在 MagicChat、Cumora、Hermes 之间三选一，而是分层使用。

---

# 一、Cumora 在最终架构中的准确位置

Cumora 不是简单的 Agent Runtime，也不是普通多 Agent 编排器。

它最有价值的是：

> **Agent 如何以独立身份存在、何时被唤醒、谁应该回答、如何避免并发碰撞、如何按需加载技能、如何与其他 Agent 协作。**

因此最终架构应当是：

```text
┌─────────────────────────────────────────────┐
│          MagicChat 企业协作与治理平面        │
│                                             │
│ 用户 / 组织 / SSO / 群聊 / Topic / 文件     │
│ App 身份 / Choice / 权限 / 审批 / 审计       │
└──────────────────────┬──────────────────────┘
                       │ 可靠消息事件
┌──────────────────────▼──────────────────────┐
│       Agent Coordination Kernel             │
│          主要借鉴 Cumora                    │
│                                             │
│ Agent Profile / Role                        │
│ Skills Progressive Disclosure               │
│ Wake Router / Inbox Triage                  │
│ Message Claim / Freshness Gate              │
│ Session Isolation / Runtime Routing         │
│ Agent DM / Group / Delegation                │
│ Memory Namespace                            │
│ Concurrency / Cost / Observability           │
└───────────────┬─────────────────┬───────────┘
                │                 │
       ┌────────▼────────┐  ┌─────▼──────────────┐
       │ Runtime Adapters │  │ Domain Controllers │
       │                  │  │                    │
       │ Native LLM       │  │ pi-ticket-planning │
       │ Pi RPC           │  │ HerdrHarness-lite  │
       │ Hermes 可选      │  │ Git / GitHub       │
       │ Codex            │  │ Release / Outcome  │
       └──────────────────┘  └────────────────────┘
```

这里需要增加的真正新组件不是“大一统 Delivery Gateway”，而是拆成两个逻辑层：

```text
Agent Coordination Kernel
    负责通用多 Agent 协作

Delivery Control Core
    负责 Planner、Admission、Harness 之间的领域可信交接
```

这两个层不能混在一起。

---

# 二、MagicChat、Cumora、Hermes 的职责不一样

| 项目                 | 最适合承担的层               | 核心问题                        |
| ------------------ | --------------------- | --------------------------- |
| MagicChat          | 企业协作和治理平面             | 人是谁、应用是谁、谁能看、谁能审批           |
| Cumora             | 多 Agent 协作语义          | 哪个 Agent 应该醒、应该说什么、如何避免冲突   |
| Hermes             | Agent Runtime 与通用任务执行 | Profile 如何运行、技能怎么装、通用任务怎么领取 |
| pi-ticket-planning | 产品规划领域引擎              | 什么值得做、如何形成可执行 Ticket        |
| HerdrHarness-lite  | 软件交付控制器               | Ticket 如何安全执行、审查、恢复和 Merge  |

所以：

```text
MagicChat 决定企业边界
Cumora 决定 Agent 协作方式
Hermes 决定一种可选运行方式
Planner 决定产品与 Ticket
Harness 决定交付状态
```

---

# 三、具体应该从 Cumora 借鉴什么

## 1. Agent 成为一等身份，而不只是不同 Prompt

Cumora 的 Persona 不只是一个 `system_prompt`，而是一个明确的数据对象：

```text
Agent ID
Name
Role
Style
Model
Company / Tenant
```

并且能够读取当前团队成员和各自角色。

MagicChat 应当增加：

```ts
interface AgentProfileV1 {
  id: string;
  appId: string;
  name: string;
  role: string;
  description: string;

  runtime: RuntimeRef;
  modelPolicy: ModelPolicy;
  toolPolicy: ToolPolicy;
  memoryPolicy: MemoryPolicy;
  collaborationPolicy: CollaborationPolicy;

  skillBindings: SkillBinding[];
  tenantId: string;
  status: "active" | "disabled";
}
```

这样：

```text
茉莉
Ticket Planner
Delivery Controller
Security Researcher
Solution Architect
```

才是真正独立的 Agent，而不是同一个茉莉根据 Prompt 假扮不同角色。

---

## 2. 每个 Agent 独立 Skills，且采用渐进加载

Cumora 的 Skill 设计非常值得直接借鉴：

```text
skills/<name>/SKILL.md
skills/<name>/references/*
skills/<name>/scripts/*
skills/<name>/assets/*
```

基础上下文只放：

```text
skill name
skill description
```

只有当任务真正需要时，Agent 才读取完整 Skill 内容，避免所有 Skill 一次性进入系统 Prompt。

MagicChat 应建立：

```text
AgentSkillCatalog
AgentSkillBinding
SkillVersion
SkillDigest
SkillRiskLevel
SkillAllowedTools
SkillEvalSuite
```

但企业版本不要完全照搬 Cumora 的自主行为：

```text
第一阶段：
管理员发布 Skill
管理员绑定 Agent
版本锁定
按需读取

暂不允许：
Agent 自主安装 Skill
Agent 自主修改 Skill
Skill 隐式获取工具权限
```

Skill 是知识和执行说明，不是权限来源。

---

## 3. 借鉴 Inbox/Wake 模型，而不是让所有 Agent 监听所有消息

Cumora 的 Agent 不是持续盯着整个消息流，而是在有新 Inbox 内容时收到 Wake-up，再自行判断是否需要行动。它还使用低成本模型进行 Inbox Triage，避免每次群聊活动都唤醒昂贵主模型。

MagicChat 当前如果增加多个 App Agent，最容易出现的问题是：

```text
用户在群里发一句话
→ 茉莉醒
→ Planner 醒
→ Researcher 醒
→ Delivery 醒
→ 四个 Agent 同时回答
```

因此需要一个 `WakeRouter`：

```ts
interface WakeDecisionV1 {
  eventId: string;
  conversationId: string;
  messageSeq: number;

  targetAgentIds: string[];
  responseOwnerId: string | null;

  mode:
    | "ignore"
    | "observe"
    | "reply"
    | "continue-session"
    | "decision-response";

  reasonCode: string;
}
```

路由规则优先级：

```text
1. Choice 回答 → 原 Challenge 所有者
2. 明确 @Agent → 被提及 Agent
3. App 私聊 → 当前 App
4. 当前存在有效 Work Claim → Claim 所有者
5. 当前存在等待回答的 Planner Session → Planner
6. 能力路由 → 最匹配的一个 Agent
7. 其他 Agent 只观察或忽略
```

**一条消息原则上只有一个 Response Owner。**

---

## 4. 借鉴 Cumora 的并发防碰撞，而不是只依赖 Prompt

Cumora 对多 Agent 协作的一个重要判断是：

```text
有些问题属于代码层并发碰撞
有些问题属于模型判断错误
两者不能只靠 Prompt 一起解决
```

它实现了：

* Wake Debounce 和 Coalescing；
* 同一 Agent 的并发限制；
* Model 调用节流；
* Adaptive Pacer；
* 消息新鲜度检查；
* 重复回复事务内拦截；
* Seen Sequence；
* 旧上下文输出 Hold。

MagicChat 当前已有会话 Session、消息 Seq、排队和中断机制，但仍缺少完整的最终输出新鲜度 Gate。当前输出 Sink 主要确认 Session Job 仍有效，并未完整证明“模型生成答案时所依据的消息快照仍然是最新的”。

应增加：

```ts
interface FreshnessTokenV1 {
  conversationId: string;
  triggerMessageId: string;
  triggerSeq: number;
  contextMaxSeq: number;
  contextDigest: string;
  claimId: string;
  agentId: string;
}
```

发送前校验：

```text
当前 Conversation Max Seq
    == contextMaxSeq

当前 Claim
    仍属于该 Agent

当前 Agent Session
    仍是该 Session

最后一条 Peer 输出
    未与本次输出重复
```

不满足时：

```text
HOLD 输出
→ 将新增消息追加到同一 Session
→ 要求 Agent 重新判断
→ 新结果再次通过 Gate 后发布
```

这是 Cumora 最值得移植的部分之一。

---

## 5. 借鉴 Agent Session 的独立性

Cumora 中每个 Agent 是独立 Engine Session。多个 Agent 不是共享同一份模型消息历史。

MagicChat 多 Agent 后，Session Key 不能继续只依赖：

```text
conversation_id
```

应该升级为：

```text
交互 Session：
tenant_id + agent_id + conversation_id

规划 Session：
tenant_id + planner_agent_id + delivery_case_id

执行 Attempt：
harness_job_id + lane + attempt_id
```

绝不能：

```text
Planner、Researcher、Delivery
共享一个 Conversation Session
```

否则会造成：

* Persona 串线；
* Skill 串线；
* 授权串线；
* Memory 污染；
* 工具结果互相影响；
* Reviewer 看到 Worker 的隐式上下文。

---

## 6. 借鉴 Cumora 的 Agent-to-Agent 协作形式

Cumora 允许 Agent：

* 私聊其他 Agent；
* 创建临时 Agent Group；
* 拉入特定成员；
* 使用团队成员名册；
* 在 Agent-only side room 中先完成内部讨论。

这对 MagicChat 很适合，因为 MagicChat 本身已有：

* App 身份；
* 群聊；
* Topic；
* Group 创建；
* App 之间的会话能力。

但企业版应增加约束：

```text
Agent 可以发起：
delegate
consult
request_review
request_evidence

Agent 不能通过聊天直接发起：
approve
activate
resume
mark_done
force_merge
```

Agent 间正式交接使用：

```ts
interface AgentHandoffV1 {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;

  kind:
    | "consultation"
    | "evidence-request"
    | "candidate-review"
    | "runtime-delegation";

  objective: string;
  contextRefs: string[];
  artifactRefs: string[];
  obligations: string[];
  unknowns: string[];

  sourceRevision: string;
  digest: string;
}
```

普通讨论可以在 Topic 中发生；真正的领域交接仍使用结构化 Handoff。

---

## 7. 借鉴 Agent Memory Namespace，但不能让 Memory 成为事实

Cumora 每个 Agent 都有独立的：

```text
SOUL.md
IDENTITY.md
memory/
skills/
```

并把这些内容与普通临时工作文件区分开。

MagicChat 可借鉴为：

```text
Agent Identity
Agent Private Memory
Project Shared Memory
Conversation Memory
Domain Fact References
```

但企业版必须增加：

```ts
interface MemoryRecordV1 {
  id: string;
  agentId: string;
  tenantId: string;
  scope: "agent-private" | "project-shared";

  type:
    | "preference"
    | "decision-reference"
    | "working-note"
    | "learned-procedure";

  content: string;
  sourceRefs: string[];
  confidence: number;
  expiresAt: string | null;
  supersedes: string | null;
}
```

约束：

```text
Memory 可以帮助 Agent 找信息
Memory 不能覆盖 Git、GitHub、Harness、Release Artifact
Memory 不能产生用户授权
Memory 不能证明某个操作已完成
```

---

# 四、Cumora 和 Hermes 的借鉴重点并不一样

| 能力            | 优先借鉴 Cumora |          优先借鉴 Hermes |
| ------------- | ----------: | -------------------: |
| Agent 一等身份    |           是 |                  可参考 |
| Persona 和团队名册 |           是 |                  可参考 |
| Skills 渐进披露   |           是 |                    是 |
| Inbox/Wake 语义 |           是 |                   次要 |
| 消息 Claim      |           是 |     Kanban Claim 可参考 |
| 输出新鲜度         |           是 |         不如 Cumora 完整 |
| 重复回复拦截        |           是 |                   次要 |
| Agent 群聊      |           是 | Desktop Bot Mode 可参考 |
| 多 Agent 运行进程  |    可参考 BYOA |                    是 |
| Profile 隔离    |         可参考 |                    是 |
| 通用任务 Kanban   |          次要 |                    是 |
| 企业身份、SSO、应用治理 |           否 |                    否 |
| 正式软件交付状态      |           否 |                    否 |

因此优先级应该是：

```text
企业平台：MagicChat

Agent 协作内核：
Cumora 优先

通用 Runtime 和任务板：
Hermes 可选

领域引擎：
pi-ticket-planning + HerdrHarness-lite
```

---

# 五、哪些 Cumora 能力不要直接搬

## 1. 不要让 Agent 自主安装和修改生产 Skill

个人 Agent 可以这么做，企业产品不适合。

## 2. 不要让聊天成为任务唯一事实

Agent 群聊只能是协作界面，不能替代：

```text
GitHub Ticket
Admission Envelope
Harness Ledger
Git HEAD
Reviewer Result
Approval Record
```

## 3. 不要第一阶段复制 Cumora 的全部主动行为

暂时不做：

```text
长期 Idle Agenda
主动拉群
自动周期跟进
自主创建大量任务
自主技能学习
```

先把被动触发、Claim、新鲜度和权限做好。

## 4. 不要直接复制 Cumora 的完整基础设施

没有必要立即复制：

* 每 Agent Pod；
* FUSE Workspace；
* 云端 BYOA Daemon；
* 完整邮件、日历和看板体系；
* 所有主动任务调度。

MagicChat 已经有消息、身份、Topic 和 App 协议；只需要提取 Cumora 的协调契约。

---

# 六、调整后的模块架构

建议新增独立服务：

```text
agent-hub/
├── contracts/
│   ├── agent-profile.ts
│   ├── wake-event.ts
│   ├── wake-decision.ts
│   ├── claim.ts
│   ├── freshness-token.ts
│   ├── handoff.ts
│   └── runtime-result.ts
│
├── profiles/
│   ├── registry.ts
│   ├── tool-policy.ts
│   └── model-policy.ts
│
├── skills/
│   ├── catalog.ts
│   ├── binding.ts
│   └── loader.ts
│
├── routing/
│   ├── wake-router.ts
│   ├── triage.ts
│   └── response-owner.ts
│
├── sessions/
│   ├── manager.ts
│   ├── freshness.ts
│   └── compaction.ts
│
├── coordination/
│   ├── claim-store.ts
│   ├── dedup.ts
│   ├── delegation.ts
│   └── side-room.ts
│
├── memory/
│   ├── store.ts
│   ├── retrieval.ts
│   └── policy.ts
│
├── runtimes/
│   ├── native-magicchat.ts
│   ├── pi-ticket-plan.ts
│   ├── herdr-harness.ts
│   ├── hermes.ts
│   └── codex.ts
│
└── observability/
    ├── events.ts
    ├── usage.ts
    └── audit.ts
```

建议技术选择：

```text
MagicChat Server：
继续 Go，不大改领域逻辑

Agent Hub：
TypeScript / Node.js

原因：
pi-ticket-planning 和 HerdrHarness-lite 都是 TypeScript
协议和类型可以直接共享
Pi RPC、Harness CLI、GitHub 集成更容易复用
```

Agent Hub 通过 MagicChat 的 App WebSocket 协议接入，不直接访问 MagicChat 内部数据库。

---

# 七、需要区分三种 Claim

这是防止未来架构再次混乱的关键。

## 1. Message Claim

```text
谁负责回答这条消息
```

所有者：

```text
Agent Coordination Kernel
```

## 2. Generic Work Claim

```text
谁负责某项研究、分析或文档任务
```

所有者：

```text
Agent Coordination Kernel
或可选 Hermes Kanban
```

## 3. Delivery Ticket Claim

```text
谁正在执行 GitHub Issue
```

所有者：

```text
HerdrHarness-lite
```

不能出现：

```text
Agent Hub 认为 Ticket 已领取
Hermes Kanban 也认为已领取
Harness Ledger 又认为已领取
```

正式开发 Ticket 的唯一 Claim 权威必须仍然是 Harness。

---

# 八、需要区分三种 Handoff

## 1. Agent 协作 Handoff

```text
Researcher → Architect
Planner → Researcher
```

使用 Cumora 风格协作 Handoff。

## 2. Planning → Delivery Handoff

```text
pi-ticket-planning → HerdrHarness
```

使用：

```text
Admission Plan
Admission Envelope
Harness Manifest
Fingerprint
```

## 3. Delivery Attempt Handoff

```text
Reviewer → Worker
Analyst → Fresh Worker
```

继续使用 HerdrHarness 的：

```text
TypedHandoff
AttemptContextEnvelope
ExecutionSnapshot
```

不应试图用一个万能 `handoff.json` 统一三者。

---

# 九、交给 Codex 的优先实施顺序也要调整

## 第一阶段：Cumora Coordination Foundation

先实现：

```text
AgentProfile
AgentSkillBinding
AgentRuntimePort
Composite Session Key
Message Claim
Freshness Token
Response Owner
```

验收：

```text
同一消息只允许一个 Agent 回复
不同 Agent Session 不串线
旧上下文输出会被 Hold
Agent 只能看到自己绑定的工具和 Skill
```

## 第二阶段：Visible Agent Apps

实现：

```text
茉莉 App
Ticket Planner App
Delivery App
Researcher App
```

每个 App 绑定独立 AgentProfile 和 Runtime。

## 第三阶段：pi-ticket-plan Runtime Adapter

```text
MagicChat 用户消息
→ Planner Message Claim
→ Case-scoped Pi RPC Session
→ ask-yet
→ PlannerTurnSubmission
→ Freshness Gate
→ Planner App 回复
```

## 第四阶段：HerdrHarness Adapter

```text
Harness Event
→ Delivery App 状态投影

OperatorAction
→ Exact Decision Challenge
→ 用户确认
→ Harness CAS
```

## 第五阶段：Agent-to-Agent Collaboration

实现：

```text
delegate
consult
request_evidence
request_review
agent-only Topic
structured Handoff
```

## 第六阶段：Memory 和主动行为

最后再实现：

```text
Agent Private Memory
Project Shared Memory
Idle Agenda
Stall Nudge
Synthetic Wake Gate
```

---

# 十、最终架构判断

现在最准确的产品技术路线是：

```text
MagicChat
    提供企业可信入口

Cumora
    提供多 Agent 协作内核设计

Hermes
    提供可选 Runtime、Profile 和通用 Kanban参考

pi-ticket-planning
    提供产品规划与 Ticket Admission

HerdrHarness-lite
    提供确定性软件交付控制
```

一句话概括：

> **MagicChat 是企业外壳，Cumora 是 Agent 协作大脑，pi-ticket-plan 是产品规划专家，HerdrHarness-lite 是交付执行权威，Hermes 是可选执行环境。**

Cumora 不是附加参考，而应该成为你设计 MagicChat 多 Agent 能力时的**第一参考对象**；尤其是 Agent Identity、Skills 渐进披露、Wake/Inbox、Message Claim、Freshness Gate 和并发防碰撞，这些应该在接入 pi-ticket-plan 和 HerdrHarness-lite 之前先建立。

