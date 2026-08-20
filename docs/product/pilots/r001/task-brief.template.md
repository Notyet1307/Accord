# R001 真实内部决策任务说明

> 本文件是空白模板。真实填写版本必须保存在仓库外批准目录；仓库只保留脱敏结果和摘要。

## Identity

- pilot_id: `<stable pilot id>`
- decision_owner: `<有权作出或使用该决定的角色>`
- source_bundle_owner: `<有权批准资料使用的角色>`
- security_reviewer: `<检查数据与外发边界的角色>`
- target_decision_date: `<YYYY-MM-DD>`

## Decision question

用一个句子描述尚未决定、且本次输出能够改变的真实内部决定：

`<Should we choose / continue / stop / change ...>`

## Why this decision matters

- expected_business_effect: `<结果会影响什么>`
- consequence_of_delay: `<延迟的可观察后果>`
- consequence_of_wrong_choice: `<错误选择的主要影响>`

## Actor and use

- primary_reader: `<实际阅读并使用方案的角色>`
- decision_meeting_or_process: `<方案会在哪个流程中使用>`
- completion_signal: `<什么情况表示方案足以支持决定>`

## Options

至少三个选项，并包含保持现状：

1. `<option A>`
2. `<option B>`
3. `保持现状 / 不采取变化`

不得在这里预先写入推荐答案。

## Fixed comparison criteria

在运行前冻结，不得根据输出调整权重：

| Criterion | Weight | Minimum acceptable boundary |
| --- | ---: | --- |
| `<criterion 1>` | `<n>` | `<boundary>` |
| `<criterion 2>` | `<n>` | `<boundary>` |
| `<criterion 3>` | `<n>` | `<boundary>` |

## Constraints

- budget_or_cost_boundary: `<known boundary or UNKNOWN>`
- deadline: `<known boundary or UNKNOWN>`
- security_and_privacy: `<mandatory rules>`
- compatibility: `<mandatory compatibility>`
- operations_and_support: `<mandatory operating constraint>`
- prohibited_actions: `外发、生产写入、自动实施，以及其他明确禁止项`

## Known facts

只列资料包中有来源的事实，并引用 Source ID：

- `<fact> — SRC-...`

## Known conflicts

至少保留一处真实来源冲突供工作流识别：

- `<SRC-A says ...; SRC-B says ...; truth is unresolved>`

## Known unknowns

至少保留一个真实未知，不提供隐藏答案：

- `<unknown that must be surfaced rather than invented>`

## Required output

一份内部决策方案，至少包含：

1. 问题和约束；
2. 事实依据及 Source ID；
3. 备选方案；
4. 固定标准下的比较；
5. 推荐结论及理由；
6. 反方观点；
7. 风险、冲突和未知；
8. 需要 Human 决定或补充的事项；
9. 不执行方案的明确边界。

## Stop condition

出现以下任一情况立即停止：

- 资料授权不清；
- 需要未批准的数据、网络、凭据或生产权限；
- 任务已经做出决定，不再代表真实待决问题；
- 无法冻结比较标准或基线；
- 关键资料包含无法安全脱敏的信息。
