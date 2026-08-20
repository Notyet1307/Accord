# R001 受控真实任务影子试点材料包

> 状态：`DEFERRED`。R001/r5 先运行单一基础架构冒烟测试；本材料包保留给后续质量、安全和真实数据优化，不是当前证据动作。

本目录只保存试点协议、空白模板、评价规则和后续脱敏结果，不保存真实企业资料、凭据、原始输出或可识别个人信息。

## 试点目的

判断受管 Agent 团队能否在明确的数据边界内，针对一个真实内部决策任务，产出不劣于员工当前方法的内部决策方案。

本试点可以建立：

- 一个真实任务中的方案质量、人工修改量和决策可用性；
- 固定资料包内的事实忠实度、引用完整性和未知处理；
- 合成安全挑战中的权限拒绝、Human Approval、Freshness 和 Dedup 行为。

本试点不能建立：

- 全企业采用率；
- 长期模型质量或成本；
- 生产规模稳定性；
- 未经测试的数据类型、Runtime 或工作流的安全性。

## 两套材料必须分开

### A. 真实任务质量包

保存在仓库外的批准目录：

```text
<approved-external-directory>/
├── 00-task-brief.md
├── 01-business-context.md
├── 02-options-and-constraints.csv
├── 03-cost-and-resource-data.csv
├── 04-security-requirements.md
├── 05-operations-notes.md
├── 06-known-unknowns.md
├── baseline/
│   └── current-method-output.md
└── manifest.sha256
```

要求：

- 一个尚未做出结论的真实内部决策；
- 至少三个选项，包含“保持现状”；
- 5–8 份脱敏、只读、不可变资料；
- 至少一处真实来源冲突；
- 至少一个确实未知的关键事实；
- 基线产物必须在查看 Accord 输出前独立完成。

### B. 合成安全挑战包

与真实质量包分开执行，不能影响质量评分：

- Prompt Injection 诱导；
- 未授权虚构数据路径；
- 绕过 Human Approval 的指令；
- 输出生成后的新约束；
- 重复消息和失败重试。

安全挑战只判断控制是否生效，不判断方案内容质量。

## 仓库内模板

- `task-brief.template.md`：定义任务、选项和决策边界。
- `source-manifest.template.csv`：冻结资料身份、摘要、授权和限制。
- `baseline-capture.template.md`：记录当前方法，防止事后调整基线。
- `evaluation-rubric.md`：固定硬门槛、质量评分和通过线。
- `security-authorization.template.md`：记录数据、模型、工具、网络和审批边界。
- `result-return.template.md`：只把脱敏结论和限制带回 Release。

## 执行顺序

1. 产品负责人选择一个真实、尚未决定的问题。
2. 数据所有者批准仓库外资料目录和使用范围。
3. 为每个文件计算 SHA-256，并完成 Source Manifest。
4. 员工使用当前方法独立完成基线；冻结其摘要和耗时。
5. 产品负责人、数据安全负责人共同确认本次精确协议。
6. 执行一次质量试点，不允许修改资料、评分或阈值。
7. 单独执行合成安全挑战。
8. 由实际决策使用者进行盲评或顺序随机评估。
9. 使用 `result-return.template.md` 形成脱敏结果；原始资料与输出留在批准位置。

## 默认安全边界

- 一个团队、一个任务、一个只读资料目录；
- 禁止外网、外发、凭据和生产写入；
- 不自动实施建议；
- Human Approval 前不得发布为正式结论；
- 出现未授权访问、数据外发、关键事实编造或审计缺失时立即停止；
- 清理试点副本并撤销临时 Agent、Skill 与工具绑定。
