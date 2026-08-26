-- Staff-set "no photos" flag, independent of the waiver's own photo_opt_out.
ALTER TABLE "users" ADD COLUMN "no_photos_override" BOOLEAN NOT NULL DEFAULT false;
