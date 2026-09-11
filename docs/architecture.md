# Accord 当前架构

本文是代码导航与实现边界说明。长期方向由 [Vision](product/VISION.md) 所有，承诺与取舍由 [R004](product/releases/r004-sas-conversational-agent-pilot.md) / [ADR-0004](adr/0004-sas-conversational-agent-boundary.md) 所有；交付进度查 [当前入口](work/current.md)。

## 两条路径分别成立

R003 已有受控真实联调记录；R004 目前是独立离线切片。不能把前者的 live 成功当作后者已接通，也不能把两套数据文件用于同一 Conversation 的并行协调。

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
```

## 当前实现在哪里

| 路径 | 入口与主要模块 | 存储与输出 | 实现边界 |
| --- | --- | --- | --- |
| R003 固定流程 | [CLI](../scripts/run-r003.mjs)、[Driver](../src/driver/r003-driver.ts)、[authority](../src/persistence/sqlite-authority.ts) | Case、Typed Board、Invocation、审批及发布状态；R003 SQLite/WAL | 一个合成 Case、四固定角色；原批准规则继续有效 |
| MagicChat 协议 | [envelope/parser](../src/contracts/magicchat.ts)、[WS transport](../src/transports/magicchat-websocket.ts) | 原会话消息、稳定发送身份及 ACK | R004 复用协议解析；目前尚无将 R004 与真实 socket 装配的入口 |
| R004 两轮对话 | [R004Dialogue](../src/driver/r004-dialogue.ts)：receive → advance → flush | 独立数据库中的 receipt、Case、Operation、候选结果与待发送回复 | 只接受 `mode=offline`；固定一用户/私聊/助手；不是启动即能使用的聊天应用 |
| SAS 对话消费合同 | [TypeScript 合同](../src/contracts/sas-dialogue.ts)，SAS 独立树中的 request/result schema | `answer`、`needs_input`、`triage_proposal`，关联原 Operation 与上下文版本 | schema 与样例通过不证明 SAS 已有 HTTP handler 或可信无工具配置 |
| SAS 输入与研判 | 外部 SAS 仓库：Run API、输入准备与显式提交、executor | SAS Run、输入 Artifact/Evidence、研判结果 | 输入闭环已交付；实际字节交付和研判 v2 是后续范围，详见报告 |

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

## 后续只补现有缺口

首先补 SAS 对话服务及运行边界，再装配 Accord 的真实消息闭环；正式只读研判复用 SAS 已有输入及研判任务。当前不需要新聊天系统、通用 Runtime 平台、动态角色目录或重建证据平台。
