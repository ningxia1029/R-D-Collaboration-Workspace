-- 在线索引清单迁移。
-- Prisma 5.22 会在事务中执行本文件，而 PostgreSQL 禁止事务内执行
-- CREATE INDEX CONCURRENTLY。因此五个现有表索引由以下幂等运维命令创建：
--   npm run db:agent-indexes
--
-- 该命令会验证目标库确认值、索引表名/列顺序以及 indisvalid/indisready；
-- 不允许用普通 CREATE INDEX 替代，以免在已有业务表上长时间阻塞写入。
SELECT 1;
