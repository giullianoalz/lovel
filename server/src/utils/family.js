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
