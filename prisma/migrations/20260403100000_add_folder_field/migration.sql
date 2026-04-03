-- AlterTable
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "folder" TEXT NOT NULL DEFAULT 'inbox';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "emails_folder_idx" ON "emails"("folder");
