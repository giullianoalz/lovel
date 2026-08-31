import prisma from '../config/database.js';
import { resolveMeetingUrl } from '../utils/meetingLink.js';
import { sessionScope } from './sessions.controller.js';

// Session.date and Session.startTime are date-only / time-only columns stamped
// at UTC. Formatting them with the local getters shifts a 2:10 PM class to
// 9:10 AM and can move it to the previous day, so read the UTC parts.
const utcDayKey = (value) => new Date(value).toISOString().slice(0, 10);

const utcTimeLabel = (value) => {
  const d = new Date(value);
  const h = d.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const utcWeekday = (value) =>
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(value).getUTCDay()
  ];

/**
 * GET /api/dashboard
 * Consolidated dashboard data — upcoming sessions, recent materials,
 * billing summary, and notifications for the current user.
 */
export const getDashboard = async (req, res, next) => {
  try {
    const today = new Date();
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    // "Today"/"Tomorrow" are judged against the local calendar day — the day the
    // reader is living in — then compared to the session's own UTC-stamped day.
    const localDayKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayKey = localDayKey(today);
    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(today.getDate() + 1);
    const tomorrowKey = localDayKey(tomorrowDate);

    // Same "only what this account may see" rule the calendar runs on: a
    // teacher's dashboard is their own classes, not the academy's whole
    // timetable with every colleague's name and teaching hours on it.
    const scope = await sessionScope(req.user);

    // 1. Upcoming sessions (next 7 days). Bounded from midnight of today's date,
    // not from the current instant: session.date is stamped at UTC midnight, so
    // a `gte: now` filter dropped today's own classes off the dashboard.
    const sessions = await prisma.session.findMany({
      where: {
        AND: [
          {
            date: { gte: new Date(`${todayKey}T00:00:00.000Z`), lte: endOfWeek },
            status: { not: 'CANCELLED' },
          },
          scope,
        ],
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        class: {
          select: {
            name: true,
            subject: true,
            type: true,
            meetingUrl: true,
            teacher: { select: { fullName: true } },
          },
        },
      },
    });

    const upcomingSessions = sessions.map((s) => {
      const sessionKey = utcDayKey(s.date);
      const startTime = utcTimeLabel(s.startTime);

      let timeLabel;
      if (sessionKey === todayKey) timeLabel = `Today, ${startTime}`;
      else if (sessionKey === tomorrowKey) timeLabel = `Tomorrow, ${startTime}`;
      else timeLabel = `${utcWeekday(s.date)}, ${startTime}`;

      return {
        id: s.id,
        subject: s.class?.subject || s.class?.name || 'Class',
        teacher: s.class?.teacher?.fullName || 'TBD',
        time: timeLabel,
        status: 'upcoming',
        // Per-meeting, not per-class: a hybrid class only shows "Virtual" (and a
        // link) on the days it actually meets online.
        type: resolveMeetingUrl(s) ? 'Virtual' : 'In-person',
        meetingUrl: resolveMeetingUrl(s),
      };
    });

    // 2. Recent session notes/materials (last 14 days)
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(today.getDate() - 14);

    const recentSessionsRaw = await prisma.session.findMany({
      where: {
        AND: [{ date: { gte: twoWeeksAgo, lte: today }, status: 'COMPLETED' }, scope],
      },
      orderBy: { date: 'desc' },
      take: 5,
      include: {
        class: {
          select: {
            subject: true,
            teacher: { select: { fullName: true } },
          },
        },
        notes: { take: 1, orderBy: { createdAt: 'desc' } },
        materials: true,
      },
    });

    const recentSessions = recentSessionsRaw
      .filter((s) => s.notes.length > 0 || s.materials.length > 0)
      .map((s) => {
        const d = new Date(s.date);
        const isYesterday =
          d.toDateString() ===
          new Date(today.getTime() - 86400000).toDateString();

        return {
          id: s.id,
          subject: s.class?.subject || 'Class',
          teacher: s.class?.teacher?.fullName || 'Teacher',
          date: isYesterday
            ? 'Yesterday'
            : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          notes: s.notes[0]?.notes || '',
          materials: s.materials.map((m) => ({
            name: m.name,
            type: m.fileType || 'application/octet-stream',
          })),
        };
      });

    // 3. Billing quick summary
    const pendingInvoices = await prisma.invoice.findMany({
      where: { status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] } },
      take: 1,
      orderBy: { dueDate: 'asc' },
      include: { lines: true },
    });

    let billing;
    if (pendingInvoices.length > 0) {
      const inv = pendingInvoices[0];
      billing = {
        nextPayment: `$${Number(inv.totalAmount).toFixed(2)}`,
        dueDate: inv.dueDate
          ? new Date(inv.dueDate).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
          : 'N/A',
        pendingCharges: inv.lines.map((l) => ({
          item: l.description,
          amount: `$${Number(l.amount).toFixed(2)}`,
        })),
      };
    } else {
      billing = {
        nextPayment: '$0.00',
        dueDate: 'No pending invoices',
        pendingCharges: [],
      };
    }

    // 4. Notifications (latest 5)
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const formattedNotifications =
      notifications.length > 0
        ? notifications.map((n) => ({
            id: n.id,
            text: n.message,
            date: getRelativeTime(n.createdAt),
            type: n.type,
          }))
        : [
            {
              id: 'default-1',
              text: 'Welcome to Love Learning Explorers!',
              date: 'Just now',
              type: 'info',
            },
          ];

    // 5. Quick stats
    const totalStudents = await prisma.user.count({
      where: { role: 'STUDENT', status: 'ACTIVE' },
    });

    res.json({
      upcomingSessions,
      recentSessions,
      billing,
      notifications: formattedNotifications,
      stats: {
        totalStudents,
        classesToday: sessions.filter((s) => utcDayKey(s.date) === todayKey).length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Helper: relative time labels
function getRelativeTime(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
