-- Distinguish teacher-written session notes from the auto-generated lesson
-- plan summary, so re-approving a lesson plan only ever replaces its own note.
ALTER TABLE "session_notes" ADD COLUMN "source" VARCHAR(30) NOT NULL DEFAULT 'teacher';
