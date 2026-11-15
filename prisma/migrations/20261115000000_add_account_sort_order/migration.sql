ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Initialize sortOrder from createdAt so existing accounts keep their current order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" DESC) * 10 AS rn
  FROM "email_accounts"
)
UPDATE "email_accounts" a
SET "sortOrder" = ordered.rn
FROM ordered
WHERE a.id = ordered.id AND a."sortOrder" = 0;
