# R003 F2：基于实际 Analyst winner 的 Reviewer 目标授权

## 状态、权威与授权

- Revision：`R003-F2/r1`；状态：开发规格，尚未实现。2026-09-09 用户明确要求「你得创建啊 我后续要按照issue、spec去开发」，授权本轮编写和发布 Spec、创建开发 Issue；本轮不实施这些功能、不调用真实服务。
- 核验代码基线：`c625517687a8b90c2e31a509c149b2102c3aaf5e`（C5 PR #69 已合并）。实施时重新核对 main；若契约或迁移序号漂移，先修订本 Spec，不能沿用过期证据。
- Authoritative inputs：[R003/r1](../product/releases/r003-governed-case-blackboard-walking-skeleton.md)、[ADR-0002](../adr/0002-production-coordination-runtime-language.md)、[ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md)、[C5/r1.1](r003-c5-external-adapter-conformance.md)、当前代码/测试，以及 [delivery gate](../agents/delivery-gate.md)、[tracker](../agents/issue-tracker.md)、[labels](../agents/triage-labels.md)。Vision 只提供长期方向。
- GitHub Issue 是唯一开发任务入口，只链接本 Spec 的固定提交与后续 PR；不复制规格、不建立历史 Harness 子图。后续开发须绑定实际实施请求、该 Spec 修订和代码 base/head。
- 保留单进程、一个冻结合成 Case、SQLite/WAL、四个固定 Profile、一次精确 Human Approval、一个 Response Owner；不改变外部事实权威，不引入 Lody/ACP/CRDT/通用 Runtime。

## Objective / Owner / Producer / Consumer / Primary seam

让实际 Analyst 输出中的无依据 Proposal 能进入 Reviewer，无需产生固定英文答案。仅支持 R003 的一个可唯一定位的 UNSUPPORTED 目标，不扩展为通用目标规划器。

- Owner：Accord Context Assembler 与 Reviewer authorization。
- Producer：已提交的 Analyst winner 和 immutable Board graph。
- Consumer：Reviewer dual disposition → Writer 精确 H1/Artifact，以及 [driver](r003-live-driver.md)。
- Primary seam：真实 winner 的目标引用 → 持久 Context → 最小权限投影与输出契约。
- 当前事实：`src/reviewer-context.ts` 的 `exactTarget/project` 和 `src/contracts/researcher-analyst-handoff.ts` 固定了两句英文；`src/reviewer-disposition.ts` 已要求 supportStatus=UNSUPPORTED。单改 selector 或 prompt 无法安全解决。

## In scope / Out of scope

新增显式版本的实际目标授权契约、确定性 selector、context/恢复分流以及相关 Reviewer/Writer 消费者适配与离线测试。不改旧 handoff/oracle bytes，不放宽为任意 target，不引入模型选目标、人工目标选择 UI、多个 Reviewer、重写 Analyst 输出、支持 SUPPORTED target 的新产品流程或自动审批。

本任务不增加 schema 迁移：持久 `profile_contexts.profile_version` 与 `runtime_invocations.profile_version` 明确使用 `accord.reviewer/v2`、`accord.writer/v2` 表示实际 winner 策略；旧 v1 Profile 继续表示固定目标。Context 存储 schema 保留 v1，若采用 F1 配置绑定则用 F1 定义的 config-bound-v2；不靠改变 schema CHECK 来区分目标。Profile 版本已进入 contextDigest，materialization/output 引用必须回查同一持久 Profile 版本。output payload/H1 形状不变；解析器按引用的 Profile 版本应用对应校验，未知组合拒绝。禁止按目标文字猜版本或静默重解释旧记录。

## 目标选择与 State / Artifact handoff

新增策略 `accord.reviewer-target/analyst-winner-v1`；旧固定目标仍使用原版本。新策略作为新 Profile/context 版本的明确组成部分，进入 contextDigest，并由 SQLite 记录，不能由来路不明的 request 参数临时切换。

1. 按精确 Case/Run/Board 读取已 RESULT_COMMITTED 的 ANALYST Invocation 与唯一 WINNER Arrival；从持久 output 重构 Board entries，并与已持久 entry IDs/digests/relations 比较。
2. 从该 winner 产生的 Proposal 中筛选 `supportStatus=UNSUPPORTED`；必须恰好一个。零个返回 REVIEW_TARGET_MISSING，多个返回 REVIEW_TARGET_AMBIGUOUS；在 Reviewer Invocation/Attempt 准备前拒绝。不得挑第一条、按英文、按模型置信度或 fallback 选择。
3. 该 Proposal 必须至少引用一个来自其实际依赖图的 `Claim`，且至少一个 Claim 明确 `unsupported=true`；Claim/Proposal 文本允许任意符合既有 payload schema 的非空内容。缺少对应 Claim 或 relation/schema 不一致拒绝 TARGET_MISMATCH。
4. 从 Proposal 遍历完整合法 cited graph；继续检查当前代码的类型关系、Case/Board、visibility=CASE、instruction_authority=NONE、status、大小/节点数、digest 和循环限制。不可从未引用或未授权 Board 条目补证据。
5. 目标引用保留实际 resultId/invocationId/proposalId/proposalDigest/proposalBoardRevision/Case/Run/Board/supportStatus=UNSUPPORTED/workflowNode=REVIEWER。来源 winner、投影与 selected entries 必须完全一致。
6. Reviewer 输出仍是同一目标上的 Critique + VerificationResult，原子物化唯一 H1；实际措辞不能转移目标或证明外部结果。Writer 必须通过同策略的授权投影读取该 H1，保留 C2 的 accepted evidence、assertion manifest、Artifact eligibility 和 C3 精确审批。

这不是让模型制造指定错误：新路径如果未产生可审查的无依据目标，就如实停止/报告 REVIEW_TARGET_MISSING。真实 Release 是否达成预置问题验收必须另给证据，不能注入固定模型答案弥补。

## Stable identities / Failure modes / Recovery behavior

同持久 winner 和同 context 版本返回同目标与 digest；不同 winner、Case/Run、Board revision 或 selected entry digest 不得沿用授权。维持 protected resource、authority escalation、freshness、context binding 拒绝规则。

新旧版本由持久版本明确 dispatch；旧记录走旧精确检查，新记录走新图契约。unknown version 拒绝。Reviewer/Writer 创建、返回、H1 parse、startup 重建和 Trace 必须使用一致版本，不能只修改运行时入口。

缺图、越权、篡改、循环、stale、多个 winner 或目标歧义均在模型调用前拒绝；晚到/重复 Reviewer 结果仍仅为审计，不二次追加 H1。崩溃恢复从原 winner/context 重建，不重新选“最新目标”。

## Acceptance tests

1. 至少两组不同中文/英文的非固定 Analyst Claim/Proposal，经业务 API 提交为 winner 后获得相同规则的合法 Reviewer view；不直接写业务完成表。
2. 零个/多个 UNSUPPORTED Proposal、没有 unsupported Claim、非法 relation 分别拒绝；不新增 Reviewer Attempt、不调用 fake provider。
3. 跨 Case/Run/Board、非 winner、伪造 resultId、篡改 proposal/claim digest、selected graph 缺条目、引用环和超限均拒绝。
4. 新输入/Board 或 Workflow revision 漂移、错误 contextDigest/版本、越权操作继续被原 gate 拒绝。
5. Reviewer 双输出不同目标或 disposition 冲突不能持久 H1；合法双输出通过新路径交给 Writer，不能接受缺失/未接受 Evidence 或绕过 Artifact eligibility。
6. reopen 与重复投递恢复同一 target/H1；新旧数据库样本同时测试，旧 C1–C4 frozen oracle/handoff 保持字节和验证语义。

## 依赖与边界影响

与 F1 无数据依赖；先完成 F1 再合入 F2 可减少共享 context 改动冲突。实施时准确绑定 F1 新 context 版本（若已合入），保持 target policy 与配置 digest 同时可恢复。driver 必须等待两者交付。

同一 authority 内收敛授权，不改变 ADR-0003 的权限和目标；无需另选 Runtime 或架构 ADR。跨入多目标/支持型 Proposal 应先另行定义规格。

## Evidence to return

交付 PR 绑定实际实施授权、Issue、base/head、Spec 固定提交和 SHA-256、测试命令/退出码/日志、审查发现及处置、迁移与接口变化、身份与恢复证据。运行固定 Node 24.19.0/npm 11.17.0 下的 `TMPDIR=/private/tmp ./scripts/validate-ci.sh`，将本任务离线测试加入精确 inventory 和受限执行入口；保留 workflow/check 名称与 runtime capability guard。说明哪些旧行为刻意保持、后续消费者是否仍成立。

普通 CI 不证明 trusted operator qualification 或真实 MagicChat/Baizhi 兼容性。本轮不产生实现、测试通过、真实人工批准或生产授权。不得设置标记伪造 qualification；真实执行须单独绑定环境和人的授权。
