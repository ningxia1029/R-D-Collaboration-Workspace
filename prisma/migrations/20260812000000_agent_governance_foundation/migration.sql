-- PLM 企业研发智能体阶段 1：组织、运行审计、活动事件与 Outbox 基础。
-- 仅做 expand：现有表只增加 nullable 列，新表为空；不包含数据回填或破坏性删除。

-- CreateTable
CREATE TABLE "Org_Units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "manager_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Org_Units_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Org_Units_status_check" CHECK ("status" IN ('active', 'inactive')),
    CONSTRAINT "Org_Units_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- CreateTable
CREATE TABLE "Positions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "org_unit_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Positions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Positions_status_check" CHECK ("status" IN ('active', 'inactive'))
);

-- AlterTable: 所有新列均 nullable，避免锁表回填；产能由后续组织数据导入单独填写。
ALTER TABLE "Users"
    ADD COLUMN "primary_org_unit_id" TEXT,
    ADD COLUMN "position_id" TEXT,
    ADD COLUMN "manager_id" TEXT,
    ADD COLUMN "weekly_capacity_hours" DOUBLE PRECISION,
    ADD CONSTRAINT "Users_weekly_capacity_hours_check"
        CHECK ("weekly_capacity_hours" IS NULL OR ("weekly_capacity_hours" >= 0 AND "weekly_capacity_hours" <= 168)),
    ADD CONSTRAINT "Users_manager_not_self_check"
        CHECK ("manager_id" IS NULL OR "manager_id" <> "id");

-- AlterTable: 扩展通用业务审计；不回填历史记录，旧记录保持 NULL。
ALTER TABLE "Audit_Logs"
    ADD COLUMN "project_id" TEXT,
    ADD COLUMN "correlation_id" TEXT,
    ADD COLUMN "event_type" TEXT,
    ADD COLUMN "metadata_json" TEXT;

-- CreateTable
CREATE TABLE "Agent_Runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "current_node" TEXT,
    "prompt_version" TEXT,
    "model_provider" TEXT,
    "model_name" TEXT,
    "input_hash" TEXT,
    "scope_json" JSONB,
    "idempotency_key" TEXT,
    "contains_sensitive_data" BOOLEAN NOT NULL DEFAULT false,
    "input_token_count" INTEGER,
    "output_token_count" INTEGER,
    "estimated_cost_micros" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "retention_until" TIMESTAMP(3),
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_Runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Runs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT "Agent_Runs_usage_nonnegative_check" CHECK (
        ("input_token_count" IS NULL OR "input_token_count" >= 0) AND
        ("output_token_count" IS NULL OR "output_token_count" >= 0) AND
        ("estimated_cost_micros" IS NULL OR "estimated_cost_micros" >= 0)
    )
);

-- CreateTable
CREATE TABLE "Agent_Messages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "content_json" JSONB,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Messages_role_check" CHECK ("role" IN ('user', 'assistant', 'system', 'tool')),
    CONSTRAINT "Agent_Messages_sequence_nonnegative_check" CHECK ("sequence" >= 0)
);

-- CreateTable
CREATE TABLE "Agent_Run_Events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Run_Events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Run_Events_sequence_nonnegative_check" CHECK ("sequence" >= 0)
);

-- CreateTable
CREATE TABLE "Agent_Tool_Executions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input_hash" TEXT,
    "input_summary_json" JSONB,
    "output_summary_json" JSONB,
    "evidence_json" JSONB,
    "project_ids_json" JSONB,
    "error_code" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Tool_Executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Tool_Executions_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT "Agent_Tool_Executions_metrics_nonnegative_check" CHECK (
        "retry_count" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
    )
);

-- CreateTable
CREATE TABLE "Agent_Checkpoints" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "parent_checkpoint_id" TEXT,
    "state_json" JSONB NOT NULL,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent_Feedback" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "category" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Feedback_rating_check" CHECK ("rating" IN ('UP', 'DOWN'))
);

-- CreateTable
CREATE TABLE "Agent_Approval_Requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "decided_by_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "action_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "target_entity_type" TEXT,
    "target_entity_id" TEXT,
    "expected_version" TEXT,
    "proposal_json" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_Approval_Requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Approval_Requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'EXECUTED')),
    CONSTRAINT "Agent_Approval_Requests_risk_check" CHECK ("risk_level" IN ('LOW', 'MEDIUM', 'HIGH', 'FORBIDDEN'))
);

-- CreateTable
CREATE TABLE "Activity_Events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "actor_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "correlation_id" TEXT,
    "payload_json" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_Events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox_Events" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outbox_Events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Outbox_Events_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD')),
    CONSTRAINT "Outbox_Events_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);

-- CreateIndex: 新表为空，可在本迁移中直接建索引。
CREATE UNIQUE INDEX "Org_Units_code_key" ON "Org_Units"("code");
CREATE INDEX "Org_Units_parent_id_status_idx" ON "Org_Units"("parent_id", "status");
CREATE INDEX "Org_Units_manager_id_idx" ON "Org_Units"("manager_id");
CREATE UNIQUE INDEX "Positions_code_key" ON "Positions"("code");
CREATE INDEX "Positions_org_unit_id_status_idx" ON "Positions"("org_unit_id", "status");
CREATE UNIQUE INDEX "Agent_Runs_idempotency_key_key" ON "Agent_Runs"("idempotency_key");
CREATE INDEX "Agent_Runs_user_id_created_at_idx" ON "Agent_Runs"("user_id", "created_at");
CREATE INDEX "Agent_Runs_status_heartbeat_at_idx" ON "Agent_Runs"("status", "heartbeat_at");
CREATE INDEX "Agent_Runs_session_id_created_at_idx" ON "Agent_Runs"("session_id", "created_at");
CREATE UNIQUE INDEX "Agent_Messages_run_id_sequence_key" ON "Agent_Messages"("run_id", "sequence");
CREATE INDEX "Agent_Messages_run_id_created_at_idx" ON "Agent_Messages"("run_id", "created_at");
CREATE UNIQUE INDEX "Agent_Run_Events_run_id_sequence_key" ON "Agent_Run_Events"("run_id", "sequence");
CREATE INDEX "Agent_Run_Events_run_id_created_at_idx" ON "Agent_Run_Events"("run_id", "created_at");
CREATE UNIQUE INDEX "Agent_Tool_Executions_request_id_key" ON "Agent_Tool_Executions"("request_id");
CREATE INDEX "Agent_Tool_Executions_run_id_created_at_idx" ON "Agent_Tool_Executions"("run_id", "created_at");
CREATE INDEX "Agent_Tool_Executions_tool_name_status_created_at_idx" ON "Agent_Tool_Executions"("tool_name", "status", "created_at");
CREATE UNIQUE INDEX "Agent_Checkpoints_run_id_checkpoint_ns_checkpoint_id_key" ON "Agent_Checkpoints"("run_id", "checkpoint_ns", "checkpoint_id");
CREATE INDEX "Agent_Checkpoints_run_id_created_at_idx" ON "Agent_Checkpoints"("run_id", "created_at");
CREATE UNIQUE INDEX "Agent_Feedback_run_id_user_id_key" ON "Agent_Feedback"("run_id", "user_id");
CREATE INDEX "Agent_Feedback_rating_created_at_idx" ON "Agent_Feedback"("rating", "created_at");
CREATE UNIQUE INDEX "Agent_Approval_Requests_idempotency_key_key" ON "Agent_Approval_Requests"("idempotency_key");
CREATE INDEX "Agent_Approval_Requests_run_id_status_idx" ON "Agent_Approval_Requests"("run_id", "status");
CREATE INDEX "Agent_Approval_Requests_status_expires_at_idx" ON "Agent_Approval_Requests"("status", "expires_at");
CREATE INDEX "Agent_Approval_Requests_target_entity_type_target_entity_id_idx" ON "Agent_Approval_Requests"("target_entity_type", "target_entity_id");
CREATE INDEX "Activity_Events_project_id_occurred_at_idx" ON "Activity_Events"("project_id", "occurred_at");
CREATE INDEX "Activity_Events_entity_type_entity_id_occurred_at_idx" ON "Activity_Events"("entity_type", "entity_id", "occurred_at");
CREATE INDEX "Activity_Events_correlation_id_idx" ON "Activity_Events"("correlation_id");
CREATE UNIQUE INDEX "Outbox_Events_dedup_key_key" ON "Outbox_Events"("dedup_key");
CREATE INDEX "Outbox_Events_status_available_at_idx" ON "Outbox_Events"("status", "available_at");
CREATE INDEX "Outbox_Events_aggregate_type_aggregate_id_created_at_idx" ON "Outbox_Events"("aggregate_type", "aggregate_id", "created_at");

-- AddForeignKey
ALTER TABLE "Org_Units" ADD CONSTRAINT "Org_Units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Org_Units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Org_Units" ADD CONSTRAINT "Org_Units_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Positions" ADD CONSTRAINT "Positions_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "Org_Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Users" ADD CONSTRAINT "Users_primary_org_unit_id_fkey" FOREIGN KEY ("primary_org_unit_id") REFERENCES "Org_Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Users" ADD CONSTRAINT "Users_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Users" ADD CONSTRAINT "Users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agent_Runs" ADD CONSTRAINT "Agent_Runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agent_Messages" ADD CONSTRAINT "Agent_Messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Run_Events" ADD CONSTRAINT "Agent_Run_Events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Tool_Executions" ADD CONSTRAINT "Agent_Tool_Executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Checkpoints" ADD CONSTRAINT "Agent_Checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Feedback" ADD CONSTRAINT "Agent_Feedback_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Feedback" ADD CONSTRAINT "Agent_Feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agent_Approval_Requests" ADD CONSTRAINT "Agent_Approval_Requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Agent_Runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent_Approval_Requests" ADD CONSTRAINT "Agent_Approval_Requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agent_Approval_Requests" ADD CONSTRAINT "Agent_Approval_Requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity_Events" ADD CONSTRAINT "Activity_Events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity_Events" ADD CONSTRAINT "Activity_Events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
