import crypto from 'crypto';
import prisma from '../config/database.js';

/**
 * Every student in the families this user belongs to.
 *
 * Family membership is the link, not a `parentId` column: a child can sit in
 * more than one family (separated parents each with their own household), and
 * both parents must see them. Ids are de-duplicated for that reason.
 */
export const childIdsOfParent = async (parentId) => {
  const parentFamilies = await prisma.familyMember.findMany({
    where: { userId: parentId },
    select: { familyId: true },
  });
  if (parentFamilies.length === 0) return [];

  const children = await prisma.familyMember.findMany({
    where: {
      familyId: { in: parentFamilies.map((f) => f.familyId) },
      user: { role: 'STUDENT' },
    },
    select: { userId: true },
  });
  return [...new Set(children.map((c) => c.userId))];
};

/** Every family this user belongs to, parent or child alike. */
export const familyIdsOfUser = async (userId) => {
  const rows = await prisma.familyMember.findMany({
    where: { userId },
    select: { familyId: true },
  });
  return rows.map((r) => r.familyId);
};

/**
 * The household's standing check-in code, minted on first use.
 *
 * From the random source, not a digest of the family's name or id: this code is
 * the whole proof at the door, and a guessable one would let a stranger present
 * somebody else's household. 32 bytes for the same reason the pickup token is.
 *
 * Pass `rotate` to burn the old code — the previous QR stops resolving the
 * moment the new value is written, which is the point of rotating it.
 */
export const ensureFamilyCheckInCode = async (familyId, { rotate = false } = {}) => {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, name: true, checkInCode: true },
  });
  if (!family) return null;
  if (family.checkInCode && !rotate) return family;

  return prisma.family.update({
    where: { id: familyId },
    data: { checkInCode: crypto.randomBytes(32).toString('hex') },
    select: { id: true, name: true, checkInCode: true },
  });
};
