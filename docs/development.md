# 开发、验证与运行

先从 [当前工作入口](work/current.md) 核对任务与基线。以下命令说明验证方式，不代表本次接管重新执行了测试，也不自动授权真实外部运行。

## OMP 与 Skills 入口

2026-09-11 静态核验：`/opt/homebrew/bin/omp` 指向 Homebrew OMP 18.1.17；用户级 `~/.agents/skills` 可被该版本默认发现。仓库没有 `.omp` 不代表 OMP 不可用。安装、静态发现条件与实际会话加载是不同证据：本轮未启动 OMP，未验证启动参数、同名覆盖或加载警告。精确路径、摘要和 Matt Skills 缺失条目见 [接管回执](handoff-receipt-2026-09-11.md)。

选择 Matt 方法或核对其授权边界时读 [Skill 使用衔接](agents/skill-usage.md)；涉及角色、绑定或 capset 词义时读 [词表](../CONTEXT.md)。当前 Codex 会话的工作只能按实际工具记录归档，不能记为 OMP 执行。OMP 启动发现验收需先固定无 prompt 命令及允许的本地状态写入，不自动安装或修改全局设置。

## 工具链与离线检查

版本以 [.node-version](../.node-version)、[package.json](../package.json) 和锁文件为准：Node 24.19.0，npm 11.17.0。本机系统 `node` 可能是不同版本；使用已经安装的项目 pinned Node，或由自己的版本管理器选择精确版本。

```sh
# 在 Accord 根目录；仅适用于已存在该可选依赖的 Apple Silicon 本机
export PATH="$PWD/node_modules/node-bin-darwin-arm64/bin:$PATH"
node --version
npm run typecheck
npm run build
npm run test:r004
npm run test:r005
```

| 操作 | 命令/入口 | 副作用与证明范围 |
| --- | --- | --- |
| 依赖安装 | `npm ci --ignore-scripts --no-audit --no-fund` | 更换 node_modules、可能联网；本次未运行 |
| 构建 | `npm run build` | 重建 dist，不启动服务 |
| R004 局部验收 | `npm run test:r004`（先构建） | 临时 SQLite、测试消息与 fake SAS；测试数量以受测版本记录为准 |
| R005 局部验收 | `npm run test:r005`（先构建） | 真实临时 SQLite/输入/证据文件、严格 CQA wire、可计数端口及 Connect JSON Adapter；注入协议 sender，不连接 CQA/模型/IM |
| 完整 CI | `./scripts/validate-ci.sh` | 需已安装依赖和 TMPDIR/RUNNER_TEMP；精确 Node 检查、重建 dist、临时 SQLite/文件/子进程，C4 对自有 worker 执行 SIGKILL；不提供 operator qualification |
| 受信本地资格 | operator-owned launcher → `./scripts/validate-delivery.sh` | 解释仓库 shell 前建立真实无网/文件隔离、私有 TMPDIR 与只读离线 cache；内部 npm ci --offline 会物化依赖并运行测试；需要精确版本、launcher/profile 哈希和 BOUNDARY 证据，不能仅设置 marker |
| SAS 合同样例 | 独立 SAS 树 `python3 scripts/verify_dialogue_fixtures.py` / `make verify` | schema/样例及 SAS 仓库检查；没有真实对话 API 或模型运行 |

2026-09-10 [接管报告](handoff-receipt.md)引用旧 manifest 的 314 项离线通过（含 11 项 R004），只证明该 manifest 绑定的版本；2026-09-11 调查及本次文档修补未重跑或重新核验原始日志。普通 GitHub CI 先安装锁定依赖，再运行 validate-ci.sh；它与可信本地资格、真实外部联调分别报告。文档整理后的说明文字与旧 manifest 的逐文件 hash 会不同；原日志只证明其实际测试版本，不应修改旧 manifest 来让它“重新匹配”。

## 实际运行入口

**R004 当前没有可运行的 live CLI 或 UI 装配。** 可在集成测试中验证 `R004Dialogue.receive / advance / flush`，其端口只能作为离线接缝使用。不要把 R003 CLI 接上 SAS URL，当作完成 R004 集成。

**R005 已实现受管 API Adapter，没有 CLI、UI 或 IM 装配。** [R005CqaConsumer](../src/driver/r005-cqa.ts) 接收受信调用者提供的完整 `CqaAcceptance`，固定 `CqaBinding`；`accept` 持久接受，`advance` 通过 `CqaRunPort` 提交或查回，`collect` 收集原 Run，`snapshot` 读取 Case/候选/待发送意图。`requestCancel`、`revoke` 和 `closeCase` 保留停止、新鲜度与未决操作边界。[CqaRunServiceAdapter](../src/transports/cqa-run-service.ts) 以 `(binding, credential)` 显式装配；调用者提供凭据的 `reference/revision/value`，Adapter 不读取环境或凭据文件，不签发 Grant。Binding 固定 `adapterRevision=accord.cqa-run-service/v1`、生产者版本组合和控制端点；managed Grant 必须为 `synthetic-cqa-managed`，不能复用 offline Grant。可运行本地例子见[消费状态场景](../test/r005-cqa.integration.test.ts)和[协议场景](../test/cqa-run-service.integration.test.ts)。

数据库父目录须预先存在、规范绝对路径且权限 0700；SQL 表形状仍为 `r005_cqa` schema 1，r3 引入的 version 2 状态快照在 r4 不变。启动只接受新库或相同 Binding 的 version 2；旧 version 1 拒绝且不自动迁移。[清理前诊断日志](/Users/yet/.local/share/accord-local-evidence/r005-r4-oozc07q6/before-cleanup/wal-isolation.log) 曾观察到写连接关闭后 WAL 不存在、拒绝旧快照后出现 0 字节 WAL；该日志来自已移除的打印探针，不是当前工作树的精确字节数断言。最终 CI 执行的回归要求拒绝前 WAL 不存在、拒绝后主库字节不变，且 WAL 不存在或最多 32 字节（仅容纳 header、无 frame）；不能以辅助文件存在推断状态已迁移。输入根目录的父目录须存在，模块创建私有逐操作目录和 0400 输入；不自动覆盖冲突或清理未知操作。准备器依赖 POSIX hard link/fsync，信任同 UID 与 root；不是抵抗同 UID 恶意进程的沙箱。

Binding 中无法序列化为 JSON 的值（如显式存在的 `sandboxId: undefined`）在建库前拒绝；应省略未设置的可选字段。已加入拒绝不留数据库、修正配置后可受理并重启读取的回归。有效 JSON 的规范化摘要不变，不自动修复或删除此前已有的非法快照。

[r2 历史 manifest](/Users/yet/.local/share/accord-local-evidence/r005-cqa-rdwqot08/manifest.json)、[r3 Adapter manifest](/Users/yet/.local/share/accord-local-evidence/r005-r3-eu99ecz0/manifest.json) 及其[早期 API 冒烟](/Users/yet/.local/share/accord-local-evidence/r005-r3-eu99ecz0/before-lazy-network-import/manifest.json) 保留原绑定。[原分层验证 manifest](/Users/yet/.local/share/accord-local-evidence/r005-fsync-ug91dwko/manifest.json) 绑定实际受测工作树与尚未单独编号的分层合同：非资格 CI 367/367；独立受限 wire 测试 8/8、文件系统命令块 44/44，runtime guard 均启用。[r4 文档修正记录](/Users/yet/.local/share/accord-local-evidence/r005-r4-oozc07q6/manifest.json) 保留修正时的合同、文档与实现／测试／runner 摘要；引用原执行，不修改原日志或宣称该文档修正重跑了 CI。原文件命令块在注入会导致 Node 启动失败的 `NODE_OPTIONS` 后仍通过，验证 `env -i` 清除继承配置；独立执行该块不是 operator OS 资格。公共资格入口在缺少 pre-shell 边界时拒绝。本次用户另行选择「本地提交并执行资格」，仅授权本地 R005 候选冻结及既有策略下的无网资格，见[当前执行入口](work/current.md)；结果以新目录的实际记录为准，不重绑旧 manifest。synthetic 资料仍只供软件测试，不是法律或真实模型结果。

**资格执行已按用户选择分层，资格状态必须来自实际执行记录。** Node 24.19.0 的同步 fsync 被 Permission Model 禁止；公开 `FileHandle.sync()` 虽在相同权限下通过文件／目录刷新和越界写拒绝探针，但不能解决祖先目录元数据拒绝和符号链接 API 要求全局文件权限的问题。因此按[唯一分层合同](specs/r005-compliance-query-consumption.md#本地资格验证的分层边界)保留生产输入逻辑：仅三个 R005 文件系统入口依赖既有 operator-owned OS 隔离与 runtime guard，不叠加 Node Permission Model；其他受限入口不变。没有授予全局 Node 文件权限、跳过安全检查或伪造 launcher/profile。原生 HTTP 仍延迟加载，静态豁免仅限 Adapter 的两个字面量动态导入，runtime guard 未修改。完整 operator 资格须绑定干净候选提交、真实 launcher/profile 和精确版本执行证据；旧 CLI／命令块验证不能替代它。[首次资格](/Users/yet/.local/share/accord-qualification/r005-r4-4eb9hd6b/evidence/operator-execution.json) 绑定 `072394d`；审查后 JSON 持久化修正的资格结果归[新证据目录](/Users/yet/.local/share/accord-qualification/r005-r4-json-ixyaieic/evidence)。默认 HTTP/TLS socket 及真实 Runtime／模型／IM 仍 NOT_RUN。

R003 受控真实运行入口是 `node scripts/run-r003.mjs --live --database <绝对路径> --config <绝对路径> --credentials <绝对路径>`。具体参数/校验以该脚本和 [真实执行 Spec](specs/r003-live-qualification.md) 为准。它会连接 MagicChat、消耗模型调用并可能发消息，需对应运行授权。凭据仅保留在私有文件，不贴进文档、命令记录或仓库。该入口写 SQLite/WAL；`--retry-unknown` 需要明确的重试授权。正常联调不替代真实故障窗口验收，见 [接管回执](handoff-receipt-2026-09-11.md)。

SAS 日常开发必须先确认工作树：主工作树可能包含输入阶段的个人改动，独立 dialogue 树则基于旧提交。开始集成前应比较最新 main 与目标补丁，选择隔离基线；不要直接 checkout、覆盖或复用旧分支来宣称当前能力。

### R005 操作员证据格式

这是文件消费合同，不是观测生成器或自动资格服务。提交前操作员须另获运行授权、完成真实部署检查并原子发布不可变记录；Adapter 只校验记录，不能证明作者所述事实为真。目录 `evidenceRoot` 及其 `<operationId>` 子目录必须为当前 UID、0700、非符号链接，根路径须规范且 realpath 一致。两个固定 JSON 文件须为当前 UID、0400、普通文件、单一 hard link、1–2097152 字节；读取有硬上限并核对前后文件身份/大小/mtime。`recordRef`、Operation ID、Run ID 均为 1–96 字符 safe ID：首字符为 ASCII 字母或数字，余字符只允许字母、数字、`_`、`.`、`-`。

`evidenceRoot/deployment.json` 的**原始 UTF-8 字节** SHA-256 必须等于 `binding.managed.deploymentSha256`。以下字段必需；额外字段不授予任何能力：

| 字段 | 精确约束 |
| --- | --- |
| `schemaVersion` / `qualification` / `recordRef` | `accord.cqa-deployment/v1`；默认真实 sender 只接受 `operator-observed`，显式注入本地 sender 只接受 `protocol-fixture`；safe ID |
| `endpoint`, `transport`, `projectId`, `agentName`, `source` | 分别等于冻结 Binding；端点只有 origin、无用户信息/路径/query/fragment；TLS 强制证书校验，`isolated-http` 仅允许私有或 loopback 的字面 IPv4，仍需操作员隔离证明 |
| `daemonSha256`, `platformManifestSha256`, `binarySha256`, `guestImageSha256`, `configFileSha256`, `configDigest`, `corpusDigest` | 分别等于冻结 Binding；原始文件 SHA 与语义 config/corpus digest 不混用 |
| `daemonInputRoot`, `engineInputRoot` | 等于冻结根目录；Accord 本地 `inputRoot/<operationId>`、daemon 可见目录、Engine 实际 bind source 分别记录，不假定坐标相同 |
| `configGuestPath`, `receiptGuestPath`, `receiptHostPath`, `receiptMode` | `/s2/inputs/config.json`、`/s2/receipts`、规范绝对宿主路径、字符串 `0700` |
| `receiptWritable`, `payloadReadOnly`, `configReadOnly`, `inputReadOnly`, `controlAuthVerified`, `guestIsolationVerified` | 均为 JSON `true`，来自真实观测而非仅从期望配置抄写 |
| `schedulerEnabled`, `catalogPolicy`, `outputCollection` | `false`；`GET /admin/v1/catalog/compliance-readonly?format=md&grpc=true:401:UNAVAILABLE_AUTH_DENIED`；`complete-separated-command/v1` |
| `observedAt`, `validUntil` | 安全整数毫秒时间；`observedAt <= Date.now() < validUntil` |

Start 仅发送固定命令 `/opt/cqa/compliance-agent query --config /s2/inputs/config.json --input /opt/accord-cqa-input/request.json`、固定 project/agent/source、稳定 clientRequestId、`accord.operation_id`/`accord.fingerprint` labels、可选冻结 sandbox 及单个只读 bind volume。API 的 volume source 是 `engineInputRoot/<operationId>`，target 为 `/opt/accord-cqa-input`；采用 `RUN_SANDBOX_CLEANUP_POLICY_KEEP_RUNNING`，不在命令/env/payload 中塞请求，也不自动清理未知 Run。Start/List 的 Summary 只持久化 `pendingRunId`；下一次 advance 单独 Get 核验完整身份，不能凭 Summary 发 Stop。

`evidenceRoot/<operationId>/<runId>.json` 是该运行的观测，建议完整结果收集后一次原子发布，不能原地修补已发布内容。必需字段：

| 字段 | 精确约束 |
| --- | --- |
| `schemaVersion`, `qualification`, `recordRef` | `accord.cqa-run-observation/v1`；与部署记录相同的资格类型；safe ID |
| `deploymentSha256`, `operationId`, `fingerprint`, `runId`, `sandboxId` | 绑定原部署、原 Operation 和经 Get 核验的实际 Run/sandbox |
| `binarySha256`, `guestImageSha256`, `configFileSha256`, `requestFileSha256` | 实际观测的字节摘要，与冻结期望相符；请求文件 SHA 不等于 CQA 语义 inputDigest |
| `engineInputSource`, `guestInputTarget`, `inputReadOnly` | 实际 `engineInputRoot/<operationId>`、`/opt/accord-cqa-input`、`true`；核验后才规范化为 Accord 的本地 volume 坐标 |
| `receiptGuestPath`, `receiptHostPath`, `receiptWritable`, `receiptMode` | `/s2/receipts`、与部署记录相同的宿主路径、`true`、字符串 `0700` |
| 成功结果另需 `outputSource`, `outputComplete`, `outputTruncated`, `stdout`, `stderr` | `complete-separated-command/v1`、`true`、`false`、完整且至多 524288 UTF-8 字节的 stdout、空字符串 stderr |

成功资格还核对 `RunDetail.imageRef=compliance-query-agent-guest@sha256:<观测摘要>`、terminal success、退出 0、无 cleanup error，以及 `resultJson` 中固定 `mode=command`、command、`success=true`、`exitCode=0`。stdout 必须与 RunDetail output 逐字节一致，才交给严格 CQA parser；Adapter 不下载日志路径、截取混合 JSON、访问 Docker socket 或将配置期望回填为证明。记录缺失/错误时保留已核验的原身份供取消，保持 UNKNOWN、无候选，后续可在原查询预算内重收。Adapter 随证明返回运行记录摘要，原始记录由操作员保留；consumer 审计保存有界原因与候选摘要，不持久化控制凭据。

## 恢复与接管

R003 schema 12、R004 独立 schema 1 与 R005 `r005_cqa` schema 1 / 状态快照 version 2 不互换数据库，r2 的快照 version 1 也不自动升级。保留未知操作、待确认消息及证据；代码回退不能当作数据回滚，删除数据库也不是恢复。

新会话先核对 Git/Issue/Spec，再选择一个具体任务；完成后回填真实 PR 证据与导航指针。只因文档改变无需重跑产品测试；代码或行为合同变化时重跑受影响检查。发布、真实运行与生产权限按 [delivery gate](agents/delivery-gate.md) 处理。
