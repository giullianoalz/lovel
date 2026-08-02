-- Per-session meeting link, so a class that meets in person some days and
-- online on others carries the Zoom link only on the days it applies to.
ALTER TABLE "sessions" ADD COLUMN "meeting_url" TEXT;
