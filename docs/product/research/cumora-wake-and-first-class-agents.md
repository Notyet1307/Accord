# Cumora 协作语义核查与 Accord 适用边界

## 文档元数据

- `status`: PINNED_SOURCE_RESEARCH
- `authority_level`: SUPPORTING_EVIDENCE
- `verified_on`: 2026-08-20
- `verified_repository`: [`yetone/cumora`](https://github.com/yetone/cumora)
- `verified_commit`: [`90fd9ae8bc42a477168eb109717291dd567993f5`](https://github.com/yetone/cumora/tree/90fd9ae8bc42a477168eb109717291dd567993f5)
- `license_at_verified_commit`: MIT
- `recommended_path`: `docs/product/research/cumora-wake-and-first-class-agents.md`
- `architecture_owner`: `docs/product/VISION.md` 与适用 Accepted ADR
- `not_authoritative_for`: Accord 产品行为、实现技术栈、当前代码事实或交付状态

> 本文固定在上述 commit 上陈述实现事实。  
> 2026-08-21 检查时，Cumora `main` 已前进到 `2c9d17e535c74533d104f2d921a55445fb1dc04d`；本文没有对该新版本重新执行完整核查，因此不把 `main` 的当前行为外推为已验证事实。

---

## 0. 如何使用本文

本文用于回答：

1. Cumora 在固定版本中真实实现了哪些多 Agent 协作机制；
2. 它的 Wake、Inbox、Triage、Freshness 和 Runtime 如何工作；
3. Cumora 是否拥有 Accord 所需的通用 Workflow Engine；
4. 哪些机制值得 Accord 借鉴、改造或拒绝；
5. Cumora 与 Accord 的 Case、Blackboard、Workflow 和领域权威如何分工。

本文是研究证据，不是 Accord 架构决策。

只有在设计以下内容时才需要读取本文：

- Agent 作为一等身份；
- Wake/Inbox；
- Agent Session；
- Skill 渐进加载；
- Agent-to-Agent 协作；
- Freshness、Dedup 和 Claim；
- Cloud/BYOA Runtime；
- Cumora 与 Accord 的边界。

局部 Bug、普通 Ticket 或与上述边界无关的实现不应默认加载本文。

---

## 1. 最强结论

**Cumora 已实现“人与 Agent 共处同一通信与协作空间”的一等参与者模型，以及 durable inbox、事件 Wake、小模型 Triage、独立 Agent 身份与工作区、群聊/私聊、Cloud/BYOA Runtime、Freshness Hold 和部分防碰撞机制。**

但在固定 commit 中，没有发现以下 Accord 核心能力：

- 通用且版本化的 `Workflow Definition`；
- 持久 `Workflow Run`；
- 可等待用户输入并恢复同一 Node 的流程语义；
- 一条请求的全局唯一 `Response Claim`；
- Case 范围的 Typed Governed Blackboard；
- Planning、Delivery 和外部业务结果的权威分离。

因此，Accord 应当：

```text
借鉴 Cumora 的参与者、通信、Wake 和新鲜度语义
        +
保留 MagicChat 的企业入口与治理边界
        +
自行拥有 Case、Blackboard、Workflow 和 Claim
        +
由 Planner、Harness、GitHub 和企业系统拥有领域事实
```

Cumora 是 Accord Agent Coordination Kernel 的关键参考对象，不是 Accord 的“协作大脑”、生产依赖或事实权威。

---

## 2. 核查方法和证据规则

实现级结论只接受固定 commit 中的：

- 官方源码；
- 数据库迁移；
- Runtime 协议；
- 测试；
- 官方 README 和文档。

不使用以下内容证明实现事实：

- Accord 旧 README；
- 二手文章；
- 产品设想；
- 仅凭文件名或界面截图作出的推断；
- Cumora 当前 `main` 上未重新核查的变化。

“未发现”属于有界否定：它只表示在固定源码树和明确检索范围内没有找到对应产品级实现，不代表未来版本或私有系统永远不存在。

---

## 3. Cumora 的真实系统模型

固定版本中，Cumora 更接近：

```text
Human 与 Agent 共享通信空间
        ↓
消息先持久化
        ↓
事件触发 Wake
        ↓
每个 Agent 独立 Triage
        ↓
值得处理时唤醒 Main Brain
        ↓
Agent 读取 durable inbox 与自己的上下文
        ↓
Agent 独立决定回复、行动或忽略
        ↓
发送前执行 Freshness 与重复检查
```

它不是：

```text
一个中央 Manager LLM
        ↓
精确选择唯一 Agent
        ↓
执行通用版本化 Workflow
        ↓
恢复等待中的持久 Node
```

普通群聊的生产路径更接近“广播 Wake + 每 Agent 独立判断 + 发送前防碰撞”，而不是中央唯一指派。

---

## 4. Human 与 Agent 是否是一等参与者

### 已验证事实

- **统一协作定位**：Cumora 将 Human 与 Agent 放在同一 roster、DM、群聊、Kanban 和 Calendar 中。  
  来源：[`README.md:1-20`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/README.md#L1-L20)。

- **统一 Participant 模型**：`participants` 同时保存 Human 与 Agent，消息统一使用 `author_id`，Conversation 统一保存成员。  
  来源：[`server/src/db/migrate.ts:9-58`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L9-L58)。

- **Agent Profile**：Persona 至少包含 `id`、`name`、`role`、`style`、`model` 和 `companyId`；团队名册同时查询 Human 与 Agent。  
  来源：[`server/src/agents/personas.ts:17-103`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/personas.ts#L17-L103)。

- **Runtime 身份约束**：Runtime JWT 固定 `agentId + companyId`，服务端剥离客户端提供的身份参数，防止 Agent 冒充其他参与者。  
  来源：[`server/src/agents/runtime/jwt.ts:9-28`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/jwt.ts#L9-L28)、[`server/src/agents/runtime/server.ts:82-106`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/server.ts#L82-L106)。

- **Agent-to-Agent 会话**：Agent 私聊使用普通 direct conversation；Agent 也可创建临时群组。  
  来源：[`server/src/agents/private_chat.ts:1-143`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/private_chat.ts#L1-L143)、[`server/src/agents/scanner_helper.ts:8-145`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scanner_helper.ts#L8-L145)。

### 对 Accord 的含义

Accord 应借鉴稳定 Agent 身份、团队名册、会话参与和 Runtime 身份绑定。

但“一等参与者”只表示协作对象是一等公民，不表示权限完全相同：

```text
Human 与 Agent 可以同处一个协作空间
≠
Agent 可以接受风险、批准生产操作或拥有企业数据
```

风险接受、数据所有权、生产授权和高影响审批必须归属于 Human 或明确企业策略。

---

## 5. Wake、Inbox 与 Triage

### 5.1 已验证事件链

```text
消息持久化到 Postgres
→ 发布 message-new 事件
→ Scheduler 查找会话中的 Agent 成员
→ Cloud Agent 在服务端执行小模型 Triage
→ BYOA Agent 收到 Wake，由本地 Daemon 执行 Triage
→ Agent 读取 durable inbox
→ Main Brain 决定是否回复或行动
```

### 5.2 关键事实

- **Durable Inbox**：消息先落库，再发布事件；Wake 丢失后可通过 unread cursor 补偿。  
  来源：[`server/src/api/router.ts:3291-3513`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/api/router.ts#L3291-L3513)。

- **事件驱动而非大模型常驻**：Cloud 侧通过 Scheduler 和按需 Pod；BYOA 侧通过常驻 Daemon、SSE 和轮询接收或补偿 Wake。  
  来源：[`server/src/agents/scheduler.ts:275-418`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L275-L418)、[`server/src/agents/computer/daemon.ts:1095-1104`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L1095-L1104)。

- **Triage 只是 Gate**：小模型判断该 Agent 的 Inbox 是否值得唤醒昂贵 Main Brain；它不生成回复，也不负责选择全局唯一回答者。  
  来源：[`server/src/agents/triage-core.ts:176-195`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/triage-core.ts#L176-L195)。

- **Cloud/BYOA 路径不同**：Cloud Agent 在 Scheduler 侧 Triage；BYOA Agent 收到 Wake 后由本地 Daemon 执行同类判断。  
  来源：[`server/src/agents/scheduler.ts:646-716`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L646-L716)。

- **Debounce 与 Coalescing**：BYOA 默认约 2.5 秒 Debounce；Agent 运行期间的新 Wake 合并为一次 Pending Rerun。  
  来源：[`server/src/agents/computer/daemon.ts:1767-1865`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L1767-L1865)。

### 5.3 关键纠正：不是中央唯一路由

- 普通未静音群聊会并行 Wake 所有非静音 Agent 成员。  
  来源：[`server/src/agents/scheduler.ts:605-615`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L605-L615)。

- 私聊总是投递；静音群只有 direct、精确 `@agent-id` 或引用该 Agent 消息时逃逸静音。  
  来源：[`server/src/agents/scheduler.ts:617-636`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L617-L636)。

- Triage 生产路径没有建立全局唯一 Response Owner。

因此，Accord 不能把 Cumora 描述成：

```text
茉莉持续观察所有消息
→ 茉莉精确挑选一个 Agent
→ 其他 Agent 完全不被唤醒
```

Accord 如果需要唯一责任，必须自行建立：

```text
Wake Decision
Work Routing
Workflow Owner
Atomic Response Claim
Freshness Token
```

---

## 6. Freshness、Dedup 与 Work Claim

### 已验证事实

- **Wake 去重**：多副本 Scheduler 使用 Redis `SET NX` 对同一消息的 Wake 去重。  
  来源：[`server/src/agents/scheduler.ts:421-436`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L421-L436)。

- **Freshness Hold**：群聊回复发送前比较 Seen Sequence；如果出现更新消息，输出返回 `HELD`，要求 Agent 重新判断。  
  来源：[`server/src/agents/cli.ts:1659-1776`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1659-L1776)、[`server/src/agents/seen-boundary.ts:153-273`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/seen-boundary.ts#L153-L273)。

- **重复回复拦截**：群聊存在读阶段和写阶段两层逐字重复检查，写阶段通过 Conversation Counter Lock 缩小竞争窗口。  
  来源：[`server/src/agents/cli.ts:1780-1827`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1780-L1827)、[`server/src/agents/cli.ts:1928-2001`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1928-L2001)。

- **共享工作 Claim**：重型共享工作使用 Redis 原子 Claim；Kanban Card Claim 使用数据库条件更新。  
  来源：[`server/src/agents/runtime/inproc-client.ts:734-863`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/inproc-client.ts#L734-L863)、[`server/src/agents/cli.ts:5223-5259`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L5223-L5259)。

### 已知边界

- 普通聊天回复没有与共享工作 Claim 等价的通用原子 `ResponseClaim`；
- Freshness 依赖 Redis Seen Baseline，部分异常路径会 Fail Open；
- 群聊和两人 DM 的处理并不完全一致；
- `thinking` 只是状态提示，不是所有权锁。

### Accord 应如何改造

Accord 应把 Cumora 的“发送前再确认”提升为持久化控制契约：

```text
ResponseClaim {
  case_id
  conversation_id
  trigger_message_id
  owner_agent_id
  workflow_run_id
  context_revision
  lease_until
  status
  dedup_key
}
```

发送前至少验证：

- Claim 仍属于当前 Owner；
- Case/Conversation 没有出现使输出失效的新输入；
- Workflow Run 仍允许发布；
- Human Approval 仍有效；
- Dedup Key 尚未被确认；
- 外部回写目标仍与原请求一致。

---

## 7. Skill、Memory、Workspace 与 Runtime

### 已验证事实

- **Skill 渐进加载**：基础上下文只注入 Skill 名称和描述，需要时再读取完整 `SKILL.md`。  
  来源：[`server/src/agents/skills.ts:1-28`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/skills.ts#L1-L28)、[`server/src/agents/skills.ts:236-256`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/skills.ts#L236-L256)。

- **Agent Namespace**：Workspace、Memory、Log 和 Task 按 `agent_id` 隔离；Runtime 文件接口使用 JWT Subject 固定 Agent。  
  来源：[`server/src/db/migrate.ts:383-438`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L383-L438)、[`server/src/agents/runtime/fs-endpoints.ts:75-113`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/fs-endpoints.ts#L75-L113)。

- **Cloud 与 BYOA Runtime**：Cloud 使用受管 Per-Agent Pod；BYOA 使用本地 Claude Code/Codex，服务端无需持有对应模型供应商密钥。  
  来源：[`README.md:17-20`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/README.md#L17-L20)、[`docs/BYOA.md`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/docs/BYOA.md)。

- **Session 路径不同**：BYOA 保存可恢复的 Claude/Codex Session；Cloud 路径以独立 Turn 为主，不是所有路径都保持跨 Wake 模型会话。  
  来源：[`server/src/agents/computer/daemon.ts:899-1206`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L899-L1206)、[`server/src/agents/turn.ts:2278-2308`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/turn.ts#L2278-L2308)。

### Accord 应借鉴

- Agent Profile 是独立对象，而不是同一个 Prompt 假扮多个角色；
- Skill 内容按需加载，避免全部进入基础上下文；
- Agent Session、Workspace 和工具权限必须隔离；
- Runtime 通过显式 Port 接入，不直接成为领域权威；
- Agent 私有上下文与 Case 共享状态必须区分。

### Accord 不应直接复制

- Agent 自主安装或修改生产 Skill；
- Skill 隐式获得工具权限；
- Agent Memory 覆盖 GitHub、Harness、Decision 或 Outcome；
- 第一阶段建设 Per-Agent Pod、FUSE Workspace 或完整 BYOA 基础设施；
- 把所有 Agent 工作文件自动写入共享 Blackboard。

---

## 8. Cumora 是否有 Accord 所需的 Workflow Engine

### 结论

**在固定 commit 中，没有发现通用、版本化、可等待输入并恢复的 Workflow Definition/Run 引擎。**

有界检索包括：

```text
workflow definition
workflow run
definition_version
workflow_version
wait-for-input
resume-run
step_id
node
edge
branch
retry-policy
```

### 支持结论的事实

- `agent_runs` 记录单次 Agent Turn 的触发、输入、状态、指标和错误，但不包含通用 Definition、Version、Node、Edge、Wait Token 或 Retry Policy。  
  来源：[`server/src/db/migrate.ts:152-203`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L152-L203)。

- Agent 可以把当前 Turn 标记为 `needs_clarification`、`waiting` 或 `blocked`，但后续用户消息仍通过普通 Inbox/Wake 进入新 Turn，不是恢复一个持久 Workflow Node。  
  来源：[`server/src/agents/tools-shared.ts:47-58`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/tools-shared.ts#L47-L58)、[`server/src/agents/turn.ts:3053-3122`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/turn.ts#L3053-L3122)。

- Kanban、Calendar 和 Shipping 各自拥有状态，但不是可复用的多 Agent Workflow Definition/Run。

### 对 Accord 的要求

Accord 必须自行拥有：

- Versioned Workflow Definition；
- Persistent Workflow Run；
- Node、Attempt 和 Transition；
- `WAITING_FOR_INPUT`；
- Human Challenge 与 Resume Correlation；
- Branch、Join、Retry、Cancel 和 Timeout；
- Workflow Owner；
- Response Gate；
- 与 Case 和外部领域对象的稳定关联。

---

## 9. Cumora 与 Governed Case Blackboard 的关系

Cumora 的通信空间、Inbox、Agent Memory 和 Workspace 都不等于 Accord 的 Case Blackboard。

### 通信空间回答

```text
谁说了什么
谁收到了什么
谁应该被 Wake
```

### Agent 私有上下文回答

```text
这个 Agent 保存了什么工作材料
它下次如何继续自己的任务
```

### Case Blackboard 回答

```text
这个 Case 已知什么
依据是什么
仍有哪些未知
有哪些 Claim、Proposal、Critique 和 Verification
哪些内容已经被决策者接受
```

因此建议关系是：

```text
Conversation
    └── 产生输入、追问、解释和审批事件

Agent Inbox / Session
    └── 让某个 Agent 接收工作并保持自己的执行上下文

Governed Case Blackboard
    └── 保存跨 Agent 的结构化共享问题求解状态

Workflow Run
    └── 规定哪些步骤必须发生、何时等待、如何恢复和发布

Domain Authority
    └── 证明现实世界中最终发生了什么
```

不能把完整聊天历史直接视为 Blackboard，也不能把 Agent Memory 自动提升为 Case Fact。

---

## 10. Accord 应采用、改造和拒绝的内容

### 10.1 直接采用其设计原则

- Human 与 Agent 使用稳定 Participant Identity；
- Durable Inbox 先持久化后 Wake；
- Event-driven Wake，而不是昂贵模型持续轮询；
- 低成本 Triage 只做 Gate；
- Skill Progressive Disclosure；
- Agent Session 和 Workspace 隔离；
- Debounce 与 Wake Coalescing；
- 发送前 Freshness；
- Agent-to-Agent DM 和受控临时协作空间；
- Cloud/BYOA 通过 Runtime Port 解耦。

### 10.2 必须改造

| Cumora 机制 | Accord 改造方向 |
|---|---|
| 普通群聊广播 Wake | 先做规则过滤和 Case/Run Correlation，再对有限 Agent 发布 Eligibility |
| 每 Agent 独立决定是否回复 | 建立 Workflow Owner 和原子 Response Claim |
| Seen Sequence Freshness | 使用持久 Context Revision、Digest、CAS 和 Dedup |
| Agent Memory/Workspace | 与 Case Blackboard、Evidence 和领域事实明确隔离 |
| Agent/Task Claim | 区分 Message Claim、Generic Work Claim 和 Delivery Ticket Claim |
| Chat/DM 协作 | 普通讨论可聊天，正式 Handoff 必须 Typed |
| BYOA Session | Runtime 必须支持稳定 Invocation ID、幂等和结果恢复 |

### 10.3 不应复制

- 把群聊广播给所有 Agent 作为默认企业路由；
- 只靠 Prompt 约束唯一回答者；
- 把聊天、Kanban 或 Memory 当作正式 Workflow；
- 让 Agent 自主获得生产 Skill 和工具权限；
- 让聊天消息直接批准、恢复、完成或强制 Merge；
- 在第一阶段复制 Cumora 的全部 Pod、Daemon、Agenda、Calendar 和 Marketplace 能力；
- 把 Cumora 当前代码结构当作 Accord 模块边界。

---

## 11. 与 Accord 目标架构的映射

| Accord 概念 | Cumora 可提供的参考 | Accord 必须自行拥有 |
|---|---|---|
| Participant / Agent Profile | 一等 Participant、Persona、Roster | 企业权限策略、版本和治理 |
| Wake Router | Durable Inbox、Wake、Triage、Debounce | Case/Run Correlation、Response Owner |
| Case | 无直接等价物 | Case Identity、Lifecycle 和 Policy |
| Governed Blackboard | 无直接等价物 | Typed Entries、Provenance、Trust、Supersession |
| Workflow Run | Agent Turn 和领域功能状态可参考 | Versioned Definition、Wait/Resume、Attempt、Gate |
| Agent Session | Cloud/BYOA Session 机制 | Composite Key、权限和 Case-scoped Context |
| Work Claim | Redis/DB Claim 可参考 | Claim 类型分离、Lease、Budget、Policy |
| Response Gate | Freshness 与重复拦截 | Atomic Response Claim、Persistent Dedup、Approval |
| Skill | Progressive Disclosure | 发布、版本、风险和工具权限治理 |
| Memory | Agent Namespace | 不能覆盖 Decision、Git、Harness 和 Outcome |
| Runtime Adapter | Cloud/BYOA | Stable Invocation、Idempotency、Result Recovery |
| Domain Authority | 无 | Planner、Harness、GitHub 和企业系统边界 |

---

## 12. 对实现拆分的直接启示

Cumora 研究支持 Accord 将以下能力分开实现：

1. **Message Ingestion**  
   接收 MagicChat 持久事件，保留稳定消息身份和投递身份。

2. **Wake Router**  
   决定哪些 Agent 或协调组件需要知道该事件。

3. **Case Resolver**  
   判断新建 Case、补充现有 Case、恢复等待 Run、审批或重放。

4. **Work Router**  
   匹配固定 Workflow、普通 Agent 对话或已有 Work Claim。

5. **Workflow Engine**  
   管理 Definition、Run、Node、Attempt、Wait、Resume、Retry 和 Cancel。

6. **Activation Controller**  
   在固定指派、受控志愿参与和 Human Choice 之间选择。

7. **Agent Runtime Port**  
   以稳定 Invocation Contract 调用 Pi、Codex、Native LLM 或其他 Runtime。

8. **Response Gate**  
   校验 Owner、Freshness、Approval、Dedup 和发布目标。

9. **Case Blackboard**  
   保存跨 Agent 的 Typed Shared State，不保存无边界聊天副本。

这些组件可以在同一进程内先实现，但契约和事实 Owner 必须分离。不要因为逻辑分层就立即拆成多个微服务。

---

## 13. 本研究不支持的说法

不得引用本文证明：

- Cumora 已实现通用 Workflow Engine；
- Cumora 已实现唯一 Response Owner；
- Cumora 的普通群聊只唤醒一个 Agent；
- Cumora 已验证企业级生产规模或合规性；
- Cumora 已证明 Blackboard 架构有效；
- Cumora 可以替代 MagicChat；
- Cumora 可以替代 Accord Case Coordinator；
- Cumora 可以替代 pi-ticket-planning 或 HerdrHarness-lite；
- Accord 应直接 Fork 或依赖 Cumora；
- TypeScript 是 Accord 生产语言。

语言选择属于单独 ADR，不由本研究决定。

---

## 14. 研究限制和失效条件

- 所有实现级结论只适用于 commit `90fd9ae8bc42a477168eb109717291dd567993f5`；
- Cumora `main` 已发生变化，重新引用当前版本前必须重新核查；
- “未发现 Workflow Engine”是有界否定；
- 本研究没有验证真实规模、性能、成本、合规和安全认证；
- 源码存在不代表 Accord 应复制其基础设施；
- 如果后续 Cumora 引入持久 Workflow、Response Claim 或新的 Agent 路由，应创建新研究 Revision，而不是静默修改历史结论；
- 架构决定发生变化时，应更新 VISION 或 ADR，不应让研究文档成为隐式决策源。

---

## 15. 主要源码索引

| 主题 | 固定版本源码 |
|---|---|
| Participant 与消息模型 | [`server/src/db/migrate.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts) |
| Persona 与团队名册 | [`server/src/agents/personas.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/personas.ts) |
| Scheduler 与 Wake | [`server/src/agents/scheduler.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts) |
| Triage | [`server/src/agents/triage-core.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/triage-core.ts) |
| BYOA Daemon | [`server/src/agents/computer/daemon.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts) |
| Freshness | [`server/src/agents/seen-boundary.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/seen-boundary.ts) |
| Agent CLI 与发送 Gate | [`server/src/agents/cli.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts) |
| Skill 加载 | [`server/src/agents/skills.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/skills.ts) |
| Agent Turn | [`server/src/agents/turn.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/turn.ts) |
| Runtime JWT | [`server/src/agents/runtime/jwt.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/jwt.ts) |
| Runtime 文件边界 | [`server/src/agents/runtime/fs-endpoints.ts`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/fs-endpoints.ts) |
| BYOA 官方说明 | [`docs/BYOA.md`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/docs/BYOA.md) |
