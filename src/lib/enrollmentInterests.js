/**
 * The modalities a family can ask for when it registers itself.
 *
 * The `id` is what gets stored on the application row, so these strings are
 * data: renaming one orphans every application already submitted with it.
 * Labels are safe to reword.
 *
 * Shared by the signup form (which offers them) and the admin review queue
 * (which reads them back) so the two can never drift into showing a parent one
 * wording and staff another.
 */
export const INTERESTS = [
  { id: 'one_on_one',  label: 'One-on-one tutoring' },
  { id: 'group',       label: 'Group classes' },
  { id: 'homeschool',  label: 'Homeschool program' },
  { id: 'virtual',     label: 'Virtual / online' },
  { id: 'pods',        label: 'Learning pods' },
  { id: 'summer',      label: 'Summer camp' },
  { id: 'not_sure',    label: "Not sure yet — help me choose" },
];

/**
 * Label for a stored id. An id that predates this list — or outlives it — still
 * has to render as something a human can read, so unknown values are
 * de-underscored rather than dropped.
 */
export const interestLabel = (id) =>
  INTERESTS.find(o => o.id === id)?.label || String(id).replace(/_/g, ' ');
