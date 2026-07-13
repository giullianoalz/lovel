-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ema_student_id" VARCHAR(50);

-- CreateIndex
CREATE UNIQUE INDEX "users_ema_student_id_key" ON "users"("ema_student_id");
