/*
  Warnings:

  - Added the required column `last4` to the `VendorBankAccount` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "VendorBankAccount" ADD COLUMN     "changeRequestId" TEXT,
ADD COLUMN     "last4" TEXT NOT NULL,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app',
ALTER COLUMN "institution" DROP NOT NULL,
ALTER COLUMN "transit" DROP NOT NULL,
ALTER COLUMN "account" DROP NOT NULL;
