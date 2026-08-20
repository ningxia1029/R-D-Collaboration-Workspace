-- PLM 企业研发智能体阶段 6：组织权限点与资源计划窗口。
-- 扩展式迁移：不改写既有用户、任务和工时；未创建发布窗口时负载计划值保持未知。

CREATE TABLE "Resource_Plan_Windows" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_Plan_Windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Resource_Plan_Windows_date_range_check" CHECK ("date_to" >= "date_from"),
    CONSTRAINT "Resource_Plan_Windows_status_check" CHECK ("status" IN ('draft', 'published', 'archived'))
);

CREATE TABLE "Resource_Plan_Allocations" (
    "id" TEXT NOT NULL,
    "plan_window_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_Plan_Allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Resource_Plan_Allocations_hours_check" CHECK ("hours" > 0 AND "hours" <= 24)
);

CREATE INDEX "Resource_Plan_Windows_user_id_status_date_from_date_to_idx"
    ON "Resource_Plan_Windows"("user_id", "status", "date_from", "date_to");
CREATE INDEX "Resource_Plan_Windows_created_by_idx"
    ON "Resource_Plan_Windows"("created_by");
CREATE UNIQUE INDEX "Resource_Plan_Allocations_plan_window_id_task_id_date_key"
    ON "Resource_Plan_Allocations"("plan_window_id", "task_id", "date");
CREATE INDEX "Resource_Plan_Allocations_task_id_date_idx"
    ON "Resource_Plan_Allocations"("task_id", "date");
CREATE INDEX "Resource_Plan_Allocations_plan_window_id_date_idx"
    ON "Resource_Plan_Allocations"("plan_window_id", "date");

ALTER TABLE "Resource_Plan_Windows"
    ADD CONSTRAINT "Resource_Plan_Windows_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resource_Plan_Windows"
    ADD CONSTRAINT "Resource_Plan_Windows_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Resource_Plan_Allocations"
    ADD CONSTRAINT "Resource_Plan_Allocations_plan_window_id_fkey"
    FOREIGN KEY ("plan_window_id") REFERENCES "Resource_Plan_Windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resource_Plan_Allocations"
    ADD CONSTRAINT "Resource_Plan_Allocations_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "Tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workbuddy_validate_resource_plan_window()
RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('workbuddy:resource-plan:' || NEW."user_id"));
    IF NEW."status" = 'published' AND EXISTS (
        SELECT 1
        FROM "Resource_Plan_Windows" existing
        WHERE existing."user_id" = NEW."user_id"
          AND existing."status" = 'published'
          AND existing."id" <> NEW."id"
          AND existing."date_from" <= NEW."date_to"
          AND existing."date_to" >= NEW."date_from"
    ) THEN
        RAISE EXCEPTION 'published resource plan windows must not overlap' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
        SELECT 1 FROM "Resource_Plan_Allocations" allocation
        WHERE allocation."plan_window_id" = NEW."id"
          AND (allocation."date" < NEW."date_from" OR allocation."date" > NEW."date_to")
    ) THEN
        RAISE EXCEPTION 'resource plan window cannot exclude existing allocations' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Resource_Plan_Windows_validate_trigger"
BEFORE INSERT OR UPDATE OF "user_id", "date_from", "date_to", "status"
ON "Resource_Plan_Windows"
FOR EACH ROW EXECUTE FUNCTION workbuddy_validate_resource_plan_window();

CREATE OR REPLACE FUNCTION workbuddy_validate_resource_plan_allocation()
RETURNS trigger AS $$
DECLARE
    owner_id TEXT;
    window_from DATE;
    window_to DATE;
    task_assignee_id TEXT;
    allocated_hours DOUBLE PRECISION;
BEGIN
    SELECT plan."user_id", plan."date_from", plan."date_to"
      INTO owner_id, window_from, window_to
      FROM "Resource_Plan_Windows" plan
     WHERE plan."id" = NEW."plan_window_id"
     FOR UPDATE;
    IF owner_id IS NULL OR NEW."date" < window_from OR NEW."date" > window_to THEN
        RAISE EXCEPTION 'resource plan allocation date is outside its window' USING ERRCODE = '23514';
    END IF;
    SELECT task."assignee_id" INTO task_assignee_id FROM "Tasks" task WHERE task."id" = NEW."task_id";
    IF task_assignee_id IS DISTINCT FROM owner_id THEN
        RAISE EXCEPTION 'resource plan task assignee must match plan owner' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(allocation."hours"), 0)
      INTO allocated_hours
      FROM "Resource_Plan_Allocations" allocation
     WHERE allocation."plan_window_id" = NEW."plan_window_id"
       AND allocation."date" = NEW."date"
       AND allocation."id" <> NEW."id";
    IF allocated_hours + NEW."hours" > 24 THEN
        RAISE EXCEPTION 'resource plan allocation exceeds 24 hours per day' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Resource_Plan_Allocations_validate_trigger"
BEFORE INSERT OR UPDATE OF "plan_window_id", "task_id", "date", "hours"
ON "Resource_Plan_Allocations"
FOR EACH ROW EXECUTE FUNCTION workbuddy_validate_resource_plan_allocation();

INSERT INTO "Permissions" ("id", "code", "description") VALUES
    ('phase6-org-read', 'org:read', '读取授权范围内的组织结构与成员基本信息'),
    ('phase6-org-manage', 'org:manage', '维护组织结构、岗位与成员归属')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Role_Permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "Roles" r
JOIN "Permissions" p ON p."code" = 'org:read'
WHERE r."name" IN ('pm', 'engineer', 'viewer')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
