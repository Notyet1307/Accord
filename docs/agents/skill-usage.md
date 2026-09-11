# Matt Skills 与仓库授权衔接

选择开发方法时读本页；技能提供方法，实际范围由用户请求及 [Delivery Gate](delivery-gate.md) 决定。先确认技能在当前执行器实际可用，再读其 SKILL.md；安装账本不是加载证据。机器路径和版本快照见 [开发入口](../development.md)，无需复制技能到仓库。

| 方法 | 适用任务与必要输入 | 本仓库边界 |
| --- | --- | --- |
| code-review | 固定 Git 基点、实际 diff、版本化 Spec 和仓库标准；按技能分别做标准与规格审查 | 使用真实审查记录，不能把审查通过当作实施或合并授权 |
| diagnosing-bugs / tdd | 已授权的诊断或测试驱动变更；追踪调用方与共享根因 | 测试按开发文档分级；只读调查不自动包含产品测试、服务或真实模型 |
| to-spec | 准备一个有界行为合同 | 复用 Accepted Release/ADR，只维护一个版本化 Spec；准备不等于接受或实施 |
| to-tickets / triage | 有明确授权的任务发布或整理 | 遵循 [tracker](issue-tracker.md) 和 [labels](triage-labels.md)；无远端写入授权时仅提出草案 |
| domain-modeling / codebase-design | 术语或具体模块边界存在歧义 | 遵循 [domain](domain.md)，按需复用词表/ADR，不机械创建上下文地图或通用平台 |

复用现有规则文件；仅在用户明确批准的范围安装技能、改变全局 OMP 设置或启用后台运行。技能不可用时如实记录缺项，不制造执行结果。历史 Planner/Controller 仅按 Delivery Gate 的独立选择规则使用。
