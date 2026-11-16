-- Archive (OneDrive-backed file manager)

CREATE TABLE IF NOT EXISTS "archive_entities" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "archive_entities_name_key" ON "archive_entities"("name");

CREATE TABLE IF NOT EXISTS "archive_items" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "driveItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "isFolder" BOOLEAN NOT NULL DEFAULT false,
  "size" BIGINT,
  "mimeType" TEXT,
  "entityId" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "expiresAt" TIMESTAMP(3),
  "sourceEmailId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "archive_items_accountId_driveItemId_key" ON "archive_items"("accountId", "driveItemId");
CREATE INDEX IF NOT EXISTS "archive_items_accountId_idx" ON "archive_items"("accountId");
CREATE INDEX IF NOT EXISTS "archive_items_entityId_idx" ON "archive_items"("entityId");
CREATE INDEX IF NOT EXISTS "archive_items_path_idx" ON "archive_items"("path");
CREATE INDEX IF NOT EXISTS "archive_items_name_idx" ON "archive_items"("name");

ALTER TABLE "archive_items"
  ADD CONSTRAINT "archive_items_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "archive_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "archive_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "accountId" TEXT,
  "senderPattern" TEXT,
  "subjectPattern" TEXT,
  "attachmentOnly" BOOLEAN NOT NULL DEFAULT true,
  "targetFolder" TEXT NOT NULL,
  "filenamePattern" TEXT,
  "entityId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timesApplied" INTEGER NOT NULL DEFAULT 0,
  "lastAppliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "archive_rules_enabled_idx" ON "archive_rules"("enabled");

ALTER TABLE "archive_rules"
  ADD CONSTRAINT "archive_rules_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "archive_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
