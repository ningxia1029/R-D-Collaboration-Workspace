# Agent 回滚与恢复手册

## 1. 应用与 Worker 回滚

1. 先关闭 Agent 总开关并记录事故编号、UTC 时间和操作者。
2. 停止新 Worker 领取；等待或取消活动 Run，保留 Run/Tool/审批审计。
3. 将 Web 与 Worker 回滚到同一已签名版本；不得混用 Tool 契约或 prompt 版本。
4. 执行登录、只读 Tool、401、总开关和维护消息 smoke test。
5. 只有错误率、权限和审计恢复后才逐步重开。

## 2. 数据库恢复

默认恢复到新库，不在原库上直接 `--clean`：

```powershell
.\scripts\db-backup.ps1 -OutputDir '<受控备份目录>'
.\scripts\db-restore.ps1 -BackupFile '<backup.dump>'
```

第一条恢复命令只校验归档和 SHA-256；真正执行必须显式传入 `-Execute` 及工具打印的精确 `-TargetConfirmation`。完成后运行：

```powershell
npx prisma migrate deploy
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
```

再抽检用户/角色、项目、任务、Agent Run、消息、审批、AuditLog 与 ActivityEvent 数量和摘要。切换连接前保留旧库只读快照和明确回退窗口。

## 3. 模型或 Worker 故障

- 模型超时、429、无效结构或网络故障必须进入 `FAILED/EXPIRED`，不得无限重试。
- Worker 中断后只从持久检查点恢复；同一 `requestId` 不重复 Tool 审计或业务结果。
- 无可用模型时关闭 Agent 或显示维护消息；不得让模型故障阻断 PLM 核心页面。

## 4. 桌面升级回滚

1. 新旧两个版本的绿色版主程序与便携外层 exe 都必须签名，并带 SHA-256 与 `BUILD-PROVENANCE.json`。
2. 先在测试机从旧版下载新包，验证签名、哈希、登录和核心页面。
3. 退出旧客户端后启动新包；失败时重新启动保留的旧签名包。
4. 验证用户配置不包含密钥，服务 URL 仍为 HTTPS，旧版仍可连接兼容后端。

当前本地只生成了未签名同版本 smoke 包，不能据此宣称跨版本升级/回滚完成。
