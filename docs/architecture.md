# Accord 当前架构

本文是代码导航与实现边界说明。长期方向由 [Vision](product/VISION.md) 所有，当前承诺与取舍由 [R005](product/releases/r005-compliance-query-conversational-pilot.md) / [ADR-0006](adr/0006-r005-compliance-query-consumer-boundary.md) 所有；交付进度查 [当前入口](work/current.md)。R003/R004 仍遵守各自原边界。

## 各 Release 的证据不互换

R003 已有受控真实联调记录；R004 和 R005 目前各有独立离线切片。不能把一条路径的 live 成功当作另一条已接通，也不能让不同 owner 同时协调同一 Conversation。

```mermaid
flowchart LR
  subgraph R003["R003：已交付代码；受控真实联调有历史证据"]
    M[MagicChat 官方 App WS] --> D[R003 Driver]
    D <--> A[SQLite authority / schema 12]
    D <--> P[Baizhi Responses / 冻结模型配置]
    A --> F[固定四角色 → 人工批准 → 唯一发布]
    F --> M
  end
  subgraph R004["R004：当前离线实现"]
    E[MagicChat 形状的测试消息] --> C[R004Dialogue]
    C <--> S[独立 SQLite / schema 1]
    C <--> T[OfflineDialoguePort 测试端]
    C --> O[持久待发送回复 → 测试确认]
    T -. sas.dialogue/v1 合同 .-> X[SAS 真实对话服务：待实现]
    X -. 无工具运行、查询恢复：待验证 .-> R[SAS 执行器]
  end
  subgraph R005["R005：CQA 私聊软件 / 实际运行单独取证"]
    Q[绑定 App 私聊 / 明确字段与单次授权] --> CQ[R005CqaConsumer]
    CQ <--> DB[独立 SQLite r005_cqa / snapshot 3]
    CQ --> I[每 Operation 不可变输入文件]
    CQ <--> CP[CqaRunPort]
    CP <--> AD[CqaRunServiceAdapter / Connect JSON]
    AD -. 默认真实通路未运行 .-> RS[agentcompose.v2.RunService]
    EP[操作员私有部署与运行观测] --> AD
    CP --> V[CQA wire / 冻结来源校验]
    V --> CI[唯一候选与待发送意图]
  end
```

## 当前实现在哪里

| 路径 | 入口与主要模块 | 存储与输出 | 实现边界 |
| --- | --- | --- | --- |
| R003 固定流程 | [CLI](../scripts/run-r003.mjs)、[Driver](../src/driver/r003-driver.ts)、[authority](../src/persistence/sqlite-authority.ts) | Case、Typed Board、Invocation、审批及发布状态；R003 SQLite/WAL | 一个合成 Case、四固定角色；原批准规则继续有效 |
| MagicChat 协议 | [envelope/parser](../src/contracts/magicchat.ts)、[WS transport](../src/transports/magicchat-websocket.ts) | 原会话消息、稳定发送身份及 ACK | R004 复用协议解析；目前尚无将 R004 与真实 socket 装配的入口 |
| R004 两轮对话 | [R004Dialogue](../src/driver/r004-dialogue.ts)：receive → advance → flush | 独立数据库中的 receipt、Case、Operation、候选结果与待发送回复 | 只接受 `mode=offline`；固定一用户/私聊/助手；不是启动即能使用的聊天应用 |
| SAS 对话消费合同 | [TypeScript 合同](../src/contracts/sas-dialogue.ts)，SAS 独立树中的 request/result schema | `answer`、`needs_input`、`triage_proposal`，关联原 Operation 与上下文版本 | schema 与样例通过不证明 SAS 已有 HTTP handler 或可信无工具配置 |
| SAS 输入与研判 | 外部 SAS 仓库：Run API、输入准备与显式提交、executor | SAS Run、输入 Artifact/Evidence、研判结果 | 输入闭环已交付；实际字节交付和研判 v2 是后续范围，详见报告 |
| R005 持久查询消费 | [R005CqaConsumer](../src/driver/r005-cqa.ts)：receive / accept → advance / collect → flush | 独立 `r005_cqa` 聚合、消息 receipt、Case、冻结 Operation、候选、精确 Artifact/choice、发送确认、有界审计 | [live launcher](../scripts/run-r005.mjs) 显式装配真实 MagicChat 和 RunService；本地协议通过不证明部署 |
| CQA 结果资格 | [cqa-query](../src/contracts/cqa-query.ts) | 严格 JSON、Go 摘要、冻结 synthetic 来源、精度安全用量 | 不复制 CQA 检索/生成，不制造人工批准或法规资格 |
| R005 输入准备 | [r005-input](../src/driver/r005-input.ts) | 私有逐操作目录、0400 文件、精确字节和只读挂载计划 | POSIX、受信同 UID/root 准备者；同路径的 daemon/Engine 映射只是离线计划，不是实际挂载证明 |

## 数据与权限所有者

| 对象 | 权威所有者 | Accord 的使用方式 |
| --- | --- | --- |
| App、企业身份、Conversation、原始 Message、展示 | MagicChat | 使用官方接口与消息引用，不操作其数据库 |
| Case、Workflow、Activity、Operation、Response Claim | Accord | 事务接受、冻结配置、结果仲裁、消息发布 |
| 事件研判定义、SAS Run、Evidence/Finding/Artifact | SAS | 使用版本化合同接收候选结果及引用，不复制为另一个 SAS 状态源 |
| 专业回答内容 | SAS 智能体产生候选 | Coordinator 校验关联、Freshness、Dedup 后发送；可见人格不等于发布权限 |
| 人工批准、风险接受、生产授权 | 实际负责人 | 只能记录真实决定，不能由模型生成 |
| 开发 Issue/PR/CI/Merge | GitHub | 本地文档链接，不维护同义任务状态表 |

Conversation 是沟通容器；Case 是正在解决的一件事；Accord Operation 是一次已接受的外部贡献；SAS Run 是外部执行记录。它们不是同一个 ID，也不相互替代。

## R004 的失败与恢复

接收消息先持久化，再 ACK。提交 SAS 前保存 Operation 与完整输入指纹；重放不新建操作，同身份异内容拒绝。调用结果未知时只查询原 Operation，不重新提交。

补充输入提升上下文修订，旧答案保留为记录但不作为最新回复。发送确认成功后，回复才进入后续对话上下文；发送已尝试而确认未知时，保持 unknown，不把“调用 send”当作已送达。停止与新事件按首个 Spec 的显式控制处理。

这些行为由 [R004 集成测试](../test/r004-dialogue.integration.test.ts) 验证。真实 SAS 没有可靠按操作查询与无工具执行证明之前，live 绑定保持禁用。

## R005 的失败与恢复

受理事务成功后才准备文件；本地 preflight 通过后进入持久“可能已提交”，至多一次 Start。每次 advance 至多一个物理 RPC；Start/List Summary 只保存 pendingRunId，下一次 Get 验证完整 labels 和 Run/sandbox 才绑定原身份。首次回执丢失只查回原身份，零/多匹配、原 Run 丢失及平台 canceled 保持 UNKNOWN。List 与 Get 分别持久扣次，共六次、间隔至少 5 秒；10 秒单次/30 秒恢复/120 秒绝对上限不能互相延长。取消 ACK 不表示远端 Search/模型停止；缺失完整运行/输出证明不妨碍取消已核验的原 Run，但不产生候选。

取消意图与结果状态分别持久保存：未知 Run ID 唯一查回后仍提交原 StopRun；即使结果已因取消而过期，或在收集与取消之间重启，也不会丢弃尚未发送的取消意图。取消仍受原权限、绝对截止和一次尝试限制。

SQL 表形状仍为 schema 1，r5 状态快照为 version 3；拒绝 version 1/2，不迁移旧库。Binding、私聊授权或状态摘要漂移拒绝启动。输入只允许精确字节恢复；managed/offline Grant 不互换。候选声明映射为 Accord Entry ID；只有实际且新鲜的单选响应能接受完整预览的精确 Artifact。自由文本不批准，未知发送不自动重发或按正文恢复；相关消息确认之前不宣称送达。

每次 managed Start 显式传入完整 payload/config/receipt/input 四项挂载；平台会整组替换而非合并项目挂载。程序、配置与本 Operation 输入只读，仅私有回执可写；源路径坐标和实际逐 Run 证明由[消费合同](specs/r005-compliance-query-consumption.md#每-operation-的不可变输入交付)所有。

Adapter、私聊 consumer 和显式 launcher 已实现；[本地验证](development.md)、operator 资格及真实 HTTP/TLS、挂载、控制鉴权、独立输出、IM/人工确认分别记录。真实部署必须满足消费合同第 9 节的独立运行授权，缺证据仍为 NOT_RUN。按[分层边界](specs/r005-compliance-query-consumption.md#本地资格验证的分层边界)，五个 R005 文件系统测试依赖 operator-owned OS 隔离和 runtime guard；其余受限检查不变，不恢复旧 SAS/X1 环境。
