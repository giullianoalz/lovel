-- Announcement photos were written to the API container's local disk and the
-- row was created regardless. On Render that disk is wiped whenever the service
-- restarts, so a post's pictures survived hours, not days: the rows outlived
-- the bytes they pointed at. This column holds the id of the durable Drive copy
-- (the same account and mechanism the marketing photos already use).
--
-- Existing rows stay NULL on purpose: those files are already gone, and the
-- feed renders "unavailable" for them rather than pretending otherwise.
ALTER TABLE "announcement_media" ADD COLUMN "drive_file_id" TEXT;
