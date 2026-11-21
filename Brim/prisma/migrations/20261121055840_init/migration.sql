-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "managerId" TEXT,
    "role" TEXT NOT NULL,
    "approvalLimitCad" DECIMAL(14,2) NOT NULL,
    "workProvince" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusSince" DATE,
    "delegateUserId" TEXT,
    "hireDate" DATE NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCentre" TEXT NOT NULL,
    "annualBudgetCad" DECIMAL(14,2) NOT NULL,
    "managerUserId" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate" DECIMAL(8,5) NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "recoverable" TEXT NOT NULL,
    "glAccount" TEXT,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
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

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBankAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "transit" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "VendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankChangeRequest" (
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

    CONSTRAINT "BankChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
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

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
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

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "date" DATE NOT NULL,
    "usdToCad" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "postedDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(14,2),
    "credit" DECIMAL(14,2),
    "source" TEXT NOT NULL DEFAULT 'history',

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTransaction" (
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

    CONSTRAINT "CardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "when" JSONB NOT NULL,
    "effect" JSONB NOT NULL,
    "sourceText" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "url" TEXT,
    "data" BYTEA,
    "pageCount" INTEGER,
    "textLayer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEmail" (
    "id" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "label" TEXT,
    "labelReason" TEXT,
    "labelSource" TEXT,
    "linkedInvoiceId" TEXT,
    "linkedVendorId" TEXT,
    "senderCheck" JSONB,
    "source" TEXT NOT NULL DEFAULT 'inbox',

    CONSTRAINT "InboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'invoice',
    "status" TEXT NOT NULL,
    "heldFrom" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "documentId" TEXT,
    "emailId" TEXT,
    "uploadedById" TEXT,
    "vendorId" TEXT,
    "vendorInvoiceNumber" TEXT,
    "numberKey" TEXT,
    "digitsKey" TEXT,
    "invoiceDate" DATE,
    "receivedDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" TEXT,
    "subtotal" DECIMAL(14,2),
    "gstHstAmount" DECIMAL(14,2),
    "pstQstAmount" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "fxRateToCad" DECIMAL(10,4),
    "totalCad" DECIMAL(14,2),
    "shipToProvince" TEXT,
    "departmentId" TEXT,
    "requesterId" TEXT,
    "poId" TEXT,
    "contractId" TEXT,
    "creditOfInvoiceId" TEXT,
    "docType" TEXT,
    "extracted" JSONB,
    "evidence" JSONB,
    "normalized" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4),
    "unitPrice" DECIMAL(14,4),
    "amount" DECIMAL(14,2),
    "lineType" TEXT,
    "glSuggested" TEXT,
    "glFinal" TEXT,
    "departmentSuggested" TEXT,
    "departmentFinal" TEXT,
    "reason" JSONB,
    "gstHstCode" TEXT,
    "pstQstCode" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
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

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "onBehalfOfId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "vendorId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

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
CREATE UNIQUE INDEX "Document_sha256_key" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_numberKey_idx" ON "Invoice"("vendorId", "numberKey");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_digitsKey_idx" ON "Invoice"("vendorId", "digitsKey");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_total_idx" ON "Invoice"("vendorId", "total");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNo_key" ON "InvoiceLine"("invoiceId", "lineNo");

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
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_invoiceId_idx" ON "AuditEvent"("invoiceId");

-- CreateIndex
CREATE INDEX "AuditEvent_paymentId_idx" ON "AuditEvent"("paymentId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "VendorBankAccount" ADD CONSTRAINT "VendorBankAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankChangeRequest" ADD CONSTRAINT "BankChangeRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "InboxEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTax" ADD CONSTRAINT "InvoiceTax_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
