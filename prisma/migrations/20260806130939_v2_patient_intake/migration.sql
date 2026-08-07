-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "calfLeftCm" REAL;
ALTER TABLE "Patient" ADD COLUMN "calfRightCm" REAL;
ALTER TABLE "Patient" ADD COLUMN "careSituation" TEXT;
ALTER TABLE "Patient" ADD COLUMN "diagnoses" JSONB;
ALTER TABLE "Patient" ADD COLUMN "education" TEXT;
ALTER TABLE "Patient" ADD COLUMN "gaitSpeed6mSec" REAL;
ALTER TABLE "Patient" ADD COLUMN "gripStrengthKg" REAL;
ALTER TABLE "Patient" ADD COLUMN "livingSituation" TEXT;
ALTER TABLE "Patient" ADD COLUMN "maritalStatus" TEXT;
ALTER TABLE "Patient" ADD COLUMN "medications" JSONB;
ALTER TABLE "Patient" ADD COLUMN "pastHistory" JSONB;
ALTER TABLE "Patient" ADD COLUMN "recentAcute" JSONB;
ALTER TABLE "Patient" ADD COLUMN "weightHistory" JSONB;
