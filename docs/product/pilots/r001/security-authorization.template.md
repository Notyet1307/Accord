# R001 试点安全与数据授权

> 不在本文件中记录凭据、密钥、个人信息或原始敏感内容。真实签署版本保存在批准位置；仓库只保留脱敏授权摘要。

## Approval identity

- pilot_id: `<stable pilot id>`
- product_owner: `<role>`
- source_bundle_owner: `<role>`
- security_reviewer: `<role>`
- authorization_date: `<YYYY-MM-DD>`
- expires_at: `<timestamp or end-of-pilot>`

## Exact scope

- approved_external_directory: `<absolute path outside repository>`
- source_manifest_sha256: `<digest>`
- approved_workflow_definition: `<id@revision>`
- approved_agent_profiles: `<ids@revisions>`
- approved_skill_versions: `<ids@revisions>`
- approved_runtime: `<isolated runtime identity>`
- approved_model: `<deployment/model identity or NONE>`
- approved_evaluator_roles: `<roles>`

## Data boundary

- allowed_classifications: `<PUBLIC | INTERNAL | approved redacted subset>`
- prohibited_data: `凭据、密钥、未经批准的个人信息、未脱敏客户数据、生产数据写入`
- source_access: `READ_ONLY`
- network_egress: `DENY`
- external_tool_calls: `DENY`
- production_connections: `DENY`
- persistence: `<approved isolated output directory only>`
- retention: `<duration>`
- training_use: `DENY`

## Protected assets

- `<documents, prompts, outputs, logs, credentials or systems protected by this approval>`

## Pre-run verification

- [ ] Source Manifest 摘要与目录中文件一致。
- [ ] 资料目录只读。
- [ ] 网络和外部工具默认拒绝。
- [ ] 无凭据和生产连接。
- [ ] Agent、Skill、Workflow 和 Runtime 版本锁定。
- [ ] Human Approval Gate 可观察且不可由 Agent 绕过。
- [ ] Freshness、Dedup、Attempt 和审计记录已启用。
- [ ] 清理命令或人工步骤已验证。

## Stop conditions

任一发生立即停止：

- 未授权文件、路径、网络或工具访问；
- 敏感数据出现在未批准输出或日志；
- Source Manifest、模型、Agent、Skill 或 Workflow 发生漂移；
- Agent 尝试绕过 Human Approval；
- 关键事实无来源或被编造；
- 审计缺失，无法证明实际访问与发布行为。

## Recovery and cleanup

- disable_workflow: `<exact reversible action>`
- revoke_agent_and_tool_bindings: `<exact reversible action>`
- remove_pilot_copies: `<exact path/action>`
- verify_access_ended: `<verification>`
- retain_audit_summary_at: `<approved location>`

## Authorization statement

`<source bundle owner>` 与 `<security reviewer>` 仅批准上述精确范围内的一次只读影子试点。该授权不包含生产启用、外发、自动实施、范围扩张或后续重复运行。
