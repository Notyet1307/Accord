# 2026-09-10 项目接管报告

类型：有日期的接管快照，不是持续更新的任务账本。后续工作从 [当前入口](work/current.md) 进入；Issue/PR 最新状态仍以 GitHub 为准。

依据用户提供的 `OMP_设计交接与接管模板_20260906` 中“已有项目接管”要求：复用原代码/Spec/ADR，仅补导航、架构说明、开发说明和本报告。模板 SHA256SUMS 全部通过；模板本身不提供实施、发布或运行授权。本轮只核对代码、GitHub、既有证据和有限自动入口，未启动服务、重跑产品测试或修改远端任务。

## 当前结论

Accord 已交付 R003 固定四角色协调流程，且有受控 Grok/MagicChat 实际批准与发布记录。当前产品方向已转到 R004：一个固定 SAS 事件研判助手通过 IM 完成任务。R004 两轮对话的离线消费实现已通过本地验证，但尚未提交、没有 GitHub 对应任务/PR，也没有真实 SAS 聊天服务。

SAS 输入准备与显式提交已合并，不能再将输入 #72/#73 当作未完成阻塞。SAS 后续研判路线已发布为 #78→#79→#80；它们明确不包含 Accord 对话集成，不能替代新对话服务任务。

## 实际基线与工作树

| 位置 | 已核对基线 | 工作树与用途 |
| --- | --- | --- |
| Accord 本地 | `codex/r004-sas-dialogue`，HEAD `2668ee62f249d462930bd980c8178ce5f24f7f6e` | R004 本地源码、测试、Spec/ADR 加本轮文档，未提交 |
| Accord GitHub main | `2668ee62f249d462930bd980c8178ce5f24f7f6e` | [PR #76](https://github.com/Notyet1307/Accord/pull/76) 已合并；不能据此认为 R004 已进入 main |
| SAS 主工作树 | `codex/72-manual-input`，HEAD `fbb416eb8074cdc9a426cc7a10d7a230e4a0143e` | 四个文档/配置改动和未跟踪 pycache；原样保留 |
| SAS 对话独立树 | `codex/sas-dialogue-contract`，HEAD `5425be8ceb715715452f97e59094f347753ca267` | `/Users/yet/Developer/.worktrees/sas-dialogue`；schema、合同及校验脚本未提交 |
| SAS GitHub main | `52343d3b11b485d9354659d2462436ffc85366bb` | 已包含输入实现及独立离线验收；两本地工作树均不代表该远端最终状态 |

历史 Accord worktree 注册仍存在，包括旧 R003 writer/approval 和 Controller 路径。注册记录不是活动执行证明，本轮没有删除、切换或清理任何 worktree。

## 能力与证据清单

分类：**已实现且验证**只指列出的验证等级；**部分实现**存在明确未接通路径；**仅规划**没有相应实现；**未核验**不推定成功或失败。

| 能力 / 期望行为 | 分类 | 代码或合同位置 | 实际证据 | 缺口 / 未核验条件 |
| --- | --- | --- | --- | --- |
| R003 Case、四固定角色、Typed Board、人工批准、唯一发布 | 已实现且验证，限 R003 | `src/persistence/sqlite-authority.ts`、`src/driver/r003-driver.ts`、R003 Specs | [PR #76](https://github.com/Notyet1307/Accord/pull/76) 的真实 happy-path 记录；[合并后 CI](https://github.com/Notyet1307/Accord/actions/runs/34437515254) 成功 | 本轮未重放真实链路；完整真实 crash-window qualification 未完成，非生产平台 |
| F1 冻结配置、F2 Reviewer 目标、Driver 调度 | 已实现且验证 | `src/frozen-runtime-config.ts`、`src/reviewer-context.ts`、Driver | [PR #74](https://github.com/Notyet1307/Accord/pull/74)、[#75](https://github.com/Notyet1307/Accord/pull/75)、[#76](https://github.com/Notyet1307/Accord/pull/76) 已合并 | 不等于接入任意外部智能体 |
| R004 同一身份两轮对话、上下文、去重、停止、恢复 | 已实现且验证，离线 | `src/driver/r004-dialogue.ts`、`test/r004-dialogue.integration.test.ts` | 已保存完整本地 CI 314/314；其中 R004 11/11，重算日志与源 hash 匹配 | 测试消息与 fake SAS，不是实际用户可用的聊天界面；未提交 |
| SAS 对话输入/输出及指纹合同 | 已实现且验证，schema 层 | 独立 SAS 树 `contracts/dialogue-*-v1.schema.json` 与 Accord typed contract | 前轮记录：24 对话样例、SAS `make verify` 与跨仓校验；本轮复核 schema hash / 保存样例，未独立复核 SAS 原始验证日志 | handler、真实按 Operation 查询和 no-tool 执行配置未实现/验证 |
| SAS 输入准备、上传、校验、显式提交及字节/Run 绑定 | 已实现且验证，离线 | SAS Run/API/store；[输入规格 #70 v3](https://github.com/Notyet1307/security-agent-suite/issues/70) | [实现 PR #75](https://github.com/Notyet1307/security-agent-suite/pull/75)、[验收 PR #76](https://github.com/Notyet1307/security-agent-suite/pull/76)；[合并后 CI](https://github.com/Notyet1307/security-agent-suite/actions/runs/34462029602) 成功 | 输入已绑定不等于字节已交给模型，也不证明研判质量 |
| SAS 私有输入交付、研判 v2 结果门禁 | 仅规划 | [#77](https://github.com/Notyet1307/security-agent-suite/issues/77)、#78→#79→#80 | 规格与任务已发布，当前仅获规划发布授权 | 大输入传输和可信输入到结果路径待实现；不能用 argv 小样本成功替代 1 MiB 边界 |
| MagicChat → Accord → 真实 SAS 固定助手 | 部分实现 | [R004 首个 Spec](specs/r004-sas-contact-dialogue.md) | 仅上述离线消费者和对话 schema | 真实 handler、装配入口、无工具执行、同 IM 两轮可见验收均待完成 |
| 五智能体完整资格、生产安全与规模能力 | 未完成 / 未核验 | [SAS #61](https://github.com/Notyet1307/security-agent-suite/issues/61)、各 Release 限制 | #61 仍开放；无本轮生产证明 | 不作为首个助手对话的默认前置，也不得标为已完成 |

## 保存证据怎样解释

本机证据目录：`/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/`。

- [manifest.json](/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/manifest.json)：`base + 未提交差异` 的摘要；整理前核验所列 14 个 Accord 文件及 2 个 SAS schema 全部匹配。
- [ci.log](/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/ci.log)：重算 314 tests / 314 pass / 0 fail / 0 skip；SHA-256 `b8e1da71e84274c6aa26b908c621bd696c33d9e2b8c5abafd0af6a56590526a5`。
- [跨仓样例](/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/cross-contract.json)：Accord 生成请求/结果，已按 SAS 合同校验；不含真实业务数据。

本轮文档整理会改变 manifest 中的部分文档 hash，但未改变受测源码/测试/构建入口。旧 manifest 与日志原样保留，不改写成新版本的“全量通过”。这些链接仅在本机可用；交付 PR 时需携带可访问的脱敏证据并绑定最终版本。

## 任务整理建议

下表为本次核验快照与调整建议，不是新任务队列；本轮没有修改 Issue、标签或依赖。

| 真实任务 | 核验状态 | 处理建议 |
| --- | --- | --- |
| Accord #44 C4 | CLOSED | 从 README/当前导航移除“当前规格准备”指向；保持原 Issue 历史 |
| Accord #70/#71/#72（F1/F2/Driver） | CLOSED，对应 PR 已合并 | 保留完成记录，不复用这些编号承接 R004 |
| Accord R004 对话任务 | 尚无对应 Issue/PR | 候选新增一个正式入口，链接当前 Spec 固定修订；区分离线候选与真实验收，不能直接关闭为完整对话已交付 |
| SAS #69 路线、#70 输入规格 | OPEN | 仍是有效路线/合同来源；规格 Issue 开放不等于输入实现未完成，不擅自关闭 |
| SAS #71/#72/#73 输入闭环 | CLOSED，已有实现与验收 PR | 复用成果，移除旧“输入尚未实现”的阻塞判断，不建同义新票 |
| SAS #77 规格、#78→#79→#80 研判任务 | OPEN | 保持真实依赖；#78 没有未完成输入前置，但任务发布不代表可自行实施 |
| SAS 对话 handler/no-tool/Operation 查询 | 尚无本次核验可对应任务 | 单独固定 SAS 实施合同及任务，消费现有 `sas.dialogue/v1`；与研判 #77 分开，不让两个系统分别定义不同对话协议 |
| SAS #61 全量资格 | OPEN | 保留未完成；不阻塞全部对话开发，也不因单助手通过而自动关闭 |

## 最小延续范围与第一项建议

产品方向无需重新访谈。先给当前 R004 本地候选补正式交付入口，并为 SAS 对话服务固定一个完整任务：受限提交、持久按 Operation 查询、两轮上下文、真实可强制的无工具模式及失败恢复。确定合同后再编码真实 handler；这才是 Accord 真实 adapter 的前置。

SAS 研判 #78→#79→#80 可以在其授权与范围内独立推进，供后续“对话完成研判”消费。不要先实现通用 session 平台，也不要为了对齐本模板重建输入闭环或旧任务图。

尚需另行覆盖的动作是新任务发布/版本交付与真实运行的明确范围；本轮整理不自动发起这些动作。已有 R004 产品决定与本地实施授权仍保留，不重复请求。

## 旧自动入口核查

- 当前 GitHub workflow 只有 PR 和 main push 触发，执行 `scripts/validate-ci.sh`；无 schedule 或 ready-label 触发。`Herdr delivery gate` 名称及旧注释不代表激活 Controller，保持不变。
- 仓库无 `.omp` 目录；本轮不新增 memory/autolearn/调度配置，不改变全局 OMP 设置。
- 当前用户无 crontab；有限 launchd 标签与用户 LaunchAgents 文件名筛选未发现 Accord/Planner/Harness/Herdr Controller 条目。
- 进程可执行名筛选发现 Herdr 终端；没有因此停止它们。可执行名筛选不能排除以通用 `node` 名称运行的外部控制器，系统级/其他用户的调度未全面审计，故不宣称旧控制器已全部停用。
- 当前没有证据证明一个自动入口在与本次开发争抢同一任务，因此没有停用建议。若后续发现具体冲突，只调查并处置该入口，保留正常 CI 和分支保护。

## 本轮文档补丁

增加架构/开发说明与单一当前导航；修正 README 的旧 C4 当前任务和旧后续路线；将 tracker 中 #44 定位为历史规则。复用原 Vision、Release、ADR、Spec 和 GitHub，不复制新项目模板、不新增空 glossary/seed/经验目录，不改源码、数据库、服务或现有任务状态。

## 文档验收

本轮检查 8 份新增或调整的文档、81 个本地链接及代码围栏，均通过；`git diff --check` 通过。独立只读复核未发现架构/进度陈述的具体事实错误。与旧 manifest 比较，受测源码、测试、package 与验证脚本 hash 均未改变；未重跑产品测试。
