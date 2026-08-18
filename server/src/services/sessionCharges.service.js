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
 * family pays, the same way term tuition works.
 *
 * One charge per class, not one per week. The published rates are per 8-week
 * quarter, but only the first week of each class carries a price and the second
 * quarter is added by hand when it comes (decided 2026-08-15). Nothing here
 * repeats a charge on its own, and nothing should be taught to: a service that
 * "completed the semester" by pricing the October sessions would raise about
 * $32,000 nobody authorised. A $400 event with three students
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
      // Either the meeting has a price for the room, or somebody has been given
      // one individually. The second half matters: pricing a single student on
      // a meeting that costs everyone else nothing is a real case — a make-up
      // lesson for one child inside a class the rest already paid for — and
      // without it that charge would be recorded and then never raised.
      OR: [
        { chargeAmount: { not: null } },
        { chargeOverrides: { some: { amount: { gt: 0 } } } },
      ],
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
      // What individual students pay instead of the meeting's price. Almost
      // always empty; when it isn't, it is because somebody's fee already covers
      // the room — see SessionChargeOverride.
      chargeOverrides: {
        select: {
          studentId: true, amount: true, reason: true,
          createdBy: { select: { fullName: true } },
        },
      },
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
    // Null means the meeting charges the room nothing; individuals may still
    // have been priced on it, and those are the only lines it produces.
    const listPrice = session.chargeAmount == null ? 0 : round2(Number(session.chargeAmount));
    const description = session.chargeNote?.trim() 
      ? `${session.class?.name || 'Class'} - ${session.chargeNote.trim()}`
      : (session.class?.name || 'Session');
    const overrides = new Map((session.chargeOverrides || []).map((o) => [o.studentId, o]));

    for (const enrollment of session.class?.enrollments || []) {
      const student = enrollment.student;
      const key = chargedKey(session.id, student.id);
      const charged = alreadyCharged.has(key);
      if (charged && !includeCharged) continue;

      // A student's own price beats the meeting's. Carried onto the line rather
      // than silently swapped, so the review screen can show what the rest of
      // the roster pays next to what this one does and why.
      const override = overrides.get(student.id);
      const amount = override ? round2(Number(override.amount)) : listPrice;

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
        listPrice,
        overridden: Boolean(override),
        overrideReason: override?.reason || null,
        overrideBy: override?.createdBy?.fullName || null,
        // Three reasons a line can't be raised, kept apart so the screen can
        // say which: already billed, nobody to bill it to, or priced at zero —
        // either because the meeting is free or because this student was
        // exempted. A $0 row on an invoice helps nobody either way.
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
  sessions: 0, students: 0, billable: 0, alreadyCharged: 0, missingFamily: 0,
  overridden: 0, waived: 0, total: 0,
});

const summarise = (lines) => {
  const billable = lines.filter(isBillable);
  const overridden = lines.filter((l) => l.overridden);
  return {
    sessions: new Set(lines.map((l) => l.sessionId)).size,
    students: new Set(lines.map((l) => l.studentId)).size,
    billable: billable.length,
    alreadyCharged: lines.filter((l) => l.alreadyCharged).length,
    missingFamily: lines.filter((l) => l.missingFamily).length,
    // Priced differently for one student, and how much of that is money given
    // up. Reported so a total that looks low has a visible reason on the same
    // screen, rather than an admin wondering where it went.
    //
    // Only reductions count. An override can price somebody *above* the room's
    // rate — a make-up lesson on a meeting that charges the class nothing is
    // the ordinary case — and letting that subtract would report a discount
    // that never happened, or in the extreme a negative one.
    overridden: overridden.length,
    waived: round2(overridden.reduce((sum, l) => sum + Math.max(0, l.listPrice - l.amount), 0)),
    total: round2(billable.reduce((sum, l) => sum + l.amount, 0)),
  };
};
