-- AlterTable
ALTER TABLE "emails" ADD COLUMN "triageAction" "TriageAction",
ADD COLUMN "triageReason" TEXT,
ADD COLUMN "triageConfidence" INTEGER,
ADD COLUMN "triageClassifiedAt" TIMESTAMP(3);
