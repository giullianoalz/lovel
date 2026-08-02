-- Teachers are paid per hour taught, with an optional different rate per kind
-- of work (in person vs online).

ALTER TABLE "users" ADD COLUMN "hourly_rate" DECIMAL(10,2);

-- Nothing is lost: this column was null for every row in the database, because
-- no teacher was ever paid per session. Hourly replaces it outright.
ALTER TABLE "users" DROP COLUMN "per_session_rate";

CREATE TABLE "teacher_pay_rates" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_pay_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teacher_pay_rates_teacher_id_category_key"
    ON "teacher_pay_rates"("teacher_id", "category");

CREATE INDEX "teacher_pay_rates_teacher_id_idx"
    ON "teacher_pay_rates"("teacher_id");

ALTER TABLE "teacher_pay_rates" ADD CONSTRAINT "teacher_pay_rates_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
