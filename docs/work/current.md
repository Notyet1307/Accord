# 当前工作入口

本页是跨会话导航，不拥有任务状态、运行事实或实施授权；当前状态沿 GitHub、版本化合同和实际执行记录核验。

- 当前 Accepted 增量：[R005/r1](../product/releases/r005-compliance-query-conversational-pilot.md)；决定边界由 [ADR-0005](../adr/0005-r005-candidate-response-and-trial-trust.md) / [ADR-0006](../adr/0006-r005-compliance-query-consumer-boundary.md) 所有，产品决定不变。
- 当前唯一行为合同：[R005-CQA/r6](../specs/r005-compliance-query-consumption.md)。它只修复 Run 的完整挂载集合；r5 私聊装配及 R003/R004 数据边界不变。
- 当前唯一软件修复任务：[Issue #83](https://github.com/Notyet1307/Accord/issues/83)。唯一 PR 的 head、审查、CI、资格与合并事实沿 GitHub 读取；不能因协议测试通过就关闭完整 Release。r5 交付见 [Issue #81](https://github.com/Notyet1307/Accord/issues/81) / [PR #82](https://github.com/Notyet1307/Accord/pull/82)，其原证据不转记为 r6。
- 用户选择「修复并继续测试」的[实际追加授权](/Users/yet/.local/share/accord-r005-live/pilot-01/evidence/mount-repair-authorization.json)允许额外修复交付后执行新隔离运行包；最多 2 小时、3 次 synthetic 查询/模型调用，操作员最多一次，正式接受仍由用户点击。完整权限与保留范围见 Spec 第 9 节。
- pilot-01 的真实非查询[停止决定](/Users/yet/.local/share/accord-r005-live/pilot-01/evidence/pre-query-stop-decision.json)与[失败观测](/Users/yet/.local/share/accord-r005-live/pilot-01/evidence/bootstrap-failure-observation.json)定位到平台整组替换 volumes，guest 缺程序/配置/回执。该窗口的 CQA 查询、模型 facade 计数与 Search 账本均为零；新资源已停止并保留，旧 MagicChat 未停止。已有 R005 测试账号/App/私聊的身份记录不证明查询可用。
- 历史监督器路径故障不再是当前阻塞：本次实际监督启动和定向停止已执行。新部署仍必须按合同重测真实完整挂载、控制鉴权、有效配置、独立输出和用户可见私聊；软件回归不是实际部署资格。
- 实现入口：[consumer](../../src/driver/r005-cqa.ts)、[纯字段/排版](../../src/driver/r005-chat.ts)、[live launcher](../../scripts/run-r005.mjs)、[RunService Adapter](../../src/transports/cqa-run-service.ts)、[wire/来源](../../src/contracts/cqa-query.ts)、[不可变输入](../../src/driver/r005-input.ts)。SQLite `r005_cqa` 表 schema 1、snapshot 3；旧 snapshot 1/2 只读拒绝，使用新库。
- 已交付 Adapter：[Issue #79](https://github.com/Notyet1307/Accord/issues/79) / [PR #80](https://github.com/Notyet1307/Accord/pull/80)，实际合并提交 `2bd1f166fb2c9008e4bd34ee1edd43ce0262b272`；[该 main CI](https://github.com/Notyet1307/Accord/actions/runs/34933007394)成功。原 head、test-merge、最终 merge 及各自资格保持分别绑定，不把 r4 通过转记为 r5。
- 历史 r4 [最终 head 资格](/Users/yet/.local/share/accord-qualification/r005-pr80-ioy3n1wl/evidence)和[双轴审查](/Users/yet/.local/share/accord-local-evidence/r005-review-11osb9jf/review.json)保留原证据；own-undefined 修正复用排序后 `JSON.stringify` 的既有语义。r5 文件系统层使用同一 OS 边界/runtime guard，增加两项私聊入口，其他 Node Permission Model 入口不变，见[开发验证](../development.md)。
- 生产者：[CQA PR #4](https://github.com/Notyet1307/compliance-query-agent/pull/4)，固定 `499af50675ab4355158eaf943fcb42c56b8c09fe`；[固定验收摘要](https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/accepted-summary.json)记录 synthetic 查询/草稿已接受、G1/G2 有界通过、G3 用户延期。CQA 保持单写者，不能把旧 NOT_RUN 当作生产者当前状态，也不能把其验收转成 Accord 的运行事实。
- 历史 R004 基线 `2668ee62f249d462930bd980c8178ce5f24f7f6e`，原任务 [#77](https://github.com/Notyet1307/Accord/issues/77)。不复用历史 C4 #44、Driver #72 或 R004 任务/数据库。
- 接管时按需读：[实际架构](../architecture.md) → [开发验证](../development.md)；[2026-09-11 回执](../handoff-receipt-2026-09-11.md)与[更早快照](../handoff-receipt.md)是历史资料，不是当前任务状态。术语有歧义时读 [词表](../../CONTEXT.md)，选择 Matt 方法时读 [Skill 衔接](../agents/skill-usage.md)。

本页不授予额外发布、模型、生产或权限扩张；未执行的真实场景必须明确保留未验证状态。
