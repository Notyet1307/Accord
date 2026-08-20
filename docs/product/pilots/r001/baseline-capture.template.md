# R001 当前方法基线记录

> 在任何评估者查看 Accord 输出前完成并冻结。原始基线产物保存在仓库外批准目录。

## Identity

- pilot_id: `<same pilot id as task brief>`
- baseline_method: `<当前人工流程或已批准工具>`
- performer_role: `<执行当前方法的人>`
- started_at: `<timestamp>`
- completed_at: `<timestamp>`
- elapsed_minutes: `<number>`
- output_path: `<approved external path>`
- output_sha256: `<64 lowercase hex>`

## Conditions

- 使用的 Source IDs：`<SRC-...>`
- 是否与 Accord 使用同一资料快照：`YES | NO`
- 是否使用额外资料：`NO | YES: <identity and approval>`
- 是否知道 Accord 输出内容：`NO`，否则该基线无效。
- 是否已经知道最终组织决定：`NO`，否则该任务不适合作为本轮试点。

## Effort

- active_work_minutes: `<number>`
- waiting_minutes: `<number>`
- people_involved: `<roles only>`
- review_rounds: `<number>`
- substantive_revisions: `<number>`

## Baseline quality evaluation

使用 `evaluation-rubric.md` 的同一评分标准：

- hard_gates: `<PASS | FAIL with reasons>`
- score: `<0-100>`
- decision_usefulness: `<1-5>`
- critical_factual_errors: `<number>`
- unsupported_load_bearing_claims: `<number>`

## Limitations

- `<anything that makes baseline and Accord output less comparable>`

## Freeze confirmation

`<performer role>` 确认以上记录及输出摘要在查看 Accord 输出前已经冻结。
