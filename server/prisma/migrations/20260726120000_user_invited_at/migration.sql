-- Tracks when staff last sent this user their "set your password" invite.
-- Nullable and additive: existing rows read as "never invited".
ALTER TABLE "users" ADD COLUMN "invited_at" TIMESTAMPTZ(6);
