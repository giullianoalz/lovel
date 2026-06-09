import prisma from '../config/database.js';

export const getCalendarData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { from, to, showPTO, showSharedSpaces } = req.query;

    const fromDate = from ? new Date(from) : new Date(new Date().setHours(0,0,0,0));
    const toDate = to ? new Date(to) : new Date(new Date().setDate(new Date().getDate() + 30));

    let sessions = [];
    let ptoRequests = [];
    let spaceReservations = [];

    // Get Teacher's Sessions
    sessions = await prisma.session.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        class: { teacherId: userId }
      },
      include: {
        class: { select: { id: true, name: true, subject: true, type: true } }
      }
    });

    // Get PTO if requested
    if (showPTO === 'true') {
      ptoRequests = await prisma.timeOffRequest.findMany({
        where: {
          teacherId: userId,
          startDate: { lte: toDate },
          endDate: { gte: fromDate }
        }
      });
    }

    // Get Shared Spaces if requested
    if (showSharedSpaces === 'true') {
      spaceReservations = await prisma.spaceReservation.findMany({
        where: {
          date: { gte: fromDate, lte: toDate }
        },
        include: {
          space: true,
          reservedBy: { select: { id: true, fullName: true } }
        }
      });
    }

    res.json({
      sessions,
      ptoRequests,
      spaceReservations
    });
  } catch (error) {
    next(error);
  }
};

export const requestPTO = async (req, res, next) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const teacherId = req.user.id;

    if (!type || !startDate || !endDate) {
      return res.status(400).json({ error: 'Validation Error', message: 'type, startDate, and endDate are required' });
    }

    const request = await prisma.timeOffRequest.create({
      data: {
        teacherId,
        type, // PTO or SICK
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        status: 'PENDING'
      }
    });

    // Notify management
    import('../utils/pushNotifications.js').then(({ broadcastToManagement }) => {
      broadcastToManagement(
        'New Time Off Request',
        `${req.user.fullName} requested ${type} from ${startDate} to ${endDate}.`,
        { type: 'PTO' }
      );
    });

    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
};

export const listSharedSpaces = async (req, res, next) => {
  try {
    const spaces = await prisma.sharedSpace.findMany();
    res.json({ spaces });
  } catch (error) {
    next(error);
  }
};

export const reserveSpace = async (req, res, next) => {
  try {
    const { spaceId, date, startTime, endTime, purpose } = req.body;
    const reservedById = req.user.id;

    if (!spaceId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Validation Error', message: 'Missing required fields' });
    }

    // Check for conflicts
    const conflict = await prisma.spaceReservation.findFirst({
      where: {
        spaceId,
        date: new Date(date),
        OR: [
          {
            startTime: { lt: new Date(`1970-01-01T${endTime}:00Z`) },
            endTime: { gt: new Date(`1970-01-01T${startTime}:00Z`) }
          }
        ]
      }
    });

    if (conflict) {
      return res.status(409).json({ error: 'Conflict', message: 'Space is already reserved during this time.' });
    }

    const reservation = await prisma.spaceReservation.create({
      data: {
        spaceId,
        reservedById,
        date: new Date(date),
        startTime: new Date(`1970-01-01T${startTime}:00Z`),
        endTime: new Date(`1970-01-01T${endTime}:00Z`),
        purpose
      },
      include: {
        space: true
      }
    });

    res.status(201).json({ reservation });
  } catch (error) {
    next(error);
  }
};
