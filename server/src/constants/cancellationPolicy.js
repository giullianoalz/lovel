/**
 * The cancellation window, shared by the two places that must agree on it:
 * what the family is suggested to be charged, and whether the teacher is paid.
 *
 * Kept in one file because these drifted apart once before — the charge rules
 * sat wrong for a month without anyone noticing. The waiver families sign is
 * the source of truth: "if I do not cancel before 24 hours of my scheduled
 * time, I will lose that paid session" (see waiverText.js).
 */
export const CANCELLATION_WINDOW_HOURS = 24;

/** Cancelled with at least the window's notice: half the session is suggested. */
export const ADVANCE_CANCELLATION_SUGGESTED_PERCENT = 50;

/** Cancelled inside the window, or a no-show: the whole session is suggested. */
export const LATE_CANCELLATION_SUGGESTED_PERCENT = 100;
