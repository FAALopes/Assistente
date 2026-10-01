-- CreateTable
CREATE TABLE "app_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "azureClientSecret" TEXT,
    "azureClientSecretUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);
