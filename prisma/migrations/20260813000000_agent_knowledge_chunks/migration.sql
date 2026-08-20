-- PLM 企业研发智能体阶段 5：版本化文档片段索引。
-- 仅新增 Agent 派生索引表，不回填、不改写 Documents/Doc_Versions 业务行。

CREATE TABLE "Agent_Document_Chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "doc_version_id" TEXT NOT NULL,
    "project_id" TEXT,
    "ordinal" INTEGER NOT NULL,
    "section_path_json" JSONB NOT NULL,
    "content_text" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "index_version" TEXT NOT NULL,
    "prompt_injection_detected" BOOLEAN NOT NULL DEFAULT false,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_Document_Chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Agent_Document_Chunks_ordinal_nonnegative_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "Agent_Document_Chunks_content_nonempty_check" CHECK (length(btrim("content_text")) > 0)
);

CREATE UNIQUE INDEX "Agent_Document_Chunks_doc_version_id_ordinal_key"
    ON "Agent_Document_Chunks"("doc_version_id", "ordinal");
CREATE INDEX "Agent_Document_Chunks_document_id_doc_version_id_idx"
    ON "Agent_Document_Chunks"("document_id", "doc_version_id");
CREATE INDEX "Agent_Document_Chunks_project_id_source_updated_at_idx"
    ON "Agent_Document_Chunks"("project_id", "source_updated_at");
CREATE INDEX "Agent_Document_Chunks_index_version_idx"
    ON "Agent_Document_Chunks"("index_version");
CREATE INDEX "Agent_Document_Chunks_prompt_injection_detected_idx"
    ON "Agent_Document_Chunks"("prompt_injection_detected");

ALTER TABLE "Agent_Document_Chunks"
    ADD CONSTRAINT "Agent_Document_Chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "Documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Agent_Document_Chunks"
    ADD CONSTRAINT "Agent_Document_Chunks_doc_version_id_fkey"
    FOREIGN KEY ("doc_version_id") REFERENCES "Doc_Versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
