# ADR-0006：R005 固定合规查询的消费边界

- Status：ACCEPTED；Revision：r1；2026-09-11；Decision owner：产品负责人。
- Source Release：[R005](../product/releases/r005-compliance-query-conversational-pilot.md)；行为唯一合同：[R005-CQA/r5](../specs/r005-compliance-query-consumption.md)。
- 接受来源：用户此前选择「接受并实施离线切片」，接受本 ADR r1；2026-09-14 进一步选择「接受 r3，并实施 Adapter 及其本地协议验证」，随后选择「采用分层验证」，其本地资格合同增量编号为 r4。原提案摘要及软件范围由消费合同所有；本 ADR 的 owner／接缝／控制通路决定与 ADR-0005 两项取舍不变，不形成新业务权限。本 ADR 不授予真实 Runtime／模型／IM、真实凭据读取、资源部署、CQA／平台修改、发布或 Git 操作权限；独立执行须有实际用户授权及对应记录。

## 问题

CQA 已有原生合成检索与独立模型候选能力，Accord 却没有 CQA consumer 或 agent-compose 运行入口。既有 R003 authority 绑定四角色工作流，R004 是 SAS 离线合同；直接增加角色枚举或泛化其数据库会让新的生产者承担旧合同。X1 还证明回执可随容器重建丢失、平台 canceled 不保证远端停止。

## 决定

1. **独立 owner，不改旧 Release。** 建立一个固定 CQA 消费模块，独占 R005 SQLite/WAL，拥有输入 receipt、Case/上下文、Operation、候选及发送/确认状态。沿用 R004 的先持久接受、UNKNOWN 只查、新鲜度和稳定发送身份模式；复用 MagicChat 传输，不接管 R003 authority、R004 数据或 SAS wire。不先抽通用 Agent registry/运行平台。
2. **生产者保持独立。** CQA 决定查询 wire、来源筛选、生成、配置摘要和业务回执；agent-compose 决定 Run/sandbox 的实际状态；Accord 决定主体授权、何时调用、候选是否可接受及谁能发布。CQA 不直接写 Accord DB，结果自报的关联/摘要/复核标志不授予权限。每次选择完整冻结生产者交付，不追随开发分支热更新。
3. **小的运行接口，明确的数据交付。** Accord 只暴露受理后的提交、原运行查询和请求取消；版本化 adapter 使用鉴权 RunService。请求先持久冻结，再生成独占不可变文件，按获准只读挂载进入 guest 的固定输入路径；外部配置/路径/输入正文不进入用户可控命令。具体行为与验收由消费合同所有，不在 ADR 复制字段表。
4. **控制通路与业务只读分开。** R005 选择受信私网内的鉴权控制通路，不把人工 docker-exec 当正式 consumer，也不自动回退 Direct。Accord 不持 Docker socket；daemon 控制凭据仍有高权限，不能称为服务端强制只读。端点、传输保护、网络/凭据隔离及模型外发须另获 R005 执行授权；不据此发布宿主端口、复制 X1 资源表或沿用旧测试秘密。
5. **保留未知，不用重跑掩盖。** 一个逻辑 Operation 在本版至多一次物理 Start；首次响应丢失查询原身份，无法唯一查回就保持 UNKNOWN。CQA 同宿主完成回执持久化不构成 Run 可重建、未知请求可重跑或分布式 exactly-once 保证；取消与完成分开记录。候选展示和正式 Artifact 确认继续由 ADR-0005 管理。

## 替代方案与代价

- 直接复用 R003/R004 owner：少一个入口，但会混入固定四角色/SAS 语义及旧数据库授权；拒绝。
- 直接调用 CQA HTTP 或用非持久 Exec：可以调用查询，却不能沿用本次选择的原生能力和持久 Run 合同；本版不建立并行通路，不自动回退。
- 先统一所有 Runtime/Agent：当前只有一个明确消费目标，抽象和迁移代价没有实际消费者支撑；拒绝。

代价是新增一个有界消费 owner、明确部署控制通路，并接受部分故障需要人工处理。收益是保留生产者独立演进和旧 Release 的正确性，不必为接入一个智能体先重写平台。具体表结构不是本 ADR 的决定；未来扩到第二消费者、多进程或跨机器恢复时再以真实需求重新评估。
