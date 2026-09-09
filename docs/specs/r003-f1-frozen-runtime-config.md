# R003 F1：持久冻结运行配置与 Invocation 绑定

## 状态、权威与授权

- Revision：`R003-F1/r1`；状态：开发规格，尚未实现。2026-09-09 用户明确要求「你得创建啊 我后续要按照issue、spec去开发」，授权本轮编写和发布 Spec、创建开发 Issue；本轮不实施这些功能、不调用真实服务。
- 核验代码基线：`c625517687a8b90c2e31a509c149b2102c3aaf5e`（C5 PR #69 已合并）。实施时重新核对 main；若契约或迁移序号漂移，先修订本 Spec，不能沿用过期证据。
- Authoritative inputs：[R003/r1](../product/releases/r003-governed-case-blackboard-walking-skeleton.md)、[ADR-0002](../adr/0002-production-coordination-runtime-language.md)、[ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md)、[C5/r1.1](r003-c5-external-adapter-conformance.md)、当前代码/测试，以及 [delivery gate](../agents/delivery-gate.md)、[tracker](../agents/issue-tracker.md)、[labels](../agents/triage-labels.md)。Vision 只提供长期方向。
- GitHub Issue 是唯一开发任务入口，只链接本 Spec 的固定提交与后续 PR；不复制规格、不建立历史 Harness 子图。后续开发须绑定实际实施请求、该 Spec 修订和代码 base/head。
- 保留单进程、一个冻结合成 Case、SQLite/WAL、四个固定 Profile、一次精确 Human Approval、一个 Response Owner；不改变外部事实权威，不引入 Lody/ACP/CRDT/通用 Runtime。

## Objective / Owner / Producer / Consumer / Primary seam

在首次外部调用前把非秘密运行配置提交到 Accord SQLite，并把同一配置引用与 digest 绑定到后续 Run、Invocation 和 Trace。重启或重试必须恢复同一有效配置；缺失或漂移一律拒绝，不能换模型、endpoint、身份或策略继续。

- Owner：Accord SQLite authority；Producer：显式配置的调用者与 Context Assembler。
- Consumer：后续 [driver](r003-live-driver.md)；Primary seam：持久配置 → 受绑定 Invocation 的准备、执行和恢复。
- 当前缺口：`src/researcher-analyst.ts` 的 `makePrepared` 仅冻结现有 context，`ProfileInvocationRequest` 没有 endpoint/policy；C5 config 只在进程内，不能据此启用 live。

## In scope / Out of scope

包含窄 SQLite 迁移、不可变配置契约、Run/Invocation 引用、前置一致性检查、启动完整性和只读 Trace 投影、离线回归。不含 transport 新功能、credential loader、driver、Reviewer 目标选择、价格/预算平台、真实调用或通用配置管理。

沿用 schema 11；本基线计划新增 `migrations/012_r003_frozen_runtime_config.sql`，推进当前 schema 到 12。历史迁移/handoff 的 bytes、版本与身份不变。若实施 base 已占用 012，须先更新 Spec 绑定新序号。

## 状态与配置契约

新增 `accord.frozen-runtime-config/v1`，只接受精确字段并沿用 canonical JSON/digest 原语：

| 字段 | 必须冻结的内容 |
| --- | --- |
| configurationId / revision | 调用者稳定 ID、显式正整数修订；同 ID 同修订只允许一个 canonical 内容 |
| magicChat | 完整 wss endpoint、App UUID、credentialRef、authenticationIdentityRevision、C5 transport version |
| provider | 完整 Responses endpoint、deploymentId、credentialRef、authenticationIdentityRevision、C5 transport version |
| profiles | 精确四个 Profile；逐个绑定 modelId、Profile/outputSchema 版本、instructions 文本及 digest，无 fallback |
| policy | Workflow/runtime/provider-port 版本、只读工具/权限策略标识、C5 全部 byte/token/timeout/retry 值、context/target 契约版本 |
| sourceManifestDigest | 冻结合成来源 manifest digest |
| executionWindow | UTC notBefore/deadline；完整外部运行窗口，不用进程重启延长期限 |
| costLimitCny | 仅 null；非 null 返回 COST_LIMIT_NOT_IMPLEMENTED，不假装金额限制生效 |

完整 canonical 配置上限 131072 UTF-8 bytes；配置所有者不得把秘密混入 instructions 或其他文本字段。F1 不持有 token，不能宣称能自动发现任意文本中的秘密；它必须拒绝 credential/token 等未定义字段，driver 在解析凭据后还须做已知 token 反射检查。credentialRef 是逻辑引用，不能是 token、环境变量展开式、URL userinfo 或凭据内容摘要。认证身份修订由配置所有者明确给定；同身份轮换 token 不改逻辑配置，换账号/App/部署须新配置修订。F1 不验证外部账号真实性，driver/环境所有者负责核验，不能把一个字符串当作验证证明。

`runtime_configurations` 保存 ID、修订、version、canonical JSON、SHA-256 和 acceptedAt，不可变。`run_runtime_configurations` 以 Run ID 为唯一键引用配置；`invocation_runtime_configurations` 以 Invocation ID 为唯一键关联同一配置。外键/唯一约束和启动重构须覆盖内容 digest、Run/Case 关联以及 Invocation context 的配置绑定。

配置可先于 MagicChat 连接和 Case 创建持久接受，供引导连接使用；Run 创建后，在同一 authority 的事务中绑定已有配置，才允许准备模型 Invocation。该配置是审计和执行约束，不是新的 Workflow 或授权事实。不能为了连接前绑定配置预造 Case。

## Stable identities 与 API 行为

- 提供 authority 的 accept/inspect 配置、bind Run、prepare 配置绑定 Invocation 和执行前校验入口；命名可服从现有代码，但不得由 transport 直接写表。
- 同 configurationId+revision+digest 返回原记录；同 ID+revision 不同内容返回 CONFIG_IDENTITY_CONFLICT，任何内容变更都需新 revision。
- Run 一旦绑定即不可换配置；新配置不能修改已有 Invocation。绑定同一配置幂等，不同配置返回 RUN_CONFIG_CONFLICT。
- 配置绑定 Context 使用 `accord.profile-context/config-bound-v2`；迁移 012 同时扩展 profile_contexts 的 schema_version CHECK，允许旧 v1 和该精确新版本，保留旧行值与所有约束。新版本将 configuration reference/digest 纳入 canonical 输入，再派生 contextDigest/Invocation ID；完整请求 instructions 在配置中固定。不得把配置塞进 modelId/objective/permissionSummary，也不得重写旧 v1 digest。
- 新 live-capable 准备与执行接口必须显式持有持久配置引用；missing/mismatch/expired 在 begin Attempt 前拒绝。构造 provider port、开始调用、恢复时都检查同一绑定。已创建的旧 READY Attempt 不因预检错误变成已执行。
- Run/Invocation 引用与 context/初始 READY Attempt 原子提交；先 durable acceptance，再 I/O。F1 本身无网络能力。

## Failure modes / Recovery behavior

配置缺失、摘要破坏、Run 引用错误、未知版本在 startup 拒绝；传入配置漂移在执行前拒绝。窗口未开始/过期不发送，不能刷新 deadline。事务失败不得留下孤立 binding 或半个 Invocation。重启重建完全相同的配置和身份。

旧 schema 11 数据升级后仍能以旧契约读取和离线恢复；没有配置引用的旧 Invocation 明确为 legacy/unbound，不能补写“默认配置”后用于 live。保持旧 UNKNOWN、两次 Attempt 上限、late/duplicate/stale 仲裁；本任务不自动重试模型。

Trace 仅追加受绑定配置引用、digest、版本和限额摘要；旧记录不伪造绑定，旧版本 Trace 保持原语义。需要新增投影版本时显式区分新旧解析，不改变旧证据。

## Acceptance tests

1. 空库和含 schema 11 历史数据升级/重启；旧 handoff/oracle 原样通过；篡改配置或 dangling reference 必须启动失败。
2. 同配置重复接受只有一行；同 ID 内容冲突、Run 重绑、跨 Run Invocation 引用均拒绝。
3. 修改 model、endpoint、instructions、策略、权限、身份修订、source digest 或 deadline 中任何一项，执行前拒绝且 fake sender 调用数为零。
4. 注入 config/binding/context/Attempt 提交异常并 reopen：没有部分状态；正常 reopen 得到相同配置/context/Invocation ID。
5. 缺配置、旧 unbound、过期窗口、非 null 费用上限零外部调用；原有 UNKNOWN 和最多两次 Attempt 行为不变。
6. 配置及 Trace 反序列化拒绝额外字段/超限；通过未定义 credential/token 字段输入的假秘密 canary 被拒绝且不进入持久配置、错误或 Trace；credentialRef 与实际认证身份不能混称。

## 依赖与边界影响

依赖已交付 C5；与 F2 可独立设计，但合入实现需串行核对共享 context/恢复代码。driver 消费此契约。继续沿用 ADR-0002/0003 的 SQLite authority；无需新架构 ADR，若实现需要更换存储或新增运行平台则超出本 Spec。若 driver 取消，应重新评估并删除无消费者的新入口。

## Evidence to return

交付 PR 绑定实际实施授权、Issue、base/head、Spec 固定提交和 SHA-256、测试命令/退出码/日志、审查发现及处置、迁移与接口变化、身份与恢复证据。运行固定 Node 24.19.0/npm 11.17.0 下的 `TMPDIR=/private/tmp ./scripts/validate-ci.sh`，将本任务离线测试加入精确 inventory 和受限执行入口；保留 workflow/check 名称与 runtime capability guard。说明哪些旧行为刻意保持、后续消费者是否仍成立。

普通 CI 不证明 trusted operator qualification 或真实 MagicChat/Baizhi 兼容性。本轮不产生实现、测试通过、真实人工批准或生产授权。不得设置标记伪造 qualification；真实执行须单独绑定环境和人的授权。
