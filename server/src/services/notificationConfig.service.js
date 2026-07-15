import prisma from '../config/database.js';
import {
  NOTIFICATION_EVENTS,
  EVENTS_BY_KEY,
  AUDIENCES,
} from '../config/notificationEvents.js';

/**
 * Per-event notification configuration.
 *
 * The catalog (notificationEvents.js) defines defaults and validation bounds;
 * the NotificationEventConfig table stores admin overrides. These helpers merge
 * the two so callers always get a fully-resolved, clamped config — a missing row
 * simply means "defaults".
 */

// Clamp a param value to its catalog bounds, falling back to the default when
// the stored/provided value is missing or non-numeric.
const resolveParams = (descriptor, stored = {}) => {
  const out = {};
  for (const p of descriptor.params) {
    const raw = stored?.[p.key];
    const num = Number(raw);
    out[p.key] = Number.isFinite(num) ? Math.min(p.max, Math.max(p.min, num)) : p.default;
  }
  return out;
};

// Keep only audience values that are both globally valid and allowed for this
// event; fall back to the event's default audience if nothing valid remains.
const resolveAudience = (descriptor, stored) => {
  const allowed = descriptor.allowedAudience || AUDIENCES;
  const filtered = Array.isArray(stored)
    ? [...new Set(stored.filter((a) => allowed.includes(a)))]
    : null;
  return filtered && filtered.length ? filtered : [...descriptor.defaults.audience];
};

const mergeConfig = (descriptor, row) => ({
  key: descriptor.key,
  label: descriptor.label,
  description: descriptor.description,
  allowedAudience: descriptor.allowedAudience || AUDIENCES,
  paramSchema: descriptor.params,
  enabled: row ? row.enabled : descriptor.defaults.enabled,
  audience: row ? resolveAudience(descriptor, row.audience) : [...descriptor.defaults.audience],
  params: resolveParams(descriptor, row?.params),
});

/**
 * Resolved config for a single event, used by the cron jobs / controllers that
 * actually send the notification. Never throws for unknown keys — returns null
 * so callers can decide (they always pass a known catalog key in practice).
 */
export const getEventConfig = async (eventKey) => {
  const descriptor = EVENTS_BY_KEY[eventKey];
  if (!descriptor) return null;
  const row = await prisma.notificationEventConfig.findUnique({ where: { eventKey } });
  return mergeConfig(descriptor, row);
};

/** Resolved config for every catalog event, for the admin settings screen. */
export const getAllEventConfigs = async () => {
  const rows = await prisma.notificationEventConfig.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.eventKey, r]));
  return NOTIFICATION_EVENTS.map((d) => mergeConfig(d, byKey[d.key]));
};

/**
 * Validate and persist overrides for one event. Throws { status, message } on
 * invalid input so the controller can turn it into a 400.
 */
export const updateEventConfig = async (eventKey, patch, updatedById) => {
  const descriptor = EVENTS_BY_KEY[eventKey];
  if (!descriptor) {
    throw { status: 400, message: `Unknown notification event: ${eventKey}` };
  }

  const data = {};

  if (patch.enabled !== undefined) data.enabled = !!patch.enabled;

  if (patch.audience !== undefined) {
    if (!Array.isArray(patch.audience)) {
      throw { status: 400, message: `${eventKey}: audience must be an array.` };
    }
    const allowed = descriptor.allowedAudience || AUDIENCES;
    const invalid = patch.audience.filter((a) => !allowed.includes(a));
    if (invalid.length) {
      throw { status: 400, message: `${eventKey}: invalid audience value(s): ${invalid.join(', ')}` };
    }
    data.audience = [...new Set(patch.audience)];
  }

  if (patch.params !== undefined) {
    if (typeof patch.params !== 'object' || patch.params === null) {
      throw { status: 400, message: `${eventKey}: params must be an object.` };
    }
    const params = {};
    for (const p of descriptor.params) {
      if (patch.params[p.key] === undefined) continue;
      const num = Number(patch.params[p.key]);
      if (!Number.isFinite(num) || num < p.min || num > p.max) {
        throw { status: 400, message: `${eventKey}: ${p.key} must be between ${p.min} and ${p.max}.` };
      }
      params[p.key] = num;
    }
    data.params = params;
  }

  await prisma.notificationEventConfig.upsert({
    where: { eventKey },
    update: { ...data, updatedById },
    create: {
      eventKey,
      enabled: data.enabled ?? descriptor.defaults.enabled,
      audience: data.audience ?? descriptor.defaults.audience,
      params: data.params ?? {},
      updatedById,
    },
  });

  return getEventConfig(eventKey);
};

// ─────────────────────────────────────────────────────────────
// Recipient resolution
// "ADMINS" → every active admin. "PARENTS" → parents tied to the subject
// students of the event (their families), never the whole parent population.
// ─────────────────────────────────────────────────────────────

export const getAdminUserIds = async () => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  return admins.map((a) => a.id);
};

export const getParentUserIdsForStudents = async (studentIds) => {
  if (!studentIds || studentIds.length === 0) return [];
  const familyMembers = await prisma.familyMember.findMany({
    where: { userId: { in: studentIds } },
    select: { familyId: true },
  });
  const familyIds = [...new Set(familyMembers.map((f) => f.familyId))];
  if (familyIds.length === 0) return [];

  const parents = await prisma.familyMember.findMany({
    where: { familyId: { in: familyIds }, user: { role: 'PARENT' } },
    select: { userId: true },
  });
  return [...new Set(parents.map((p) => p.userId))];
};
