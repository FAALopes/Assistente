-- Categories become user-editable: enum -> text (existing values keep the same text) + categories table.
-- Schema only; no data is inserted (built-in categories live in code, rows are created by the user in the UI).

ALTER TABLE "emails" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "emails" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "emails" ALTER COLUMN "category" SET DEFAULT 'UNCATEGORIZED';

ALTER TABLE "rule_applications" ALTER COLUMN "previousCategory" TYPE TEXT USING "previousCategory"::text;
ALTER TABLE "rule_applications" ALTER COLUMN "newCategory" TYPE TEXT USING "newCategory"::text;

DROP TYPE IF EXISTS "EmailCategory";

CREATE TABLE IF NOT EXISTS "categories" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("key")
);
