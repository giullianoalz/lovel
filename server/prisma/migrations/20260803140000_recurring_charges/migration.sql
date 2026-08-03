-- Standing monthly charges (IXL memberships, snack cards, anything billed on a
-- recurring arrangement). The row here is the instruction; the money is still
-- an ordinary transaction, raised one per month by the nightly job.

CREATE TABLE "recurring_charges" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "student_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recurring_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_charges_family_id_idx" ON "recurring_charges"("family_id");
CREATE INDEX "recurring_charges_active_idx" ON "recurring_charges"("active");

ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which arrangement raised this charge, and the month it covers ("2026-08").
ALTER TABLE "transactions" ADD COLUMN "recurring_charge_id" UUID;
ALTER TABLE "transactions" ADD COLUMN "period_key" VARCHAR(7);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_charge_id_fkey"
    FOREIGN KEY ("recurring_charge_id") REFERENCES "recurring_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The safety rail. The monthly run can be repeated, caught up after a deploy,
-- or fired twice by an impatient admin: the second attempt for a month that is
-- already charged hits this constraint instead of billing the family again.
-- Postgres treats NULLs as distinct, so every non-recurring transaction is
-- unaffected — same reasoning as the quarterly (student, term, quarter) index.
CREATE UNIQUE INDEX "transactions_recurring_charge_id_period_key_key"
    ON "transactions"("recurring_charge_id", "period_key");
