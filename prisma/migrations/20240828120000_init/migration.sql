-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "CompanyLead" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "companyNumber" TEXT,
    "postcode" TEXT,
    "completeAddress" TEXT,
    "companyCategory" TEXT,
    "companyStatus" TEXT,
    "incorporationDate" TEXT,
    "accountsNextDueDate" TEXT,
    "accountsLastMadeUpDate" TEXT,
    "cleanedName" TEXT,
    "website" TEXT,
    "email" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "LeadStatus" NOT NULL DEFAULT 'PENDING',
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "serperApiKey" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLead_nameKey_key" ON "CompanyLead"("nameKey");

-- CreateIndex
CREATE INDEX "CompanyLead_batchId_idx" ON "CompanyLead"("batchId");

-- CreateIndex
CREATE INDEX "CompanyLead_status_idx" ON "CompanyLead"("status");

-- CreateIndex
CREATE INDEX "CompanyLead_batchId_status_idx" ON "CompanyLead"("batchId", "status");

-- CreateIndex
CREATE INDEX "CompanyLead_createdAt_idx" ON "CompanyLead"("createdAt");
