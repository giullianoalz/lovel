-- Captures the exact wording a parent saw at signing time, so a later edit to
-- the waiver template cannot retroactively change what an already-signed
-- record says was agreed to. Nullable: rows signed before this column existed
-- have no snapshot to fall back on, and the PDF builder treats that the same
-- as "use the current template" (the honest answer for those old rows either
-- way, since their exact original wording was never captured).

ALTER TABLE "liability_waivers" ADD COLUMN "document_snapshot" JSONB;
