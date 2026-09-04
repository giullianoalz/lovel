-- A teacher can write to the board; an admin decides when it goes up.
--
-- The academy's rule is that nothing reaches families unread by an admin, so a
-- post now carries the state of that review. Existing rows are APPROVED: every
-- one of them was written by an admin under the old rule, and defaulting them
-- to PENDING would empty the feed overnight.
--
-- REJECTED posts are kept rather than deleted so the author can see the note
-- and fix the post instead of guessing why it vanished.

ALTER TABLE "announcements"
  ADD COLUMN "status" VARCHAR(10) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "reviewed_by_id" UUID,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_note" TEXT;

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The feed reads "approved, for my audience" on every load, and the admin
-- queue reads "pending" — both start here.
CREATE INDEX "announcements_status_idx" ON "announcements"("status");
