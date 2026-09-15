# 当前工作入口

本页是跨会话导航，不拥有任务状态、运行事实或实施授权；当前状态沿 GitHub、版本化合同和实际执行记录核验。

- 当前 Accepted 增量：[R005/r1](../product/releases/r005-compliance-query-conversational-pilot.md)；决定边界由 [ADR-0005](../adr/0005-r005-candidate-response-and-trial-trust.md) / [ADR-0006](../adr/0006-r005-compliance-query-consumer-boundary.md) 所有，产品决定不变。
- 当前唯一行为合同：[R005-CQA/r5](../specs/r005-compliance-query-consumption.md)。用户在合并 Adapter 后选择「MagicChat 私聊」，软件范围为同一 owner 的字段补齐、候选、精确确认、持久发送和显式真实驱动；旧 R003/R004 数据与行为不迁移。
- 当前唯一软件交付任务：[Issue #81](https://github.com/Notyet1307/Accord/issues/81)。唯一 PR 及其 head、审查、CI、资格、合并事实沿该 Issue 的 GitHub 记录读取；不能因存在脚本或协议测试就关闭整个 Release。
- 独立真实执行授权：用户选择「授权该测试包」，允许审查/验证后的正常软件交付及有界私聊部署；[实际授权记录](/Users/yet/.local/share/accord-local-evidence/r005-merge80-jhjhxh10/private-chat-run-authorization.json)绑定原运行包。最多 2 小时、3 次 synthetic 查询/模型调用，独立新资源及凭据，不自动补跑，不接管旧服务；完整边界见 Spec 第 9 节。授权不等于执行，正式接受由用户点击。
- 本地首轮[完整 CI 日志](/Users/yet/.local/share/accord-local-evidence/r005-chat-8b4fev3m/ci-01.log)记录 389/389；[实际 consumer API 冒烟](/Users/yet/.local/share/accord-local-evidence/r005-chat-8b4fev3m/smoke-02.log)覆盖原文、补字段、重启重放、先受理后输入和 preflight 拒绝零 Start，[CLI 拒绝记录](/Users/yet/.local/share/accord-local-evidence/r005-chat-8b4fev3m/cli-refusal-01.log)覆盖缺少显式 live 参数。它们只证明当时受测软件，不是 operator 资格、真实 IM/模型或新提交的重认证；最终绑定由 PR 证据索引所有。
- 真实启动前尚须核验监督进程能力、实际 MagicChat 部署来源/协议、新有效配置、输入挂载、控制权限和分离输出。当前会话工具监督器引用已不存在的 OMP 18.1.17 路径，而已安装入口为 18.1.20；进程管理与浏览器守护器不可用，不能绕过监督在后台启动服务。恢复工具能力后继续已获准运行包，不再次借用旧环境授权。
- 实现入口：[consumer](../../src/driver/r005-cqa.ts)、[纯字段/排版](../../src/driver/r005-chat.ts)、[live launcher](../../scripts/run-r005.mjs)、[RunService Adapter](../../src/transports/cqa-run-service.ts)、[wire/来源](../../src/contracts/cqa-query.ts)、[不可变输入](../../src/driver/r005-input.ts)。SQLite `r005_cqa` 表 schema 1、snapshot 3；旧 snapshot 1/2 只读拒绝，使用新库。
- 已交付 Adapter：[Issue #79](https://github.com/Notyet1307/Accord/issues/79) / [PR #80](https://github.com/Notyet1307/Accord/pull/80)，实际合并提交 `2bd1f166fb2c9008e4bd34ee1edd43ce0262b272`；[该 main CI](https://github.com/Notyet1307/Accord/actions/runs/34933007394)成功。原 head、test-merge、最终 merge 及各自资格保持分别绑定，不把 r4 通过转记为 r5。
- 历史 r4 [最终 head 资格](/Users/yet/.local/share/accord-qualification/r005-pr80-ioy3n1wl/evidence)和[双轴审查](/Users/yet/.local/share/accord-local-evidence/r005-review-11osb9jf/review.json)保留原证据；own-undefined 修正复用排序后 `JSON.stringify` 的既有语义。r5 文件系统层使用同一 OS 边界/runtime guard，增加两项私聊入口，其他 Node Permission Model 入口不变，见[开发验证](../development.md)。
- 生产者：[CQA PR #4](https://github.com/Notyet1307/compliance-query-agent/pull/4)，固定 `499af50675ab4355158eaf943fcb42c56b8c09fe`；[固定验收摘要](https://github.com/Notyet1307/compliance-query-agent/blob/499af50675ab4355158eaf943fcb42c56b8c09fe/evidence/s2-query/accepted-summary.json)记录 synthetic 查询/草稿已接受、G1/G2 有界通过、G3 用户延期。CQA 保持单写者，不能把旧 NOT_RUN 当作生产者当前状态，也不能把其验收转成 Accord 的运行事实。
- 历史 R004 基线 `2668ee62f249d462930bd980c8178ce5f24f7f6e`，原任务 [#77](https://github.com/Notyet1307/Accord/issues/77)。不复用历史 C4 #44、Driver #72 或 R004 任务/数据库。
- 接管时按需读：[实际架构](../architecture.md) → [开发验证](../development.md)；[2026-09-11 回执](../handoff-receipt-2026-09-11.md)与[更早快照](../handoff-receipt.md)是历史资料，不是当前任务状态。术语有歧义时读 [词表](../../CONTEXT.md)，选择 Matt 方法时读 [Skill 衔接](../agents/skill-usage.md)。

本页不授予额外发布、模型、生产或权限扩张；未执行的真实场景必须明确保留未验证状态。
