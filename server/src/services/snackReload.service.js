import prisma from '../config/database.js';
import { sendNotification } from '../jobs/notification.helper.js';
import { invalidate } from '../middleware/cache.js';
import {
  getEventConfig,
  getAdminUserIds,
  getParentUserIdsForStudents,
} from './notificationConfig.service.js';

// A student can only have one open reload request at a time.
export const OPEN_RELOAD_STATUSES = ['PENDING', 'APPROVED'];

/**
 * The reload package the admin configured: how many punches one paid reload
 * hands over, what it costs, and — for manual top-ups that don't come in whole
 * packages — what a single punch is worth.
 */
export const getReloadPricing = async () => {
  const config = await getEventConfig('SNACK_PUNCHES_DEPLETED');
  const punchCount = config?.params?.reloadPunches ?? 10;
  const price = config?.params?.reloadPrice ?? 10;
  return {
    punchCount,
    price,
    // Half-cent rounding, so 3 punches out of a $10/10 package bill $3.00 and
    // never $2.9999999.
    pricePerPunch: Math.round((price / punchCount) * 100) / 100,
  };
};

/** Whatever a single punch costs right now, for `count` of them. */
export const priceForPunches = (pricePerPunch, count) =>
  Math.round(pricePerPunch * count * 100) / 100;

/**
 * Raised the moment a student's snack card runs out. Creates a pending
 * SnackReloadRequest (unless one is already open) and notifies the parents
 * (and/or admins) so the parent can approve a paid reload. Fully best-effort:
 * any failure here must never fail the purchase or adjustment that emptied the
 * card.
 *
 * The request itself is raised whenever the event is enabled — an empty
 * audience only means nobody gets pinged, not that the front desk loses the
 * queue entry it needs to top the card back up.
 */
export const maybeCreateReloadRequest = async (studentId, triggeredById) => {
  try {
    const config = await getEventConfig('SNACK_PUNCHES_DEPLETED');
    if (!config?.enabled) return null;

    // Don't stack requests — one open request per student.
    const existing = await prisma.snackReloadRequest.findFirst({
      where: { studentId, status: { in: OPEN_RELOAD_STATUSES } },
    });
    if (existing) return existing;

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, fullName: true },
    });
    if (!student) return null;

    const familyMember = await prisma.familyMember.findFirst({ where: { userId: studentId } });
    const punchCount = config.params.reloadPunches;
    const price = config.params.reloadPrice;

    const request = await prisma.snackReloadRequest.create({
      data: {
        studentId,
        familyId: familyMember?.familyId ?? null,
        punchCount,
        price,
        triggeredById: triggeredById ?? null,
      },
    });

    // Bust the parents' cached portal (60 s TTL) so the approval banner shows
    // up on their next load, not up to a minute later — regardless of whether
    // they're in the notification audience.
    const parentIds = await getParentUserIdsForStudents([studentId]);
    parentIds.forEach((id) => invalidate(`portal:parent:${id}`));

    const priceLabel = `$${Number(price).toFixed(2)}`;
    const recipients = new Set();
    if (config.audience.includes('PARENTS')) {
      parentIds.forEach((id) => recipients.add(id));
    }
    if (config.audience.includes('ADMINS')) {
      (await getAdminUserIds()).forEach((id) => recipients.add(id));
    }

    for (const userId of recipients) {
      await sendNotification({
        userId,
        type: 'SNACK_PUNCHES_DEPLETED',
        title: `${student.fullName} is out of snack punches`,
        message: `${student.fullName}'s snack card reached 0. Approve reloading ${punchCount} punch(es) for ${priceLabel}?`,
        referenceType: 'snackReload',
        referenceId: request.id,
        dedupKey: `snack-reload-${request.id}-${userId}`,
      });
    }

    return request;
  } catch (err) {
    console.error('[Rewards] maybeCreateReloadRequest failed:', err.message);
    return null;
  }
};
