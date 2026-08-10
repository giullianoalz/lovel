-- Extra teachers on a class, alongside the primary `teacherId`.
--
-- Standard Prisma implicit many-to-many join table for `Class.coTeachers` /
-- `User.coTaughtClasses`. This table was created by hand directly against the
-- database when the co-teachers feature shipped, so this migration exists only
-- to bring that change under version control — every statement is guarded so
-- it is a no-op against a database that already has it (this project's local
-- .env points at the shared production database) and a normal create against
-- any database that doesn't.

-- CreateTable
CREATE TABLE IF NOT EXISTS "_ClassCoTeachers" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ClassCoTeachers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_ClassCoTeachers_B_index" ON "_ClassCoTeachers"("B");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '_ClassCoTeachers_A_fkey'
  ) THEN
    ALTER TABLE "_ClassCoTeachers"
      ADD CONSTRAINT "_ClassCoTeachers_A_fkey"
      FOREIGN KEY ("A") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '_ClassCoTeachers_B_fkey'
  ) THEN
    ALTER TABLE "_ClassCoTeachers"
      ADD CONSTRAINT "_ClassCoTeachers_B_fkey"
      FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
