-- Add incremental sync fields

ALTER TABLE "email_accounts"
  ADD COLUMN IF NOT EXISTS "globalDeltaLink" TEXT;

ALTER TABLE "mail_folders"
  ADD COLUMN IF NOT EXISTS "lastUid" INTEGER,
  ADD COLUMN IF NOT EXISTS "uidValidity" BIGINT;
