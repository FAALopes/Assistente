ALTER TABLE "email_accounts" ALTER COLUMN "accessToken" SET DEFAULT '';
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "imapHost" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "imapPort" INTEGER;
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "imapUser" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "imapPasswordEnc" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "imapTls" BOOLEAN NOT NULL DEFAULT true;
