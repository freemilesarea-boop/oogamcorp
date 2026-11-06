-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "detectedMime" TEXT,
ADD COLUMN     "scanEngine" TEXT,
ADD COLUMN     "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'SKIPPED',
ADD COLUMN     "scannedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfaEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastUsedStep" INTEGER,
ADD COLUMN     "mfaPendingSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_userId_codeHash_key" ON "mfa_recovery_codes"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
