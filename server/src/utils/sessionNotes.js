/**
 * Which session note a family is shown, and how it gets there.
 *
 * A session can carry two notes at once:
 *   - `lesson_plan_summary` — the preview the assistant drafts from the week's
 *     lesson plan, published when an admin approves it. It says what the class
 *     *is going to* do, and it exists before the class happens.
 *   - `teacher` — what the teacher writes on the day, in their own words.
 *
 * The teacher's version wins. Families were being shown the plan preview
 * forever: the teacher would rewrite the note after class, save it, and nothing
 * they wrote ever reached a parent, because every family-facing query filtered
 * to `lesson_plan_summary` alone. From the teacher's side that is
 * indistinguishable from the save silently failing.
 */

// Teacher notes carry a visibility list from the session editor's toggles
// ('students_parents', 'me', or the legacy 'all'). A note marked for the
// teacher alone must never leave this file's guard.
export const FAMILY_NOTE_WHERE = {
  OR: [
    { source: 'lesson_plan_summary' },
    { source: 'teacher', visibility: { contains: 'students_parents' } },
    { source: 'teacher', visibility: 'all' },
  ],
};

// Session notes are written in a contenteditable, so a teacher note is HTML.
// Every family-facing surface (portal cards, the notes modal, the PDF) prints
// it as plain text, so it gets flattened here rather than at each call site.
export const noteToPlainText = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Pick the note a family should see out of a session's notes, newest teacher
 * note first, falling back to the plan preview.
 *
 * Blank notes are skipped rather than preferred: a teacher who clears the
 * editor and saves shouldn't blank out the preview families are relying on.
 *
 * @param {Array<{id: string, notes: string|null, source: string}>} notes
 * @returns {{ id: string, notes: string, source: string } | null}
 */
export const pickFamilyNote = (notes = []) => {
  const usable = notes.filter((n) => noteToPlainText(n.notes) !== '');
  const chosen =
    usable.find((n) => n.source === 'teacher') ||
    usable.find((n) => n.source === 'lesson_plan_summary') ||
    null;
  return chosen ? { ...chosen, notes: noteToPlainText(chosen.notes) } : null;
};

// Prisma `include` for the family-visible notes of a session. Ordered newest
// first so `pickFamilyNote` gets the teacher's most recent wording; both
// sources are fetched because the preview is the fallback.
export const familyNotesInclude = {
  where: FAMILY_NOTE_WHERE,
  orderBy: { createdAt: 'desc' },
};
