-- Pay by the kind of work, scheduled on the calendar.
--
-- Until now payroll guessed the category from whether a session had a meeting
-- link (online vs in person). That can't express "front desk pays $20, the
-- junior jams class pays $30", and it can't pay hours that aren't a class at
-- all. This adds:
--   * pay_categories  — the kinds of work, each with a default hourly rate
--   * work_shifts     — paid hours that aren't a class (reception, planning)
--   * a category + optional one-off rate on each session
--   * users.flat_rate_only — "this person's hourly rate wins, whatever the work"
--
-- Everything is additive and nullable, so existing sessions keep paying exactly
-- what they paid before this ran.

CREATE TYPE "work_shift_status" AS ENUM ('scheduled', 'completed', 'cancelled');

CREATE TABLE "pay_categories" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "default_rate" DECIMAL(10,2),
    "teaching" BOOLEAN NOT NULL DEFAULT false,
    "color" VARCHAR(20),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pay_categories_key_key" ON "pay_categories"("key");
CREATE INDEX "pay_categories_active_idx" ON "pay_categories"("active");

CREATE TABLE "work_shifts" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "pay_category_key" VARCHAR(40),
    "pay_rate_override" DECIMAL(10,2),
    "status" "work_shift_status" NOT NULL DEFAULT 'scheduled',
    "title" VARCHAR(255),
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_shifts_staff_id_date_idx" ON "work_shifts"("staff_id", "date");
CREATE INDEX "work_shifts_date_idx" ON "work_shifts"("date");

ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sessions" ADD COLUMN "pay_category_key" VARCHAR(40);
ALTER TABLE "sessions" ADD COLUMN "pay_rate_override" DECIMAL(10,2);

ALTER TABLE "users" ADD COLUMN "flat_rate_only" BOOLEAN NOT NULL DEFAULT false;

-- The starting list. ONLINE and IN_PERSON keep the keys the payroll engine
-- already used, so any teacher_pay_rates row set before today still matches.
-- Rates are left null on purpose except where the academy has already said the
-- number out loud: an invented default would quietly pay somebody it.
INSERT INTO "pay_categories" ("id", "key", "label", "default_rate", "teaching", "color", "sort_order", "updated_at") VALUES
    (gen_random_uuid(), 'IN_PERSON',     'In-person class',  NULL, true,  '#6366f1', 10, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ONLINE',        'Online session',   NULL, true,  '#0ea5e9', 20, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PRIVATE_TUTOR', 'Private tutoring', NULL, true,  '#8b5cf6', 30, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'FRONT_DESK',    'Front desk',       NULL, false, '#f59e0b', 40, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PLANNING',      'Planning',         NULL, false, '#10b981', 50, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'MEETING',       'Staff meeting',    NULL, false, '#64748b', 60, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'SUBSTITUTE',    'Substitute cover', NULL, true,  '#ef4444', 70, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
