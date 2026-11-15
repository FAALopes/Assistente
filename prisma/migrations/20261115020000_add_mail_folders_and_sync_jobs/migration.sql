-- MailFolder: enumerated folders per account (nested, with delta token)
CREATE TABLE IF NOT EXISTS "mail_folders" (
  "accountId"       TEXT NOT NULL,
  "id"              TEXT NOT NULL,
  "displayName"     TEXT NOT NULL,
  "parentId"        TEXT,
  "path"            TEXT NOT NULL,
  "depth"           INTEGER NOT NULL DEFAULT 0,
  "wellKnownName"   TEXT,
  "totalItemCount"  INTEGER NOT NULL DEFAULT 0,
  "unreadItemCount" INTEGER NOT NULL DEFAULT 0,
  "deltaLink"       TEXT,
  "lastSyncAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mail_folders_pkey" PRIMARY KEY ("accountId", "id")
);

CREATE INDEX IF NOT EXISTS "mail_folders_accountId_idx" ON "mail_folders"("accountId");
CREATE INDEX IF NOT EXISTS "mail_folders_accountId_path_idx" ON "mail_folders"("accountId", "path");

ALTER TABLE "mail_folders"
  DROP CONSTRAINT IF EXISTS "mail_folders_accountId_fkey";

ALTER TABLE "mail_folders"
  ADD CONSTRAINT "mail_folders_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SyncJob: background job progress
CREATE TABLE IF NOT EXISTS "sync_jobs" (
  "id"            TEXT NOT NULL,
  "accountId"     TEXT,
  "status"        TEXT NOT NULL,
  "phase"         TEXT,
  "currentFolder" TEXT,
  "foldersTotal"  INTEGER NOT NULL DEFAULT 0,
  "foldersDone"   INTEGER NOT NULL DEFAULT 0,
  "emailsSynced"  INTEGER NOT NULL DEFAULT 0,
  "emailsRemoved" INTEGER NOT NULL DEFAULT 0,
  "errors"        JSONB,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sync_jobs_status_idx" ON "sync_jobs"("status");
CREATE INDEX IF NOT EXISTS "sync_jobs_startedAt_idx" ON "sync_jobs"("startedAt");
