-- Days the academy did not open.
--
-- Pay and charges both accrue from the calendar, so a holiday whose sessions
-- were never cancelled pays every teacher and bills every family as though it
-- had run. This table is the one place that says otherwise.
--
-- One row per day, not a range: every caller asks about a single date, and
-- answering that against start/end pairs puts overlap arithmetic in all of
-- them. Ranges are expanded on the way in.
--
-- Starts empty. Nothing already recorded changes until somebody declares a day
-- closed, and doing so is what clears any pay already frozen onto it.

CREATE TABLE "academy_closures" (
  "id"         UUID NOT NULL,
  "date"       DATE NOT NULL,
  "label"      VARCHAR(120) NOT NULL,
  "notes"      TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "academy_closures_pkey" PRIMARY KEY ("id")
);

-- A date is closed or it is not; two rows could disagree about why.
CREATE UNIQUE INDEX "academy_closures_date_key" ON "academy_closures"("date");
CREATE INDEX "academy_closures_date_idx" ON "academy_closures"("date");

ALTER TABLE "academy_closures"
  ADD CONSTRAINT "academy_closures_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
