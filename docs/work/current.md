# 当前工作入口

这是跨会话导航，不拥有任务状态或实施授权。最近只读核验：2026-09-11；开始工作时重新核对链接目标与 Git。

- 本地当前增量：[R004/r1](../product/releases/r004-sas-conversational-agent-pilot.md)，目标是让固定 SAS 事件研判助手通过 IM 沟通完成任务；架构决定见 [ADR-0004](../adr/0004-sas-conversational-agent-boundary.md)。
- 当前合同：[R004-DIALOGUE/r1](../specs/r004-sas-contact-dialogue.md)。当前只落地离线两轮对话消费接缝；真实聊天服务尚未接通。
- 本地候选：`codex/r004-sas-dialogue`，base `2668ee62f249d462930bd980c8178ce5f24f7f6e` 加未提交改动。R004 Release、ADR 与实现尚未提交到 main；SAS 合同及跨仓工作树位置见旧快照，使用前重新核验。
- 正式任务入口：[Accord Issues](https://github.com/Notyet1307/Accord/issues)。核对实际状态与评论后选择任务；历史 C4 #44 和 Driver #72 不作为新任务入口，不凭空填写编号。
- 历史验证：[本机 manifest](/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/manifest.json) 与 [CI 日志](/Users/yet/.local/share/accord-local-evidence/r004-dialogue-nscum4mz/ci.log)。旧 manifest 记录 314 项离线通过，含 11 项 R004，只证明原受测版本。2026-09-11 调查未重跑或重新核验原始日志，不作为当前脏树、实际 IM/模型或 operator qualification 的通过记录。
- 后续候选：[首个外部只读合规智能体闭环草案](../handoff-receipt-2026-09-11.md)，暂名 R005，未批准，不替换 R004。文档修补批准不代表接受该 Release 或授权实现。下一技术建议是其中 X1：固定 agent-compose 命令式运行、持久身份、结果查询/取消和 OctoBus 权限合同；实施前另行确认范围。
- 接管必读：[实际架构](../architecture.md) → [开发验证](../development.md) → [2026-09-11 接管回执](../handoff-receipt-2026-09-11.md)。跨仓旧状态保留在 [2026-09-10 快照](../handoff-receipt.md)，使用时重新核验。
- 选择 Matt 方法时读 [Skill 使用衔接](../agents/skill-usage.md)，术语有歧义时读 [词表](../../CONTEXT.md)。

若要继续，沿用已经接受的产品方向，按具体任务合同补齐缺口；本页不授予推送、发布、真实模型或生产权限。
