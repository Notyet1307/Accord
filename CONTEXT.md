# 运行与授权词表

用于消除领域角色、运行身份与能力授权的歧义；不声明这些对象已全部实现。行为与所有权以 [AGENTS.md](AGENTS.md)、适用 Release 和 ADR 为准，具体入口见 [当前工作](docs/work/current.md)。

| 词 | 本仓库含义 |
| --- | --- |
| 领域角色 | 如“合规资料研究员”的业务职责；不等于 R003 的 RESEARCHER 等固定认知阶段 |
| AgentProfile | 身份、能力声明及治理策略的版本；声明本身不授予访问权 |
| RuntimeBinding | 选定运行时、执行配置、模型、凭据引用与版本；凭据值不放入 Profile |
| 单次授权 | 明确主体、本次允许的资源/能力、期限和预算；不是持续 DelegationGrant |
| AgentActivity | Agent 为 Case 作出的一次有界贡献 |
| RuntimeOperation | Accord 先持久接受、冻结输入与配置并负责恢复的逻辑命令 |
| agent-compose Run | 外部运行时拥有的执行记录；与 Operation 关联，不等于 Case 或 Workflow Run |
| RuntimeSessionRef / Session | 外部执行会话引用；不拥有批准或业务结果接受权 |
| capset | OctoBus 的 method binding 集合；不自动证明用户/组织权限、只读语义或管理权限隔离 |

新外部接入边界仍是[后续提案](docs/handoff-receipt-2026-09-11.md)，不能用新增词义扩大已接受 Release。
