-- Nullable: the archive-to-Drive step runs after the signature is already
-- saved and must never be what decides whether signing succeeded. A row with
-- this column empty just means Drive wasn't reachable (or configured) at the
-- moment of signing, not that anything went wrong.

ALTER TABLE "liability_waivers" ADD COLUMN "drive_file_id" VARCHAR(128);
