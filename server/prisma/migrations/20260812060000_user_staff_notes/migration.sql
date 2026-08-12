-- Back-office notes about a student (scholarship paperwork, what the family
-- bought). Kept apart from accommodation_notes, which teachers see.
ALTER TABLE "users" ADD COLUMN "staff_notes" TEXT;
