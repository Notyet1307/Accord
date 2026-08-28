# Lody Runtime Operation 与 Coding Workspace 研究

> 本文用于确定 Lody 在 Accord 架构中的准确位置，并为后续独立 Integration Release 提供事实基础。  
> 本文不是实现授权，不修改 R003，也不替代未来的 Accepted ADR、Delivery Spec 或 Ticket。

---

## 文档元数据

- `status`: RESEARCH
- `authority_level`: SUPPORTING
- `decision_owner`: 产品负责人
- `created_at`: 2026-08-27
- `last_verified_at`: 2026-08-27
- `accord_base`: `Notyet1307/Accord@dc736d11274e676f5f07965759b641b1d0cc2f34`
- `lody_source`: `LodyAI/Lody@953759639c59aa567628cb352477502b9d104080`
- `source_license`: Apache-2.0
- `scope`: Lody 的公开产品模型、Session/Task/Agent Role、Operation、机器调度、Worktree、CRDT 边界及其与 Accord 的映射
- `not_proven`: Lody 私有托管后端、生产 SLO、企业内网部署、长期兼容性、Accord Adapter 可行性、客户价值
- `implementation_authority`: NONE

`accord_base` 是本研究已对账的 Accord 快照；其后的 R003 实现切片不在本研究验证范围内，当前实现事实仍以代码、契约、迁移和测试为准。

---

# 1. 结论

Lody 对 Accord 的参考价值很高，但正确关系不是“用 Lody 替换 Accord”，也不是“把 Accord 改造成 Lody”。

准确定位是：

```text
Accord
    企业级 Case 治理、证据、Workflow、授权、审批、审计和可信结果协调平面

Lody
    可选的 Coding Agent Runtime、机器连接层和共享执行工作空间
```

Lody 最值得 Accord 借鉴的不是 UI 本身，而是以下稳定执行机制：

1. Task 意图与 Session 执行分离；
2. Agent Role 与运行中 Agent 分离；
3. Role 不保存秘密；
4. 机器、Agent Config 和运行选项精确绑定；
5. 不可用时不静默 fallback；
6. Stable Operation ID；
7. Canonical Command Fingerprint；
8. Operation 接受后冻结有效配置；
9. Operation 完成结果通过持久 Delivery 返回；
10. Session 创建、追加指令、取消、状态和历史的统一工具边界；
11. 机器侧后台调度；
12. Worktree 隔离；
13. Platform Capability / Port；
14. local-first/CRDT 只承担适合协作合并的状态。

Accord 不应继承：

- 以 Session 为产品中心；
- 将 Lody Task 直接等同于 Case；
- 将 Loro/Flock 作为 Approval、Claim、Workflow 或副作用确认权威；
- 将 Coding 专用对象强制写进所有 Case；
- 让 Lody 替代 HerdrHarness-lite 或 GitHub；
- 依赖未公开 Cloud Backend；
- 在当前 R003 中引入 Lody、ACP、Worktree、CRDT 或远程机器。

---

# 2. 研究方法与证据等级

## 2.1 证据类型

本文区分：

- **FACT**：在固定 Commit 的公开 README、文档、类型、代码或测试中可直接观察；
- **INFERENCE**：根据多个 FACT 对 Accord 的适配性作出的架构判断；
- **DECISION DIRECTION**：已经写入 Accord Vision 的长期方向，但不是具体实现授权；
- **UNKNOWN**：公开仓库无法证明。

## 2.2 主要来源

固定源：

- [Lody README.zh-CN.md](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/README.zh-CN.md)
- [Lody AGENTS.md](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/AGENTS.md)
- [Session 文档](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/site-docs/content/docs/zh/%28core-concepts%29/session.mdx)
- [Worktree 文档](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/site-docs/content/docs/zh/%28core-concepts%29/worktrees.mdx)
- [Agent Config 文档](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/site-docs/content/docs/zh/%28core-concepts%29/agents.mdx)
- [Task 类型](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/packages/shared/src/task-types.ts)
- [Task Index](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/packages/shared/src/task-index.ts)
- [Task Automation Scheduler](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/apps/cli/src/lib/task-automation/task-automation-scheduler.ts)
- [Session Orchestration Contract](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/packages/shared/src/session-orchestration.ts)
- [Operation Store](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/apps/cli/src/orchestration/operation-store.ts)
- [Lody MCP Server](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/apps/cli/src/mcp/lody-mcp-server.ts)
- [Review Contract](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/packages/shared/src/review.ts)
- [Apache-2.0 LICENSE](https://github.com/LodyAI/Lody/blob/953759639c59aa567628cb352477502b9d104080/LICENSE)

## 2.3 公开仓库边界

**FACT**

Lody 的公开仓库明确排除：

- hosted backend implementations；
- deployment/operator configuration；
- billing operations；
- private service secrets；
- Web 和移动端源码。

因此公开代码可以证明其本地 CLI、Electron、共享 package、协议和公开文档，但不能证明私有 Cloud Backend 的部署、数据模型、SLO、安全边界或企业可交付性。

---

# 3. Lody 产品模型

## 3.1 Workspace

**FACT**

Lody 将团队正在使用的 Coding Agents 组织到共享 Workspace 中：

- 团队成员可共享 Agent 对话；
- 可连接本地、工作站、服务器和云主机；
- 可从桌面、移动、Web 或 CLI 调度；
- 可查看运行状态、文件和代码改动；
- 机器默认保持私有，所有者主动共享后进入团队 Workspace。

**INFERENCE**

Workspace 适合作为 Coding Agent 的执行协作面，但不能替代 Accord 的 Case，因为 Workspace 是长期环境容器，不是围绕一个目标形成的治理和证据边界。

## 3.2 Session

**FACT**

Lody 将 Session 定义为基本对象，对应 Claude Code、Codex 等 CLI 的一次对话。

Session 可绑定：

- Repository / Project；
- Branch；
- Agent Config；
- Model；
- Permission 范围；
- 多个 UI Tab；
- 子对话、文件预览和 Diff；
- 可选 Worktree。

Session 可以 Fork；Fork 历史和后续回合独立，但原生 Fork 不一定创建独立 Worktree。

Session 可以归档和恢复。带 Worktree 的 Session 归档时可回收工作目录，并在移除前保存未提交改动。

**INFERENCE**

Session 是一次执行容器，最适合映射到 Accord 的 `RuntimeSessionRef`，而不是映射到 Case 或 Workflow Run。

## 3.3 Task

**FACT**

Lody Task 的 `status` 是声明性字段，用于表达工作处于哪个阶段。运行中、等待、PR 状态等活跃事实不存入 Task status，而从链接的 Session 和 PR 读取。

Task 支持：

```text
backlog
todo
in_progress
needs_review
done
canceled
```

Task 包含：

- 人类 owner；
- 可选 Agent ref；
- priority；
- labels；
- project refs；
- lastRunConfig；
- append-only Session/PR links；
- timeline comments and activities。

Task 的 Session/PR 关联是追加式记录，解除关联使用 tombstone，保留 Provenance。

**INFERENCE**

“意图对象与执行对象分离”是 Accord 应继承的原则。

但 Lody Task 仍不足以承载 Accord Case 的：

- Evidence Graph；
- Claims / Critiques；
- Workflow Runs；
- Human Decisions；
- Artifact revisions；
- External Outcomes；
-多领域对象。

因此：

```text
Lody Task != Accord Case
```

## 3.4 Agent Config

**FACT**

Agent Config 对多种 Code CLI / ACP Agent 做抽象，包含 Agent 类型和环境配置，可使用机器上已有的订阅登录，也支持环境变量和托管 Runtime。

公开文档包含 Claude Code、Codex、DeepSeek、Kimi、GLM、MiniMax、Qwen 等接入方向。

**INFERENCE**

Agent Config 更接近 Accord 的 `RuntimeBinding` 或其外部引用，不应直接等同于 `AgentProfile`。

## 3.5 Agent Role

**FACT**

Lody 根 `AGENTS.md` 规定：

- Agent Role 是 Workspace 中的一类共享配置；
- Role 不保存 API Key、MCP selection 或 memory；
- Role 可以锁定 permission mode；
- Role 精确绑定 `machineId + agentConfigId`；
- 机器、Config、Model 或 Mode 不可用时，Role 保持可见并给出原因，不 fallback；
- Role 有 revision；
- 接受 Operation 时冻结 Role revision 和 dispatch config；
- 后续编辑或删除 Role 不改变已接受 Operation 的恢复或重试；
- SessionMeta 记录 Role 来源，只用于展示。

**INFERENCE**

Accord 应明确分离：

```text
AgentProfile
    企业治理身份和 Capability

RuntimeBinding
    Runtime / Machine / AgentConfig / Permission

DelegationGrant
    持续自动化授权

RuntimeOperation Snapshot
    本次冻结的有效配置
```

直接使用一个 “Agent” 对象同时承载四类语义会导致权限、恢复和审计混乱。

---

# 4. Stable Operation 机制

## 4.1 Operation 类型

**FACT**

Lody 公开 `LodyOperationKind`：

```text
session_create
session_create_many
session_chat
session_chat_many
```

Operation 有：

- workspace；
- owner machine；
- requester Session / user；
- Operation ID；
- kind；
- fingerprint；
- canonical command；
- frozen continuation config；
- chain depth；
- created/deadline；
- active/finished；
- item results；
- completion；
- finished time。

默认 deadline 24 小时，允许 60 秒到 7 天；最大 chain depth 为 5；Command 和 Completion 有大小上限。

## 4.2 Canonical Command 与 Fingerprint

**FACT**

Lody 会：

1. 递归规范化对象；
2. 排序键；
3. 移除 `undefined`；
4. 序列化为 canonical JSON；
5. 以 `kind + canonical command` 计算 SHA-256 fingerprint。

Operation Store 以 requester Session + Operation ID 查找已有记录。

如果相同 Operation ID 绑定不同 kind 或 fingerprint，返回 `OPERATION_ID_REUSED` 错误。

**INFERENCE**

这是 Accord `RuntimeOperation` 应继承的核心契约：

```text
same operation_id + same fingerprint
    → recover / return existing

same operation_id + different fingerprint
    → reject
```

## 4.3 接受先于物化

**FACT**

Lody Operation Store 先把 Operation 写入 SQLite，再通过 materialization claim 负责创建目标 Session 或持久化输入。

Operation item 包含：

```text
active + inputDurable
succeeded
failed
cancelled
```

materialization claim 有 token 和 claim time，可在过期后重新认领。

**INFERENCE**

Accord 必须把以下顺序写成不变量：

```text
persist accepted Operation
→ freeze effective config
→ claim materialization
→ create/invoke external Runtime
```

而不是：

```text
call Runtime
→ success
→ write a record afterwards
```

## 4.4 Frozen Configuration

**FACT**

Lody Operation 保存 frozen config，包含输入配置和按 target 的 effective dispatch config。

公开规则进一步要求 Agent Role 的 Prompt、target、Role revision 和 dispatch config 在 Operation 接受时冻结。

**INFERENCE**

Accord 需要冻结：

- AgentProfile revision；
- RuntimeBinding revision；
- model / mode；
- Skill；
- Tool；
- permission；
- credential ref；
- Context Digest；
- output contract；
- budget；
- deadline。

## 4.5 Completion Delivery

**FACT**

Lody Operation 完成后：

- Operation 进入 finished；
- Completion 持久化；
- 插入 pending delivery；
- 使用确定性 delivery ID 和 system turn ID；
- requester 消费后标记 consumed；
- Store 开启时可修复终态 delivery；
- 终态数据有限保留期。

**INFERENCE**

Accord 不一定复制其 SQLite 表，但应复制外部行为：

```text
Operation completion
    先持久化
    再投递给发起 Activity / Workflow
    重放不会制造第二份完成
```

## 4.6 Cancellation

**FACT**

取消一个 active Operation 会以 `cancelled` completion 结束，并可保留 partial item results。

**INFERENCE**

Accord 必须区分：

- 逻辑 Operation 已取消；
- Runtime 是否接受停止；
- 外部 Session 是否仍运行；
- 已产生的文件或副作用如何处理；
- 迟到结果如何审计；
- Workflow 如何进入 Hold 或 Human Review。

## 4.7 SQLite 使用

**FACT**

Lody Operation Store 使用：

- `better-sqlite3`；
- WAL；
- foreign keys；
- busy timeout；
- 目录 `0700`；
-数据库 `0600`；
- SQLITE_BUSY retry；
- machine-scoped database path。

**INFERENCE**

这些实现细节可以作为 R003 后本地 Spike 的参考，但不能自动决定 Accord 生产持久化。

---

# 5. Session 编排工具面

## 5.1 MCP 工具

**FACT**

Lody MCP Server 公开的工具名包括：

```text
lody_session_create_options
lody_session_create
lody_session_create_many
lody_session_chat
lody_session_chat_many
lody_session_cancel
lody_session_list
lody_session_status_many
lody_session_history
lody_session_archive
lody_operation_get
lody_operation_cancel
```

同时包含 Task create/get/list/update/comment、Review submit、文件/图片上传等工具。

## 5.2 批量能力

**FACT**

Lody 为 Session create/chat 提供 batch Operation，允许多个 item 各自成功、失败或取消，并报告进度。

**INFERENCE**

Accord 第一版 Lody Adapter 不应立即暴露批量多 Session。

建议第一步只支持：

```text
one RuntimeOperation
→ one Lody Session
```

待单目标恢复语义验证后，再评估 batch。

## 5.3 输出边界

**FACT**

Lody 对 Session History、Task Body、Operation Completion、文件上传和批量项数量设置明确上限。

**INFERENCE**

Accord Adapter 不能把完整 Session Transcript 或无限 Diff 写入 Blackboard。应返回：

- bounded preview；
- truncation metadata；
- stable artifact/history ref；
-继续读取接口。

---

# 6. 机器侧调度

## 6.1 Task Automation Scheduler

**FACT**

Lody Task Scheduler 运行在机器侧：

- UI 关闭后仍可执行；
- 根据 Task Index 和本机 Agent Config 选择工作；
- 只执行当前 operator 拥有的 Task；
- 每个 Agent Config 控制一个 in-flight start；
- 合并突发 evaluate；
- Daemon 第一次启动只记录 baseline，不自动重放已有 backlog；
- Task 离开并重新进入 eligibility 后可被视为新事件；
- 机器不在线时等待；
- start 失败后释放槽并允许重试。

## 6.2 Accord 可借鉴

**INFERENCE**

Accord 可以借鉴：

- 后台常驻执行；
- 不依赖 UI 生命周期；
- 启动 baseline 防历史重放；
- 每个 Binding 并发槽；
- 明确 ownership；
- coalesced scheduling；
-失败释放 claim。

Accord 还必须增加：

- Delegation Grant；
- Work Claim / Lease；
- Cost Budget；
- Tenant / Case concurrency；
- Capability eligibility；
- Policy check；
- Cancellation；
- Freshness；
- duplicate work detection；
- audit。

---

# 7. Worktree 与 Coding 执行面

## 7.1 Worktree

**FACT**

Lody 为不同 Session 创建独立 Git Worktree：

```text
~/.lody/repos/<repoId>/
├── bare.git/
├── cache/
└── worktrees/
    ├── <sessionId-1>/
    └── <sessionId-2>/
```

创建任务时可：

1. 创建分支；
2. 创建 Worktree；
3. 执行 setup script；
4. 将改动同步到 UI。

归档时可运行 cleanup，回收目录。

## 7.2 Accord 映射

**INFERENCE**

```text
Lody Worktree
    → RuntimeSessionRef.worktree_ref

Diff / Files
    → Artifact Candidate

PR
    → GitHub authoritative ref

Merge / CI
    → GitHub or Harness Outcome
```

Worktree 不属于 Case 核心，不应成为所有 Agent Activity 的通用字段。

## 7.3 与 HerdrHarness-lite 的边界

Lody 和 HerdrHarness-lite 可能同时接触 Coding 执行，但职责不同：

```text
Lody
    Session、机器、Worktree、交互式 Agent 执行和工作空间

HerdrHarness-lite
    正式 Delivery Ticket、Attempt、Reviewer、恢复、验证和 Merge Gate
```

可选组合：

```text
Accord Case
→ Lody RuntimeOperation 产生候选改动
→ Harness 接收正式 Delivery Ticket 或验证候选
→ GitHub 提供 PR / CI / Merge
```

不应让 Lody 的 `done` 或 Session idle 直接等同于正式交付完成。

---

# 8. Review 能力

## 8.1 Lody Review

**FACT**

Lody 公开 Review Contract 包含：

- workspace review policy；
- machine reviewer config；
- per-session review run；
- frozen policy and reviewer；
- blocking/suggestion finding；
- blocking finding 必须提供具体 failure scenario；
- review rounds、CI fix、conflict budget；
- approve / request_changes；
- disputed finding 停止 Agent 争论；
- protected paths；
- review_only / review_and_merge；
- awaiting merge confirmation；
- merge-confirmed-once 机制。

## 8.2 可借鉴部分

**INFERENCE**

Accord 或 HerdrHarness-lite 可以借鉴：

- Review policy 在 Run 授权时冻结；
- blocking finding 要求可复现 failure scenario；
- dispute 触发 Human Gate；
- Reviewer budget；
- protected path；
- 第一次自动 Merge 要求人工确认。

## 8.3 不替代 Harness

Lody Review 是 Coding Workspace 内能力，不能自动取代 HerdrHarness-lite 的 Delivery Ledger、Reviewer、Analyst、rework 和 Merge 控制。

任何复用必须通过正式 Release 决定事实 Owner。

---

# 9. local-first 与 CRDT

## 9.1 已验证方向

**FACT**

Lody README 说明其 Workspace 将从共享对话扩展到文档和文档沙盒，使用 Loro Stack、Loro 和 Flock 表示并同步 CRDT 协作状态，并明确完整 local-first 支持仍在演进。

Task Index、Task 文档、Agent Role、Review policy 等公开代码大量使用 Flock/Loro。

## 9.2 适合 CRDT 的状态

**INFERENCE**

Accord 可借鉴 CRDT 到：

- Artifact Draft；
- 评论；
- 行级标注；
- Case Canvas；
- Presence；
- 非权威偏好；
- 离线协作笔记。

## 9.3 不适合 CRDT 的状态

以下状态需要明确唯一性、CAS、事务、单调 revision 或不可变决定，不能以普通 CRDT 最后合并结果作为权威：

- Approval / Rejection；
- Delegation Grant；
- Work Claim / Response Claim；
- Runtime Operation fingerprint；
- Budget consumption；
- Workflow completion；
- Accepted Artifact revision；
- external side-effect confirmation；
- GitHub/Harness/Planner authority projection。

因此目标关系是：

```text
Transactional Authority
    Case / Workflow / Claim / Approval / Operation / Outcome Ref

CRDT Collaboration
    Draft / Comment / Annotation / Canvas / Presence
```

---

# 10. Accord 与 Lody 对象映射

| Lody | Accord 对应位置 | 说明 |
|---|---|---|
| Workspace | Execution Workspace Ref | 长期执行环境，不是 Case |
| Task | 可选 External Work Ref / Runtime Task Ref | 不等同于 Case 或 Delivery Ticket |
| Session | RuntimeSessionRef | 一次外部执行会话 |
| Agent Config | RuntimeBinding.agent_config_ref | 机器上的执行配置 |
| Agent Role | Runtime Binding Template / Selection Profile | 不是运行中 Agent 或授权 |
| Machine | RuntimeBinding.machine_ref | 外部执行位置 |
| Worktree | RuntimeSessionRef.worktree_ref | Coding 专用隔离目录 |
| Operation | RuntimeOperation | 最值得继承的稳定执行边界 |
| Operation Item | RuntimeAttempt / target result | Batch 时使用 |
| Task owner | 外部工作项 owner | 不自动等同 Case owner |
| Task agent | 外部 automation assignment | 必须映射到 Accord authorization |
| Review Run | External Review Activity Ref | 不替代 Harness |
| PR Link | GitHub Ref | GitHub 仍是权威 |
| Flock/Loro doc | Collaboration Document Ref | 不能承载治理权威 |

---

# 11. 目标 Accord Runtime 数据模型

## 11.1 AgentProfile

```text
AgentProfile {
  id
  tenant_id
  name
  role
  capabilities[]
  skill_bindings[]
  tool_policy
  model_policy
  collaboration_policy
  revision
  digest
}
```

## 11.2 RuntimeBinding

```text
RuntimeBinding {
  id
  agent_profile_id
  runtime_adapter_id        // lody
  machine_ref
  agent_config_ref
  agent_role_ref?
  model / mode
  permission_mode
  credential_ref
  supported_capabilities[]
  availability
  revision
  digest
}
```

## 11.3 DelegationGrant

```text
DelegationGrant {
  id
  granted_by
  agent_profile_id
  scope
  allowed_actions[]
  max_cost
  max_concurrency
  valid_until
  status
  policy_revision
}
```

## 11.4 AgentActivity

```text
AgentActivity {
  id
  case_id
  workflow_run_id
  node_id
  agent_profile_id
  authorization_ref
  purpose
  input_contract
  output_contract
  state
}
```

## 11.5 RuntimeOperation

```text
RuntimeOperation {
  id
  case_id
  workflow_run_id
  node_id
  agent_activity_id

  kind
  canonical_input
  input_fingerprint

  agent_profile_revision
  runtime_binding_revision
  frozen_config
  context_digest
  output_contract_digest

  deadline
  budget
  state
  accepted_at
  completed_at

  runtime_session_ref
  result_digest
  usage
  error
}
```

## 11.6 RuntimeAttempt

```text
RuntimeAttempt {
  id
  operation_id
  attempt_no
  state
  materialization_claim
  external_request_ref
  external_session_ref
  started_at
  completed_at
  result_digest
  error
}
```

---

# 12. Lody Adapter 目标接口

## 12.1 Accord 侧 Port

```text
interface AgentRuntimePort {
  acceptOperation(input): AcceptedOperation
  getOperation(operationId): OperationSnapshot
  cancelOperation(operationId): CancelResult
  collectResult(operationId): RuntimeResult
}
```

可以增加能力发现：

```text
getCapabilities(binding): RuntimeCapabilities
```

但能力结果不能自动授予权限。

## 12.2 acceptOperation

输入至少包括：

```text
operation_id
canonical_prompt
input_fingerprint
runtime_binding_snapshot
work_context
deadline
budget
output_contract
context_digest
```

Adapter 应使用 Operation ID 或派生稳定 ID 与 Lody Operation 关联。

## 12.3 getOperation

返回：

```text
accepted
materializing
running
waiting
succeeded
failed
cancelled
unknown
expired
```

以及：

- observed_at；
- external_session_ref；
- bounded progress；
- retryability；
- explicit unavailable reason。

## 12.4 collectResult

只返回受界限结果：

```text
text_preview
truncated
omitted_bytes
artifact_refs[]
diff_ref?
file_refs[]
usage
runtime_metadata
result_digest
```

## 12.5 不允许的 Adapter 行为

- 自动选择不同 Agent Role；
- 自动换机器；
- 自动降低权限检查；
- 自动换模型；
- 自动新建不同 Operation；
- 把完整 Session History 写进 Board；
- 直接标记 Case completed；
- 直接创建 Human Approval；
- 直接将 PR 视为 merged；
- 直接写 Harness Ledger。

---

# 13. 身份、权限与秘密

## 13.1 身份层

至少区分：

```text
Human Identity
Accord AgentProfile Identity
Lody Workspace User
Lody Agent Config
Runtime Machine
Runtime Session
External Provider Account
```

不要用单个字符串 “agent_id” 同时表示所有对象。

## 13.2 秘密

秘密只能通过受管引用进入 Runtime：

```text
credential_ref
```

不得保存到：

- AgentProfile；
- DelegationGrant；
- BoardEntry；
- Lody shared Agent Role；
- Case Artifact；
-普通 Audit；
- Prompt；
- Session 标题；
- Runtime result preview。

## 13.3 Permission Mode

Lody Agent Role 可锁定 permission mode，因此 Accord UI 和审计必须明确展示高风险模式。

Role 选择不等于 Human Approval。即使 Role 使用 full-access，外部副作用仍必须满足 Accord Workflow 和领域 Gate。

## 13.4 Egress

Lody Session 可能调用外部模型、GitHub 或工具。

Integration Release 必须明确：

- 允许网络目标；
- 数据分类；
- Prompt/附件是否可外发；
- provider endpoint；
- credential owner；
-日志保留；
- redaction；
-停止条件。

---

# 14. 失败与恢复模型

## 14.1 必须区分的状态

```text
Operation accepted
Input durable
Session materialized
Agent running
Agent idle
Agent output available
Result collected
Result committed to Board
Artifact accepted
External Outcome confirmed
```

这些状态不能压缩成一个 `done`。

## 14.2 故障矩阵

| 故障 | Accord 行为 |
|---|---|
| Lody daemon offline | Operation 保持 accepted/waiting 或明确 unavailable；不 fallback |
| Agent Config missing | 返回精确不可用原因；不选择相似 Config |
| Role edited after accept | 使用 frozen snapshot |
| Session create 超时 | 查询 Operation/Session；无法判断则 UNKNOWN |
| Prompt durable but Agent not started | 恢复同一 Operation，不生成新逻辑 ID |
| Agent output ready, Accord crash | 重启后 collect 同一 Operation |
| Result duplicated | fingerprint/digest/freshness 阻止二次提交 |
| Result stale | 保留审计，进入 HOLD |
| Cancel request timeout | 区分 local cancelled 与 external unknown |
| Worktree has changes after cancel | 形成 Artifact/Recovery decision，不静默删除 |
| History too large | bounded read + explicit truncation |
| GitHub unavailable | PR/CI projection 标记 stale/unknown |
| Harness unavailable | 不声称正式 Delivery 完成 |
| Credential unavailable | 明确失败；不切换账户 |
| Permission request waiting | Workflow 显示 Waiting Human/Runtime，不伪装 running |

## 14.3 Exactly-once 声明

除非 Lody 和底层 Agent/Provider 提供明确 idempotency 和 result retrieval，否则只能保证：

```text
one logical Accord RuntimeOperation result is committed
```

不能保证：

```text
underlying model or tool executed physically exactly once
```

物理重复执行和成本需要审计。

---

# 15. Post-R003 Integration Spike

## 15.1 前置条件

- R003 已完成或明确结束；
- 创建独立、Accepted 的 Integration Release；
- 选择 Lody 固定 Commit/Release；
- 决定 Adapter 协议；
- 明确运行环境、账户、模型和数据；
- 明确是否需要新 ADR；
- 不复用生产凭据和真实客户数据。

## 15.2 最小场景

```text
Synthetic Coding Request
→ Accord Case
→ Fixed Workflow Node
→ AgentActivity
→ RuntimeOperation
→ Lody Session
→ Isolated Worktree
→ Bounded Diff / Artifact Candidate
→ Review / Human Gate
→ Final ArtifactRef
→ Unique Response
```

## 15.3 验收场景

### IDENTITY-01：重复接受

相同 Operation ID 和相同输入返回同一逻辑 Operation。

### IDENTITY-02：ID 冲突

相同 Operation ID 和不同输入被拒绝。

### FREEZE-01：Role 修改

Operation 接受后修改 Role，不改变本次执行。

### FREEZE-02：Binding 删除

Binding 删除后，新 Operation 失败；已接受 Operation 使用 frozen snapshot 恢复，或明确无法恢复。

### FAILURE-01：Daemon 离线

不创建隐式备用 Session。

### FAILURE-02：未知物化结果

Session create 超时后查询；无法判断则 UNKNOWN。

### RECOVERY-01：Accord 崩溃

重启后恢复同一 Operation 和 Session Ref。

### CANCEL-01：取消

取消后迟到结果不能提交。

### OUTPUT-01：结果边界

超大 History/Diff 明确截断并返回引用。

### AUTH-01：一次性授权

一次性选择 Agent 不创建持久 Delegation。

### AUTH-02：高风险权限

full-access Role 仍不能绕过 Human Gate。

### AUTHORITY-01：GitHub

Lody 产生 PR ref，但 Merge 结果只从 GitHub 获取。

### AUTHORITY-02：Harness

Lody 完成不自动完成正式 Delivery Ticket。

### RESPONSE-01：唯一发布

Case 最终只有一个 Response Owner 和一次用户可见发布。

## 15.4 评价指标

- Operation duplicate rate；
- unknown outcome rate；
- recovery success；
- unintended fallback count；
- frozen-config consistency；
- Session create latency；
- result collection latency；
- context size；
- output truncation rate；
- human intervention；
- coding artifact acceptance；
- Runtime cost；
- adapter failure classification accuracy。

## 15.5 停止条件

- 必须依赖未公开私有后端；
- Operation ID 无法稳定映射；
- 无法区分 accepted/materialized/completed；
- 无法阻止 silent fallback；
- Session/Task 被迫成为 Case 权威；
- 秘密必须进入共享 Role 或 Board；
- 取消和迟到结果无法治理；
- 无法获得 bounded result；
- Lody 与 Harness/GitHub 事实 Owner 冲突；
- 需要先建设完整多 Runtime 平台。

---

# 16. 采用路径

## 16.1 当前采用边界

- README、VISION 和 AGENTS 可引用本研究的方向性结论，但不得把它提升为实现授权；
- 保持 R003 不变；
- 后续规划时使用 `RuntimeOperation`、`RuntimeBinding` 和 `DelegationGrant` 术语；
- 将 Lody 记录为可选 Runtime Reference；
- 未来 Release 开始前重新固定并验证 Accord 与 Lody 的当前 Commit。

## 16.2 R003 完成后

1. 形成 `RuntimeOperation Foundation` Release；
2. 实现或验证稳定 Operation 契约；
3. 独立设计 Lody Adapter Spike；
4. 只支持 one Case / one Activity / one Session；
5. 验证失败和恢复；
6. 再决定是否进入正式 Coding Case。

## 16.3 暂不做

- Fork Lody 作为 Accord 主仓库；
- 替换 MagicChat；
- 替换 Harness；
- 将 Lody Task 作为 Case；
- 将 Loro/Flock 作为 Accord 核心数据库；
- 同时接入多个 Runtime；
- 构建 Runtime Marketplace；
- 做多机器智能调度；
- 做自动 Merge；
- 复制私有 Cloud Backend。

---

# 17. 许可证与上游风险

## 17.1 许可证

**FACT**

Lody 公开仓库使用 Apache License 2.0。

如果复制代码，需要：

- 保留许可证；
- 保留版权和 NOTICE 要求；
- 记录修改；
- 检查 `THIRD_PARTY_NOTICES.md`；
- 不假设 submodule 或托管 Runtime 与主仓库使用相同许可。

仅借鉴架构思想和重新实现契约，仍应在研究材料中保留来源说明。

## 17.2 上游风险

Lody 是高速演进项目。风险包括：

- API/Schema 变化；
- ACP 能力变化；
-公开与私有组件边界变化；
- Session/Operation 行为变化；
- mobile/Web 能力不可复用；
- local-first 实现仍在演进；
-无稳定 Release 或兼容承诺时的升级成本。

任何 Adapter 应：

- pin Commit/Release；
- 做 Contract Test；
-记录 capability；
-明确最小支持版本；
-使用 feature detection；
-不根据 CLI 版本猜 capability；
-允许禁用 Adapter；
-失败时不影响 Accord 其他 Runtime。

---

# 18. 未知问题

公开证据尚不能回答：

1. Lody 私有 Cloud Backend 能否企业内网部署；
2. Cloud 数据驻留、租户隔离和 SLO；
3. ACP 各 Agent 的 Session 恢复一致性；
4. 跨机器 Operation 的网络分区语义；
5. Secret Store 和企业凭据集成；
6. 大规模 Workspace 的 CRDT 成本；
7. Lody Task automation 与复杂 Lease 的可靠性；
8. Worktree setup/cleanup 在不可信仓库中的安全沙箱；
9. 多人同时控制同一 Session 的权限冲突；
10. Lody Review 与 HerdrHarness-lite 的最佳整合边界；
11. Lody 的公开 API 是否足够支持无私有后端 Adapter；
12. 长期版本兼容策略；
13. 国内企业环境下的 Agent Provider 和网络策略；
14. 端到端成本和稳定性。

这些问题应在实际 Release 中逐项收窄，不能由研究推断填空。

---

# 19. 研究结论摘要

```text
Keep:
    Accord Case / Blackboard / Workflow / Approval / Authority

Adopt as concepts:
    Task vs Session
    Agent Role vs active Agent
    RuntimeBinding
    Stable Operation
    Fingerprint
    Frozen Config
    No Fallback
    Machine-side Scheduling
    Worktree Isolation
    Capability Port
    Bounded Output

Integrate optionally:
    Lody as Coding Agent Runtime / Workspace

Do not adopt:
    Session-centered Accord
    Lody Task as Case
    CRDT as governance authority
    Lody Review as Harness replacement
    Private backend dependency
    R003 scope expansion
```

最终定位：

> **Accord 决定任务为什么存在、依据什么、谁被授权、哪些 Gate 必须通过以及现实结果由谁证明；Lody 可以负责把其中一次受约束 Coding Agent Activity 放到明确的机器、Agent、Session 和 Worktree 中执行。**
