-- 企业账号生命周期：兼容现有账号的 expand-only 字段。
-- 现有账号默认无需首次改密；新账号策略由应用层显式设置。

ALTER TABLE "Users"
    ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "password_changed_at" TIMESTAMP(3),
    ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 1;
