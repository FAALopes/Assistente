-- CreateTable
CREATE TABLE "email_actions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT,
    "senderPattern" TEXT,
    "subjectPattern" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'OPEN_URL',
    "actionValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_actions_accountId_idx" ON "email_actions"("accountId");
