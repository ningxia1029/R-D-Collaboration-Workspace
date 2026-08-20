-- PLM 企业研发智能体阶段 3：为独立 Worker 增加有限租约与预算计数。
-- 所有新增字段有默认值或允许 NULL；不重写现有 Run 正文，不接触业务表。

ALTER TABLE "Agent_Runs"
    ADD COLUMN "lease_owner_id" TEXT,
    ADD COLUMN "lease_expires_at" TIMESTAMP(3),
    ADD COLUMN "lease_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "step_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "result_bytes" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "Agent_Runs_runtime_metrics_nonnegative_check" CHECK (
        "lease_version" >= 0 AND
        "step_count" >= 0 AND
        "tool_call_count" >= 0 AND
        "result_bytes" >= 0
    ),
    ADD CONSTRAINT "Agent_Runs_lease_pair_check" CHECK (
        ("lease_owner_id" IS NULL AND "lease_expires_at" IS NULL) OR
        ("lease_owner_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    );

CREATE INDEX "Agent_Runs_status_lease_expires_at_idx"
    ON "Agent_Runs"("status", "lease_expires_at");
