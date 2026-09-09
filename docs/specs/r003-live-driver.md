# R003：单进程驱动与离线恢复装配

## 状态、权威与授权

- Revision：`R003-DRIVER/r1`；状态：开发规格，尚未实现。2026-09-09 用户明确要求「你得创建啊 我后续要按照issue、spec去开发」，授权本轮编写和发布 Spec、创建开发 Issue；本轮不实施这些功能、不调用真实服务。
- 核验代码基线：`c625517687a8b90c2e31a509c149b2102c3aaf5e`（C5 PR #69 已合并）。实施时重新核对 main；若契约或迁移序号漂移，先修订本 Spec，不能沿用过期证据。
- Authoritative inputs：[R003/r1](../product/releases/r003-governed-case-blackboard-walking-skeleton.md)、[ADR-0002](../adr/0002-production-coordination-runtime-language.md)、[ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md)、[C5/r1.1](r003-c5-external-adapter-conformance.md)、当前代码/测试，以及 [delivery gate](../agents/delivery-gate.md)、[tracker](../agents/issue-tracker.md)、[labels](../agents/triage-labels.md)。Vision 只提供长期方向。
- GitHub Issue 是唯一开发任务入口，只链接本 Spec 的固定提交与后续 PR；不复制规格、不建立历史 Harness 子图。后续开发须绑定实际实施请求、该 Spec 修订和代码 base/head。
- 保留单进程、一个冻结合成 Case、SQLite/WAL、四个固定 Profile、一次精确 Human Approval、一个 Response Owner；不改变外部事实权威，不引入 Lody/ACP/CRDT/通用 Runtime。

## Objective / Owner / Producer / Consumer / Primary seam

以一个串行驱动消费 authority 已持久化的状态，装配 C5 transports、F1 配置与 F2 Reviewer 目标，使一个冻结合成 Case 可以等待人工、重启后恢复并到达唯一发布。实现及验收默认使用 fake I/O；实际部署、凭据和运行窗口由后续真实执行另行绑定。

- Owner：Accord 单进程 Coordinator；Producer：MagicChat envelopes、provider wire 和 operator 明确启动/恢复命令。
- Consumer：独立受控 R003 真实验收；Primary seam：authority 的待执行动作 → 已绑定端口 → authority 结果收集。
- 依赖：C5 已交付；[F1](r003-f1-frozen-runtime-config.md) 和 [F2](r003-f2-reviewer-target-authorization.md) 的实现 PR 均合并且满足验收后才能开始此任务实现。当前不得绕开缺失依赖接 live。

## In scope / Out of scope

一个可测试串行 loop、最小显式命令入口、限定文件读取、端口装配、signal/关闭处理及 fake 故障恢复测试。不新增 Workflow DSL、调度服务、任务板、后台常驻安装、自动重连/模型重试、环境扫描、数据库直写、认证系统或 UI。

为受控停止，允许在 `src/transports/baizhi-responses.ts` 的显式构造参数增加 caller AbortSignal 接缝并更新 transport 契约版本；只取消本地请求/读取，不代表 provider 未执行或已取消。已取消信号必须在 I/O 前拒绝；信号到达后使用原有 UNKNOWN 仲裁，无自动重试。F1 配置须冻结实际新 transport 版本及其策略，不能静默覆盖 C5 v1。对应 fake 回归加入原 transport 测试。

精确新增能力路径：`src/driver/r003-driver.ts` 只装配端口与 authority，不读取环境/秘密；`scripts/run-r003.mjs` 是唯一显式 CLI/config/credential 文件读取入口；`test/r003-driver.integration.test.ts` 注入 fake，无网络和秘密读取豁免。核心不能反向 import driver，更新静态依赖图以覆盖核心→driver→transport 的间接边，并只为上述入口开放需要的能力；runtime guard 和 CI 权限不放宽。

## 显式配置与入口

命令形状为 `node scripts/run-r003.mjs --live --database <absolute-path> --config <absolute-path> --credentials <absolute-path>`；无默认 live 命令、无缺参 fallback。实现源码路径与 build 布局应在 package/检查入口一致绑定，不把新入口挂到 import core 时执行。

- config 为 F1 精确非秘密配置；credential 文件只包含该配置所引用的两个逻辑 credentialRef 到 token 的映射，其他 key 拒绝。不从 argv token、shell env、HOME、.env 或全盘搜索读取秘密。
- 两个配置文件必须是显式绝对路径的普通文件，不接受 symlink；以安全 open/fstat 校验同一个文件句柄，避免校验后换文件。credential 文件仅当前用户可读写（0600），最大16384 bytes；config 最大131072 bytes。错误只输出固定码与非秘密引用。
- 先验证完整参数与 C5/F1 配置，用实际已读取 token 检查 config/日志候选的秘密反射且零泄漏，再持久接受 F1 配置，再连接 MagicChat；Case/Run 由真实消息创建后绑定该配置。端口只能从持久配置重建，禁止静默换模型/endpoint/凭据身份。实际认证身份的配置由 operator 验证，token 不落 SQLite/Trace。
- `--live` 是明确调用入口，不代表这个 Spec 已批准真实执行；本任务只在 fake factory 中验收入口行为。没有真实执行授权时禁止运行该命令。

## 串行行为与 State / Artifact handoff

1. 打开唯一 SQLite authority，完成 startup integrity/recovery；恢复已有 Run/config 及待处理请求，不能重建一套 Workflow 或把内存游标当事实。
2. reliable envelope 与 RPC response 按既有 protocol 顺序送入 receive；处理返回的 pending action 时必须通过 dispatch，同步提交 ready socket.send。ACK 只来自 authority pendingRequests；禁止跳过 cursor、自造 request ID 或自动确认未知发送。
3. stable wait 时释放执行，不忙轮询、不做模型调用；只消费显式输入、端口结果或停止信号。一个时刻最多一个 Profile 模型调用，不阻塞事件接收导致把旧上下文误当 fresh。
4. 通过 F1 准备绑定 Invocation；构造 C5 provider port 及请求体预检后，才调用 authority.executePreparedAttempt。Researcher evidence 只经原有确定性 synthetic source manifest 验证接受；不能把模型自述升格成 accepted evidence。
5. Analyst winner 经 F2 选择目标和权限投影；Reviewer 原子 H1；Writer 使用现有 createWriterArtifactContract 及 eligibility；审批/拒绝由 MagicChat 用户产生，禁止 fake fallback 用于 live。
6. Freshness 请求/发布/ACK 仍由既有 C3 gate 处理；新的用户输入优先形成持久状态，使过期输出无法发布。只有完整 authority completion predicate 成立才报告完成，并输出受限 Trace 位置/摘要。

允许为 driver 增加一个窄的只读 authority 工作投影，返回现有 Case/Run、待处理动作、当前 Invocation/Attempt 与等待原因；不把 SQL 放进 CLI，不新增第二状态表或事件总线。该投影只是查询，不能创建授权或补齐缺失业务结果。

## Stable identities / Failure modes / Recovery behavior

- 重启沿用配置、Run、Invocation、Attempt、request Envelope ID 与 Artifact digest；只重新连接 owned socket，不重放已完成模型 Invocation。
- 请求超时/断开：持久 authority 保留 UNKNOWN；默认退出等待人工决定，不自动开第二 Attempt。需要补跑时，显式 `--retry-unknown <attempt-id>` 只针对本 Run 的唯一 UNKNOWN、未耗尽两次 Attempt 上限且配置/上下文仍 fresh 的 Invocation；复用 authority audit 记录该显式恢复选择，并在同一事务中建立下一 Attempt 的接受记录，再开始有界调用；不新增第二套恢复状态。新增的窄 authority mutation 为 `authorizeUnknownRetry(attemptId, configurationDigest, now)`：校验属于当前 Run、UNKNOWN、无 winner、配置/上下文 fresh 且未耗尽后，以原 Attempt ID 派生稳定 audit identity（复用现有 ID 原语和 audit 表），event_kind 固定为 `UNKNOWN_RETRY_AUTHORIZED:<attemptId>`；配置 digest 进入审计内容。审计与下一 Attempt 接受原子提交，不存在已授权但无 Attempt 的中间状态。同 ID 同内容重放只返回原下一 Attempt；同 ID 不同配置拒绝。如果原下一 Attempt 已开始/UNKNOWN/完成，不再发送或创建第三次 Attempt。投影与这个窄 mutation 是本任务允许的 authority 接缝，必须有事务回滚和重放测试。其他状态/身份拒绝，不能变成普遍自动重试。
- MagicChat 未确认动作在新进程显式启动时按既有 authority API 恢复同 ID；网络断线不在后台无限重连。无法检索 provider 结果时不宣称 exactly-once 或取消成功。
- SIGINT/SIGTERM 停止接收新工作、关闭本实例 socket/本地请求并保留 UNKNOWN/持久证据；用 caller AbortSignal 取消 provider 读取；关闭/退出等待上限沿用已冻结关闭策略，不等待剩余 120 秒。deadline 到达同样停止新的调用并取消本地在途请求。不杀其他进程、不删除数据库/资源。SIGKILL 后由新进程依据 SQLite 恢复。
- 输出目标缺失/歧义、配置漂移、过期窗口、来源无效、审批不匹配和审计损坏产生明确等待/失败理由，不能注入答案继续。等待原因来自 authority 或失败结果，不伪造人类 Decision。

## Acceptance tests

1. 默认参数/缺 live/非法路径/不安全 credential 文件/多余键/无配置绑定均零 fake 外部调用；canary 不出现在异常、CLI 日志、SQLite 或 Trace。
2. 通过 fake inbound/provider 串行完成一个 Case 的四角色→人工测试事件→唯一发布；只在测试标注 synthetic，不将 fake 输出和审批用于真实资格。
3. 追问与审批 stable wait 不轮询、不重复模型调用；错误审批人、stale Artifact、新输入到达和重复 choice 不能绕过现有 gate。
4. 模型完成并 durable receipt 后崩溃/新进程恢复，不重复调用；UNKNOWN 默认停止，明确 retry 只产生允许的下一 Attempt；两次耗尽、deadline/context/config 漂移拒绝。
5. 发布接受但本地未确认后重启，同 request ID 恢复，仅一个最终消息；持久 ACK 未确认恢复不重复业务动作。
6. 不同进程实例由串行测试先退出再启动；不得引入第二副本运行。同一端口队列/超时限制、SIGTERM owned cleanup、Trace 上限与静态/运行时网络拒绝均验证。
7. CI 与可信 qualification 保持分离；测试不得监听网络端口。沿用已有本地 killed-process harness 能力做子进程验证，若需新能力先在 Spec 中列出精确路径与限制。

## 后续真实验收及边界影响

本 Issue 只交付 driver 代码与离线恢复。历史 #40 已有真实试运行主题，不能因旧关闭状态认为完成，也不自动恢复其旧执行路由；在准备真实执行时核对并保留历史后绑定独立执行 Spec/环境。该真实 Spec 须确定准确部署/endpoint/model、合成输入、人的批准、运行窗口、故障位置、恢复次数和停止条件。

金额上限继续 null；四个初始调用加一次补跑只是此前建议，不在这里接受为全局费用预算。F1 窗口与现有 Attempt 上限仍生效。无新事实权威或架构 ADR；如果装配必须改业务决策，回到该 owner 的 Spec，不藏在 loop 中。

## Evidence to return

交付 PR 绑定实际实施授权、Issue、base/head、Spec 固定提交和 SHA-256、测试命令/退出码/日志、审查发现及处置、迁移与接口变化、身份与恢复证据。运行固定 Node 24.19.0/npm 11.17.0 下的 `TMPDIR=/private/tmp ./scripts/validate-ci.sh`，将本任务离线测试加入精确 inventory 和受限执行入口；保留 workflow/check 名称与 runtime capability guard。说明哪些旧行为刻意保持、后续消费者是否仍成立。

普通 CI 不证明 trusted operator qualification 或真实 MagicChat/Baizhi 兼容性。本轮不产生实现、测试通过、真实人工批准或生产授权。不得设置标记伪造 qualification；真实执行须单独绑定环境和人的授权。
