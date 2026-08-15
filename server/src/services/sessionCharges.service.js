/**
 * Charging for one meeting on the calendar.
 *
 * This is how the academy bills — the only live path (confirmed by the admin on
 * 2026-08-15). A price is typed onto the calendar entry and every family
 * enrolled in it owes that amount. In practice the price goes on the *first
 * week* of a class, which is the habit this was built around: "I put the very
 * first week of that class, I put the price."
 *
 * The term-based quarterly run in quarterlyBilling.service.js prices the same
 * classes and is deliberately not executed — running both charges every family
 * twice, and no database constraint spans the two. Read that file's header
 * before touching either.
 *
 * Per enrolled student at full price, not split: the price typed is what one
 * family pays, the same way term tuition works. A $400 event with three students
 * raises three $400 charges.
 *
 * Nothing here writes. `buildSessionCharges` is the sheet an admin checks;
 * billing.controller.js is what turns approved lines into Transactions. That
 * split is deliberate and matches the quarterly run — money that goes out to
 * real families is reviewed before it is committed, never as a side effect of
 * typing in a calendar.
 */

import prisma from '../config/database.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * What each enrolled student would be charged for the priced meetings in a
 * date range.
 *
 * @param {object}  options
 * @param {Date}    options.from  - start of the range (inclusive)
 * @param {Date}    options.to    - end of the range (inclusive)
 * @param {boolean} options.includeCharged - keep lines already raised, so the
 *        screen can show "already billed" rather than looking like it silently
 *        skipped somebody. On by default for the same reason the quarterly
 *        preview lists them.
 */
export const buildSessionCharges = async ({ from, to, includeCharged = true } = {}) => {
  // A cancelled meeting bills nothing: the price says what the hour costs, not
  // that it is owed regardless of whether it happened. An absent teacher is
  // deliberately NOT excluded here — that is a question about who gets paid,
  // and a class the academy still ran with a substitute is still owed.
  const sessions = await prisma.session.findMany({
    where: {
      chargeAmount: { not: null },
      status: { not: 'CANCELLED' },
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      chargeAmount: true,
      chargeNote: true,
      class: {
        select: {
          id: true,
          name: true,
          // The roster as it stands now, not as it stood when the price was
          // typed: a student who left before the meeting should not be billed
          // for it, and one who joined in time should.
          enrollments: {
            where: { status: 'active' },
            select: {
              student: {
                select: {
                  id: true,
                  fullName: true,
                  familyMembers: { select: { familyId: true }, take: 1 },
                },
              },
            },
          },
        },
      },
    },
  });

  if (sessions.length === 0) {
    return { lines: [], summary: emptySummary() };
  }

  // Everything these meetings have already raised, in one query rather than one
  // per session. Keyed by session+student because that pair is exactly what the
  // unique index protects.
  const existing = await prisma.transaction.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    select: { sessionId: true, studentId: true, amount: true },
  });
  const chargedKey = (sessionId, studentId) => `${sessionId}:${studentId}`;
  const alreadyCharged = new Map(
    existing.map((t) => [chargedKey(t.sessionId, t.studentId), Number(t.amount)])
  );

  const lines = [];
  for (const session of sessions) {
    const amount = round2(Number(session.chargeAmount) || 0);
    const description = session.chargeNote?.trim() || session.class?.name || 'Session';

    for (const enrollment of session.class?.enrollments || []) {
      const student = enrollment.student;
      const key = chargedKey(session.id, student.id);
      const charged = alreadyCharged.has(key);
      if (charged && !includeCharged) continue;

      lines.push({
        sessionId: session.id,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        className: session.class?.name || 'Class',
        description,
        studentId: student.id,
        studentName: student.fullName,
        familyId: student.familyMembers[0]?.familyId || null,
        amount,
        // Three reasons a line can't be raised, kept apart so the screen can
        // say which: already billed, nobody to bill it to, or a price of zero
        // that would put a $0 row on somebody's invoice for no reason.
        alreadyCharged: charged,
        chargedAmount: alreadyCharged.get(key) ?? null,
        missingFamily: !student.familyMembers[0]?.familyId,
        zeroAmount: amount <= 0,
      });
    }
  }

  return { lines, summary: summarise(lines) };
};

/** Whether a preview line is one the commit step will actually raise. */
export const isBillable = (line) =>
  !line.alreadyCharged && !line.missingFamily && !line.zeroAmount;

const emptySummary = () => ({
  sessions: 0, students: 0, billable: 0, alreadyCharged: 0, missingFamily: 0, total: 0,
});

const summarise = (lines) => {
  const billable = lines.filter(isBillable);
  return {
    sessions: new Set(lines.map((l) => l.sessionId)).size,
    students: new Set(lines.map((l) => l.studentId)).size,
    billable: billable.length,
    alreadyCharged: lines.filter((l) => l.alreadyCharged).length,
    missingFamily: lines.filter((l) => l.missingFamily).length,
    total: round2(billable.reduce((sum, l) => sum + l.amount, 0)),
  };
};
