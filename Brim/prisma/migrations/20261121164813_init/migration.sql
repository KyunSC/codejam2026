-- CreateEnum
CREATE TYPE "Role" AS ENUM ('employee', 'ap_clerk', 'approver', 'finance_manager', 'controller_admin', 'auditor');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'on_leave', 'terminated');

-- CreateEnum
CREATE TYPE "IntakeSource" AS ENUM ('inbox', 'upload', 'submission');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'llm', 'system', 'brim_admin');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "departmentId" TEXT,
    "role" "Role" NOT NULL,
    "approvalLimitCad" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "workProvince" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "statusSince" DATE,
    "hireDate" DATE,
    "managerId" TEXT,
    "delegateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT,
    "fromName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attachmentNames" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "IntakeSource" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "documentId" TEXT NOT NULL,
    "emailId" TEXT,
    "submittedById" TEXT,
    "poNumber" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "onBehalfOfId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_externalId_key" ON "User"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Document_organizationId_sha256_idx" ON "Document"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "InboxEmail_organizationId_sourceId_idx" ON "InboxEmail"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_at_idx" ON "AuditEvent"("organizationId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_invoiceId_idx" ON "AuditEvent"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_actorId_idx" ON "AuditEvent"("organizationId", "actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_idx" ON "AuditEvent"("organizationId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "InboxEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
