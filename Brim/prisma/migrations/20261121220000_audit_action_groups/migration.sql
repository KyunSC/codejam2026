-- Rows written by one user action (one database transaction) share an id, for grouping in the audit log.
-- Additive and nullable: existing rows and code that doesn't set it are unaffected.
ALTER TABLE "AuditEvent" ADD COLUMN "actionGroupId" TEXT;

CREATE INDEX "AuditEvent_organizationId_actionGroupId_idx" ON "AuditEvent"("organizationId", "actionGroupId");
