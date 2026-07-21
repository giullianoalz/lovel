/**
 * Canonical catalog of the automated notification events the system can fire.
 *
 * This is the single source of truth for:
 *   - which events exist and how they're described in the admin UI,
 *   - their default on/off state, audience, channels, and tunable parameters,
 *   - the validation bounds applied before an admin's overrides are saved.
 *
 * Per-event overrides are stored in the NotificationEventConfig table keyed by
 * `key`. A missing row means "use the defaults below". Adding a new automated
 * notification? Add its descriptor here and read its resolved config via
 * getEventConfig() in the job/controller that sends it.
 */

// Recipient groups an event can be delivered to. Resolution to concrete user
// ids happens per-event (see notificationConfig.service.js), because "PARENTS"
// means the affected student's/family's parents, not every parent in the system.
export const AUDIENCES = ['PARENTS', 'ADMINS'];

export const AUDIENCE_LABELS = {
  PARENTS: 'Parents / families',
  ADMINS: 'Admins / front desk',
};

// Delivery channels. IN_APP is the bell inbox (+ FCM push): it is always on and
// not deselectable, because the in-app row is both the audit trail and where
// dedup keys live — drop it and a daily cron would re-send every run. EMAIL and
// SMS are opt-in fan-out on top of it. A recipient still has the final say per
// channel through their own NotificationPreference row — see `category` on each
// descriptor below.
export const CHANNELS = ['IN_APP', 'EMAIL', 'SMS'];

// Channels an admin can actually toggle in the settings screen.
export const OPTIONAL_CHANNELS = ['EMAIL', 'SMS'];

export const CHANNEL_LABELS = {
  IN_APP: 'In-app + push',
  EMAIL: 'Email',
  SMS: 'Text message',
};

/**
 * @typedef {Object} EventParam
 * @property {string} key      - stored in NotificationEventConfig.params
 * @property {string} label    - shown before the input in the UI
 * @property {number} default
 * @property {number} min
 * @property {number} max
 * @property {string} unit     - shown after the input in the UI
 */

export const NOTIFICATION_EVENTS = [
  {
    key: 'CLASS_REMINDER',
    label: 'Class starting-soon reminder',
    description: 'Sent shortly before a class begins, to the recipients below.',
    category: 'class_reminders',
    defaults: { enabled: true, audience: ['PARENTS'], channels: ['IN_APP'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [
      { key: 'minutesBefore', label: 'Send', default: 15, min: 1, max: 180, unit: 'minute(s) before class starts' },
    ],
  },
  {
    key: 'ABSENCE',
    label: 'Absence alert',
    description: 'Sent as soon as a teacher marks a student absent.',
    category: 'attendance_alerts',
    defaults: { enabled: true, audience: ['PARENTS'], channels: ['IN_APP', 'SMS'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [],
  },
  {
    key: 'REPEATED_ABSENCE',
    label: 'Repeated-absence alert',
    description: 'Flags students who miss several sessions within a rolling window.',
    category: 'attendance_alerts',
    defaults: { enabled: true, audience: ['ADMINS'], channels: ['IN_APP', 'EMAIL'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [
      { key: 'thresholdCount', label: 'Trigger after', default: 3, min: 2, max: 30, unit: 'absence(s)' },
      { key: 'windowDays', label: 'within the last', default: 30, min: 1, max: 365, unit: 'day(s)' },
    ],
  },
  {
    key: 'PAYMENT_OVERDUE',
    label: 'Overdue-invoice alert',
    description: 'Sent the day after an invoice passes its due date.',
    category: 'payment_reminders',
    defaults: { enabled: true, audience: ['PARENTS', 'ADMINS'], channels: ['IN_APP', 'EMAIL'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [],
  },
  {
    key: 'LOW_SNACK_PUNCHES',
    label: 'Low snack-punches alert',
    description: 'Flags snack-authorized students running low on punches.',
    category: 'snack_alerts',
    defaults: { enabled: true, audience: ['ADMINS'], channels: ['IN_APP'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [
      { key: 'thresholdPunches', label: 'Trigger at or below', default: 2, min: 0, max: 50, unit: 'punch(es)' },
    ],
  },
  {
    key: 'SNACK_PUNCHES_DEPLETED',
    label: 'Snack card empty — reload approval',
    description:
      'Sent the moment a student\'s snack card hits 0, asking the parent to approve a paid reload. Front desk can only top up once the parent approves.',
    category: 'snack_alerts',
    defaults: { enabled: true, audience: ['PARENTS', 'ADMINS'], channels: ['IN_APP', 'EMAIL'] },
    allowedAudience: ['PARENTS', 'ADMINS'],
    allowedChannels: ['IN_APP', 'EMAIL', 'SMS'],
    params: [
      { key: 'reloadPunches', label: 'Reload package of', default: 10, min: 1, max: 100, unit: 'punch(es)' },
      { key: 'reloadPrice', label: 'charged at', default: 10, min: 1, max: 500, unit: '$ per reload' },
    ],
  },
];

// Fast lookup by key.
export const EVENTS_BY_KEY = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e.key, e]),
);
