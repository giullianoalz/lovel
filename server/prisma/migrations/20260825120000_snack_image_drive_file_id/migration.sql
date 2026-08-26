-- Snack photos move out of Postgres and into Drive.
--
-- image_url used to hold the whole picture as a base64 data URI, straight from
-- the phone camera that took it. Eleven rows reached 62 MB — four fifths of the
-- database — and every list of the snack cabinet dragged all of it across the
-- wire. drive_file_id points at the bytes in Drive instead; image_url keeps
-- holding a plain URL for the seeded rows that already reference one.
ALTER TABLE "snack_items" ADD COLUMN "drive_file_id" TEXT;
