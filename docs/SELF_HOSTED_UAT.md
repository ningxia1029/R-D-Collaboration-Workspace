# WorkBuddy 自托管 UAT 运维手册

## 隔离边界

此栈的 Compose 项目名固定为 `workbuddy-selfhost`，使用独立的 `workbuddy_selfhost_uat_pgdata` 命名卷和 `workbuddy_selfhost_uat` 数据库；不会复用或管理现有 `cf-tunnel`、`sub2api` 或其他 UAT 卷。数据库不发布宿主机端口，应用仅绑定 `127.0.0.1:3010`；`tunnel` 仅在 frontend 网络访问 `app`，数据库、迁移、backup、restore 在隔离 backend 网络。

所有 Compose 操作均通过 wrapper 执行：`powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 ...`。停止服务使用 `powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 stop`；它不会删除命名卷。**禁止使用 `down -v`**，因为它会删除数据库卷。

## 首次配置与启动

在仓库根目录生成被 Git 忽略的真实环境文件（不会覆盖已有文件）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/new-selfhost-env.ps1
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 config --quiet
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 up --detach --build db migrate app
```

`migrate` 会先于应用完成 Prisma migration。一次性演示数据仅可显式执行 `demo-seed` profile，且 seed 会清表；只允许对空的隔离 UAT 数据库操作，绝不能在已有业务数据或其他环境执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile demo-seed run --rm seed
```

本机 live 与 ready 检查分别为 `http://127.0.0.1:3010/api/health/live` 和 `http://127.0.0.1:3010/api/health/ready`。

## Cloudflare Access 与 Tunnel

在 Cloudflare 创建新的 remotely-managed tunnel，并将其独立 token 只写入 `.env.selfhost` 的 `CLOUDFLARE_TUNNEL_TOKEN`，不要复用现有 tunnel token。Published application route 的 Service URL 固定为 `http://app:3000`。应在发布 route 前先创建 Cloudflare Access 的 Allow policy，否则公网访问会直接到达应用登录页。

相关官方文档：[创建 remotely-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)；[Cloudflare Access applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/).

启动 tunnel：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile tunnel up --detach tunnel
```

办公电脑必须保持开机并联网；本地 tunnel 不具备云端常驻服务的可用性。

## 备份与恢复

备份写入宿主机 `./backups/selfhost`（容器内 `/backups`）。每次启动 backup 会立即生成 UTC 格式 `workbuddy-YYYYMMDD-HHMMSS.dump` custom archive 和同名 `.sha256`，之后按 `.env.selfhost` 中 `SELFHOST_BACKUP_INTERVAL_SECONDS`（3600–604800）循环；`SELFHOST_BACKUP_RETENTION_DAYS` 必须为 1–90。归档和 checksum 均通过同目录 `.partial` 后原子移动完成，失败不会伪造成功文件。

启动自动备份：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 up --detach backup
```

恢复默认是离线 dry-run：验证文件名、同名 SHA-256 和 archive 可读性，**不会连接或写数据库**。先替换为实际备份名执行；dry-run 不必停止任何服务：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile restore run --rm --env BACKUP_FILE=workbuddy-YYYYMMDD-HHMMSS.dump restore
```

真正恢复要求双确认，且只可恢复到此隔离库：

恢复目标数据库固定为 `workbuddy_selfhost_uat`，不可通过 `--env PGDATABASE=...` 覆盖；`RESTORE_TARGET_ACK` 必须精确等于该目标库。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile restore run --rm --env BACKUP_FILE=workbuddy-YYYYMMDD-HHMMSS.dump --env RESTORE_EXECUTE=1 --env RESTORE_TARGET_ACK=workbuddy_selfhost_uat restore
```

破坏性恢复流程必须按以下顺序执行。备份包含完整业务数据；不能以旧日志作为恢复前备份的证据。先记录已有 dump basename，强制重建 backup，并在有界时间内等待一个**新出现**且存在同名 SHA-256 的 dump；找不到则失败。对该新文件立即运行离线 dry-run，只有验证通过后才停止会访问数据库的服务。保留 `db` 运行供 execute 恢复连接：

```powershell
$backupDirectory = Join-Path (Get-Location) "backups\selfhost"
$beforeBackupNames = @(Get-ChildItem -LiteralPath $backupDirectory -Filter "workbuddy-*.dump" -File | ForEach-Object Name)
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 up --detach --force-recreate backup
$deadline = (Get-Date).AddMinutes(2)
$newBackup = @()
do {
  $newBackup = @(Get-ChildItem -LiteralPath $backupDirectory -Filter "workbuddy-*.dump" -File |
    Where-Object { $beforeBackupNames -notcontains $_.Name -and (Test-Path -LiteralPath (Join-Path $backupDirectory "$($_.Name).sha256")) } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1)
  if ($newBackup.Count -eq 1) { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if ($newBackup.Count -ne 1) { throw "No new paired selfhost backup appeared before deadline." }
$backupName = $newBackup[0].Name
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile restore run --rm --env "BACKUP_FILE=$backupName" restore
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 stop tunnel app backup
```

上方 dry-run 已验证新备份的文件名、SHA-256 和 archive；随后才可用同一 `$backupName` 执行恢复。execute 后先通过 wrapper 确认 migration 状态和数据，再以 wrapper 启动 app/backup 并检查 ready；仅在需要公网入口时最后启动 tunnel：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile restore run --rm --env "BACKUP_FILE=$backupName" --env RESTORE_EXECUTE=1 --env RESTORE_TARGET_ACK=workbuddy_selfhost_uat restore
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 run --rm migrate
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 run --rm --no-deps --entrypoint psql restore --command "SELECT current_database();"
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 up --detach app backup
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 exec app node --eval "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
powershell -ExecutionPolicy Bypass -File scripts/selfhost-compose.ps1 --profile tunnel up --detach tunnel
```

`scripts/selfhost-compose.ps1` 每次运行都会将 `backups/selfhost` 的 ACL 收紧到当前 Windows SID、SYSTEM 和 Builtin Administrators；该操作不递归修改其他目录。可在本机检查 ACL：

```powershell
icacls.exe .\backups\selfhost
```

应用回滚与数据库恢复是两件独立的操作：先保留当前数据库卷和可验证备份，再按应用版本回滚；只有明确需要回退数据时才执行上述恢复命令。
