/**
 * Role helpers for accounts that wear more than one hat.
 *
 * A user carries one primary `role` plus any number of `secondaryRoles`. The
 * split exists because sign-in is tied 1:1 to a Firebase email, so a teacher
 * who also enrols her own children cannot simply hold two accounts.
 *
 * Two rules, and they are not the same:
 *
 *   hasRole()  — permission. Permissive: holding the role anywhere grants it.
 *                Use for "may this person do X".
 *
 *   isOnly()   — restriction. Strict: true only when the user holds that role
 *                and nothing broader. Use before narrowing someone's view, so a
 *                teacher-who-is-also-an-admin isn't accidentally demoted by a
 *                check that was written when one role was all anyone had.
 */

/** Roles that outrank the key, so a restriction written for it shouldn't apply. */
const BROADER_THAN = {
  TEACHER: ['ADMIN'],
  PARENT: ['ADMIN', 'TEACHER'],
  STUDENT: ['ADMIN', 'TEACHER'],
  RECEPTIONIST: ['ADMIN'],
};

/** Every role this user holds, primary first. */
export const allRoles = (user) =>
  user ? [user.role, ...(user.secondaryRoles || [])].filter(Boolean) : [];

/** True when the user holds any of `roles`, primary or secondary. */
export const hasRole = (user, ...roles) => {
  const held = allRoles(user);
  return roles.flat().some((r) => held.includes(r));
};

/**
 * True when `role` is the only hat this user wears — nothing broader alongside
 * it. `isOnly(user, 'TEACHER')` is false for a teacher who is also an admin,
 * which is what keeps admin-level access from being narrowed by teacher-scoped
 * filters. It stays true for a teacher who is also a parent: being a parent
 * doesn't widen what you may see as staff.
 */
export const isOnly = (user, role) => {
  const held = allRoles(user);
  if (!held.includes(role)) return false;
  return !held.some((r) => r !== role && BROADER_THAN[role]?.includes(r));
};
