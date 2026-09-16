# R005：固定合规查询结果的受管消费合同

- Revision：`R005-CQA/r6`；Status：ACCEPTED（完整 Run 挂载修复范围）；2026-09-16。
- 授权来源：r4 Adapter／分层资格由 PR #80 交付，r5 私聊装配由 PR #82 交付。真实非查询预检发现显式 Run volumes 覆盖项目挂载后，用户选择「修复并继续测试」，授权本次额外修复交付及第 9 节的新有界运行包。原 r2–r5 授权、提交和证据保持各自绑定，不制造运行或人工确认通过记录。
- 本修订沿用 r5 已交付的消息接收、字段收集、候选、精确 choice 与 live launcher，只修复 Adapter 的完整 Run 挂载集合。主 Owner、wire、SQLite schema/snapshot、输出资格、一次 Start 和恢复预算不变；不改 CQA／平台代码，不增加替代运行通路。
- Objective：用户与固定合规资料研究员完成一次有来源的只读查询及补充，获得明确标记的候选答复；选择正式接受/导出时，由本人确认精确 Artifact。
- Authoritative inputs：已接受的 [R005 Release](../product/releases/r005-compliance-query-conversational-pilot.md)、[ADR-0006](../adr/0006-r005-compliance-query-consumer-boundary.md)、[ADR-0005/r1](../adr/0005-r005-candidate-response-and-trial-trust.md)；[ADR-0002](../adr/0002-production-coordination-runtime-language.md) 的协调语言；[Delivery Gate](../agents/delivery-gate.md)；下述固定生产者源码及执行记录。R003/R004 的实现、库及原 ADR 边界不变。
- Owner：Accord Coordinator。Producer：经认证的 MagicChat 输入、agent-compose 运行记录、CQA 候选内容、操作员冻结的合成来源快照、实际人工决定。Consumer：Case 与原私聊用户。
- Primary seam：Accord 的持久查询消费入口 → 固定外部运行及 CQA 结果 → 原会话候选答复/精确 Artifact 确认。CQA 拥有查询实现和生产者合同，agent-compose 拥有 Run；Accord 不再造知识服务或接管它们的状态。
- 设计基线：Accord `e54ae9ee490223f4d51d53adb7a9da82b37065bc`；CQA 已发布 S1/TokenUsage 基线 `d1b53d36fb3092ae7ea63f1c6aba37558fc23ad1`，该提交明确排除 X1。X1 执行基于 `630d469e989a0093a4e661ee4db736872f9265a2` 上的未提交候选；第 8 节分别绑定当前工作树读取摘要与 X1 封存证据。任何一个 HEAD 或 `0.1.0-starter` 都不能代替完整原生运行产物。首个离线实现的本地证据见第 8 节，不代表真实接入验收。

## 1. In scope / Out of scope

一个固定 Profile/Binding、一个明确授权的用户及私聊、一个活动 Case、串行执行；数据限冻结且明确标记为 synthetic 的等保测试文档。CQA 已交付第 8 节固定的受管查询组合；Release 模型候选闭环仍须取得本次真实运行授权及第 9 节准入证据。按需的 extractive 技术接缝不替代该目标。保留五领域声明，但不声称真实法规资格、五域覆盖或生产模型启用。

查询入口收集 question、topic、asOfDate、jurisdiction、industry；字段缺失时确定性追问，回答后沿用同一 Case。日期和行业不能由模型默默猜测。后续问题携带用户确认的当前结构化问题与范围，不把聊天历史塞进不存在的 CQA context 字段，也不为改写问题再调用另一模型。结束后显式新建 Case，不自动串联不同事项。

候选答复、正式确认是两种不同动作。候选答复不要求逐条审批；正式 Artifact 在完整可见后由指定用户确认，拒绝或未确认均不能导出为已接受产物。

不含客户资料、生产模型启用、扫描、业务写入、上传/知识库编辑、群聊、动态角色、跨 Case 记忆、持续 Delegation、第二 Runtime、通用工作流平台。不得把 R003 合成 source manifest 接受入口改成真实来源后门。

本文描述 R005 所需端到端消费行为；r4 已交付 `R005CqaConsumer` → agent-compose RunService 的版本化 Adapter，r5 在同一 R005 owner 内补私聊装配，复用现有 wire／来源校验、独立 SQLite、不可变输入及 MagicChat 官方传输，不建立通用 Runtime 或第二运行通路。Accepted Release／ADR 的 Owner 和主接缝不变；软件、真实接缝和完整 Release 验收分别报告，本文不维护任务状态图。

### 当前生产者成熟度与交接

- [X1 §9](/Users/yet/Developer/compliance-query-agent/docs/specs/x1.md#9-本次执行回执) 已记录真实原生合成 Search、回放/权限检查及恢复限制，用户已报告试验通过；本轮不重跑。它不是“原生 adapter 尚不存在”，也不是模型/Accord 闭环已通过。
- CQA S1 的独立模型路径与 X1 的 synthetic/extractive 候选是历史上的不同组合；不能拼接它们的通过记录作为 guest + OctoBus + Grok 运行资格。当前选择第 8 节 S2 的同一完整交付。
- CQA 已交付并获用户接受真实受管查询／synthetic 草稿切片；[PR #4](https://github.com/Notyet1307/compliance-query-agent/pull/4) 的合并提交为 `499af50675ab4355158eaf943fcb42c56b8c09fe`。固定 [S2 规格][cqa-s2-spec] 与 [验收摘要][cqa-s2-accepted] 记录 G1／G2 有界通过、G3 由用户延期；原真实资料 AC 不由 synthetic 测试替代。旧工作树文档的 NOT_RUN 不能否定本次交付，也不能把查询接受扩大为整 S2、Accord 接入或运行授权；第 9 节据此规定当前准入，不要求重复交付已完成的查询切片。
- CQA 交付一个可引用的源码/文件快照、最终 guest/二进制、有效配置、资料快照、输入路径/挂载合同和完整结果向量；复用已有交付 manifest，不在 Accord 建第二套生产者清单。开发中新版本不能热替换已接受 Operation 的绑定。
- CQA 业务 S2/S3 与 X1 矩阵 S2/S3 不是同一组任务。[SEED-S3](/Users/yet/Developer/compliance-query-agent/docs/issue-seeds/S3.md) 的正式集成前置仍归 CQA 所有；Accord 离线开发可并行，技术接缝通过不等于业务 S3 完成。

## 2. 原 Operation：调用前必须冻结的事实

Accord 在同一事务内持久化输入 receipt、Case/Workflow/Activity 关联、上下文修订、单次授权引用、Runtime Operation 和待提交动作。事务未成功时，平台 Start 与 Search 调用计数都必须为零。

冻结内容至少包含：

- Operation ID；Case/Workflow Run/Activity；MagicChat App/Conversation/Message 与实际 actor；当前 context revision/digest。
- Profile/Binding/输出合同/政策修订；agent-compose 源版本、project ID、agent name、source、受信端点、固定 command；CQA 二进制/最终 guest 镜像 digest。
- 规范化 CQA 请求、精确文件字节及摘要、CQA 输入摘要规则版本；独占输入目录身份和固定 guest 读取路径；预期 per-run volume 与 sandbox 选择约束。实际 Run/sandbox 引用由回执另行绑定，不回写原指纹。问题、来源和用户路径均不拼进 shell。
- CQA 有效配置摘要、生成模式、知识快照、允许的 capset/instance/method；模型绑定额外冻结 provider/model、凭据引用、外发范围、期限与允许的新调用次数。X1 绑定为 extractive、模型调用为零；用量记录不等于金额闸门，不能推导无限调用授权。
- 单次授权的主体、用途、资料范围、方法、期限、外发范围和调用预算；credential reference 与受控修订，不保存秘密值或把秘密 hash 写进公开结果。
- deadline、结果大小上限、重试/查询/取消与收集策略。运行中配置变化不得改变原 Operation；无法保证原绑定则停止新的提交，已有不明操作只做受控查询。

**稳定身份：** 同 Operation ID 同冻结指纹返回/恢复原操作；同 ID 异指纹拒绝。不能通过给不同输入重新算 ID 来绕过同一受理身份的冲突检查。新用户消息即使文字相同也是新输入；重放同一 Message ID 不新建 Operation。

R005 使用独立的单进程 SQLite/WAL 文件和既有单聚合事务模式：`r005_cqa` schema 1 仅含固定主键、JSON 状态及完整性摘要。r5 状态快照 version 3 在同一聚合中保存消息 receipt／cursor、字段收集与 Case、冻结 Operation、候选、正式 Artifact／challenge／实际决定、发送意图和有界审计。拒绝旧 version 1/2，不自动迁移；真实运行使用独立新 R005 库。启动先只读核对 schema、快照版本、完整性及完整 Binding，再执行写操作；不得打开／迁移 R003/R004 数据库或同时协调其 Conversation。

`CqaBinding.mode` 与 `CqaRunPort.mode` 必须同为 `offline` 或 `managed`；同一窄接口供本地替身和具体 Adapter 使用，生产装配不得自动选择替身或 fallback。Grant 的 `outboundScope` 分别精确为 `offline-only` 或 `synthetic-cqa-managed`，旧离线 Grant 不可用于受管端口；受管范围仍须冻结期限及至多一次新模型调用，不把任意环境变量或 `networkApproved` 当授权。

受管 Binding 额外冻结 `daemonSha256`、`platformManifestSha256`、`deploymentSha256`、`evidenceRoot`、`daemonInputRoot`、`engineInputRoot`、`configFileSha256` 和 `transport`（`tls` 或 `isolated-http`），连同既有控制端点、凭据引用／受控修订、有效配置和第 8 节固定构建。所有根目录为规范绝对路径；Accord、daemon 与 Engine 的路径坐标不能假设相同。Binding 不含秘密值；Accord 仅运行时持独立控制秘密，不获取模型上游或 OctoBus 管理秘密。managed 使用 `RUN_SOURCE_MANUAL` 和固定 llm／provider／model／corpus；部署证据是操作员符合性输入，不是 Adapter 自动完成的资格认证。

### 每 Operation 的不可变输入交付

1. 先提交第 2 节事务，再物化该 Operation 的输入。Accord 从已接受字节生成独占文件，不让多个请求覆盖同一个共享 `request.json`；文件和父目录只允许受信准备者写入。
2. 文件创建采用不覆盖已有内容的原子流程并落盘。重启遇到已有文件只允许精确字节/摘要匹配；不匹配、符号链接、权限过宽或不明归属立即停止，不删掉重建来掩盖冲突。未进入“可能已提交”状态时，可继续完成相同已接受输入的本地准备；不能据此重新提交外部运行。
3. 部署合同必须区分 Accord 写入位置、daemon 可见的 bind source、Docker Engine 解析位置和 guest 固定 target。只映射本 Operation 所需输入，guest 只读；不暴露整个仓库、其他 Operation、HOME 或秘密。固定配置/回执路径不能随操作目录意外变化并改变 configDigest。
4. 固定平台在 Run 请求含非空 `volumes` 时整组替换项目挂载，不进行增量合并。Adapter 每次 Start 必须显式发送完整四项：daemon 可见 `/s2/payload` → guest `/opt/cqa`（只读）、`/s2/inputs` → `/s2/inputs`（只读）、`/s2/receipts` → `/s2/receipts`（读写），以及冻结 `engineInputRoot/<operationId>` → `/opt/accord-cqa-input`（只读）。前三项使用本固定部署布局，输入仍按独立路径坐标冻结；仅回执可写，不扩大为整个 `/s2`、输入根目录或其他 Operation。操作员在提交前核验这些 source 的实际 host 映射、字节和权限，并冻结第 5 节证据；缺证据时零 Start。逐 Run 再核对实际完整挂载，漂移则拒绝候选并保留实际调用／UNKNOWN，不能倒写为 Start/Search 为零；既有 sandbox 复用不是缺挂载时的绕过方式。
5. `prepareCqaInput` 完成后再次核对当前上下文、授权、Binding、文件与路径映射，并调用只读本地 `preflight(operation, fingerprint)`；通过后才持久进入“可能已提交”并发一次 Start。预检失败保留可安全继续本地准备的已受理状态，零 Start；Adapter 的直接 start 入口也必须预检，不以此发额外 RPC。已提交或未知的输入不自动清理；保留期限和定向删除纳入运行清单，不等同于 CQA 回执保留策略。

固定六项 argv 为 `/opt/cqa/compliance-agent`、`query`、`--config`、`/s2/inputs/config.json`、`--input`、`/opt/accord-cqa-input/request.json`；Adapter 只将这组字面量映射成平台 command 字符串。请求内容不进入命令、env 或 `payload_json`；不新增 shell 包装器，不把 stdin 能力当成平台已支持的透传。原 CQA `/s2/inputs/requests/*.json` 预置演示不能证明每 Operation 映射。

r6 对应 C16 的回归必须覆盖平台“整组替换”语义：固定程序/配置可读、本 Operation 输入只读、私有回执可写；删除静态挂载或错配权限不能获得候选。不得继续用“只有一个请求挂载”的协议断言固定错误实现。本地协议验证和新部署的实际挂载预检分别取证，后者不能由 fixture 代替。

## 3. CQA wire 映射：复用 v1，不发明新字段

生产者实际定义：[types.go][cqa-types]、[engine.go][cqa-engine]、[config.go][cqa-config]、[knowledge.go][cqa-knowledge]，按第 8 节快照绑定。知识服务 proto 只定义内部 Search，不是完整 CQA 查询/结果 JSON；Accord 不直接调用 Search 来替代 CQA。

| 字段/约束 | R005 consumer 规则 |
| --- | --- |
| `schemaVersion` | 精确 `cqa.query/v1`；结果精确 `cqa.result/v1` |
| `requestId` | 原 Operation 的稳定 CQA 调用身份；固定映射后持久化，不用随机 CLI run 身份 |
| `question/topic/asOfDate/jurisdiction/industry` | 用户确认的当前问题/范围；首个授权 topic=`mlps`，jurisdiction=`CN`。日期是合法 `YYYY-MM-DD`；question 为 2–8000 UTF-8 字节（去空白后至少 2 字节），industry 为 1–80 字节 |
| `caseId/invocationId/contextDigest` | 在 R005 一起提供；前两项符合 CQA safe ID，contextDigest 为小写 64 位 SHA-256。作为关联而非授权；Workflow/Activity/Grant 留在 Accord 原 Operation 映射中 |
| safe ID | `[A-Za-z0-9][A-Za-z0-9_.-]{0,95}`；不把带冒号等不支持字符的内部 ID 原样塞入生产者 |
| `inputDigest` | SHA-256(Go `json.Marshal(Request)`)，不是输入文件原字节，也不是 Accord 排序 JSON digest |
| `configDigest` | 来自生产者有效配置、corpus 标识/摘要和 AgentVersion；由受信部署合同预先给出期望，不能接受结果自报的新值 |
| `corpusDigest/datasetId` | 匹配所选 Binding 允许的完整测试快照，不固定假定永远是 X1 demo corpus；同 datasetId 异内容仍拒绝。外部知识 configDigest 使用 `external-at-query-time` 标记，本身不承诺实际 corpus 字节 |
| `agentVersion` | 字符串匹配不足以证明二进制身份；同时核对受信 Binding/镜像/运行回执 |
| `tokenUsage` | 当前结果的可选字段；按下述用量规则保存，不漏掉该字段后把合法当前结果误判为未知 schema |

Accord 输入/结果边界拒绝重复键、未声明字段、多个顶层值及无效 Unicode/UTF-8；不能把 Go JSON 解码自动替换非法字符当作生产者已拒绝。大小在完整解析前限制：wire 请求不超过 64 KiB，结果不超过 512 KiB，嵌套深度最多 20，JSON 节点最多 100000。已声明的可选 tokenUsage 按下节容错，不放宽其他字段。更严格的生产者限制优先；不得先截断再解析。结果/回执封装的额外限制须通过实际重放验收，不仅凭裸 JSON 大小推导回执可读。

**摘要字节合同：** 当前 Request 的 Go 字段顺序固定为 schemaVersion、requestId、question、topic、asOfDate、jurisdiction、industry、caseId、invocationId、contextDigest。后三项为空时省略；紧凑 JSON、无结尾换行，Go 默认 HTML escaping（包括 `<`、`>`、`&` 与 U+2028/U+2029）。中文不转 ASCII，数组顺序不能改变。输入文件的缩进、字段排列与换行不进入 inputDigest；question 内空白不擅自修剪/归一化。独立保留 `request_file_sha256`，不能将它命名为 inputDigest。

配置相对目录经 LoadConfig 变为绝对路径，路径属于 configDigest 输入。S2 精确摘要算法和当前交付见第 8 节；不能更换路径、复制回执、重新算期望摘要后宣称恢复原操作。冻结 X1 镜像、r2 工作树与当前 S2 交付是不同产物，不混用其配置、二进制或摘要向量。

### Token 用量的消费

声明字段是 status、provider、model、inputTokens、outputTokens、totalTokens、cachedInputTokens、reasoningTokens；状态采用生产者现有 `not_called / reported / partial / unknown`。字段缺失不补零，显式零与缺失不同；不估算 Token、价格或费用，不把缓存/推理明细再加到 total，不强制输入＋输出等于 provider total。

计数来自生产者非负 int64；消费和保存不能经 JavaScript Number 静默舍入。可选用量缺失、无效或不可解释时，保留有界诊断并将用量投影记 unknown，不使其他合法候选内容失败，也不捏造未调用；如 provider/model 与冻结 Binding 明确矛盾，按运行错绑拒绝。extractive/无依据路径是否未调用仍须由冻结生成模式与实际执行证据支持，不能仅相信结果自报的 status。

同一 Operation 的完成回放复用原结果和原用量投影，不重复累计；用量记录不是额度账本，也不代表对账完整。失败响应若未提供用量，就记 unknown：不能将 CQA 私有回执中可能留存的计数冒充已由接口返回，更不能直读生产者数据库来补齐。超时/取消/HTTP 错误不证明未计费。

### 状态的消费含义

| CQA 业务状态 | 允许行为 | 不允许行为 |
| --- | --- | --- |
| `REFERENCE_ONLY` | 显示 extractive 候选资料答复及来源/局限 | 标记模型研判或正式合规结论 |
| `DRAFT_READY` | 仅在获准且冻结的 llm Binding 下显示候选；X1 extractive 绑定禁用 | 用 extractive 演示解除真实模型资格门 |
| `INSUFFICIENT_EVIDENCE` | 回答缺项并让 Case 等待补充 | 宣称任务已获得有依据的结论 |
| `NEEDS_REVIEW` | 显示冲突/待复核原因，保留未解决项 | 晋升正式 Artifact 或绕过来源问题 |
| 执行错误/未识别状态 | 保留实际失败或 UNKNOWN，返回确定性状态说明 | 把 HTTP 200、退出 0 或新字符串状态当业务成功 |

当前 v1 的 `humanReviewRequired=true`、`entailmentVerified=false` 保留原义；前者不是已批准，后者不是通过语义验证。依据 ADR-0005，这些标记不阻止候选展示，但不能代替正式 Artifact 的真实人工确认。consumer 不将它们翻转为“已验证”。

## 4. 来源资格与候选结果提交

仅解析 JSON 不足以接受来源。操作员预置受信的合成 corpus 及资料范围；接收时按它逐项核对 dataset/corpus、document ID/version、source ID、URI、locator、publisher、sourceKind、日期及原文字节。当前 CQA citation.quote 为完整 source.text，SHA-256 也是该完整 UTF-8 text 的摘要，不是任意摘录。不得从 citation.uri 发起额外抓取。

日期按来源合同核对发布/生效区间、asOfDate、validityCheckedAt；检查来源的 synthetic、curatorReviewed、适用地区/行业及状态。这些字段有些不在 citation 中，必须从受信快照查询，不能因为结果没带就跳过。冻结快照包含全部相关版本；不从模型返回的几条引用推断检索完整或没有冲突。

claims 的 evidenceIds 必须指向本结果合法 citations，并映射为 Accord 自有候选 Entry ID。来源 digest 一致只证明字节关系，不证明法律适用、语义蕴含、用户权限或业务完成；来源文本中的命令没有 instruction authority。

拒绝越权资源、缺失引用、引用摘要错误、未获准资料、已知冲突或隐瞒截断。若平台输出被截断、stdout/stderr 混杂或无法确认完整 JSON，只保留审计和错误，不猜测截取“像 JSON 的部分”。已收集的失败记录不得泄露其他主体正文。

提交时在一个事务中重查 Operation/Binding、context revision、授权期限与撤销、停止标记，选择一个 fresh winner，保存候选投影和待发送身份。完全相同的重复结果不重复提交；不同字节的第二结果只记录分歧；先到的有效 winner 也不能因较晚非法结果被覆盖。对已变化上下文的完成仅收集审计，不作为当前答复。

## 5. Runtime 提交、查询与 UNKNOWN

固定 [RunService][ac-proto]，不使用非持久 Exec 替代。`CqaRunPort` 仅提供本地 `preflight`、提交已接受请求、查询原请求、请求取消；外部 DTO、labels、凭据和证据收集留在具体 `CqaRunServiceAdapter`，consumer 不依赖 transport。每次 start／lookup／cancel 至多一个物理 RPC；接口不得把 List+Get 藏在一次 lookup 内。

### 控制通路与部署资格

X1 使用容器内 CLI 且不发布 host port；这不是现成的 Accord 控制端点。R005 选择受信私网的鉴权 RunService RPC，绑定固定地址／协议／服务版本及独立控制凭据，Accord 不持 Docker socket。TLS 或明确批准的隔离 HTTP 网络由运行清单冻结；关闭自动重试、重定向与环境代理，不静默降级、改公开监听或自动改用 docker-exec/Direct。当前仅获准本地协议替身验证，不授予实际网络放行。

只使用预置项目/智能体的固定业务命令；部署/镜像/权限修改由受信操作员处理，不在查询入口按用户输入执行。client 的方法/项目白名单不等于 daemon 强制的细粒度权限；其控制 token 仍可能有广泛执行权限，风险与隔离必须在 R005 运行授权中明示，ADR-0005 的 X1 合成例外不自动覆盖新增模型/IM 环境。

执行前证明：guest scoped token/空凭据不能执行 daemon 控制动作，guest 无 Docker socket、上游管理凭据和直达 OctoBus admin 的旁路；Accord 不获得不必要的 OctoBus/模型秘密。专用网络/路径选择仍按实际部署验收，不只看配置名。运行资源清单由对应执行合同所有，本文不复制 X1 名字、端口或重启其封存资源。

### 部署、运行身份与结果证明

Adapter 消费操作员预置的私有证据文件：`evidenceRoot/deployment.json` 的 SHA-256 必须匹配冻结的 `deploymentSha256`；每次运行观测位于 `evidenceRoot/<operationId>/<runId>.json`，绑定实际 Run/sandbox、payload／配置／输入字节、实际挂载以及独立 stdout／stderr 完成事实。固定安全文件名、有界读取、受控归属与仅 owner 权限、不可变内容必须核对；不得使用 RunDetail 或用户提供的任意 URL／路径。精确字段格式见[开发验证](../development.md)。这是受信操作员提供符合性证据、Adapter 校验并消费的合同，不是自动部署、采集或资格认证服务；本地替身不证明操作员事实为真。

`RunDetail.image_ref` 不是二进制／输入文件摘要，也没有实际 volumes 或 `completeOutput`。GetRun 先核对 project／agent／source／完整 labels，受管 consumer 可据此绑定唯一原 Run/sandbox 以取消；候选资格另验，不用缺失证明否定已经确认的运行身份。`binarySha256`、`guestImageSha256`、`requestFileSha256`、`volume` 可缺失，新增 `deploymentSha256` 和 `observationSha256`；所有证明值来自观测记录，不回填 Binding 期望值。仅在证明实际 Engine source 与原文件映射后，将 volume 规范化为 Accord 坐标。缺失或矛盾的部署／运行证明须审计并保持 UNKNOWN、无候选，后续可在预算内 GetRun 重收证明；offline 仍须完整证明后才绑定。

平台 `result_json` 是 `mode/command/success/exitCode` 元数据，`output` 是混合收集通路；须核对元数据和观测中完整、未截断的 stdout 字节、零 stderr，并与 RunDetail output 逐字节一致，才能设置 `completeOutput=true` 并送 CQA parser。缺少证明时为 false。退出 0、合法 JSON 或长度较短均不能单独证明完整性；不得猜截日志中的 JSON 或获取 Docker socket 补证。

### 提交与恢复

1. Operation 及 submission intent 事务提交、输入准备及本地预检通过后，才执行一次 `StartAgentRun`；显式固定 project／agent／`RUN_SOURCE_MANUAL`／command／client_request_id。request labels 携带稳定 Operation 和完整冻结指纹，不含用户正文。
2. Start 前持久置“可能已提交”；崩溃后不能因未收到 Run ID 就再次 Start。Start 返回 Summary 时仅持久保存 `pendingRunId`，不是已核验原 Run，也不授权 StopRun；hint 与已有 hint／原 Run 冲突即拒绝。一个 Operation 不重新绑定第二个 Run。
3. 已知原 Run 或 pendingRunId 时，下一次 advance 用 GetRun 核对完整身份。首次响应丢失则 ListRuns 按固定 project／agent／source 和 Operation／指纹 labels 精确过滤，limit=2；只有 total=1 且列表完整一致才保存 pendingRunId，下一次 advance 才 GetRun。lookup 显式携带原 frozen operation 以支持无内存状态恢复。零／多匹配、读错或不完整保持 UNKNOWN，无新 Start；此路径的真实部署资格仍待另行验证。
4. 不照搬 CLI 重放：CLI 的 client key 含时间，CQA requestId 不防止新 Run/新 sandbox 的创建。上游数据库相同 run_id 复用也不提供完整 command/config fingerprint 冲突拒绝；责任仍在 Accord。
5. 默认一次物理 Start，无自动 replacement Attempt。单次 RPC 至多 10 秒，外部工作绝对截止 120 秒，恢复窗口至多 30 秒；每次只使用共享剩余时间。只读预算按物理 RPC 持久计数，List 与 Get 各扣一次，共最多 6 次、相邻至少 5 秒，每次调用前扣次，崩溃不返还。第六次只有 Summary 时不能补第七次 Get。超限保持 UNKNOWN 并交还人工；次数不能延长截止。授权撤销后仅按保留的最小审计／恢复权限收集已发生状态，缺该权限则停止。
6. 平台 terminal success、exit code=0、无 cleanup error 只是外壳条件；候选还须满足本节独立运行证明、CQA 合同及 fresh 提交条件，不能将 command 元数据当成 CQA result。
7. 取消意图先落盘并阻止后续 Start；仅对 GetRun 完整核验的原 Run 发送一次有界 StopRun，Summary hint 不足以授权取消。未知 ID 时仅在既有查询预算内定位。StopRun 不占只读六次，但受取消／恢复权限和截止限制，不重试或重建 sandbox。即使候选已判迟到也继续处理已持久取消意图；stop requested、取消确认、业务 completion 分开，均不证明 Search／模型已停止。
8. deadline 到期、新输入、授权撤销或取消与完成竞态，都不能让旧结果推进 Case。平台记录/回执因 GC 或重建丢失时保持 UNKNOWN；绝不删除本地记录重试。冻结期间禁止对该专用项目热改 Binding/权限或清理未解决 Run。

X1 已证明 stop/resume 更换容器也可能丢失 `/tmp` 回执，且平台 canceled 不证明远端 Search 已停。CQA S2 的 G3 同宿主持久完成结果重放由用户延期，不是原 Run 可重建或未知请求可再执行的保证。即使未来 G3 通过，Accord 查不到原 Run 仍保持 UNKNOWN；本版不因回执持久而创建第二 Run，也不复制／修补 CQA 回执。

## 6. 可见答复、正式确认与发布恢复

候选答复使用确定性排版：候选标记、claims、每项对应的版本/定位引用、缺项/局限、需要人工复核的提示。引用的原始全文保留在受控证据中，不把全文塞入聊天。可见正文至多 4096 UTF-8 字节并满足现有 MagicChat body 校验；不能通过删掉某条主张的依据或截半句适配。不能完整排版时显示“范围过大，需要缩小问题”的状态说明，候选不晋升正式 Artifact；不另用模型压缩补写。

用户请求正式接受/导出时，先生成不可变、同样有界且可完整预览的 Artifact revision/digest，并通过官方 choice 交互交给指定用户确认/拒绝。challenge 绑定 actor、conversation、Case、context revision、Artifact revision/digest、choice message ID 和到期时间；草稿默认有效 15 分钟。只有实际返回的匹配 choice response 能建立接受记录；自由文本“同意”、CQA 标记或模型输出不创建批准。确认前必须明确显示它仍非法律/认证结论。

拒绝仅终结该 challenge，不伪造接受；用户补充后可以生成新修订和新 challenge。内容、来源、权限或相关上下文变化使旧 challenge 不可再用；保留历史决定，不覆盖旧版本。NEEDS_REVIEW 或未解决来源问题不能仅靠点击确认洗成合格来源。

“导出”在本切片指将已接受的精确 Artifact 内容交付原授权私聊；不写第三方系统、不创建公开链接。候选回复与正式产物分别有持久发送身份；前者不能误算为后者的重复，但同一个回复槽只能确认一次。发送前重查上下文、授权和接受绑定，以既有 MagicChat 稳定客户端消息身份提交。

已发送但确认丢失时保持 publication unknown；只按原身份收集/恢复确认。没有新上下文且协议证明同身份去重安全时可以重放相同 send；有新输入/撤权后不重发旧正文，先解决原确认，不发布冲突新答案。无法查询确认则保持未知并由人处理，不能把发送调用返回当用户可见或重复发布碰运气。

## 7. Failure modes / Recovery / Acceptance tests

验收主面是持久消费入口到可观察的 Case/消息结果，不测试私有 helper 接线。本地使用真实 SQLite、输入文件及可计数固定协议替身控制故障；生产者／平台和 MagicChat 的实际合同须由对应有界运行包证明。r5 补齐 C01–C19 中适用的本地私聊行为；尚未执行的消息端和真实外部场景仍为 NOT_RUN，不将本地检查写成真实 C01–C19 全部通过。

| AC | 场景 | 必须观察到的行为 |
| --- | --- | --- |
| C01 | 字段缺失 → 追问 → 用户补齐 → 合成等保查询 | 同一 Case，缺字段时外部调用为零；补齐后一次 Start，引用与冻结来源一致，候选清晰标记 |
| C02 | 同一 Message 重放 / 不同 Message 同文字 | 前者不新增 Operation/回复；后者作为新输入处理，不能按文本去重 |
| C03 | 接受事务失败；同 Operation 改问题/配置/权限 | Start/Search 为零或保持原唯一调用；异指纹明确拒绝 |
| C04 | Start 被接受但首次响应丢失；重启 | 只按原 labels 查询、唯一匹配绑定原 Run；零/多匹配保持 UNKNOWN，无第二次 Start |
| C05 | 请求字段顺序/空白差异；中文、HTML 转义、可选字段 | CQA inputDigest 按生产者语义匹配；文件 hash 不混用，问题内字节变化确实改变摘要 |
| C06 | 错误 schema、重复键、额外字段、身份/配置错绑、混合日志、过大输出 | 不提交候选、不发布成功；保留有界原因，无 fallback |
| C07 | 合法 JSON 但错误引用/摘要/日期/未授权来源/截断或冲突 | 不晋升来源；不得返回跨主体正文，不制造 VerificationResult/批准 |
| C08 | REFERENCE_ONLY / DRAFT_READY / INSUFFICIENT_EVIDENCE / NEEDS_REVIEW | 严格按冻结生成模式消费；X1 绑定拒绝 llm 成功，受管模型绑定须有生产者资格与本次授权；缺项/冲突不完成为有据结论 |
| C09 | 重复/分歧/迟到结果；先合法后非法 | 一个 winner、一份候选发送；分歧和非法后到仅审计，不覆盖先前结果 |
| C10 | 新消息、deadline、撤权或取消与完成竞态 | 旧结果不可当前发布；取消请求不显示为远端已取消；超查询预算停止 |
| C11 | 原 Run/回执因重建或保留策略丢失 | UNKNOWN，零新 Start；不删除本地状态或复制旧回执伪造恢复 |
| C12 | 普通候选 → 用户请求正式产物 → 匹配 choice | 候选无需逐条审批；正式 Artifact 只在真实精确确认后交付，原样追溯 |
| C13 | 错 actor/choice、过期、重复确认、拒绝、新修订 | 不错误接受、不重复交付；旧确认保留但不能授权新修订 |
| C14 | send 已被服务端接受、确认丢失；期间有/无新输入 | 保持原发送身份；不重复可见、不把旧内容当新答案，未知不报告送达 |
| C15 | 重启时 R003/R004 文件或错误 Binding | 明确拒绝；旧库/旧工作流不被迁移或接管，同一 Conversation 不双协调 |
| C16 | 独占输入文件创建/重启；错字节、符号链接、错误挂载、相邻请求串用旧文件 | 只运行已冻结的准确输入；准备失败时 Start/Search 为零；文件不能被 guest 改写，不泄漏其他 Operation；实际 volume 路径须另有真实验证 |
| C17 | 控制凭据缺失/错绑；guest token 请求管理动作；控制端点/网络漂移 | 无业务提交或明确拒绝；不退回 CLI/Direct、不开放宿主端口碰运气、不把客户端白名单当服务端权限证明 |
| C18 | reported/partial/unknown/not_called、显式零、大整数、重复结果、失败缺失用量 | 用量不舍入、不补零、不重复累计；无效可选用量不丢弃合法内容；provider/model 明确错绑拒绝；未知费用不显示为零 |
| C19 | 同 agentVersion 的新二进制/配置/资料、开发树漂移、旧 X1 镜像配新 schema | 保持原 Binding 或拒绝新提交；不凭版本字符串、main HEAD 或结果自报替换生产者资格；后到错绑结果不覆盖原合法候选 |

后续真实验收还需证明 agent-compose/CQA/OctoBus/消息端实际身份、权限旁路拒绝、首次响应丢失、取消/持久卷/日志与发送确认窗口。CQA X1 的 extractive 原生查询通过只解除它明确覆盖的前置，不自动解除 R005 的模型、MagicChat、完整恢复或 operator qualification 门。

### 当前 Adapter 切片的本地协议验证

沿用 C01–C19；r4 已落实 C02–C11、C15–C19 中适用的候选消费行为。以下是该 Adapter 切片的检查要求，不是后续私聊实现或真实验收的通过记录：

| 对应 AC | 本切片必须观察的行为 |
| --- | --- |
| C03／C16／C17／C19 | 无持久受理、授权、冻结配置、正确输入／部署证据时零 Start；offline Grant／错误构建不可用于受管入口；version 1 快照拒绝迁移 |
| C04／C10／C11 | 启动响应丢失及重启只查原身份；零／多匹配不绑定；Summary/Get 分步、hint 不授权取消、物理预算／间隔／截止及取消各自守界，无 replacement |
| C05／C06／C07／C08／C19 | 固定 v1 向量及完整新关联；历史无关联草稿、错摘要、mixed/truncated output 或回填期望值的“观测”不能成为候选；已核验身份与候选证明分开，缺证据可查不可接受 |
| C02／C08／C09／C10／C18 | 合法模型候选唯一持久化；无依据不是成功结论且零模型；重复／迟到／撤权不重复候选或用量；保留 synthetic 和人工复核标记 |
| C16／C17 | 另获准的真实部署须证明相邻 Operation 输入隔离、实际 payload／配置／回执挂载、控制认证、guest 权限及输出收集；不以本地替身代替 |

本地软件验证使用现有 Node 工具链，覆盖实际 Adapter 的请求／响应和故障路径，不读取真实凭据、不联网业务系统、不启动真实 Runtime 或重新跑生产者验收。交付记录按第 8 节分别报告协议验证和未验证的真实表面。

### r5 私聊装配合同

- 复用 `R005CqaConsumer` 的同一事务 owner，新增显式冻结私聊配置、接收官方 envelope 及发送持久意图的入口；不在第二个数据库复制 Case、Operation 或 Approval。既有结构化 `accept` 与一次 RPC `advance` 合同保持。私聊配置必须在连接前持久冻结授权引用／修订／到期时间和 MagicChat endpoint／credential reference／revision；配置不含秘密，不能由聊天消息修改或自发扩大。
- 按官方 App 私聊绑定验证 actor、Conversation 和 App；先持久 receipt 和消息身份再 ACK。沿用最多 256 条输入、512 个接收 cursor 的有界试点规模；达到上限明确停止，不裁剪身份导致重放再执行。
- 普通提问保留原文字节作为 question，确定性逐项收集 topic、asOfDate、jurisdiction、industry。允许用户按提示提供 `mlps`／等保、合法日期、`CN`／中国和行业；缺项或无效项只追问，零外部提交。后续提问可沿用用户已确认的范围；显式修改范围立即使旧候选／challenge 失效。不得默猜日期或行业、调用额外模型改写问题。
- 完整结构化问题由原消息派生稳定 Case／Workflow／Activity／Operation 与单次 Grant 身份；受理 receipt、上下文和待提交 Operation 必须在同一事务中完成。每个 Grant 只能在已冻结的本次操作员授权范围和 Binding 总调用上限内使用；不能把选中 App 变成持续 Delegation。
- 完整消息 `停止`／`/stop` 停止新提交并保留原运行取消／UNKNOWN 语义；`/new` 仅在不存在未解决 Operation 或未知发送时明确结束并开始下一 Case；`/status` 返回确定性实际状态。`导出`／`/export` 进入第 6 节正式确认，不创建新模型调用；自由文本“同意”不批准产物。
- 第 6 节的候选排版、完整预览、15 分钟 choice、精确 revision/digest、拒绝／过期／错主体、新消息失效及原会话导出全部适用。只由实际 choice response 建立接受，Agent 验证不得代用户点击接受。正文或确认卡无法在有界字节内完整表示时返回缩小范围提示，不截断证据或生成假正式产物。
- 使用现有官方 `message.send`、`events.ack` 及有证据支持的原身份恢复；网络写成功不代表可见发送。当前没有已验证的跨服务重启／缓存淘汰安全重发合同，因此 r5 不自动重发 UNKNOWN 消息，即使上下文未变也保留未知，等待实际相关确认或人工处理；未知发送阻止冲突的新回复。没有协议证明的确认查询不得按正文猜测。旧 R003/R004 的 parser、传输版本和行为保持不变；R005 如需保留输入字节，必须显式选择自身文本策略，不扩大默认行为。
- live launcher 显式接收私有配置、独立 0600 凭据文件及新 R005 数据库路径；只装配真实 MagicChat transport 与真实 `CqaRunServiceAdapter`。导入模块不发网络请求，不扫描 OMP／HOME 凭据、不自动重连／重新 Start，不支持 fake fallback；凭据不进入状态、日志、异常、trace 或请求正文。
- 本地验证覆盖字段补齐与同 Case、重放、暂停外部调用时的新输入、候选/确认/导出的稳定身份、全部 choice 拒绝边界、发送确认丢失及重启。真实执行额外证明实际 App 私聊、模型候选、输入／控制／输出资格；本地 sender 和 fixture 不能作为部署成功。

## 8. State / Artifact handoff 与 Evidence to return

交付候选的可追溯链为：用户 Message → Case/Workflow/Activity → 单次授权及冻结 Operation → CQA requestId/input/config/corpus digest → 平台 project/Run/sandbox → 结果 digest/来源映射 → 候选发送或 Artifact revision/challenge/真实决定 → 唯一发送及服务端确认。没有一个外部 ID 代替 Accord Case。

实施 PR 绑定确切代码 head、本文 commit/blob 或 SHA-256、生产者最终代码与有效配置、镜像、资料快照、输入映射及实际测试日志。逐项 C01–C19 报告 PASS/FAIL/BLOCKED/NOT_RUN，区分合成证据、CI、可信本地资格和真实外部观测；引用 CQA 已有交付记录，不复制另一份生产者任务图。失败保留原 Operation 与回执，不用数据重置当恢复。

首个 r2 离线切片的 [本地 manifest](/Users/yet/.local/share/accord-local-evidence/r005-cqa-rdwqot08/manifest.json) 绑定其原 Accord 基线、当时确切 Spec／实现文件摘要、命令与日志：完整非资格 CI 和 R005 局部检查通过，精确数量见 manifest；独立冒烟验证一次 offline Start 丢回执后重启查回原 Run，形成一个候选意图。C03–C11、C15–C19 的适用离线行为由原测试覆盖，但实际挂载／guest 权限、控制 RPC、模型与 IM 均未运行，C01／C12–C14 也未在该切片实现。本地待发送意图不是送达或正式 Artifact 接受；这些历史结果不重新绑定当前 r4。

当前 r4 交付须另绑定确切 Spec／实现摘要、实际命令／结果及未验证表面；文档修订后的记录须区分原受测版本、未变更的实现及当前文档摘要，不将旧日志改记为修订后的新执行。r3 接受前提案摘要见文首，不把旧 r2 CI、本地协议替身或只读探针改记为真实 Adapter 运行通过。当前真实 R005 接缝仍为 NOT_RUN；本地软件实现／验证结果由实际交付证据记录，本合同不预告通过。

### 当前受管生产者交付与摘要合同

交付主入口为合并提交 `499af50675ab4355158eaf943fcb42c56b8c09fe` 下的 [验收摘要][cqa-s2-accepted]、[软件／构建验证][cqa-s2-verification] 和 [平台补丁 manifest][cqa-s2-platform]。本表仅列消费绑定，完整文件清单和执行记录仍由生产者 manifest 所有。

| 绑定 | 固定值与含义 |
| --- | --- |
| CQA 可执行文件 | linux/arm64 SHA-256 `a98b6423b7b3602ff2777e52a48747fda4e3d018742a5e4ad2a760850b8a7355`；入口 `/opt/cqa/compliance-agent` |
| daemon 可执行文件 | linux/arm64 SHA-256 `8cd19f27f0d6a8ba0dc6158ad50737b3e779fdd6c1e1fc11bb773a21b3ebc447`；上游 `043b763f05304c3a55f1bd3f4eb8504a591aa4ba` 加 manifest 按序三层补丁，不是原版上游；平台 manifest SHA-256 `b3c2bdd28f728935c40a6a5862748bf9a2d7eab3c39f75449ac834d8d2cc26c9` |
| 受测 guest 镜像 | `compliance-query-agent-guest@sha256:e202e11188012c8489fd7df87cf07fa14b3136ad16df86e84972f5be8eb4e367`；其外部只读 CQA payload 也须匹配，镜像 digest 不代替文件验证 |
| 查询配置 | `octobus_native_s2`、`llm`、`baizhi-chat/grok-4.6`；guest 配置 `/s2/inputs/config.json`，回执 `/s2/receipts`；有效配置和预置私有 RW 挂载分别冻结 |
| 知识范围 | `enterprise/compliance-readonly`／`compliance-kb-s2-02`；`datasetId=s1-single-test-document`；完整 corpus digest `a9c2e7a68e69a169e75e0fd5847203e58e33507fd31ea04e3410dbb482555bba`；测试原文 SHA-256 `6682b44abfed44d9fb42c935be9bec04ac1b2ce3b6a43fe1b16df94d38e30ad5` |
| 历史结果向量 | [已接受草稿][cqa-s2-draft] SHA-256 `81940c5f84e8667e5117d7579d397f4236347d13366a39982bcf3ab01d833b21`；inputDigest `8b3d740d98b2747b0ca5d75b52621318a1ceffeec66b8952fd61f8edef897210`、configDigest `35ce39066985949c678850487a1d435fc8faeff716e2cb1965bdedad3c9152e6` 仅绑定原请求／有效配置 |

S2 的 configDigest 是 Go `json.Marshal` 后 SHA-256，结构依次为 `Config`、`CorpusDigest`、`AgentVersion`、非空时的 `ExecutableSHA256`。Config 为加载并解析路径后的完整稳定配置；原生知识使用 `external-at-query-time` 标记，实际 corpus 另验。临时 sandbox 模型 URL／连接端口、同权限凭据值不进入摘要，凭据引用、受信 daemon origin、project／role、模型、知识范围及稳定路径仍绑定。以固定 [engine.go][cqa-s2-engine] 为准，不在 Accord 发明配置子集。

换 project、daemon origin、路径或重新构建后不能复制历史 configDigest；须在新 Operation 受理前取得生产者算法的精确部署向量。默认 VCS 元数据会改变二进制：源码或 `agentVersion=0.1.0-starter` 相同不表示构建相同。优先消费封存产物；另行重建须按新构建重新固定资格，不迁移历史完成回执。

历史草稿缺少 `caseId/invocationId/contextDigest`，仅可用作向量，不是新 Case 的结果。新请求由 Accord 持久受理时提供三项关联，CQA 现有实现已回传；缺失／不同即拒绝，不回填、不放宽 parser、不修改 CQA 协议。

### r2 离线实现的来源快照

以下 SHA-256 是 r2 原始准备时读取的 CQA 工作树文件字节，包含未提交的 native 候选；不是 `d1b53d36…` 的 Git 树清单，也不是 X1 受测镜像清单。它们固定已完成离线实现的来源依据，后续 S2 文档读取另列于下方，不覆盖这份历史绑定。真实运行须绑定生产者验收过的完整交付，不能把 S1 提交与这些单文件拼成未经执行的新镜像。

| CQA 文件 | SHA-256 |
| --- | --- |
| `internal/agent/types.go` | `4087c419848ad4a5f6c34154dc663891dd360d310eadfa6dfdeb005a45a8bb0d` |
| `internal/agent/config.go` | `28819c378138fff6f81e5dae9634af8ecd81e3febfa176cce683a4e5516cd7f8` |
| `internal/agent/engine.go` | `19cc9322cd981982a3ea0c2ff1cb6b2e3e8677302b32364791997fae851a2920` |
| `internal/agent/knowledge.go` | `37e59395fcfb60cde40b864a725fe4537fb3afbabc83c09713ad944d69ae8d4d` |
| `internal/agent/native.go` | `5f19f026679ff4f46eaf8ce0c7df150724d69a3d32c18501290da3e0a1a9c53c` |
| `internal/agent/clients.go` | `c2c285c1427e842d31ed744f11ae99e985d03e5da5d0a98da923416e1cb3f002` |
| `internal/agent/store.go` | `0d11fa52b4459a7f56029edae34e833cab77792deff72ee63ab9f53b15f3e6e6` |
| `docs/specs/x1.md` | `cd8357b2157b3511ff22b23adb1316186bc3c8de7cfb41dcc7a04064a12d8e97` |
| `docs/specs/s1.md` | `7690de313ff96248120ff66f494679c30457d6c323d357125ee55c692d435a4c` |
| `docs/decisions-and-assumptions.md` | `548bfb264f336ddd2c6e28ed7483061829f1a5714a0cd5fde09cccf15c6adef5` |
| `docs/issue-seeds/S2.md` | `a374d849a1ad036f91b578538cd0cd53e0f99dff52f870480c2a06ca61486236` |

X1 历史运行候选的证据入口是 [§9.6 双轴审查与封存](/Users/yet/Developer/compliance-query-agent/docs/specs/x1.md#96-双轴审查与候选封存)：该记录给出的初审候选 manifest SHA-256 为 `b365963817c2e64445a66320bd8d7cc84d21d4781192da20a1a5481146a8c518`，完整差异 SHA-256 为 `4ac42f79a50048b5833b9b790181a8986824465e2e2c15b6462cfc5ab89c6af6`；后续文档修正及最终交付另见其 `delivery-manifest.json`、`evidence-index.json`。镜像/二进制身份引用同一记录 §9.1，不重建资源表。以上是对 CQA 已有记录的引用，不声称本轮重新验收了封存产物；当前 S2 组合单独绑定于本节，不能拼接旧记录。

原 r1 所指 X1 批准前摘要 `b358c4a87fdd1d054eb373c1ea0a9b0559c1d3ebca2b6838081e1659924003fd` 是历史授权范围快照；当前执行结果由上表 X1 §9 所有，不把旧摘要继续标为当前版本。历史调查见[基线研究](../product/research/r005-baseline-and-design-2026-09-11.md)；本轮不修改 CQA 文件或 X1 执行记录。

### 后续 S2 设计交接：只读核验，不是运行资格

以下保留 S2 交付前的读取记录，不代表当前生产者状态；当前固定交付见本节上方，准入以第 9 节为准。

用户要求继续下一步后，记录了生产者文档的本轮初次读取快照；上述七个生产者代码文件摘要未变。设计来源为 `docs/specs/s2.md`（CQA-S2/r0，SHA-256 `b290d4352a124e51ec1e263bdee12ad10d2965c8c3f63e70875ca55dfd3999d2`）、`docs/decisions-and-assumptions.md`（`c173a01f488b487fd8bc9d3db9b11736d4f9694e788fb4f5eab8d01184a56197`）和当时的 `docs/issue-seeds/S2.md`（`100cc6ff4b2da3a9b9934bbfecb707fc21004529b548cdaa51ec6e2695106d4f`）。读取期间 CQA 会话继续更新候选拆分；这些摘要是读取时点，不声称匹配其后续工作树，也不是新构建或验收产物。原离线 manifest 继续只证明它绑定的确切 Spec/代码，不因本次文档更新重新盖章。

该读取时点的 S2 保留 v1 请求／结果及既有 Token 状态，其 G1 模型代理兼容、G2 最小权限 OctoBus、G3 同机持久回执均记 NOT_RUN；这只是历史快照，不是当前前置。生产者 A01–A15 仍由其规格所有，Accord 不建立第二份矩阵或代发任务。

该阶段的后续候选和依赖由 [CQA 的 S2 父入口](/Users/yet/Developer/compliance-query-agent/docs/issue-seeds/S2.md) 所有，本仓库不镜像其票面状态。该历史设计曾要求等待查询数据面及完整模型／重放候选；当前以本节固定交付和第 9 节准入替代这一等待条件。任何生产者票的粒度认可都不是 Accord 的运行授权。

该时点待取得的清单包含完整源码／差异与最终二进制／镜像、configDigest 算法和向量、受管模式及稳定路径、完整结果和 G1–G3 引用。当前交付已在本节单列；G3 的用户延期以第 9 节为准，不沿用历史待交付措辞重新阻塞已完成查询。稳定配置与临时 sandbox 代理地址仍按生产者摘要合同分开，新 sandbox 完成重放仍不授权 UNKNOWN replacement。

## 9. 分阶段开发与真实验收准入

本表是交付边界，不是工单状态表。r4 的 Adapter／本地分层资格已独立交付；用户随后选择「MagicChat 私聊」，授权 r5 软件装配，并另行选择下述有界真实测试包。持久发送意图、软件测试或脚本启动均不证明送达或整个 Release 完成。

| 阶段 | Accord 消费目标 | 前置与验收边界 |
| --- | --- | --- |
| 本地消费与 Adapter 协议验证（已授权） | 固定 CQA wire／用量、SQLite 受理与恢复、不可变输入及实际 Adapter 的受控协议请求／响应和候选校验 | 复用已有模块，不接管 R003/R004 数据库或 SAS wire；按第 7 节验证适用本地行为。协议替身不证明实际 Run／挂载／权限或模型通过 |
| 合成接缝资格（按需，未授权） | 独立 R005 Operation → 精确文件 → 实际 Run → 完整候选持久化 | 仅用冻结 X1 extractive 组合、无模型／IM；须新增执行授权及输入／控制通路实证。若不能提前消除缺项，不额外恢复旧 X1 演示；不替代受管查询或完整 Release |
| 受管查询接缝（本次有界测试已授权，实际符合性待证） | 消费第 8 节已接受 S2 查询组合，验证真实候选及原 Run 查询/重收 | 按本次运行包冻结部署、有效配置、资料与输入／控制／输出事实。查回和重收不能通过新建 CQA command 冒充业务完成重放；不要求重复交付已接受查询 |
| 后续部署可靠性（G3 用户延期） | 同宿主、跨容器及新 sandbox 的已完成业务结果重放 | G3 保持 `DEFERRED_BY_USER`，由 CQA 拥有其验收；不作为本次受管查询接缝前置，也不删除私有持久挂载预检、完成回执或 UNKNOWN 保护 |
| 私聊与正式确认（软件及本次有界测试已授权） | 新 MagicChat App/私聊补字段、候选答复、精确确认和原会话导出 | 启动前冻结实际 actor/App/Conversation，验证协议及发送确认；取得真实查询接缝证据后执行适用私聊场景。不得代用户批准，未执行的故障场景必须单列 |

真实联调前须证明本次冻结交付、每 Operation 输入／volume、可达鉴权控制通路、首次响应丢失的 exact-label 查回、完整输出以及运行／模型／IM 对应权限。操作员证据文件的本地校验不替代实际部署符合性；缺项时相应真实阶段 BLOCKED，真实 R005 仍 NOT_RUN，不阻塞已授权本地软件工作。

### 本地资格验证的分层边界

本会话用户已选择「采用分层验证」：只调整本地验证执行方式，不修改生产输入的持久化或安全检查，不重写异步输入 API 来适配验证器。具体消费者是 R005 的真实文件系统回归场景，实施 owner 是 Accord 本地资格 runner；真实隔离事实仍由 operator-owned launcher 及其执行记录所有。

- 既有 operator-owned OS 无网／秘密最小化文件边界必须在解释仓库 shell 前建立；私有 TMPDIR、只读离线 cache、精确工具链、launcher/profile 哈希和 BOUNDARY 证据仍必需。没有该边界不得运行资格流程，不能设置 marker 或把普通 CI 当作替代。
- 构建、静态检查、R003/R004、能力拒绝回归和纯 CQA wire 测试继续使用原 Node Permission Model 与 runtime guard，不授予全局 `fs.read`/`fs.write`。
- r4 的 `r005-input.test`、`r005-cqa.integration.test`、`cqa-run-service.integration.test`，以及 r5 使用同一真实文件能力的 `r005-magicchat.integration.test`、`r005-live-driver.integration.test`，在同一 OS 边界中以清空继承环境的固定命令运行，保留 runtime guard，不叠加 Node Permission Model。该层支持私有输入与证据的 fsync／hard link／符号链接拒绝场景和祖先目录元数据核验；仅新增这两个私聊文件系统回归入口，不扩大到通用无权限限制的执行入口。其余入口保持受限。
- 普通 CI 仍为 non-qualification；独立执行上述命令只能证明本地行为，不能产生 operator 资格。若实际 OS profile 或精确版本执行证据缺失，资格状态保持 NOT_RUN／未证明，不假设 profile 兼容。
- 恢复／取消、一次 Start、查询预算、输入不可变、来源／输出校验及旧库拒绝不变。验证方式的取舍不创造业务运行权限；未来调整本层须重新绑定本 Spec 与 runner，并重跑能力边界及文件场景。
- 移除此例外的条件：所选 Node 版本能在相同受限权限下通过真实文件场景、祖先核验及越界拒绝验证，再恢复统一受限执行；不为假想兼容性提前改写生产 API。

### 真实运行边界不变

G1／G2 仅继承[固定验收摘要][cqa-s2-accepted]覆盖的组合和边界。目录例外精确为 `GET /admin/v1/catalog/compliance-readonly?format=md&grpc=true` 返回 401、分类 `UNAVAILABLE_AUTH_DENIED`；不豁免 Search 认证、其他 401 或管理旁路。新部署须在运行授权中明确接受该策略，不升权补目录。受测平台 scheduler 关闭，原 scheduler 测试失败保留，不扩展到调度或宣称平台全套通过。平台补丁保留 AGPL 义务，须引用对应源码／生成输入，不仅依赖未公开二进制。

真实验收前另行提交有界运行包，列明资源／网络、独立凭据引用和权限风险、冻结候选／有效配置、每个新请求和模型调用上限、停止／保留及清理对象。优先合并正常查询与响应丢失／重启查回观察，不额外模型探活；异常变体优先本地验证。新建／重启、真实凭据读取、模型外发和目录例外均以该运行授权为准，不借用 X1 批准或恢复旧 CQA 环境。软件可以独立交付，但必须报告真实接缝 NOT_RUN。

### 本次有界私聊测试授权

用户在明确列出权限、费用和停止范围的问题中选择「授权该测试包」。独立[授权记录](/Users/yet/.local/share/accord-local-evidence/r005-merge80-jhjhxh10/private-chat-run-authorization.json)绑定[原运行包](/Users/yet/.local/share/accord-local-evidence/r005-merge80-jhjhxh10/private-chat-run-proposal.json)（SHA-256 `307838c1b471bec6859070ccc5737951bfba729ea3b4e372409c2aa727597a6e`），不改写其原提案状态来制造执行事实。

- 允许唯一新 Issue/PR、精确提交审查/CI/隔离资格后正常合并，再部署独立 R005 测试资源；不绕过保护。
- 本次窗口最多 2 小时、3 次新 CQA 查询/模型调用，仅 synthetic、`baizhi-chat/grok-4.6`，可能收费；不自动替换/补跑或额外模型探活。操作员最多使用一次真实查询冒烟，其余供用户；正式接受只能由用户点击。
- 新 daemon/OctoBus/guest、网络、数据库和证据按运行包独立创建；控制端点仅 loopback `127.0.0.1:27410`，复用现有 MagicChat 服务但新建 creator-visible App/私聊，不接管旧 owner。只读取获准的选定 Baizhi 凭据，新建其余凭据；值不进入仓库/日志。
- 保留高权限 daemon 控制风险、精确 catalog-only 401 例外和 G3 延期；不放宽 Search、实际输入/挂载/输出证明或 UNKNOWN 规则，不修改 CQA/平台代码。
- 到期/停止仅处理本次新资源并保留未知操作、数据库、输入、回执与证据；不停止旧 MagicChat/SAS 或清理旧 CQA。监督进程能力、实际 MagicChat 来源/协议及新有效配置须在启动前核验，缺失则阻塞对应真实动作，不伪造观测或运行资格。

### 挂载修复后的追加授权

用户选择「修复并继续测试」的[实际授权记录](/Users/yet/.local/share/accord-r005-live/pilot-01/evidence/mount-repair-authorization.json)允许一个额外的 Accord Adapter 修复 Issue/PR，精确提交独立审查、CI／隔离资格及正常合并后，再新建隔离运行资源并固定新的最多 2 小时窗口。总计最多 3 次 synthetic CQA 查询／模型调用，操作员最多一次，模型仍为 `baizhi-chat/grok-4.6`；不自动补跑，不代用户接受产物。

复用仅限本次新建的 R005 测试账号、creator-only App 和私聊；失败 pilot-01 的资源、输入与证据保留，不恢复旧 CQA/X1 环境或借用其数据库。此前限定读取当前 MagicChat `ADMIN_PASSWORD` 只用于创建这个新测试账号的[授权记录](/Users/yet/.local/share/accord-r005-live/pilot-01/evidence/admin-read-authorization.json)不扩大为管理员密码重置、旧账号修改或其他秘密访问。实际 Actor/App/Conversation、网络排序、未重叠地址、有效配置、输入／控制／输出事实和截止时间须在新运行包中重新冻结；原失败窗口不自动延长。

本修订不改变事实所有权或新增通用平台决定，沿用 ADR-0006；改用另一控制通路、放宽 source／permission 或补丁能力时，须回到相应 ADR／Release 决策者。本地实施授权不形成新的业务运行权限。

[cqa-types]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/internal/agent/types.go
[cqa-engine]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/internal/agent/engine.go
[cqa-config]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/internal/agent/config.go
[cqa-knowledge]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/internal/agent/knowledge.go
[ac-proto]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/proto/agentcompose/v2/agentcompose.proto
[cqa-s2-spec]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/docs/specs/s2.md
[cqa-s2-accepted]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/accepted-summary.json
[cqa-s2-verification]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/verification.json
[cqa-s2-platform]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/integrations/agent-compose/candidate.json
[cqa-s2-draft]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/draft.json
[cqa-s2-engine]: https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/internal/agent/engine.go
