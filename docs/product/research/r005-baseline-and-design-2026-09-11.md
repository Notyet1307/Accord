# R005 基线与最小接缝设计研究

- Status：RESEARCH / DESIGN PROPOSAL；不是 Accepted Release、ADR 或实施 Spec。
- 核验日期：2026-09-11。
- 本轮授权来源：用户要求暂停推进 R003/R004，先核对 R005 基线环境并开始设计研究。
- 本轮范围：本地版本与只读环境探针、当前代码和公开上游核验、本文；不安装、不启动业务服务、不调用真实模型/知识库、不发布 GitHub 变更。
- Accord 基线：`e54ae9ee490223f4d51d53adb7a9da82b37065bc`；调查开始时干净 main，与 GitHub main 相同。
- CQA 基线：`630d469e989a0093a4e661ee4db736872f9265a2`，本地及 GitHub main 相同；另有未提交 X1 文档，见下文摘要。没有修改该仓库。
- 权威输入：[Delivery Gate](../../agents/delivery-gate.md)、[Vision](../VISION.md)、[ADR-0002](../../adr/0002-production-coordination-runtime-language.md)、[ADR-0003](../../adr/0003-r003-governed-case-blackboard-boundary.md)、[R004](../releases/r004-sas-conversational-agent-pilot.md)、[ADR-0004](../../adr/0004-sas-conversational-agent-boundary.md)、[既有 R005 候选](../../handoff-receipt-2026-09-11.md#后续-release-候选草案外部只读智能体业务闭环)。运行术语沿用 [CONTEXT](../../../CONTEXT.md) 与 [Runtime 研究不变量](lody-runtime-operation-and-coding-workspace.md)，不引入 Lody。

后续决定更新：用户在本会话答复「接受你的推荐取舍」，已接受 Q1/Q2，权威记录见 [ADR-0005](../../adr/0005-r005-candidate-response-and-trial-trust.md)。这不将其余设计建议、R005 Release 或执行方案标记为已接受；下列基线与命令仍仅证明原调查。

## 1. 结论

**设计与本地开发底座已具备；R005 真实端到端环境尚未证明就绪。** 不需要先补完 R003/R004 才研究 R005，也不能用暂停旧增量来免除 R005 自己的权限、幂等、来源和唯一发布条件。

建议首先收敛一个固定“合规资料研究员”、一条合成等保查询、一个明确知识 Search 方法。五个业务域保留覆盖声明，不以首条等保演示声称其余领域已验证。先验证真实运行/查询接缝，再接 Accord 消费与原聊天回复；不建设通用 Runtime、角色市场或新 IM。

本轮不将 R005 标记为 ACCEPTED；R003/R004 代码、批准规则、数据库和未完成资格保持原义。候选咨询/正式 Artifact 的接受原则现由 ADR-0005 决定，具体交互及验收仍待 R005 Spec 固定。

## 2. 当前基线：实际观察与未证明事项

| 层次 | 本轮实际观察 | 能证明 / 不能证明 |
| --- | --- | --- |
| Accord Git | 干净 main；HEAD 与远端为 `e54ae9ee…` | 可以作为研究起点；不是 R005 实现 |
| 远端交付 | [PR #78](https://github.com/Notyet1307/Accord/pull/78) 已合并；[#77](https://github.com/Notyet1307/Accord/issues/77) CLOSED；开放 Issues/PR 查询均为空 | R004 离线切片已交付，不是 live 闭环 |
| 既有 CI | [run 34549095888](https://github.com/Notyet1307/Accord/actions/runs/34549095888) SUCCESS，event=pull_request，head SHA=`0e299fe593c22ed241297d80e6e501a25a45c9a4` | 只属于该 PR head；不能宣称是合并 SHA 的 operator qualification |
| Node/npm | 默认 Node `v26.5.0`；仓库已有 pinned Node `v24.19.0`；npm `11.17.0` | 使用 pinned Node，无需安装或升级依赖 |
| Accord 静态基线 | pinned Node 下 tsc `--noEmit` 成功；外部接缝 inventory 成功，覆盖 66 个源文件 | 类型与当前静态围栏通过；未重跑产品测试 |
| SQLite | pinned Node 的 SQLite `3.53.3`；内存建表、事务、唯一键拒绝、rollback 探针成功 | Node 内建 SQLite 可用；不是磁盘 WAL/crash qualification |
| Docker | 当前 context=`orbstack`，endpoint=`unix:///Users/yet/.orbstack/run/docker.sock`；Engine `29.4.0`、API `1.54`、`linux/arm64`；Compose `v5.1.2` | 已在确认本地 Unix socket 后查询版本；未列举无关资源、拉镜像或启停容器 |
| Go/工具 | Go `1.27.1 darwin/arm64`；gh `2.96.0`；protoc、Python 3 在 PATH | 不等于所有依赖/镜像内工具均通过 |
| CQA 二进制 | `bin/compliance-agent version` 输出 `0.1.0-starter` | 命令可执行；本轮未重建或执行业务查询，不以版本字符串证明其与源码逐字节对应 |
| agent-compose / OctoBus | 当前 PATH 无对应命令 | 不能由此推断所有容器/其他目录均未安装；本轮没有探测其 daemon 或部署状态 |
| 模型、知识服务、MagicChat | 未调用 | 凭据、资料权限、预算、真实消息发布和故障恢复均未证明 |

实际命令：

```text
git status --short --branch
git rev-parse HEAD
git remote -v
gh api repos/Notyet1307/Accord/commits/main
gh issue list --state open --json number,title,url,labels
gh pr list --state open --json number,title,url,headRefOid
gh pr view 78 --json number,url,state,mergedAt,mergeCommit,headRefOid,statusCheckRollup
gh api repos/Notyet1307/Accord/actions/runs/34549095888
gh issue view 77 --json number,url,title,state,comments
node --version
npm --version
go version
gh --version
node_modules/node-bin-darwin-arm64/bin/node --version
node_modules/node-bin-darwin-arm64/bin/node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node_modules/node-bin-darwin-arm64/bin/node scripts/check-no-external-seams.mjs
docker --version
docker context show
docker context inspect orbstack --format '{{.Endpoints.docker.Host}}'
docker --context orbstack version --format '{{json .Server}}'
docker compose version
/Users/yet/Developer/compliance-query-agent/bin/compliance-agent version
```

另在 CQA cwd 查询 Git status/HEAD/remote，并读取 GitHub `repos/Notyet1307/compliance-query-agent/commits/main`。上述命令均退出 0。Docker 调用前只检查 `DOCKER_HOST/DOCKER_CONTEXT/DOCKER_TLS_VERIFY` 是否存在覆盖，三者均无；输出仅保留 Engine 版本/API/OS/架构。SQLite 探针使用 `node:sqlite` 和 `node:assert/strict`，数据库为 `:memory:`，结果为 `transaction=true, unique_constraint=true, rollback=true`，退出 0，无磁盘数据库或脚本遗留。

## 3. 复用已有 CQA 工作，而不是重新设计生产者

当前 CQA 仓库已建立远端；旧接管回执所述“不是 Git 仓库”已过时。调查时仅以下设计文档有未提交变更：`docs/issue-seeds/X1.md`，新增 `docs/research/x1-upstream-facts.md` 和 `docs/specs/x1.md`。这些是当前材料，不是接受或执行证明。

直接复用：

- [CQA X1 研究（本地未提交）](/Users/yet/Developer/compliance-query-agent/docs/research/x1-upstream-facts.md)：固定发行版、原生 gRPC ABI、镜像候选、管理 token 取舍。
- [CQA X1 草稿（本地未提交）](/Users/yet/Developer/compliance-query-agent/docs/specs/x1.md)：合成 Search、原生代理、取消、跨 sandbox 回执及日志试验；全部运行矩阵仍为 NOT_RUN。本轮只读 Docker 预检是 Accord 会话的新证据，不改写其历史记录或暗示 P1/P2/P3 已获授权。
- [CQA 类型](https://github.com/Notyet1307/compliance-query-agent/blob/630d469e989a0093a4e661ee4db736872f9265a2/internal/agent/types.go)：已有 `cqa.query/v1` 与 `cqa.result/v1`；请求为 requestId/question/topic/asOfDate/jurisdiction/industry，可选 caseId/invocationId/contextDigest。结果有 inputDigest/configDigest/corpusDigest、claims/citations、状态、HumanReviewRequired、EntailmentVerified。
- [CQA Store](https://github.com/Notyet1307/compliance-query-agent/blob/630d469e989a0093a4e661ee4db736872f9265a2/internal/agent/store.go)：O_EXCL + fsync 接受；同 ID 改输入/配置拒绝；completed 复用；reserved/blocked 返回 `PREVIOUS_EXECUTION_UNRESOLVED`；临时文件、同步、rename、目录同步提交回执。
- [CQA engine](https://github.com/Notyet1307/compliance-query-agent/blob/630d469e989a0093a4e661ee4db736872f9265a2/internal/agent/engine.go)：reserve 先于 Search；当前接入是 local 或 Connect HTTP，不是原生 gRPC。
- [OctoBus 接入说明](https://github.com/Notyet1307/compliance-query-agent/blob/630d469e989a0093a4e661ee4db736872f9265a2/integrations/octobus/README.md)：`KnowledgeService/Search` 是本项目提案，尚无可运行的 service package。声明、proto、httptest 都不代表已经部署。

不要直接复用 R004 的 `DialogueRequest`：它固定 `event-triage`、`tools:none`、`sas.dialogue/v1`，与 CQA 不同。CQA 也没有通用角色注册接口，role-proposal.json 不是可导入配置。

跨语言摘要是具体缺口：CQA 的 inputDigest 是 Go `json.Marshal(Request)` 后 SHA-256；Accord 的 `dialogueDigest` 则排序 JSON 键。不能直接比较两者并声称协议一致。保留 Accord 自己的冻结指纹，另按生产者合同验证 CQA 摘要；后续需要精确序列化样例，覆盖可选字段、省略规则及转义。配置摘要亦包含 CQA 有效配置、数据集标识/摘要和版本；目录变化可能改变摘要，不靠复制回执解决跨 sandbox 重放。

CQA 的 caseId/invocationId/contextDigest 是关联数据，不是可信授权。结果没有完整 Accord Workflow/Activity/Grant 或平台 Run ID；这些可由受信 consumer 的原 Operation 映射及平台回执外壳关联，不应先强迫生产者复制 Accord 全部领域对象。

## 4. 外部 Runtime：稳定身份不等于完整幂等合同

研究版本分开：旧候选引用 main `e5cc4b6…`；CQA 新草稿优先发行版 `v2609.2.0` / `043b763f05304c3a55f1bd3f4eb8504a591aa4ba`。以下关键实现已直接核对**后者**；不把 main 新功能当稳定版能力，不把源码版本当本机部署版本。

| 问题 | 第一方证据与结论 | R005 设计含义 |
| --- | --- | --- |
| 正确运行入口 | [RunService proto][ac-proto]：StartAgentRun 持久、提交后断连不取消；GetRun/ListRuns/StopRun；Exec 非持久 | 优先固定 command 的 StartAgentRun；不用 Exec 充当可恢复业务运行 |
| 稳定身份 | [StableProjectRunID][ac-id] 使用 project/agent/source/client key；[Coordinator][ac-coordinator] 空 key 会生成 UUID | Accord 必须先持久保存稳定 key 和冻结请求；不让客户端临时生成身份 |
| CLI 重放 | [manualRunClientRequestID][ac-cli] 包含 RFC3339Nano 当前时间 | CLI 可用于一次性 X1 观测，但重复运行 CLI 不是 Accord 幂等恢复 |
| 同 key 异 command/config | [Controller][ac-controller] 的 BeginRun 输入不包含 command/env/完整配置；[事务创建][ac-store] 遇 run_id 冲突取旧记录，无完整 command fingerprint 比较 | 上游这一写入路径不提供 Accord 要求的完整异载荷拒绝。Accord 必须自己拒绝，不能将“相同 Run ID”解释为该请求被安全复用 |
| 首次响应丢失 | [proto][ac-proto] GetRun 必须知道 run_id；ListRuns 无 client key 过滤，但支持精确 labels AND 查询 | 建议首次提交带 Operation/指纹 labels，用 project/agent/source + labels 查询并要求唯一匹配；零条/多条/身份不符保持 UNKNOWN。不查询“最新一条”，不重发 Start 来找 ID；该恢复候选需真实故障验证 |
| 活跃重入 | [RunSupervisor][ac-supervisor] 对非终态返回启动执行 goroutine；active map 不是该路径上的完整幂等屏障 | 不能以稳定 key 宣称重复 Start 只发生一次物理执行；本轮未运行并发重入/daemon crash 试验 |
| 命令输出 | [transitionFromCommandResult][ac-transition] 的 result_json 是 mode/command/success/exitCode | 它不是 CQA JSON；只读取有界、完整且唯一的业务结果，不从混合日志猜测 JSON 片段 |
| 取消与清理 | [Supervisor][ac-supervisor] StopActiveRun 取消 context；proto 区分 stop requested/运行结果 | 取消请求不等于 Search/模型已取消；迟到结果只归档，不能推进已失效 Case |
| 保留与重启 | CQA X1 研究记录回执卷、日志/归档与版本限制，尚无本轮实测 | 冻结专用持久目录和保留策略；数据库查不到不能证明从未运行，UNKNOWN 不自动重新执行 |

建议不为研究复制上游 ID 算法到 Accord。精确 label 查询是现有公共合同，先验证其在首次响应丢失、并发和保留窗口下是否足够；如果不能证明可靠查回，则明确保留 UNKNOWN，而不是新建平台恢复服务。

## 5. OctoBus：协议与权限两项真实缺口

核验源码固定为 `22bd3865542c23864b30373ec35a9239f91b61ca`；没有把 npm/镜像/latest 宣称为该部署版本。

1. **协议不是同一路径。** CQA [clients.go][cqa-client] 发 Connect JSON；agent-compose [capproxy][ac-proxy] 是原生 gRPC/protobuf 代理。代理校验 sandbox capset，剥离 guest 的 credential/authorization 和自报 `x-octobus-ext-*`，注入受信元数据与上游 token。不能仅换 URL。生产者 X1 已提出原生 client 试验；本轮复用，不实现。
2. **capset 不是主体授权。** [OctoBus README][ob-readme]：无 token 默认公开；add-instance 默认选择当前全部方法。应精确选择 Search，并由受信知识服务按真实主体/资料范围过滤，不能信任问题里的行业/角色。
3. **管理 token 不是只读 token。** [agent-compose capability client][ac-capability] 访问 admin catalog/capsets；[OctoBus admin middleware][ob-admin] 对管理路由统一验证 admin token，没有只读 scope 分支。结合原生 target 共用 token 的配置，双面认证需要该 token 同时被管理面和指定 capset 接受。受信 daemon 因而拥有隔离实例的管理能力，虽然 guest 只能走受限代理。
4. **网络必须独立验证。** capset 不能阻止直接旁路。guest 不得取得 Docker socket、daemon 控制面、OctoBus admin、宿主广泛目录或上游 token。Docker socket 只授予受信 daemon，仍属高权限；不是“只读业务”可以隐含授权的环境操作。

推荐把管理权限例外仅作为**本机、独立、合成数据试验**的人工取舍。若要求 daemon 也只有技术上不可写的凭据，现有原生组合不能按已研究配置直接满足；继续设计最小受信代理/上游鉴权变更需另定范围，不自动关闭管理认证或回退 direct Connect。

## 6. R005 最小设计方向（待决定，不是规格）

```text
MagicChat 私聊：用户选定合规资料研究员并给出本次范围
  → Accord：Case / 有界上下文 / 单次授权
  → SQLite 事务：冻结 Operation + 输入/配置/权限指纹 + 待提交动作
  → 固定 agent-compose StartAgentRun(command, client_request_id, labels)
  → CQA：预留回执 → 原生 gRPC → OctoBus Search → 候选业务 JSON
  → Accord：平台终态 + CQA schema/摘要 + 来源/权限 + Freshness 校验
  → 候选答复；正式 Artifact 的接受规则由 R005 明定
  → 单一 Response Owner / 持久待发送动作 / 原会话确认
```

**一个具体 Module，少量 Interface：** 提交已接受 Operation、查询原 Operation、请求取消；实现细节留在版本化 agent-compose Adapter 内。Coordinator 不知道 Docker/socket/capset 凭据，不把整个 runtime catalog 暴露给模型。不为第二个尚未实现的 runtime 创建泛化插件框架。

**消费规则：** CQA citation 先作为候选来源，核对受信知识服务、授权范围、document/version、原文字节摘要及定位；source ID 映射为 Accord Entry ID。语义主张仍是候选，来源 hash 一致不证明法律适用或已经合规。INSUFFICIENT_EVIDENCE/NEEDS_REVIEW 形成未解决项，不制造通过或审批。

**状态规则：** 调用前 durable acceptance；一次 Operation 同身份异指纹拒绝；提交后不明只查原记录；同一有效结果只接受一次；取消/上下文变化后的结果留审计；发出但未确认不当已送达。网络故障不自动换模型、机器、凭据或 direct 模式。

**Accord 现有代码不能原样承载：** [R004Dialogue](../../../src/driver/r004-dialogue.ts) 只有 offline SAS seam；[接缝检查](../../../scripts/check-no-external-seams.mjs) 限定两条既有 transport、外部依赖和子进程。未来 R005 必须以 Accepted ADR/Spec 明确新增放行点及对应负向验证，保留 R003 的能力围栏，不能删除检查或给整个目录豁免。

持久化建议继续 TypeScript、单进程 SQLite/WAL，先隔离 R005 运行实例与 R003/R004 数据；这仍需新 ADR 明确，不在旧库中直接加通用 runtime 表，不同时协调同一 Conversation。只提取真实复用的身份/协议/事务行为，不大规模改造旧四角色链。

## 7. 下一步与当前决策前沿

不建立第二套任务图。复用 CQA X1 作为生产者试验合同候选；Accord R005 后续只维护自己的一个版本化消费 Spec 和一个 GitHub 任务入口，发布需另行授权。

后续草稿：[R005-CQA/r1 消费合同](../../specs/r005-compliance-query-consumption.md)，细化请求/结果绑定、来源资格、UNKNOWN、候选与正式 Artifact、C01–C15 验收；仍为 DRAFT，不是实施或运行授权。

建议顺序：

1. **产品接受规则与试验信任范围已定。** Q1/Q2 已由 ADR-0005 记录；下一步细化剩余合同与资源清单，不据此创建 Accepted R005 或默认启动服务。
2. **有界 X1 真实接缝试验。** 本机 Docker 只读版本预检已完成；接下来需要独立批准镜像/依赖下载、专用资源、Docker socket、Search package 预置、token 与运行矩阵。不调用真实 LLM、不用客户数据；这只证明运行接缝，不能替代 R005 用户闭环。
3. **Accord consumer 设计/离线验证。** 固定摘要、身份映射、首次响应丢失查询、来源接受及发布规则；X1 证据是接口前置，不要求先完成 R003/R004。
4. **另行授权 R005 真实闭环。** 加入获准模型与 MagicChat，验证唯一执行/结果/回复，以及未知、越权、过期、取消和发送确认丢失；不把 extractive 合成演示说成模型研判。

原决策前沿已收敛：

- **Q1 产物语义：已接受推荐。** 具体决定由 ADR-0005 第 1 项所有，不默认继承 R004 规则。
- **Q2 试验信任范围：已接受推荐。** 具体限制由 ADR-0005 第 2 项所有；仍不是镜像拉取、服务启动或生产授权。

真实试验必须覆盖：接受前调用计数为零；同 ID 异输入/配置拒绝；首响应丢失且无新物理提交；未授权 capset/方法/资源与旁路拒绝；完整来源/截断/冲突；重建导致回执丢失；取消竞态；旧上下文结果；结果唯一接受；消息已接受未确认时的恢复。只有实际观测到的场景可以记 PASS。

## X1 资源与执行审批清单（候选）

本节引用 [CQA X1 Spec 第 8 节](/Users/yet/Developer/compliance-query-agent/docs/specs/x1.md#8-待批准执行包一次本机合成接缝试验) 的待批准执行包，不在 Accord 建立第二套 X1 资源或任务图。资源、下载、写入范围、实施顺序、清理授权和 S1–S6 均由该生产者 Spec 所有。资源对齐时读取的文件 SHA-256：`b358c4a87fdd1d054eb373c1ea0a9b0559c1d3ebca2b6838081e1659924003fd`；仍为 EXECUTION_PROPOSED，不能冒充另一个会话的执行记录。

### 资源合同引用

镜像及依赖、私有目录、容器/网络身份、能力端口、容器内 CLI 操作通道与不发布宿主端口的限制，统一引用 [CQA X1 §8.1](/Users/yet/Developer/compliance-query-agent/docs/specs/x1.md#81-资源下载与写入范围)；精确镜像摘要与来源证明见其引用的[上游核验附件](/Users/yet/Developer/compliance-query-agent/docs/research/x1-upstream-facts.md)。Accord 不维护资源表副本、不冻结另一套名字/端口/预算。实际执行必须绑定 CQA 获准的 Spec revision 与生成的候选产物，不能把本研究当作部署配置。

**关键权限核验：** [公开环境配置](https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/.env.example) 明确 `AUTH_PASSWORD/AUTH_SECRET` 属于可选 UI；daemon 要使用独立 `AGENT_COMPOSE_AUTH_TOKEN`，并受 [daemon_auth.go](https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/cmd/agent-compose/daemon_auth.go) 校验。健康接口、runtime LLM facade、Jupyter、webhook 有独立信任边界，不可仅测 health 成功就宣称控制面安全；本试验不配置模型、调度或 webhook 业务入口。

专用网络不能按 YAML 名字直接记 PASS：固定 [Docker driver](https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/driver/docker_runtime.go) 会排序选择 daemon 网络，失败可能回退 default。启动业务前必须观察 guest 实际网络，并验证它无法直达 OctoBus backend/admin；对 daemon 控制 RPC 使用空凭据及 guest scoped token 均须被拒。guest 与 daemon 共网不等于 TCP 端口完全不可达，必须区分控制授权拒绝与网络阻断；若存在可绕过权限执行的通道，立即停止，不以“仅合成”豁免。不修改 Engine 全局防火墙或给容器 NET_ADMIN 来临时掩盖问题。

**秘密由谁持有：** 新生成的 daemon control token 仅操作员/受信 consumer；OctoBus 管理级测试 token 仅操作员/受信 daemon，并在管理面和指定 capset 登记；sandbox scoped token 由平台按 sandbox 分配。身份互不混用，业务输入/输出不含秘密。OctoBus 数据根采用其非 root 用户可写的专用目录；不得用全局 chmod 777 或关闭认证处理权限错误。

### 执行与停止规则的唯一入口

审批及实施顺序直接引用 CQA X1 第 8.2 节 A–F：固定候选 → 准备产物 → 预置与安全门禁 → S1 最小真实路径 → S2–S6 → 固定结论。不在 Accord 另造 P1a/P1b 分期、Run/Search 次数预算或对原矩阵的替代版本。用户可只批准 CQA 的离线候选实现，真实集成仍不因此放行。

生命周期与定向删除引用第 8.3 节：仅操作已记录且本次创建的精确资源 ID；临时构建容器删除保留绑定数据；S4 重建仅针对本试验 guest；结束停止本试验容器。默认保留 evidence、数据与镜像，不做全局 prune、不删除既有资源；额外删除另行给清单获准。

**当前仍不能称“一键可运行”：** 原生 adapter、Search package、依赖 lock、派生镜像与实际隔离证明属于 CQA 待批准执行包的产物。Accord 本轮只制定消费合同、引用资源清单，未修改 CQA 仓库、授权或执行该包；其后续状态必须回到生产者记录核验。

### 本轮消费字节合同检查

使用现有 CQA 二进制（SHA-256 `401fa4207e61656eb7a6ea4fd9d40e0e01866319845267788abd3f3b31fc28f1`）在自动清理的私有临时目录执行 `query --config <临时合成配置> --input -`；配置明确 `local + extractive + networkApproved=false`，只引用已有合成 corpus，并清空业务凭据环境。没有启动 HTTP 服务、调用 OctoBus/模型或重跑产品测试套件。

| 场景 | 实际结果 |
| --- | --- |
| 现有 mlps 样例；重排字段/缩进后重放；可选关联字段显式为空后重放 | 三次均退出 0，inputDigest=`d7919ed2d003aae76324e6ad43023b2aeb34f96934af020f9591e224ced446a3` |
| question 追加 ` <tag>&`、U+2028、U+2029；requestId=`r005-wire-escaped`，caseId=`case-probe`、invocationId=`op-probe`、contextDigest=64 个 `a` | 退出 0，inputDigest=`8ba15539033fa58285f53e569673e339414a76e516ffe025e4fa8ada80de8541` |
| 输出语义/引用字节 | 四次均为 `REFERENCE_ONLY`、synthetic_demo、extractive；保留 humanReviewRequired=true / entailmentVerified=false；每条 quote 的 SHA-256 与 citation 匹配 |

独立序列化计算与实际生产者摘要一致；只证明这四个具体输入的现有二进制行为，不覆盖所有 Unicode、配置摘要、真实原生协议或新 consumer 实现。临时配置与回执已自动删除；不修改 CQA 现有数据或源码。

## 8. 证据绑定与交付边界

CQA 摘要（SHA-256；本轮读取字节）：

| 文件 | 摘要 |
| --- | --- |
| `internal/agent/types.go` | `cc2dfab71cd76ad2895d7ce560615406e7b96bf07175eda5e656b8a06b2043e1` |
| `internal/agent/store.go` | `f756870cdccfab346b9ea560538efbd9da4c0b05313805f4cc68070834cfab29` |
| `internal/agent/clients.go` | `53374b4d0e0c8ecb0e01ad57bb466f88aa11623415dcb768f446bc5c9019fd11` |
| `protocol/compliance.proto` | `830c38e5b90f781f20b5708e77c91843f09800a4c8302dfe39fdd28e5ca352c5` |
| `docs/research/x1-upstream-facts.md` | `7ce923df06e1d950e61caa52752fbd1f8ec59e3aeeebdd7acfb16d4a2e479ce6` |
| `docs/specs/x1.md` | `0e20bb04a95ae28e0af3584b7a0bb05513c3519cbec3b354d510698a54af37c1` |
| `bin/compliance-agent` | `401fa4207e61656eb7a6ea4fd9d40e0e01866319845267788abd3f3b31fc28f1` |

研究包含两次只读子任务委派；均因模型服务容量错误退出，无可用结果。结论来自主会话实际读取与上述命令，不记子任务成功，不代表调用过产品模型。

原调查仅新增本文；后续用户接受 Q1/Q2 后新增 ADR-0005；用户要求继续后新增 R005-CQA 消费合同草稿并补充本节执行清单和本地字节探针。没有产品 schema、migration、业务实现或权威所有权变更；未提交、推送或更新跨仓 X1 文档。其余 R005 合同仍需接受，不修改历史 ADR 来制造授权。未重跑 R003/R004/CQA 产品测试套件、未做 operator qualification 或真实外部业务联调。

许可：固定 agent-compose 的 [LICENSE.txt][ac-license] 为 AGPL v3 文本，OctoBus 的 [LICENSE][ob-license] 为 GPL v3 文本。本轮未复制上游代码。后续复制实现、生成/分发协议客户端、修改服务或分发镜像前需核对具体适用条款与 notice；独立进程分工不是自动的许可证豁免结论。

[ac-proto]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/proto/agentcompose/v2/agentcompose.proto
[ac-id]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/internal/projects/stable_ids.go
[ac-coordinator]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/runs/coordinator.go
[ac-controller]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/runs/controller.go
[ac-store]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/storage/configstore/project_run_event_transaction.go
[ac-supervisor]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/agentcompose/app/run_supervisor.go
[ac-cli]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/cmd/agent-compose/cli_run_command.go
[ac-transition]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/runs/execution_transition.go
[ac-proxy]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/capproxy/proxy.go
[ac-capability]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/pkg/capability/client.go
[ob-readme]: https://github.com/chaitin/OctoBus/blob/22bd3865542c23864b30373ec35a9239f91b61ca/README.md
[ob-admin]: https://github.com/chaitin/OctoBus/blob/22bd3865542c23864b30373ec35a9239f91b61ca/internal/admin/admin.go
[cqa-client]: https://github.com/Notyet1307/compliance-query-agent/blob/630d469e989a0093a4e661ee4db736872f9265a2/internal/agent/clients.go
[ac-license]: https://github.com/chaitin/agent-compose/blob/043b763f05304c3a55f1bd3f4eb8504a591aa4ba/LICENSE.txt
[ob-license]: https://github.com/chaitin/OctoBus/blob/22bd3865542c23864b30373ec35a9239f91b61ca/LICENSE
