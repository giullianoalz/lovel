-- The updated waiver document offers a "No Photos" opt-out on the photo/video
-- release line instead of an all-or-nothing consent. Defaults to false (photos
-- allowed) so every already-signed row keeps meaning what it meant when signed.

ALTER TABLE "liability_waivers" ADD COLUMN "photo_opt_out" BOOLEAN NOT NULL DEFAULT false;
