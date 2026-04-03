-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('MICROSOFT', 'GMAIL', 'IMAP');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('INBOX', 'DELETE', 'TODO', 'SAVE_LATER', 'SAVE_ONEDRIVE', 'UNCATEGORIZED');

-- CreateEnum
CREATE TYPE "RuleField" AS ENUM ('FROM', 'SUBJECT', 'BODY');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('CONTAINS', 'EQUALS', 'STARTS_WITH');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('DELETE', 'TODO', 'SAVE_LATER', 'SAVE_ONEDRIVE');

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "provider" "Provider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "subject" TEXT,
    "bodyPreview" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "importance" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "category" "EmailCategory" NOT NULL DEFAULT 'UNCATEGORIZED',
    "categorySetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "field" "RuleField" NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "action" "RuleAction" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emails_externalId_key" ON "emails"("externalId");

-- CreateIndex
CREATE INDEX "emails_accountId_idx" ON "emails"("accountId");

-- CreateIndex
CREATE INDEX "emails_category_idx" ON "emails"("category");

-- CreateIndex
CREATE INDEX "emails_receivedAt_idx" ON "emails"("receivedAt");

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
