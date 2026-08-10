import crypto from 'crypto';
import prisma from '../config/database.js';
import { hasRole, isFrontDeskOnly } from '../utils/roles.js';
import { loadPayCategories } from '../services/payroll.service.js';

export const getCalendarData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { from, to, showPTO, showSharedSpaces, orgWide } = req.query;

    const fromDate = from ? new Date(from) : new Date(new Date().setHours(0,0,0,0));
    const toDate = to ? new Date(to) : new Date(new Date().setDate(new Date().getDate() + 30));

    // `orgWide` powers the shared read-only calendar grid (Month/Week views),
    // where front desk/admins need to see everyone's time off at a glance.
    // It's never used by the self-service "My PTO" panel, which always omits it
    // and stays scoped to the caller only.
    //
    // Teachers are deliberately excluded, the same way sessionScope excludes
    // them from each other's classes: another teacher's sick days and vacation
    // are their schedule, and nothing a colleague needs. A teacher who also
    // covers reception is still a teacher, so the front-desk hat doesn't
    // reopen it.
    const canSeeOrgWide = hasRole(req.user, 'ADMIN') || isFrontDeskOnly(req.user);
    const isOrgWide = orgWide === 'true' && canSeeOrgWide;

    let sessions = [];
    let ptoRequests = [];
    let spaceReservations = [];
    let workShifts = [];

    // Get Teacher's Sessions
    sessions = await prisma.session.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        class: {
          OR: [
            { teacherId: userId },
            { coTeachers: { some: { id: userId } } }
          ]
        }
      },
      include: {
        class: { 
          select: { 
            id: true, name: true, subject: true, type: true, teacherId: true,
            teacher: { select: { id: true, fullName: true } },
            coTeachers: { select: { id: true, fullName: true } }
          } 
        }
      }
    });

    // Paid hours that aren't a class — reception, planning, a staff meeting.
    // Scoped exactly like sessions: your own, unless you're one of the people
    // who builds the rota, who need to see everyone's.
    const shiftWhere = {
      date: { gte: fromDate, lte: toDate },
      status: { not: 'CANCELLED' },
      ...(isOrgWide ? {} : { staffId: userId }),
    };
    const [shiftRows, payCategories] = await Promise.all([
      prisma.workShift.findMany({
        where: shiftWhere,
        include: { staff: { select: { id: true, fullName: true, avatarUrl: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
      loadPayCategories(),
    ]);
    const categoryByKey = new Map(payCategories.map((c) => [c.key, c]));

    // What a colleague earns is not on anybody else's calendar: the block shows
    // who and what kind of work, and the rate only for admins and its owner.
    const canSeePay = hasRole(req.user, 'ADMIN');
    workShifts = shiftRows.map((s) => {
      const decorated = {
        ...s,
        categoryLabel: categoryByKey.get(s.payCategoryKey)?.label || null,
        categoryColor: categoryByKey.get(s.payCategoryKey)?.color || null,
      };
      return canSeePay || s.staffId === userId
        ? decorated
        : { ...decorated, payRateOverride: null, notes: null };
    });

    // Get PTO if requested
    if (showPTO === 'true') {
      ptoRequests = await prisma.timeOffRequest.findMany({
        where: {
          ...(isOrgWide ? {} : { teacherId: userId }),
          date: { gte: fromDate, lte: toDate }
        },
        ...(isOrgWide ? { include: { teacher: { select: { id: true, fullName: true } } } } : {}),
      });
    }

    // Get Shared Spaces if requested
    if (showSharedSpaces === 'true') {
      spaceReservations = await prisma.spaceReservation.findMany({
        where: {
          startTime: { gte: fromDate, lte: toDate }
        },
        include: {
          space: true,
          user: { select: { id: true, fullName: true } }
        }
      });

      // Everyone needs to see *that* a room is taken, or they'd book on top of
      // each other. Only the people allowed the org-wide view get to see whose
      // booking it is and what for — to a teacher, someone else's reservation
      // is just a busy room.
      if (!canSeeOrgWide) {
        spaceReservations = spaceReservations.map((r) =>
          r.userId === userId ? r : { ...r, purpose: null, user: null }
        );
      }
    }

    res.json({
      sessions,
      ptoRequests,
      spaceReservations,
      workShifts
    });
  } catch (error) {
    next(error);
  }
};

export const requestPTO = async (req, res, next) => {
  try {
    const { type, date, startDate, endDate, reason } = req.body;
    const teacherId = req.user.id;

    const rangeStart = startDate || date;
    const rangeEnd = endDate || date;

    if (!type || !rangeStart || !rangeEnd) {
      return res.status(400).json({ error: 'Validation Error', message: 'type and date (or startDate/endDate) are required' });
    }

    const start = new Date(rangeStart);
    const end = new Date(rangeEnd);

    if (end < start) {
      return res.status(400).json({ error: 'Validation Error', message: 'endDate must be on or after startDate' });
    }

    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    const groupId = dates.length > 1 ? crypto.randomUUID() : null;

    const requests = await prisma.$transaction(
      dates.map(d => prisma.timeOffRequest.create({
        data: {
          teacherId,
          type,
          date: d,
          groupId,
          reason: reason || null,
          status: 'PENDING'
        }
      }))
    );

    res.status(201).json({ requests, request: requests[0] });
  } catch (error) {
    next(error);
  }
};

export const cancelPTO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;

    const existing = await prisma.timeOffRequest.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== teacherId) {
      return res.status(404).json({ error: 'Not Found' });
    }
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Validation Error', message: 'Only pending requests can be cancelled.' });
    }

    if (existing.groupId) {
      await prisma.timeOffRequest.deleteMany({ where: { groupId: existing.groupId, teacherId, status: 'PENDING' } });
    } else {
      await prisma.timeOffRequest.delete({ where: { id } });
    }

    res.json({ success: true });
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
    const userId = req.user.id;

    if (!spaceId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Validation Error', message: 'Missing required fields' });
    }

    const startDt = new Date(`${date}T${startTime}:00Z`);
    const endDt = new Date(`${date}T${endTime}:00Z`);

    const conflict = await prisma.spaceReservation.findFirst({
      where: {
        spaceId,
        startTime: { lt: endDt },
        endTime: { gt: startDt }
      }
    });

    if (conflict) {
      return res.status(409).json({ error: 'Conflict', message: 'Space is already reserved during this time.' });
    }

    const reservation = await prisma.spaceReservation.create({
      data: {
        spaceId,
        userId,
        startTime: startDt,
        endTime: endDt,
        purpose: purpose || null
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
