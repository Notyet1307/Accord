# ADR-0002：Accord 生产协调平面的实现语言

- **Status**: PROPOSED
- **Date**: 2026-08-21
- **Decision owner**: 产品负责人
- **Applies to**: Accord 生产 Coordination Plane
- **Recommended path**: `docs/adr/0002-production-coordination-runtime-language.md`
- **Supersedes**: 无
- **Related**:
  - `docs/product/VISION.md`
  - `docs/adr/0001-r002-non-production-walking-skeleton-boundary.md`
  - `docs/product/research/cumora-wake-and-first-class-agents.md`

> 将本文状态改为 `ACCEPTED` 之前，它只是推荐方案，不是实现授权。  
> README、VISION、Release、Delivery Spec 和 Ticket 不应复制本文的完整理由。

---

## 1. 决策问题

Accord 的生产协调平面应以 TypeScript/Node.js、Go 还是 Rust 为主要实现语言，才能在可靠性、集成成本、迭代速度、AI 可维护性和未来演进之间取得最合理的平衡？

这里的“生产协调平面”包括：

- Case Coordinator；
- Governed Case Blackboard；
- Workflow Definition/Run；
- Agent Activation、Work Claim 和 Response Claim；
- Context Assembly；
- Human Input/Approval Gate；
- Freshness、Dedup 和 Audit；
- Runtime Adapter；
- Planner、Harness、GitHub 和企业系统 Adapter；
- 对外 API 与后台任务。

本 ADR 不决定：

- MagicChat 核心的实现语言；
- R002 Go Reference Harness 的去留；
- 外部 Agent Runtime 自身的语言；
- 前端框架；
- 数据库、消息队列或部署平台；
- 高风险沙箱、浏览器隔离或原生安全组件的语言。

---

## 2. 推荐决策

选择：

> **TypeScript + Node.js Active LTS 作为 Accord 生产协调平面的主要实现语言。**

同时保留以下边界：

1. **R002 仅保留为历史证据**
   R002/r3 已进入 HOLD。ADR-0001、Go Reference Harness 的既有结果和故障语义只作为 R002 范围内的历史证据；本提案只继承 stable identity、wait/resume、Human Approval、Response Claim、deterministic idempotency、Freshness、Dedup、crash recovery 和 audit 等外部行为约束，不授权继续交付或重写 R002 Harness。

2. **MagicChat 保持外部 Go 系统**  
   Accord 通过官方 App WebSocket/API 集成，不为统一语言而 Fork 或直接访问 MagicChat 数据库。

3. **Rust 暂不用于初始生产核心**  
   只有出现经过测量的性能、内存安全、原生隔离、WASM Host 或高风险本地执行需求时，再为独立组件创建新的 ADR。

4. **跨语言边界使用语言无关契约**  
   外部接口使用 JSON Schema、OpenAPI、Protobuf 或等价的版本化契约；不得把 TypeScript 类型本身当作跨进程协议。

---

## 3. 第一性原理

语言选择取决于五类变量：

```text
任务负载
集成邻接
可靠性来源
团队认知成本
未来重写成本
```

### 3.1 任务负载

Accord 核心主要执行：

- WebSocket 和 HTTP 事件接收；
- 数据库读取、事务和状态转换；
- JSON/Schema 验证；
- LLM、Pi、Codex、GitHub 和 Harness 调用；
- 长时间等待 Human Input 或外部结果；
- Outbox、Inbox、Retry、Timeout 和 Audit；
- 少量规则判断和上下文组装。

这是以网络、数据库和外部 Runtime 为主的 **I/O-bound Coordination Workload**，不是持续 CPU 密集型计算。

Node.js 官方说明其标准库提供异步 I/O，非阻塞行为适合处理大量并发网络连接：

- <https://nodejs.org/learn>

这使 TypeScript/Node.js 在当前负载下没有结构性劣势。CPU 密集或不可信任务应放入独立 Worker/Runtime，而不是阻塞 Coordination Process。

### 3.2 集成邻接

当前相邻项目事实：

- `pi-ticket-planning` 使用 Node.js ESM，要求 Node `>=22.16.0`：  
  <https://github.com/Notyet1307/pi-ticket-planning/blob/main/package.json>

- `HerdrHarness-lite` 使用 TypeScript、Node.js ESM，要求 Node `>=22.16.0`：  
  <https://github.com/Notyet1307/HerdrHarness-lite/blob/main/package.json>

- Cumora 的 Server、Agent Scheduler、Runtime 和前端均主要位于 TypeScript 生态：  
  <https://github.com/yetone/cumora/blob/main/package.json>

- MagicChat Server 使用 Go，但 Accord 已验证的集成缝是 App WebSocket，而不是进程内 Go API：  
  <https://github.com/chaitin/MagicChat/blob/main/server/go.mod>

因此 TypeScript 可以降低以下成本：

- Planner/Harness Adapter 的重复 DTO；
- Pi SDK、CLI 和 Session 集成；
- Agent Profile、Board Entry、Workflow Contract 的类型共享；
- AI 在多个仓库之间切换语言时的上下文成本；
- 小团队维护多个生产语言的认知负担。

### 3.3 可靠性来源

Accord 的主要风险不是裸指针或手工内存管理，而是：

- 错误的事实 Owner；
- 重复 Run、重复副作用和重复发布；
- 过期上下文输出；
- 未授权读取、外发和执行；
- 错误 Case/Workflow 关联；
- Agent 生成内容被误当成事实；
- 外部 Runtime 无法恢复结果；
- 审批被绕过。

这些风险主要由以下机制控制：

```text
Typed Contract
Runtime Schema Validation
Database Constraint
Transaction / CAS
Stable Business ID
Inbox / Outbox
Idempotency Key
Lease
Freshness Token
Human Approval
Audit Trace
Independent Verification
```

Rust 的内存安全和线程安全非常有价值，但不能替代上述领域可靠性。Rust 官方对其性能和内存/线程安全优势的说明见：

- <https://rust-lang.org/>

### 3.4 团队认知成本

Accord 目前仍在验证产品形态、Case/Blackboard/Workflow 边界和首个真实场景。此阶段最大的风险是：

```text
把错误的产品抽象实现得非常坚固
```

TypeScript 的优势不是“永远性能最好”，而是：

- 与现有相邻项目一致；
- 结构化对象和协议表达直接；
- LLM/Agent SDK 更新通常更容易接入；
- AI 能同时理解代码、Schema、测试和前端契约；
- 快速形成 Walking Skeleton 后仍可通过严格类型和运行时验证收紧。

TypeScript 官方将其定位为在 JavaScript 上增加静态类型和工具能力：

- <https://www.typescriptlang.org/>

### 3.5 未来重写成本

生产核心采用 TypeScript 不代表所有组件永久使用 TypeScript。

只要领域边界清晰，未来可以把经过测量的热点拆成：

- Go 网络 Gateway；
- Rust Sandbox/WASM Host；
- 独立 Python 数据或模型 Worker；
- 专用 Go/Rust CLI。

当前应避免在没有性能证据时先承担全局 Rust 复杂度，或为了接近 MagicChat 而把所有 Agent/Planner/Harness Adapter 迁入 Go。

---

## 4. 候选方案比较

| 维度 | TypeScript / Node.js | Go | Rust |
|---|---|---|---|
| 当前 I/O 协调负载 | 很适合 | 很适合 | 适合 |
| 与 Pi/Planner/Harness 邻接 | 最强 | 需要跨语言 Adapter | 需要跨语言 Adapter |
| 与 MagicChat Server 邻接 | 通过协议接入即可 | 语言一致，但仍不应进程内耦合 | 无直接优势 |
| 类型表达和 JSON Contract | 强，但必须加运行时验证 | 强，结构简单 | 最强但实现成本高 |
| 单二进制与部署 | 一般 | 强 | 强 |
| 并发服务和资源效率 | 足够，需避免阻塞 Event Loop | 强 | 最强 |
| 迭代速度 | 最快 | 快 | 相对慢 |
| 小团队与 AI 维护成本 | 最低 | 中等 | 最高 |
| 当前性能证据要求 | 满足 | 满足 | 过度 |
| 适合作为首个生产核心 | **是** | 可行但次优 | 暂不建议 |

Go 官方强调其对 Cloud/Network Service、并发、CLI 和可维护服务的适配：

- <https://go.dev/solutions/use-cases>
- <https://go.dev/solutions/cloud>

因此 Go 不是错误选择；它只是对当前 Accord 的生态邻接和迭代目标不如 TypeScript。

---

## 5. 为什么不选择 Go 作为唯一主语言

Go 的主要优点：

- 单二进制；
- 启动快、资源稳定；
- Goroutine 和标准库适合长运行网络服务；
- 运维和部署简单；
- 与 MagicChat Server 同语言。

但当前不选择它作为 Accord 唯一主语言，原因是：

1. MagicChat 是外部权威系统，语言相同不应成为直接耦合理由；
2. Pi、pi-ticket-planning 和 HerdrHarness-lite 已经处于 Node/TypeScript 生态；
3. Accord 当前最大的工作量是协议、状态、Adapter 和产品迭代，而不是底层网络性能；
4. 选择 Go 会增加 TypeScript 与 Go 之间的 Contract 生成、测试和调试边界；
5. 小团队同时维护 MagicChat、Go Harness、Go Coordination Core、TypeScript Runtime Adapter 会增加上下文成本。

Go 仍适合：

- 未来已承诺 Release 在满足 R002/r3 reopen condition 后明确选择的独立 Conformance 组件；
- 后续高吞吐、低资源常驻 Gateway；
- 与 MagicChat 紧邻但保持协议隔离的边界工具；
- 独立 CLI 或运维 Agent。

这些新增用途必须由实际需求和单独 ADR 决定。

---

## 6. 为什么暂不选择 Rust 作为主语言

Rust 的主要优点：

- 无垃圾回收；
- 可预测性能和较低资源占用；
- 编译期内存安全和线程安全；
- 适合高性能网络、原生工具、WASM 和安全边界。

但当前不选择它作为 Accord 主语言，原因是：

1. 当前没有 CPU、内存或延迟瓶颈证据；
2. Accord 的核心风险主要是权限、状态、幂等、来源和恢复，不是内存破坏；
3. Pi、Planner、Harness 和多数 Agent SDK 邻接需要额外跨语言层；
4. 产品与架构仍在演进，Rust 会提高抽象变更和 AI 修复成本；
5. 把整个协调平面写成 Rust 不会自动使 Workflow、Approval 或事实权威正确。

Rust 更适合未来独立组件：

- 不可信插件或代码执行 Host；
- WASM Runtime；
- 本地凭据代理；
- 高吞吐内容扫描；
- 高性能协议代理；
- 经过 Profiling 证明的热点路径；
- 需要强内存隔离属性的安全组件。

---

## 7. TypeScript 方案必须满足的工程约束

选择 TypeScript 不是选择“动态、宽松、快速堆代码”。

### 7.1 工具链

- 使用 Node.js **Active LTS**；
- 具体 Node、TypeScript 和包管理器版本在仓库工具链中固定；
- 与 Planner/Harness 的最低 Node 版本保持兼容；
- 使用 ESM；
- 启用 `strict`、`noUncheckedIndexedAccess` 和适用的严格编译选项；
- 禁止在核心 Contract 中使用无边界 `any`；
- CI 必须执行 Typecheck、Unit、Integration 和 Conformance Test。

### 7.2 契约

- TypeScript Interface 只负责进程内静态检查；
- 进程、数据库、消息和 Runtime 边界必须运行时验证；
- Contract 必须版本化；
- 稳定 ID 使用明确类型，不使用随意字符串拼接；
- Schema 变更必须提供兼容策略或迁移；
- 外部 Adapter 不能直接泄漏供应商 SDK 类型到核心领域。

### 7.3 可靠性

- Workflow 状态转换通过事务或 CAS；
- 所有副作用使用稳定 Idempotency Key；
- 消息消费遵循持久 Inbox/Outbox；
- Response Claim、Approval 和 Publication 必须持久化；
- 不依赖内存中的 Promise 或 EventEmitter 证明完成；
- 重试必须区分“可以重算”和“必须恢复既有结果”；
- CPU 密集任务不得阻塞 Event Loop；
- 不可信代码不得在 Coordination Process 内执行。

### 7.4 架构

建议先使用 **模块化单体**，不要立即拆微服务：

```text
apps/
└── accord-server/

packages/
├── contracts/
├── case-core/
├── board-core/
├── workflow-core/
├── coordination-core/
├── context-assembler/
├── runtime-ports/
├── adapters/
├── audit/
└── testkit/
```

逻辑模块可以有独立 Owner 和 Contract，但第一阶段共享一个部署单元和同一事务边界。外部行为 Conformance 的实现、位置和语言由后续已承诺 Release 决定；本提案不继承 `conformance/r002-go` 作为生产布局。

---

## 8. 与 R002 历史证据的关系

ADR-0001 仅规定 R002 范围内的非生产边界；R002/r3 已进入 HOLD。其 Release、ADR、Go Reference Harness 既有结果和故障证据继续保留，但不构成本 ADR 的生产架构输入。

本 ADR 若接受：

- 只继承 stable identity、wait/resume、Human Approval、Response Claim、deterministic idempotency、Freshness、Dedup、crash recovery 和 audit 等外部行为约束；
- 不要求保留、运行、重写或交付 R002 Go Harness；
- 不继承 Atomic JSON Store、单进程部署或 R002 内部模块划分；
- Production Core 必须在其自身 walking skeleton 中直接验证适用的外部行为；
- 只有这些行为无法在新的 production walking skeleton 中直接验证时，后续已承诺 Release 才能按 R002/r3 的 reopen condition 重新打开 R002。

---

## 9. 后果

### 正向后果

- 与现有 Planner、Harness 和 Pi 生态一致；
- 共享 Contract、测试工具和 Adapter 的成本较低；
- 更适合快速验证 Case、Blackboard 和 Workflow 产品边界；
- Agent/LLM SDK 接入路径直接；
- 前后端和工具链可以复用部分类型与测试基础设施；
- AI 跨仓库理解和修复的语言切换减少。

### 负向后果

- 若后续 Release 另行选择 Go Conformance 组件，生产仓库可能同时存在 TypeScript 与 Go；
- Node.js 需要明确 Event Loop、内存、Backpressure 和 Shutdown 纪律；
- TypeScript 类型会在运行时擦除，必须额外执行 Schema Validation；
- 单二进制分发和极低资源运行不如 Go/Rust；
- 如果模块边界控制不严，容易形成大型耦合应用。

这些风险通过版本化外部行为约束、严格类型、运行时 Schema、模块化单体和持久状态约束控制。

---

## 10. 重新打开本决策的条件

满足任一条件时，应创建新 ADR 重新评估：

- Profiling 证明 Coordination Core 存在 TypeScript 无法合理解决的 CPU 或内存瓶颈；
- 明确 SLO 无法通过水平扩展、队列和数据层优化满足；
- 需要在 Accord 内运行不可信 Native Plugin 或 WASM；
- 需要高保障本地凭据、密钥或系统调用代理；
- Accord 必须修改或嵌入 MagicChat Core，而不再只通过 App Protocol；
- 主要相邻 Runtime 和领域控制器迁离 TypeScript 生态；
- 团队长期维护能力发生显著变化；
- Node.js Active LTS 或关键依赖无法满足企业部署约束；
- Conformance Test 证明语言运行模型引发无法接受的恢复缺陷。

不得仅因为“Rust 更先进”“Go 更稳定”或“统一语言看起来更整洁”而重开。

---

## 11. 文档归属

语言决定的唯一权威位置是本 ADR。

其他文档只能这样引用：

### README

只写：

```text
生产实现语言由 Accepted ADR 决定。
```

可以链接本 ADR，但不复制完整比较和理由。

### VISION

保持技术中立，只声明：

```text
生产语言、数据库和部署形态由适用 Accepted ADR 决定。
```

VISION 不应因为本 ADR 接受而变成技术栈文档。

### Release / Delivery Spec / Ticket

- 引用本 ADR；
- 明确本次使用哪些模块和版本；
- 不重新讨论 TypeScript、Go、Rust 的总体优劣；
- 如果必须偏离，创建替代 ADR 或显式 Exception。

### 代码与工具链

`package.json`、锁文件、`tsconfig`、容器镜像和 CI 拥有实际版本事实。

---

## 12. 接受本 ADR 后的最小动作

1. 将 `Status` 改为 `ACCEPTED`；
2. 在根 README 的技术栈段落链接本 ADR；
3. 保持 `VISION.md` 技术中立；
4. 保留 ADR-0001 作为 R002-only 历史决定，不推广其 Go Harness、Atomic JSON Store 或内部模块划分；
5. 为第一个 TypeScript Production Walking Skeleton 创建独立 Release；
6. 先验证一个模块化单体，不提前拆微服务；
7. 由后续已承诺 Release 决定是否以及如何建立跨语言 Conformance Test；
8. 在代码产生前固定 Contract、Idempotency 和 Recovery 验收标准。
