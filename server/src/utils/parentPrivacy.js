import prisma from '../config/database.js';
import { hasRole } from './roles.js';

/**
 * Teachers talk to families, not to people they can look up afterwards.
 *
 * A teacher never sees a guardian's name, email or phone — in the chat inbox,
 * in a thread, in a push notification or in the "New Conversation" picker the
 * other side reads as "Ana's Parent". Contact details already stay inside the
 * app (see utils/contentFilter.js, which blocks emails and phone numbers in
 * message bodies); this closes the other half, the identity itself, so a
 * teacher can't take a family with them when they leave.
 *
 * Admins are exempt — running the office means knowing who the families are.
 */

export const PARENT_MASK_FALLBACK = "Student's Parent";

/** True when `viewer` must see guardians masked. Holding ADMIN lifts it. */
export const masksParentIdentity = (viewer) =>
  !!viewer && hasRole(viewer, 'TEACHER') && !hasRole(viewer, 'ADMIN');

const firstNameOf = (fullName) => (fullName || '').trim().split(/\s+/)[0] || '';

/** "Ana" -> "Ana's", "Lucas" -> "Lucas'" — plain English possessive. */
const possessive = (name) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/**
 * Label for a guardian, derived from the children the teacher already knows by
 * name. Two children are named; beyond that the extra ones are counted, so the
 * label stays short in the thread list.
 */
export const parentLabelFor = (studentFullNames = []) => {
  const names = Array.from(new Set(studentFullNames.map(firstNameOf).filter(Boolean)));
  if (names.length === 0) return PARENT_MASK_FALLBACK;
  if (names.length <= 2) return `${possessive(names.join(' & '))} Parent`;
  return `${possessive(`${names[0]} & ${names.length - 1} others`)} Parent`;
};

/**
 * Builds userId -> masked label for the guardians among `userIds`, as seen by
 * `viewer`. Returns an empty Map when the viewer isn't masked, so every call
 * site can stay a plain `map.get(id) || user.fullName`.
 *
 * A teacher who is also a parent keeps seeing their own co-parents by name:
 * the point is other people's families, not their own household.
 */
export async function buildParentMaskMap(viewer, userIds = []) {
  const map = new Map();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!masksParentIdentity(viewer) || ids.length === 0) return map;

  const [users, ownMemberships] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        role: true,
        secondaryRoles: true,
        familyMembers: {
          select: {
            familyId: true,
            family: {
              select: {
                members: {
                  select: { user: { select: { fullName: true, role: true, secondaryRoles: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.familyMember.findMany({ where: { userId: viewer.id }, select: { familyId: true } }),
  ]);

  const ownFamilyIds = new Set(ownMemberships.map((m) => m.familyId));

  for (const user of users) {
    if (!hasRole(user, 'PARENT')) continue;
    if (user.familyMembers.some((fm) => ownFamilyIds.has(fm.familyId))) continue;

    const studentNames = user.familyMembers.flatMap((fm) =>
      fm.family.members.filter((m) => hasRole(m.user, 'STUDENT')).map((m) => m.user.fullName)
    );
    map.set(user.id, parentLabelFor(studentNames));
  }

  return map;
}

/** Convenience for a single user once the map is built. */
export const displayNameFor = (maskMap, user) =>
  (user && maskMap.get(user.id)) || user?.fullName || null;

/**
 * Same rule for one user, without a pre-built map — for the paths that shape a
 * single row (e.g. the user directory) rather than a whole thread.
 */
export async function maskParentUser(viewer, user) {
  if (!user) return user;
  const map = await buildParentMaskMap(viewer, [user.id]);
  const label = map.get(user.id);
  if (!label) return user;
  return { ...user, fullName: label, email: null, phone: null, isMaskedParent: true };
}
