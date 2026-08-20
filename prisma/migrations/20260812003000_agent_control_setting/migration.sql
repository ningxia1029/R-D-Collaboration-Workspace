-- PLM 企业研发智能体阶段 4：可审计的 Agent 总开关与 Tool 禁用策略。
-- 新表默认无记录；服务在无记录时一律 fail closed，必须由管理员显式启用。

CREATE TABLE "Agent_Control_Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "disabled_tools_json" JSONB,
    "maintenance_message" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_Control_Settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Control_Settings_singleton_check" CHECK ("id" = 'default'),
    CONSTRAINT "Agent_Control_Settings_message_length_check" CHECK (
        "maintenance_message" IS NULL OR char_length("maintenance_message") <= 500
    )
);

CREATE INDEX "Agent_Control_Settings_updated_by_id_idx"
    ON "Agent_Control_Settings"("updated_by_id");

ALTER TABLE "Agent_Control_Settings"
    ADD CONSTRAINT "Agent_Control_Settings_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
