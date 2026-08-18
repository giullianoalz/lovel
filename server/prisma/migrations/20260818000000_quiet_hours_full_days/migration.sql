-- AlterTable
ALTER TABLE "users" ADD COLUMN "quiet_hours_full_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
