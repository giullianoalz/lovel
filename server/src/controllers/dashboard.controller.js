import prisma from '../config/database.js';

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

    // 1. Upcoming sessions (next 7 days)
    const sessions = await prisma.session.findMany({
      where: {
        date: { gte: today, lte: endOfWeek },
        status: { not: 'CANCELLED' },
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
      const sessionDate = new Date(s.date);
      const isToday = sessionDate.toDateString() === today.toDateString();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const isTomorrow = sessionDate.toDateString() === tomorrow.toDateString();

      const startTime = new Date(s.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      let timeLabel;
      if (isToday) timeLabel = `Today, ${startTime}`;
      else if (isTomorrow) timeLabel = `Tomorrow, ${startTime}`;
      else
        timeLabel = `${sessionDate.toLocaleDateString('en-US', { weekday: 'long' })}, ${startTime}`;

      return {
        id: s.id,
        subject: s.class?.subject || s.class?.name || 'Class',
        teacher: s.class?.teacher?.fullName || 'TBD',
        time: timeLabel,
        status: 'upcoming',
        type: s.class?.type === 'VIRTUAL' ? 'Virtual' : 'In-person',
        meetingUrl: s.class?.meetingUrl || null,
      };
    });

    // 2. Recent session notes/materials (last 14 days)
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(today.getDate() - 14);

    const recentSessionsRaw = await prisma.session.findMany({
      where: {
        date: { gte: twoWeeksAgo, lte: today },
        status: 'COMPLETED',
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
      where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
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
        classesToday: sessions.filter(
          (s) => new Date(s.date).toDateString() === today.toDateString()
        ).length,
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
