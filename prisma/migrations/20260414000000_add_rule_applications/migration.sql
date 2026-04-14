-- CreateTable
CREATE TABLE "rule_applications" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "previousCategory" "EmailCategory" NOT NULL,
    "newCategory" "EmailCategory" NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "rule_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_applications_acknowledgedAt_idx" ON "rule_applications"("acknowledgedAt");

-- CreateIndex
CREATE INDEX "rule_applications_appliedAt_idx" ON "rule_applications"("appliedAt");
