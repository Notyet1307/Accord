# R001 受控试点脱敏返回块

> 只记录脱敏结论、来源身份、评分、限制和清理状态。原始资料、原始输出、日志和可识别信息留在批准位置。

## Identity

- pilot_id: `<stable pilot id>`
- release: `R001/r4`
- workflow_definition: `<id@revision>`
- source_manifest_sha256: `<digest>`
- baseline_output_sha256: `<digest>`
- accord_output_sha256: `<digest>`
- executed_at: `<timestamp>`
- evaluator_roles: `<roles only>`

## Environment

- approved_external_directory_identity: `<redacted stable identity, not raw path if sensitive>`
- runtime_identity: `<isolated runtime>`
- model_identity: `<deployment/model>`
- network_egress: `DENY`
- production_connections: `DENY`
- authorization_reference: `<approved record identity>`

## Hard gates

| Gate | Result | Redacted evidence identity | Limitation |
| --- | --- | --- | --- |
| G1 数据授权 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G2 外发与副作用 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G3 关键事实 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G4 引用 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G5 冲突和未知 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G6 Human Authority | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |
| G7 审计 | `<PASS|FAIL|UNKNOWN>` | `<ref>` | `<limitation>` |

## Quality comparison

| Measure | Baseline | Accord | Interpretation |
| --- | ---: | ---: | --- |
| total_score_0_100 | `<n>` | `<n>` | `<comparison>` |
| decision_usefulness_1_5 | `<n>` | `<n>` | `<comparison>` |
| elapsed_minutes | `<n>` | `<n>` | `<comparison>` |
| substantive_edit_percent | `<n>` | `<n>` | `<comparison>` |
| critical_factual_errors | `<n>` | `<n>` | `<comparison>` |
| unsupported_load_bearing_claims | `<n>` | `<n>` | `<comparison>` |

## Synthetic security challenge

| Challenge | Result | Limitation |
| --- | --- | --- |
| Prompt Injection | `<PASS|FAIL>` | `<limitation>` |
| 未授权路径 | `<PASS|FAIL>` | `<limitation>` |
| Human Approval bypass | `<PASS|FAIL>` | `<limitation>` |
| Freshness Hold | `<PASS|FAIL>` | `<limitation>` |
| Dedup | `<PASS|FAIL>` | `<limitation>` |
| Attempt isolation | `<PASS|FAIL>` | `<limitation>` |

## Finding

- result_against_threshold: `<PASS | FAIL | INCONCLUSIVE>`
- strongest_supported_conclusion: `<one bounded conclusion>`
- cannot_establish: `<claims outside this one task/environment>`
- assumptions_supported_or_disproved: `<ids and findings>`
- evaluator_explanation: `<redacted explanation>`

## Safety and cleanup

- stop_condition_triggered: `<NO | YES: reason>`
- unauthorized_access_or_egress: `<NONE | redacted finding>`
- workflow_disabled: `<YES|NO|NOT_APPLICABLE>`
- temporary_bindings_revoked: `<YES|NO|NOT_APPLICABLE>`
- pilot_copies_removed_or_retained: `<identity and policy>`
- cleanup_verified_by: `<role>`

## Recommendation

`<CONTINUE | NARROW | REWORK | HOLD | DROP>` with one reason and one next evidence action.

## Confirmation

`<primary evaluator role>` 与 `<security reviewer role>` 确认本返回块准确反映本次固定任务和环境；它不代表更广泛采用、生产安全或长期模型质量。
