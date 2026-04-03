-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TriageAction" AS ENUM ('DELETE', 'MOVE_TO_INBOX', 'REVIEW');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "triage_overrides" (
    "id" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "senderDomain" TEXT NOT NULL,
    "subjectPattern" TEXT,
    "aiDecision" "TriageAction" NOT NULL,
    "userDecision" "TriageAction" NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triage_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "triage_overrides_senderDomain_idx" ON "triage_overrides"("senderDomain");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "triage_overrides_senderAddress_userDecision_key" ON "triage_overrides"("senderAddress", "userDecision");
