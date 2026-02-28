-- AlterTable
ALTER TABLE "listings" ADD COLUMN "intents" TEXT[] DEFAULT ARRAY[]::TEXT[];
