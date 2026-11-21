-- AlterEnum
ALTER TYPE "IntakeSource" ADD VALUE 'history';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "datasetImportedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "textLayer" TEXT,
ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "InboxEmail" ADD COLUMN     "label" TEXT,
ADD COLUMN     "labelReason" TEXT,
ADD COLUMN     "labelSource" TEXT,
ADD COLUMN     "linkedInvoiceId" TEXT,
ADD COLUMN     "linkedVendorId" TEXT,
ADD COLUMN     "senderCheck" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'inbox';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "creditOfInvoiceId" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "digitsKey" TEXT,
ADD COLUMN     "docType" TEXT,
ADD COLUMN     "documentSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "extracted" JSONB,
ADD COLUMN     "fxRateToCad" DECIMAL(10,4),
ADD COLUMN     "heldFrom" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'invoice',
ADD COLUMN     "normalized" JSONB,
ADD COLUMN     "numberKey" TEXT,
ADD COLUMN     "poId" TEXT,
ADD COLUMN     "receivedDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "requesterId" TEXT,
ADD COLUMN     "shipToProvince" TEXT,
ADD COLUMN     "totalCad" DECIMAL(14,2),
ADD COLUMN     "vendorId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "departmentFinal" TEXT,
ADD COLUMN     "departmentSuggested" TEXT,
ADD COLUMN     "glFinal" TEXT,
ADD COLUMN     "glSuggested" TEXT,
ADD COLUMN     "gstHstCode" TEXT,
ADD COLUMN     "lineType" TEXT,
ADD COLUMN     "pstQstCode" TEXT,
ADD COLUMN     "reason" JSONB;

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app',
ADD COLUMN     "vendorId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCentre" TEXT NOT NULL,
    "annualBudgetCad" DECIMAL(14,2) NOT NULL,
    "managerUserId" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "GlAccount" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(8,5) NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "recoverable" TEXT NOT NULL,
    "glAccount" TEXT,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultGlAccount" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "provinceOrState" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "gstHstNumber" TEXT,
    "qstNumber" TEXT,
    "paymentTermsDays" INTEGER NOT NULL,
    "earlyPayDiscount" TEXT,
    "preferredPaymentMethod" TEXT NOT NULL,
    "acceptsCardPayment" BOOLEAN NOT NULL,
    "apContactEmail" TEXT NOT NULL,
    "requiresPo" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "onboardedAt" DATE NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "VendorBankAccount" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "institution" TEXT,
    "transit" TEXT,
    "account" TEXT,
    "last4" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "changeRequestId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',

    CONSTRAINT "VendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankChangeRequest" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "oldLast4" TEXT NOT NULL,
    "newLast4" TEXT NOT NULL,
    "newInstitution" TEXT,
    "newTransit" TEXT,
    "newAccount" TEXT,
    "channel" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByCallback" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',

    CONSTRAINT "BankChangeRequest_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "billingType" TEXT NOT NULL,
    "monthlyFee" DECIMAL(14,2),
    "currency" TEXT NOT NULL,
    "hourlyRateCap" DECIMAL(14,2),
    "fuelSurchargeCapPct" DECIMAL(6,2),
    "notToExceedMonthly" DECIMAL(14,2),
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "autoRenew" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "usdToCad" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("organizationId","date")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "postedDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(14,2),
    "credit" DECIMAL(14,2),
    "source" TEXT NOT NULL DEFAULT 'history',

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "CardTransaction" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "cardholderUserId" TEXT NOT NULL,
    "postedDate" DATE NOT NULL,
    "merchantDescriptor" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "amountCad" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL,
    "receiptAttached" BOOLEAN NOT NULL,
    "memo" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'history',

    CONSTRAINT "CardTransaction_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "when" JSONB NOT NULL,
    "effect" JSONB NOT NULL,
    "sourceText" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "InvoiceTax" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "labelPrinted" TEXT NOT NULL,
    "taxCode" TEXT,
    "ratePrinted" DECIMAL(8,5),
    "amount" DECIMAL(14,2) NOT NULL,
    "expectedAmount" DECIMAL(14,2),

    CONSTRAINT "InvoiceTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "vendorId" TEXT,
    "paymentId" TEXT,
    "bankTxnId" TEXT,
    "code" TEXT NOT NULL,
    "klass" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "message" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "related" JSONB,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "onBehalfOfId" TEXT,
    "limitCad" DECIMAL(14,2) NOT NULL,
    "why" JSONB NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "paidDate" DATE,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "fxRateToCad" DECIMAL(10,4) NOT NULL,
    "amountCad" DECIMAL(14,2) NOT NULL,
    "discountTaken" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "bankSnapshot" JSONB,
    "source" TEXT NOT NULL DEFAULT 'app',

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("organizationId","id")
);

-- Preserve arrival dates and every historical association from the organization-aware app.
UPDATE "Invoice" i SET "receivedDate" = COALESCE(
  (SELECT e."receivedAt"::date FROM "InboxEmail" e WHERE e.id = i."emailId"), i."createdAt"::date
);
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "documentId" ORDER BY "createdAt", id) - 1 AS position
  FROM "Invoice" WHERE "documentId" IS NOT NULL
)
UPDATE "Invoice" i SET "documentSequence" = ranked.position
FROM ranked WHERE ranked.id = i.id AND ranked.position > 0;

-- CreateIndex
CREATE INDEX "VendorBankAccount_vendorId_idx" ON "VendorBankAccount"("vendorId");

-- CreateIndex
CREATE INDEX "BankChangeRequest_vendorId_idx" ON "BankChangeRequest"("vendorId");

-- CreateIndex
CREATE INDEX "Contract_vendorId_idx" ON "Contract"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "CardTransaction_merchantDescriptor_idx" ON "CardTransaction"("merchantDescriptor");

-- CreateIndex
CREATE INDEX "InvoiceTax_invoiceId_idx" ON "InvoiceTax"("invoiceId");

-- CreateIndex
CREATE INDEX "Flag_invoiceId_idx" ON "Flag"("invoiceId");

-- CreateIndex
CREATE INDEX "Flag_vendorId_idx" ON "Flag"("vendorId");

-- CreateIndex
CREATE INDEX "Flag_code_status_idx" ON "Flag"("code", "status");

-- CreateIndex
CREATE INDEX "ApprovalStep_assignedToId_decision_idx" ON "ApprovalStep"("assignedToId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_invoiceId_stepNo_key" ON "ApprovalStep"("invoiceId", "stepNo");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_vendorId_numberKey_idx" ON "Invoice"("organizationId", "vendorId", "numberKey");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_vendorId_digitsKey_idx" ON "Invoice"("organizationId", "vendorId", "digitsKey");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_vendorId_total_idx" ON "Invoice"("organizationId", "vendorId", "total");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_documentId_documentSequence_key" ON "Invoice"("documentId", "documentSequence");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_vendorId_fkey" FOREIGN KEY ("organizationId", "vendorId") REFERENCES "Vendor"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBankAccount" ADD CONSTRAINT "VendorBankAccount_organizationId_vendorId_fkey" FOREIGN KEY ("organizationId", "vendorId") REFERENCES "Vendor"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankChangeRequest" ADD CONSTRAINT "BankChangeRequest_organizationId_vendorId_fkey" FOREIGN KEY ("organizationId", "vendorId") REFERENCES "Vendor"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTax" ADD CONSTRAINT "InvoiceTax_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_vendorId_fkey" FOREIGN KEY ("organizationId", "vendorId") REFERENCES "Vendor"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
