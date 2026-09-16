# 当前工作入口

本页是跨会话导航，不拥有任务状态、运行事实或实施授权；当前状态沿 GitHub、版本化合同和实际执行记录核验。

- 当前 Accepted 增量：[R005/r1](../product/releases/r005-compliance-query-conversational-pilot.md)；决定边界由 [ADR-0005](../adr/0005-r005-candidate-response-and-trial-trust.md) / [ADR-0006](../adr/0006-r005-compliance-query-consumer-boundary.md) 所有，产品决定不变。
- 当前唯一行为合同：[R005-CQA/r8](../specs/r005-compliance-query-consumption.md)。它仅修复已核验原 Run 的有界结果等待；未核验身份的三十秒恢复、六次总读取、原一百二十秒截止及既有证明／取消边界不变。
- 当前唯一软件修复任务：[Issue #87](https://github.com/Notyet1307/Accord/issues/87)。head、审查、CI、资格与合并事实沿该任务的 GitHub 链接读取；软件通过不代表完整 Release 通过。先前私聊、挂载与 r7 协议交付分别见 [PR #82](https://github.com/Notyet1307/Accord/pull/82) / [PR #84](https://github.com/Notyet1307/Accord/pull/84) / [PR #86](https://github.com/Notyet1307/Accord/pull/86)，其证据保持原版本绑定。
- 用户选择「修复并用最后额度验证」的[实际追加授权](/Users/yet/.local/share/accord-r005-live/pilot-05/evidence/collection-wait-repair-authorization.json)允许本次 Spec／Accord 修复、验证、独立审查、资格与正常合并；门禁通过后才可使用原总预算内最后一次合成查询／模型调用。权限、停止及保留边界由 Spec 第 9 节所有；原截止 **2026-09-16T08:36:52.421Z** 不延长，正式接受仍由用户执行。
- 本修复的触发记录是 pilot-05 [实际回执](https://github.com/Notyet1307/Accord/pull/86#issuecomment-5693828912)：该次 Search／模型成功、CQA 返回 `DRAFT_READY`，但六次读取在完整独立证明可用前 942 毫秒耗尽，未提交候选或取得 Human Acceptance。修复后的运行事实沿当前任务关联 PR 的证据索引核验，不以生产者成功或软件通过代替私聊闭环。
- 历史 pilot-02 的[实际执行记录](/Users/yet/.local/share/accord-r005-live/pilot-02/evidence/session-observation.json)与 [PR 证据](https://github.com/Notyet1307/Accord/pull/84#issuecomment-5691928645)记录完整挂载非查询预检通过、问题／确定性追问真实可见，随后两个私聊协议入口错误阻断完整查询。该次 CQA／模型／Search 均为零，资源停止保留及原 MagicChat 状态仅按该次记录解释；不是最新运行或可用性验收。
- 新部署仍须重新冻结实际身份、有效配置、完整挂载、控制鉴权、独立输出和私聊观测；保留 pilot-01 至 pilot-05 现场，不重置旧 Operation、延长窗口、自动重试／替代查询或借用旧 CQA 数据。
- 实现入口：[consumer](../../src/driver/r005-cqa.ts)、[纯字段/排版](../../src/driver/r005-chat.ts)、[live launcher](../../scripts/run-r005.mjs)、[RunService Adapter](../../src/transports/cqa-run-service.ts)、[wire/来源](../../src/contracts/cqa-query.ts)、[不可变输入](../../src/driver/r005-input.ts)。SQLite `r005_cqa` 表 schema 1、snapshot 3；旧 snapshot 1/2 只读拒绝，使用新库。
- 已交付 Adapter：[Issue #79](https://github.com/Notyet1307/Accord/issues/79) / [PR #80](https://github.com/Notyet1307/Accord/pull/80)，实际合并提交 `2bd1f166fb2c9008e4bd34ee1edd43ce0262b272`；[该 main CI](https://github.com/Notyet1307/Accord/actions/runs/34933007394)成功。原 head、test-merge、最终 merge 及各自资格保持分别绑定，不把 r4 通过转记为 r5。
- 历史 r4 [最终 head 资格](/Users/yet/.local/share/accord-qualification/r005-pr80-ioy3n1wl/evidence)和[双轴审查](/Users/yet/.local/share/accord-local-evidence/r005-review-11osb9jf/review.json)保留原证据；own-undefined 修正复用排序后 `JSON.stringify` 的既有语义。r5 文件系统层使用同一 OS 边界/runtime guard，增加两项私聊入口，其他 Node Permission Model 入口不变，见[开发验证](../development.md)。
- 生产者：[CQA PR #4](https://github.com/Notyet1307/compliance-query-agent/pull/4)，固定 `499af50675ab4355158eaf943fcb42c56b8c09fe`；[固定验收摘要](https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/accepted-summary.json)记录 synthetic 查询/草稿已接受、G1/G2 有界通过、G3 用户延期。CQA 保持单写者，不能把旧 NOT_RUN 当作生产者当前状态，也不能把其验收转成 Accord 的运行事实。
- 历史 R004 基线 `2668ee62f249d462930bd980c8178ce5f24f7f6e`，原任务 [#77](https://github.com/Notyet1307/Accord/issues/77)。不复用历史 C4 #44、Driver #72 或 R004 任务/数据库。
- 接管时按需读：[实际架构](../architecture.md) → [开发验证](../development.md)；[2026-09-11 回执](../handoff-receipt-2026-09-11.md)与[更早快照](../handoff-receipt.md)是历史资料，不是当前任务状态。术语有歧义时读 [词表](../../CONTEXT.md)，选择 Matt 方法时读 [Skill 衔接](../agents/skill-usage.md)。

本页不授予额外发布、模型、生产或权限扩张；未执行的真实场景必须明确保留未验证状态。
