import prisma from '../config/database.js';

/**
 * Snack card punches are only for in-person students. A student is eligible if
 * they have at least one ACTIVE enrollment in an in-person or hybrid class;
 * students whose classes are all virtual (100% online) are not.
 *
 * Pass a transaction client (`tx`) when calling inside a prisma.$transaction.
 */
export const canUseSnackPunches = async (studentId, client = prisma) => {
  const inPersonEnrollments = await client.classEnrollment.count({
    where: {
      studentId,
      status: 'active',
      class: { type: { in: ['IN_PERSON', 'HYBRID'] } },
    },
  });
  return inPersonEnrollments > 0;
};
