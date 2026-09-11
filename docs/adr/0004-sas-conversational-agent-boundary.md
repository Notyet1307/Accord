# ADR-0004：固定 SAS 智能体的对话边界

- Status：ACCEPTED；2026-09-10；Decision owner：产品负责人。
- Source Release：[R004/r1](../product/releases/r004-sas-conversational-agent-pilot.md)。
- 2026-09-10 用户明确答复「接受」本决定并授权首个切片本地实现；不修改 ADR-0003 对 R003 的决定。

## 问题

如何让用户与同一个 SAS 智能体聊天完成任务，同时保留 MagicChat 的消息权威、Accord 的 Case 与执行治理、SAS 的专业执行权威？

## 决定

1. **复用官方 App 作为可见身份。** MagicChat 拥有联系人、Conversation、Message 和展示。Accord 只关联消息并协调回复；不建设另一套 IM，不直接访问 MagicChat 数据库。
2. **一个固定 SAS 对象。** Accord AgentProfile 绑定版本化 SAS event-triage 定义；RuntimeBinding 独立冻结端点、执行配置、模型及权限。凭据保持在机器私有配置中，不进入 Profile。无静默替换模型、机器或备用智能体。
3. **显式有界上下文。** Accord 保存必要的消息引用和内容投影，每个实质咨询先有关联 Case/Workflow/Activity 和持久 Runtime Operation，再调用 SAS。SAS 收到有界上下文，不依赖 agent-compose 会话续接；聊天历史不取得指令权威。
4. **同一身份，两种受限贡献。** SAS 提供专业回答/追问/研判建议，或执行已接受的只读研判。对话阶段必须在运行边界禁用工具，仅提示词要求不够；做不到则不得启用真实对话调用。具体 API 由 SAS 合同确定，Accord 不能替 SAS 声称接口已存在。
5. **专业内容与发送权分开。** SAS 产生候选内容；Accord Coordinator 是唯一 Response Owner，做 schema、关联、Freshness、Dedup 检查后发送。同一智能体身份不代表模型拥有发布权限。Accord 只补确定性状态消息，不用另一模型代写专业回答。
6. **批准与只读回复分开。** R004 普通回复、追问及当前材料的只读结论可直接返回；不继承 R003 四角色最终 Artifact 审批链。涉及扫描、封禁、隔离、删除等操作则明确不支持，不制造批准。
7. **独立状态与恢复。** SAS Run 不等于 Case 或 Accord Workflow Run。每次外部操作冻结输入指纹和关联；同 ID 不同内容拒绝，未知结果先查询、不盲目重跑。两个系统都保留自己的事实，只有合法且新鲜的结果进入 Case。

## 替代方案及取舍

- 让 Accord 原四角色链代答：不能满足用户与同一 SAS 智能体沟通的目标，且误用合成研判合同。
- 直接把每条消息提交为现有 event-triage Run：当前没有对话结果类型和无工具对话模式，不能据此得到自然多轮聊天。
- 先建设持久 runtime session/通用 Agent 网关：本试点可用有界上下文达成，不作为前置。以后只有明确需要跨轮执行状态时再评估。

代价：首版只能保留受限上下文，超限需显式说明并请求必要材料；一次仅处理一个活动 Case。优势是不用新建会话平台，消息、任务和执行各自保留清晰所有者。

## 实施前置

R004 和本决定已获用户接受；SAS 仍需固定可执行接口、工具禁用及幂等恢复合同；每个实施任务按 delivery gate 绑定版本和授权。真实 IM/模型运行单独固定环境、输入和预算。

首个离线切片使用独立的 Accord-owned R004 SQLite/WAL 文件，以版本 1 保存有界试点聚合；拒绝在 R003 数据库原地建表，不迁移或复制 R003 Case。两个文件分别对应隔离的 Release 运行实例，不同时协调同一 Conversation。真实连接仍须固定接口和无工具执行边界。
