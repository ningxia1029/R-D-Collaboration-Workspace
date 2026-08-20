# 数据库迁移、备份与恢复

## 基线迁移

`20260808000000_baseline` 是按当前 Prisma 模型生成的 PostgreSQL 基线，`20260808001000_add_operational_indexes` 增加工作台查询索引。

- 全新数据库：执行 `npx prisma migrate deploy`。
- 已有数据库：先在隔离备份上核对实际结构；确认与基线一致后，才可执行 `npx prisma migrate resolve --applied 20260808000000_baseline`，随后执行 `npx prisma migrate deploy`。
- 禁止在未备份、未核对结构的生产库直接运行 `prisma db push`、`npm run setup` 或 seed。

## 备份

```powershell
.\scripts\db-backup.ps1 -OutputDir E:\backups\workbuddy
```

脚本使用 `pg_dump` 自定义格式，并生成 SHA-256 校验文件。数据库连接仅从参数或 `DATABASE_URL` 获取。

## 恢复演练

先只读检查归档：

```powershell
.\scripts\db-restore.ps1 -BackupFile E:\backups\workbuddy\workbuddy-yyyymmdd-hhmmss.dump
```

脚本会先验证同名 `.sha256` 文件。仅在目标为隔离恢复库且已复核连接串后，显式增加 `-Execute`，并按脚本显示的 `主机:端口/数据库名` 传入 `-TargetConfirmation`。恢复完成后必须检查登录、项目/成员、任务、BOM、ECR/ECO、文档版本和审计记录。
