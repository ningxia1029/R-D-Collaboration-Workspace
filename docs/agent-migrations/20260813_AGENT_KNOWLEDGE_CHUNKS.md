# 20260813 Agent Knowledge Chunks 迁移说明

| 属性 | 内容 |
|---|---|
| 迁移 | `20260813000000_agent_knowledge_chunks` |
| 类型 | expand-only；新增 Agent 派生索引表 |
| 业务表数据改写 | 无 |
| 历史活动回填 | 无，禁止从当前快照猜测历史 |
| 本地演练 | 2026-08-13 在可丢弃 PostgreSQL 14.23 实例完成 |

## 变更内容

新增 `Agent_Document_Chunks`，保存最新版文档的确定性 Markdown 片段：文档/版本外键、片段序号、标题路径、正文、内容哈希、索引版本、提示注入标记、源更新时间和索引时间。文档或版本删除时片段级联删除。

`Documents`、`Doc_Versions`、`Activity_Events` 和 `Outbox_Events` 不做历史更新。新应用版本在文档写事务内追加 Outbox；独立索引器消费后替换派生片段。

## 生产前执行顺序

以下命令只可对已确认的目标库执行；本轮没有对现有业务库运行。

1. 备份并验证恢复点，记录目标数据库名与迁移前版本。
2. 执行 `npm run db:migrate:deploy`。
3. 部署包含事务 Outbox 写入的新 Web 版本。
4. 单次回填并消费积压：`npm run agent:knowledge-indexer -- --backfill --once`。
5. 核对文档数、最新版版本数、片段数、失败/死信 Outbox 和权限负例。
6. 以独立进程启动 `npm run agent:knowledge-indexer`，配置健康检查、重启和积压告警。
7. 完成门禁后才由管理员启用 `plm_document_search` / `plm_report_generate_weekly`。

## 验证查询

```sql
SELECT COUNT(*) AS documents FROM "Documents";
SELECT COUNT(DISTINCT "document_id") AS indexed_documents FROM "Agent_Document_Chunks";
SELECT "status", COUNT(*) FROM "Outbox_Events"
WHERE "aggregate_type" = 'DOCUMENT'
GROUP BY "status" ORDER BY "status";
SELECT COUNT(*) AS stale_chunks
FROM "Agent_Document_Chunks" c
WHERE NOT EXISTS (
  SELECT 1 FROM "Doc_Versions" v
  WHERE v."document_id" = c."document_id"
  GROUP BY v."document_id"
  HAVING MAX(v."version") = (
    SELECT dv."version" FROM "Doc_Versions" dv WHERE dv."id" = c."doc_version_id"
  )
);
```

还必须执行应用级权限负例：非成员不可召回项目片段、撤销成员后无需等待索引即可失效、公共文档仅在 `includeShared=true` 时返回。表数量相等不是权限验收。

## 回滚与恢复

- 应用故障：先关闭 Agent 或单独停用文档/周报 Tool，主 PLM 文档业务不依赖派生片段表。
- 索引器故障：停止索引器并保留 Outbox；修复后由幂等消费者继续，期间 Tool 返回范围内的索引延迟 warning。
- 数据重建：清空派生片段前必须确认目标库并维护窗口，随后执行受控 backfill；不得删除业务文档或版本。
- 迁移物理回退：只有完成备份并确认新应用不再引用该表后，才可按外键/索引/表顺序移除；本项目不提供自动 destructive down migration。

## 已知边界

- 当前仅 lexical 基线，没有 pg_trgm、全文索引、embedding 或向量检索。
- 阶段 5 固定知识集是 10 条精确关键词题，不代表自然语言语义召回或生产规模性能。
- `ActivityEvent` 覆盖从部署新写路径后开始；部署前历史不会补猜。
- PostgreSQL 16、生产数据量、连接池和长时间索引积压尚未验证。
