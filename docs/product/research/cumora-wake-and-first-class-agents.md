# Cumora Wake、一等 Agent 与工作流边界核查

- 状态：`LIVE_VERIFIED`
- 访问日期：2026-08-20
- 官方项目：[`yetone/cumora`](https://github.com/yetone/cumora)
- 核查版本：[`90fd9ae8bc42a477168eb109717291dd567993f5`](https://github.com/yetone/cumora/tree/90fd9ae8bc42a477168eb109717291dd567993f5)
- 官方站点：[`cumora.ai`](https://cumora.ai)
- 许可证：MIT，见 [`LICENSE`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/LICENSE)
- 证据规则：实现级结论只接受上述版本的官方源码、测试和文档；Accord 本地 README 只作为待核实线索。

## 最强结论

**Cumora 已实现“人与 Agent 共处同一通信与协作空间”的一等参与者模型，以及 durable inbox、事件唤醒、小模型 triage、独立 Agent 身份/工作区、群聊/私聊、BYOA Runtime、Freshness Hold 和部分防碰撞机制；但它不是“一个中央茉莉持续选择唯一负责人并运行正式工作流”的系统，也没有通用、版本化、可等待输入并恢复的 Workflow Definition/Run 引擎。**

因此 Accord 应采用：

```text
Cumora 风格的通信与协调语义
+ MagicChat 的企业身份、会话、审批和审计
+ Accord 自己的 Wake/Work Router
+ Accord 自己的持久化 Workflow Definition/Run
+ 明确的 Response Claim 与 Freshness Gate
```

不能把“预设工作流自动启动、缺信息追问并恢复、单一 Response Owner”描述为 Cumora 已有能力。

## 1. 人与 Agent 是否是一等参与者

### 已证实事实

- **FACT｜官方定位**：Cumora 把 AI Agent 和人类放在同一 roster、DM、群聊、Kanban 和 calendar 中。来源：[`README.md:1-20`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/README.md#L1-L20)。
- **FACT｜统一身份模型**：`participants` 同时保存 human 与 agent，消息统一使用 `author_id`，Conversation 统一保存 members。来源：[`server/src/db/migrate.ts:9-58`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L9-L58)。
- **FACT｜Agent Profile**：Agent Persona 至少包含 `id/name/role/style/model/companyId`；团队名册同时查询 human 与 agent。来源：[`server/src/agents/personas.ts:17-103`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/personas.ts#L17-L103)。
- **FACT｜Runtime 身份约束**：Runtime JWT 固定 `agentId + companyId`，CLI 会剥离客户端传入的身份参数，避免 Agent 冒充其他参与者。来源：[`server/src/agents/runtime/jwt.ts:9-28`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/jwt.ts#L9-L28)、[`server/src/agents/runtime/server.ts:82-106`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/server.ts#L82-L106)。
- **FACT｜私聊和拉群**：Agent-to-Agent DM 使用普通 direct conversation，不是隐藏工具通道；Agent 也可以创建临时群组。来源：[`server/src/agents/private_chat.ts:1-143`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/private_chat.ts#L1-L143)、[`server/src/agents/scanner_helper.ts:8-145`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scanner_helper.ts#L8-L145)。

### 对 Accord 的限制

“一等参与者”不代表权限完全相同。Accord 应让 Human 与 Agent 都拥有稳定身份、会话、DM、群聊、Topic 和消息能力，但风险接受、审批、生产授权和数据所有权仍必须归属于人类或企业策略。

## 2. Cumora 的 Wake/Inbox 到底怎样运行

### 已证实事件链

```text
消息先持久化到 Postgres
→ 发布 message-new 事件
→ Scheduler 找到会话中的 Agent 成员
→ 对 Cloud Agent 先做小模型 Triage
→ 对 BYOA Agent 发布 Wake，由本地常驻 Daemon 做 Triage
→ Agent 读取 durable inbox
→ Main Brain 判断是否回复或行动
```

- **FACT｜Durable inbox**：消息先落库，再发布事件；丢失 Wake 后可以通过 unread cursor 恢复。来源：[`server/src/api/router.ts:3291-3513`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/api/router.ts#L3291-L3513)。
- **FACT｜Wake 不是持续运行大模型**：Cloud 侧是事件驱动 Scheduler 和按需 Pod；BYOA 侧有常驻 Daemon，通过 SSE 和 20 秒轮询接收/补偿 Wake。来源：[`server/src/agents/scheduler.ts:275-418`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L275-L418)、[`server/src/agents/computer/daemon.ts:1095-1104`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L1095-L1104)。
- **FACT｜小模型只做 Gate**：Triage 只判断该 Agent 的 inbox 是否值得唤醒昂贵 Main Brain，不负责生成回复，也不决定谁回复。来源：[`server/src/agents/triage-core.ts:176-195`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/triage-core.ts#L176-L195)。
- **FACT｜Cloud/BYOA 差异**：Cloud Agent 在 Scheduler 侧 triage；BYOA Agent 直接收到 Wake，并由本地 Daemon 使用相同语义 triage。来源：[`server/src/agents/scheduler.ts:646-716`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L646-L716)。
- **FACT｜Debounce/Coalescing**：BYOA 默认 2.5 秒 debounce；运行中到达的新 Wake 合并为一次 pending rerun。来源：[`server/src/agents/computer/daemon.ts:1767-1865`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L1767-L1865)。

### 关键纠正

Cumora 不是“茉莉挑选一个 Agent 后只唤醒它”：

- **FACT**：在普通未静音群聊中，Scheduler 会并行唤醒所有非静音 Agent 成员；源码明确把它比作 Slack room。来源：[`server/src/agents/scheduler.ts:605-615`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L605-L615)。
- **FACT**：私聊总是投递；静音群只有 direct、精确 `@agent-id` 或引用该 Agent 消息时逃逸静音。来源：[`server/src/agents/scheduler.ts:617-636`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L617-L636)。
- **FACT**：Triage 输出中虽然存在 response mode 数据，但生产路径不使用它选择唯一回答者。聊天回复没有通用的原子 Response Claim。

所以 Cumora 的真实模型更接近：**广播 Wake + 每 Agent 独立判断 + 发送前防碰撞**，而不是中央 Router 的唯一指派。

## 3. 防碰撞与新鲜度

- **FACT｜Wake 去重**：多副本 Scheduler 使用 Redis `SET NX` 对同一 message wake 去重。来源：[`server/src/agents/scheduler.ts:421-436`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/scheduler.ts#L421-L436)。
- **FACT｜Freshness Hold**：群聊回复发送前比较 seen sequence；出现更新消息时返回 `HELD`，要求 Agent 重新判断。来源：[`server/src/agents/cli.ts:1659-1776`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1659-L1776)、[`server/src/agents/seen-boundary.ts:153-273`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/seen-boundary.ts#L153-L273)。
- **FACT｜重复拦截**：群聊存在读阶段和写阶段两层逐字重复检查，写阶段通过 conversation counter 锁关闭竞争窗口。来源：[`server/src/agents/cli.ts:1780-1827`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1780-L1827)、[`server/src/agents/cli.ts:1928-2001`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L1928-L2001)。
- **FACT｜真实工作 Claim**：重型共享工作使用 Redis 原子 Claim；Kanban Card Claim 使用数据库条件更新。但普通聊天回复没有等价的 Response Claim。来源：[`server/src/agents/runtime/inproc-client.ts:734-863`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/inproc-client.ts#L734-L863)、[`server/src/agents/cli.ts:5223-5259`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/cli.ts#L5223-L5259)。

### 已知限制

- Freshness 依赖 Redis seen baseline；缺失或 Redis 错误时部分路径 fail-open。
- 当前逐字重复和 Freshness Gate 主要覆盖群聊，2 人 DM 有例外。
- `thinking` 只是“正在思考”的提示，不是所有权锁。

因此 Accord 若要求“一条请求只有一个负责者”，应自行实现原子 `ResponseClaim`，不能只复制 Cumora 的 prompt etiquette。

## 4. Agent 独立能力、Skill、Memory 与 Runtime

- **FACT｜渐进式 Skill**：默认上下文只注入 Skill 名称和描述；Agent 需要时再读取完整 `SKILL.md`。来源：[`server/src/agents/skills.ts:1-28`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/skills.ts#L1-L28)、[`server/src/agents/skills.ts:236-256`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/skills.ts#L236-L256)。
- **FACT｜Memory Namespace**：Workspace、Memory、Log 和 Task 均以 `agent_id` 隔离；Runtime 文件接口使用 JWT subject 固定 Agent。来源：[`server/src/db/migrate.ts:383-438`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L383-L438)、[`server/src/agents/runtime/fs-endpoints.ts:75-113`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/runtime/fs-endpoints.ts#L75-L113)。
- **FACT｜两类 Runtime**：Cloud 使用受管 per-agent Pod；BYOA 使用本地 Claude Code/Codex，服务端不接触模型供应商密钥。来源：[`README.md:17-20`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/README.md#L17-L20)、[`docs/BYOA.md`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/docs/BYOA.md)。
- **FACT｜Session 差异**：BYOA 为每个 Agent 保存可恢复的 Claude/Codex session；Cloud 当前以独立 turn 为主，并非所有路径都有跨 Wake 的模型会话历史。来源：[`server/src/agents/computer/daemon.ts:899-1206`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/computer/daemon.ts#L899-L1206)、[`server/src/agents/turn.ts:2278-2308`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/turn.ts#L2278-L2308)。

## 5. Cumora 是否有正式 Workflow Engine

### 结论

**没有发现通用、版本化的 Workflow Definition/Run 引擎。**

在固定 commit 上对 `workflow definition`、`workflow run`、`definition_version`、`workflow_version`、`wait-for-input`、`resume-run`、`branch`、`retry-policy`、`step_id` 及相关文件名进行了源码搜索，没有找到产品级通用工作流定义、节点图或运行存储。

- `agent_runs` 记录单次 Agent Turn 的触发、输入、状态、指标和错误，不包含 definition、version、node、edge、wait token 或 retry policy。来源：[`server/src/db/migrate.ts:152-203`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/db/migrate.ts#L152-L203)。
- Agent 可以把当前 Turn 标记为 `needs_clarification`、`waiting`、`blocked` 等，但后续用户消息仍通过普通 inbox/wake 进入新 Turn，不是恢复一个持久化 Workflow Node。来源：[`server/src/agents/tools-shared.ts:47-58`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/tools-shared.ts#L47-L58)、[`server/src/agents/turn.ts:3053-3122`](https://github.com/yetone/cumora/blob/90fd9ae8bc42a477168eb109717291dd567993f5/server/src/agents/turn.ts#L3053-L3122)。
- Kanban、Calendar 和 Shipping 有各自状态，但不是可复用的多 Agent Workflow Definition/Run。

## 6. 用户预期、Cumora 实际与 Accord 设计

| 用户预期 | Cumora 已证实实现 | Accord 建议 |
| --- | --- | --- |
| 用户在群聊或 Bot 私聊提出任务 | 人与 Agent 共用 Group/DM；消息进入 durable inbox | 直接复用 MagicChat 的企业会话、Bot/App、ACL 和审计 |
| 茉莉持续 Wake、路由、指派 | Scheduler/Daemon 持续接收事件；普通群聊通常广播 Wake，没有中央唯一指派 | 把茉莉实现为事件驱动 Coordination Service，不让一个大模型常驻 |
| 信息不足时继续追问 | Agent 可标记 `needs_clarification` 并发消息，但没有持久 Workflow wait/resume | Workflow Run 增加 `WAITING_FOR_INPUT`、缺失字段、提问者、correlation 和 resume token |
| 自动匹配设计好的工作流 | 未发现通用 Workflow Definition/Run | Accord 自建版本化 Definition、Run、Node、Attempt、branch/join/retry/cancel |
| 过程调用多个能力 Agent | Agent 可 DM、拉群、使用 Board/Calendar 和独立 Skill/Memory | Workflow Node 通过 Agent Capability Registry 选择固定或策略性 Agent |
| 一条请求只有一个负责人 | Triage 不决定唯一回复者；群聊会广播 Wake | 原子 `ResponseClaim` 与 `WorkflowRun.ownerAgentId` 代码强制唯一责任 |
| Agent 和人类都是一等公民 | 同 roster、DM、group、board、calendar | 保留身份平等、权限不对称；Human 节点负责审批与风险决定 |
| 输出必须基于最新上下文 | 群聊存在 seen-sequence Hold 和重复拦截 | 使用持久 Freshness Token、Context Digest、发送前 CAS 和 Dedup Key |

## 7. 对 R001 交互模型的建议

R001 不应从“Coordinator 已经领取任务”开始，而应从用户自然消息开始：

```text
Human / Agent 在群聊或私聊发送消息
→ MagicChat 持久化消息并发布可靠事件
→ Wake Router 识别 DM、@mention、现有 Run correlation 和普通群聊
→ Work Router 匹配 Workflow Definition 或选择普通对话 Agent
→ 创建 Workflow Run 与唯一 Owner
→ 输入不足：Run 进入 WAITING_FOR_INPUT，由 Owner 在原会话提出一个问题
→ 用户回复后按 conversation + run + challenge 恢复同一 Run
→ Orchestrator 调用专业 Agent Node 与 Human Node
→ Reviewer / Policy Gate 检查结果
→ Freshness + Claim + Dedup 校验
→ Owner 在原会话发布唯一结果
```

需要明确拆分：

1. **Wake Router**：谁需要知道发生了消息。
2. **Work Router**：这是普通对话、已有 Run 的回复，还是某个 Workflow 的新实例。
3. **Workflow Engine**：持久化步骤、等待输入、恢复、失败和审计。
4. **Agent Runtime**：执行某个 Agent Node。
5. **Response Gate**：谁能发布、上下文是否最新、输出是否重复。

## 研究限制

- 结论只适用于 commit `90fd9ae8bc42a477168eb109717291dd567993f5`，后续版本可能变化。
- “未发现 Workflow Engine”是对固定源码树和明确标识符的有界否定，不排除未来版本或外部私有组件。
- 本研究确认设计机制，不证明 Cumora 的生产规模、安全认证、企业合规或真实采用效果。
