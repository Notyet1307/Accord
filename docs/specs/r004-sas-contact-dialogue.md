# R004 首个 Accord 切片：固定 SAS 联系人的两轮对话

- Revision：`R004-DIALOGUE/r1`；状态：本地实施已授权。2026-09-10 用户答复「接受」承接前一轮明确的 Release/ADR 接受及本地实现请求；真实模型/IM 运行、发布与推送不在此授权内。
- Objective：用户向固定事件研判助手提问、收到追问、补充后得到同一 SAS 对象的回答；第一条闭环不执行正式研判任务。
- Authoritative inputs：[R004/r1](../product/releases/r004-sas-conversational-agent-pilot.md)、[ADR-0004](../adr/0004-sas-conversational-agent-boundary.md)、[delivery gate](../agents/delivery-gate.md)、实施时固定的 SAS 对话合同及 MagicChat 官方协议。Accord 探索基线 `2668ee62f249d462930bd980c8178ce5f24f7f6e`。
- Owner：Accord Coordinator；Producer：经过认证的 MagicChat 消息和 SAS 对话贡献；Consumer：原私聊用户及 Case。
- Primary seam：MagicChat 消息进入 → 持久 Case/Operation → SAS 对话贡献 → 原会话唯一响应。SAS wire 路由、执行器和权限模式由 SAS 仓库的对应合同所有。

## In scope / Out of scope

一个固定绑定、一个受控用户/Conversation、一个活动 Case、串行消息处理；两轮以上的有界上下文传递；回答与追问；拒绝工具执行；错误恢复、消息去重和旧结果抑制。复用现有 MagicChat transport 和 ID/事务能力，不强行修改 R003 四角色 Driver 以支持新流程。

不提供输入上传、实际研判、自动开新 Case、群聊、多智能体选择或跨会话记忆。收到“开始研判”候选时明确告知该切片尚不提供执行，不能显示假进度。完整研判由后续任务接入。

## 消费合同与稳定身份

以下是 Accord 所需语义，字段命名和 wire 映射须绑定 SAS 最终 schema，不视为现有 SAS API。

- 请求：版本、稳定 operation_id、输入指纹、Case/Workflow/Activity 关联、固定 agent 与 binding 修订、当前消息 ID/内容、按顺序排列的上下文及来源、上下文修订/截断标记、deadline 和预算。
- 成功贡献：匹配的身份及指纹、SAS 执行引用、agent 修订、类型 answer/needs_input/triage_proposal、有界可见文本。triage_proposal 仅为候选，不产生执行授权。
- 配额固定为当前消息 8 KiB、历史至多 12 条且 32 KiB、可见回答 4 KiB，均以 UTF-8 字节计数。当前消息超限直接说明；历史裁剪保留最新连续消息并标记裁剪，不截半条。SAS schema 若有更严上限则在实施前修订合同，不能静默丢弃内容。
- 首条实质消息建立 Case 和固定 Workflow；同件事的后续消息沿用它。首版结束/新事件必须显式选择；不通过模型自行覆盖当前 Case。
- 消息稳定身份使用 MagicChat Conversation + Message ID，不使用每次重放会变化的 Envelope ID。重复内容但不同 Message ID 是不同输入，不按文本相同丢弃。
- 每次 SAS 调用前事务提交 Inbox、上下文版本和冻结的 Runtime Operation。禁止传入共享凭据、未授权历史或可执行系统指令。SAS 端独立鉴权及无工具权限不能由请求自称替代。

## State handoff / Failure / Recovery

1. 先持久接收消息，再推进 ACK；同消息重放返回既有接收状态。
2. 同一 Case 串行处理，外部调用前持久接受，同 ID 同指纹恢复原调用，同 ID 不同指纹拒绝。
3. 有在途调用时收到新消息先保存并递增上下文修订；旧回答不作为当前最终回复发布，后续处理使用最新受限上下文，不并发调用。
4. SAS 超时先按稳定身份查询；尚未知 Run ID 时也必须能按请求身份解析。没有可靠检索能力则保持 unknown，等待人工恢复，不重复提交赌幂等。
5. 无法验证 schema、关联或 agent 配置时明确失败，无备用模型。SAS 内容不允许嵌入可执行批准或跳过权限。
6. 新鲜合法结果与待发送消息身份在事务中保存；通过既有 MagicChat 稳定 client-message 身份发送/恢复。发送确认未知不报告已送达。
7. 重启恢复相同 Case、上下文修订及操作身份，不重跑已完成 SAS 调用。用户要求停止时停止后续调用并报告在途实际状态；无法确认取消则不宣称已取消。

## Acceptance tests / Evidence to return

以消息入口到发送出口为主验收面，使用真实本地持久化与可计数 fake SAS/MagicChat 验证协议。fake 文本不构成真实智能体体验验收。

- 两条用户消息触发两次有界对话贡献，第二次含第一轮必要上下文，两次回复来自同一固定身份，沿用同一 Case。
- 重放第一条消息不会产生第三次调用或重复发送；新 Message ID 的相同文字仍被处理。
- 人为阻塞第一轮后补消息，旧结果不会以最新答案发布；后续回答使用新的上下文修订。
- 操作接受前外部调用计数为零；提交超时、重启、发送确认丢失均保持原身份并按恢复规则处理。
- 错误 agent、跨用户历史、指纹冲突、超限/畸形输出、工具执行请求被拒绝；不改变实际批准状态。
- SAS 未提供无工具执行和按请求身份检索时，真实绑定不可启用。离线 fake 通过不能解除此门。

实施 PR 记录源/Spec 修订、迁移与兼容影响、实际测试命令和结果、失败恢复证据。真实 SAS 与 MagicChat 验收须另行固定环境与预算，再证明可见联系人和实际两轮对话；未运行则明确未运行。

## 依赖与交付入口

- 前置：R004/ADR-0004 接受；SAS 的无工具对话贡献合同固定。Accord 离线消费实现可针对已固定合同进行，不必等待输入闭环 #72/#73 或五智能体资格验收。
- SAS 先交付一个完整可验证的“提交对话贡献—查询结果—第二轮传上下文”路径；复用 Run 的存储和查询能力优先，不建立聊天存储服务。此为跨仓前置建议，不在 Accord 仓库替其实施。
- 当前尚未创建该 Accord GitHub 任务；发布时只链接本 Spec 固定修订和依赖，不复制行为合同。现有 SAS 输入任务继续复用，不重建。

## 本地实现边界（r1）

- 对话消费合同固定于 SAS 基线 `5425be8ceb715715452f97e59094f347753ca267` 上独立工作树新增的 `sas.dialogue/v1`：请求 schema SHA-256 `f079209559d3025f260326cbcc91ee09b53bd07c91adbadc6e6acb0f40932f2a`；结果 schema `44c81d29d013555d2f6c64618c62dc1bc9a008e0f4e9976afaf16f92294a37de`。文件在 SAS 仓库 `contracts/dialogue-{request,result}-v1.schema.json`，尚未提交或发布；Accord 的 typed contract 固定消费这些形状，不声明 SAS HTTP 接口已存在。
- 当前只提供 `mode=offline` 的本地驱动接缝。`submit` 与按 Operation ID/指纹的 `lookup` 由可计数测试端提供；任何 live 模式均拒绝。真实 HTTP adapter、SAS 无工具执行及真实联系人验收仍待完成。
- 独立 R004 SQLite/WAL schema 1 保存一个有界试点聚合，预算为配置中的 1–100 个 Operation，单次 1–120000 ms，最多 256 条输入和 512 个接收 cursor。冻结整个绑定并校验重启一致性。拒绝打开已有 R003 表的文件，不迁移 R003 schema 12。聚合持久化的规模上限只覆盖本试点；扩大吞吐或规模须另立合同。
- 停止入口为完整消息 `停止` 或 `/stop`，新事件入口为 `/new`；旧停止消息重放不影响新 Case。未知操作未解决时不开放新事件。用户无需输入内部 ID。
- 新消息到达时已发送但确认未知的回复，不再按旧上下文重发；保留 unknown 并等待原确认，阻止新的对话调用。没有确认检索接口时不宣称可自动恢复。
- shared MagicChat parser 的默认 R003 行为保持；R004 显式选择保留原文字节的文本策略，在自己的持久入口执行 8 KiB 拒绝提示。不得把裁剪后的文本冒充原材料。
- 本地验收入口：构建后 `npm run test:r004`；新测试同时接入原有 CI 与 operator validator 的清单。运行 CI 不等于 operator qualification，修改清单不构成受信执行证明。
