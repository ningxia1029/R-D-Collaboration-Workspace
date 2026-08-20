# Agent 数据保留与删除手册

## 1. 数据分类

- 业务事实：项目、任务、BOM、变更、文档；按 WorkBuddy 业务策略管理，Agent 清理脚本不删除。
- Agent 运行数据：Run、消息、事件、检查点、ToolExecution、反馈、审批。
- 业务审计与活动事实：AuditLog、ActivityEvent；独立于 Agent Run 的删除策略。

保留天数必须由企业法务/安全/业务负责人批准。本仓库不擅自写死一个生产期限；每个 Run 使用 `retentionUntil` 作为可审计删除条件。

## 2. 预览和执行

```powershell
$env:AGENT_RETENTION_TARGET_ACK='<准确数据库名>'
npm run agent:retention
```

默认只预览最多 100 个已经到期的终态 Run。核对数量和事故保全要求后：

```powershell
$env:AGENT_RETENTION_APPLY_ACK='DELETE <数量> EXPIRED AGENT RUNS'
npm run agent:retention -- --apply
```

脚本会再次校验状态、到期时间和精确数量；Agent 子表通过外键级联清理。业务事实、AuditLog 和 ActivityEvent 不在该脚本范围内。

## 3. 数据主体请求

1. 验证申请人与范围，冻结自动清理以保留处理证据。
2. 查询用户关联的业务事实、Agent Run、反馈和审批；区分依法保留的审计记录。
3. 由数据负责人批准删除/匿名化清单；先在恢复副本演练。
4. 执行后记录查询条件、数量、哈希/工单、操作者和时间，不记录被删除的敏感正文。

当前未获得企业保留期限与数据主体流程签署，因此生产删除门禁仍未完成。
