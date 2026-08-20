-- PLM 企业研发智能体阶段 7：受控动作审批与一次性幂等执行元数据。
-- 仅扩展 Agent 审批表；不触碰既有业务实体，不回填、不执行任何业务动作。

ALTER TABLE "Agent_Approval_Requests"
    ADD COLUMN "proposal_hash" TEXT,
    ADD COLUMN "approval_nonce_hash" TEXT,
    ADD COLUMN "execution_idempotency_key" TEXT,
    ADD COLUMN "execution_result_json" JSONB,
    ADD COLUMN "readback_json" JSONB,
    ADD COLUMN "failure_code" TEXT,
    ADD COLUMN "failure_message" TEXT;

ALTER TABLE "Agent_Approval_Requests"
    DROP CONSTRAINT "Agent_Approval_Requests_status_check";

ALTER TABLE "Agent_Approval_Requests"
    ADD CONSTRAINT "Agent_Approval_Requests_status_check"
        CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'EXECUTED', 'CONFLICT', 'FAILED')),
    ADD CONSTRAINT "Agent_Approval_Requests_execution_complete_check"
        CHECK (
            "status" <> 'EXECUTED'
            OR (
                "decided_by_id" IS NOT NULL
                AND "decided_at" IS NOT NULL
                AND "executed_at" IS NOT NULL
                AND "execution_idempotency_key" IS NOT NULL
                AND "execution_result_json" IS NOT NULL
                AND "readback_json" IS NOT NULL
            )
        ),
    ADD CONSTRAINT "Agent_Approval_Requests_proposal_expiry_check"
        CHECK ("expires_at" > "created_at");

CREATE UNIQUE INDEX "Agent_Approval_Requests_execution_idempotency_key_key"
    ON "Agent_Approval_Requests"("execution_idempotency_key");
