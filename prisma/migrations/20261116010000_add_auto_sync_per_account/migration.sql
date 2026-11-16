-- Per-account auto-sync config

ALTER TABLE "email_accounts"
  ADD COLUMN IF NOT EXISTS "autoSyncMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);
