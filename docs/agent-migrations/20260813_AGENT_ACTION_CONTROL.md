# 20260813 Agent Action Control 迁移说明

## 变更

迁移 `20260813002000_agent_action_control` 只扩展 `Agent_Approval_Requests`：提议散列、确认 nonce 散列、执行幂等键、执行结果、回读与失败摘要；同时扩展终态约束并增加执行键唯一索引。不回填、不修改 `Tasks` 或其他业务表。

## 上线前

1. 备份并验证备份可读。
2. 在同版本隔离恢复库运行 `npx prisma migrate deploy`。
3. 运行 `npx prisma migrate diff --from-url <isolated-url> --to-schema-datamodel prisma/schema.prisma --exit-code`，必须为 `No difference detected`。
4. 配置独立的 `AGENT_ACTION_APPROVAL_SECRET`，不得与内部服务、委托或 cursor 密钥复用。
5. Action Tool 默认可由管理员总开关停用；未配置动作密钥时仅保留只读 Agent 能力。

## 回滚

应用代码可先回滚并停用 `plm_action_propose_task_update`；新增可空列不会影响旧代码。数据库收缩（删列/缩状态约束）不作为紧急回滚步骤，需另行维护窗口和备份后执行。

## 隔离验收

```powershell
$env:DATABASE_URL = "postgresql://postgres@127.0.0.1:<port>/workbuddy_phase7_<name>?schema=public"
$env:AGENT_ACTION_VERIFY_TARGET_ACK = "workbuddy_phase7_<name>"
$env:AGENT_ACTION_VERIFY_ALLOW_DESTRUCTIVE = "1"
npm run db:agent-action-verify
```

验收器拒绝非 `127.0.0.1`、非 `workbuddy_phase7_*` 或未显式确认的目标。
