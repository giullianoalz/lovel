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
 * THE PRICE IS THE CHARGE (changed 2026-09-01). There used to be a review step:
 * priced meetings collected on a Billing → Calendar Charges sheet and an admin
 * released them by hand. That step is gone — typing a price raises the charge.
 * `buildSessionCharges` still computes the lines and decides which are
 * billable; `raiseSessionCharges` is what commits them, and it runs wherever a
 * price is written (sessions.controller.js, and the per-student override in
 * billing.controller.js) plus a daily sweep that catches what those moments
 * cannot see — chiefly a student enrolled into a class after its priced meeting
 * was already saved and charged.
 *
 * What did NOT change is which lines are billable. A line held back for joining
 * late, for having no family to bill, or for being priced at zero is still held
 * back: removing the review did not remove the rules the review enforced. Held
 * lines are reported to an admin (cron.jobs.js) rather than raised, and the one
 * way to release a late joiner is still a deliberate, named-meeting call —
 * POST /billing/session-charges with includeJoinedLate.
 *
 * Because nobody proofreads the number any more, a price that changes has to
 * carry its charge with it: `raiseSessionCharges` corrects the amount of a
 * charge it already raised instead of leaving a typo on the ledger. It corrects
 * in place — never delete-and-recreate — and it will not touch a charge that
 * has already reached an invoice, which is a credit note, not an edit.
 */

import prisma from '../config/database.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * What each enrolled student would be charged for the priced meetings in a
 * date range.
 *
 * @param {object}   options
 * @param {Date}     options.from - start of the range (inclusive)
 * @param {Date}     options.to   - end of the range (inclusive)
 * @param {string[]} options.sessionIds - just these meetings, whatever their
 *        date. This is what the save path uses: pricing one class should look
 *        at that class, not sweep the calendar.
 * @param {boolean}  options.includeCharged - keep lines already raised, so a
 *        caller can see "already billed" rather than a silently short list.
 *        On by default; `raiseSessionCharges` needs them to spot a charge whose
 *        price has since changed.
 */
export const buildSessionCharges = async ({ from, to, sessionIds, includeCharged = true } = {}) => {
  // An empty list means "these zero meetings", not "every meeting" — the
  // difference between charging nothing and charging the whole calendar.
  if (Array.isArray(sessionIds) && sessionIds.length === 0) {
    return { lines: [], summary: emptySummary() };
  }
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
      ...(Array.isArray(sessionIds) ? { id: { in: sessionIds } } : {}),
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
              // Since when this student has been on the roster. The price sits
              // on the *first week* of a class, so a child added in late August
              // is otherwise billed for meetings that happened before anyone
              // had heard of them — on 2026-08-26 that raised $3,370 across
              // four families, all of it for classes predating their arrival.
              enrolledAt: true,
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
  //
  // The invoice link comes back too: a raised charge can be corrected while it
  // is still loose on the ledger, and must not be once it is on a document a
  // family has been sent.
  const existing = await prisma.transaction.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    select: { id: true, sessionId: true, studentId: true, amount: true, invoiceId: true },
  });
  const chargedKey = (sessionId, studentId) => `${sessionId}:${studentId}`;
  const alreadyCharged = new Map(
    existing.map((t) => [chargedKey(t.sessionId, t.studentId), t])
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
      const existingCharge = alreadyCharged.get(key) || null;
      const charged = Boolean(existingCharge);
      if (charged && !includeCharged) continue;

      // A student's own price beats the meeting's. Carried onto the line rather
      // than silently swapped, so the review screen can show what the rest of
      // the roster pays next to what this one does and why.
      const override = overrides.get(student.id);
      const amount = override ? round2(Number(override.amount)) : listPrice;

      // Enrolled after the meeting had already happened. Compared as plain
      // days, not instants: joining on the morning of a class the family then
      // attended is not late, and the hour of the enrollment row says nothing
      // useful anyway.
      //
      // Flagged rather than dropped, and reversible: `enrolledAt` records when
      // the row was written, so re-adding a student who was always there resets
      // it and makes an honest charge look late. The admin can still raise it
      // deliberately — see generateSessionCharges' includeJoinedLate.
      const enrolledOn = enrollment.enrolledAt ? startOfUtcDay(enrollment.enrolledAt) : null;
      const joinedLate = Boolean(enrolledOn && enrolledOn > startOfUtcDay(session.date));

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
        chargedAmount: existingCharge ? round2(Number(existingCharge.amount)) : null,
        // What the correction path needs: which row to fix, and whether it is
        // still fixable. A charge already on an invoice is left alone.
        chargeId: existingCharge?.id || null,
        chargeInvoiced: Boolean(existingCharge?.invoiceId),
        missingFamily: !student.familyMembers[0]?.familyId,
        zeroAmount: amount <= 0,
        joinedLate,
        enrolledAt: enrolledOn,
      });
    }
  }

  return { lines, summary: summarise(lines) };
};

/** Midnight UTC of whatever day a date falls on. */
const startOfUtcDay = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Whether a preview line is one the commit step will actually raise.
 *
 * `allowJoinedLate` is the deliberate exception: an admin who has looked at a
 * late-looking line and decided it is owed anyway can raise it, one narrowed
 * batch at a time. Nothing else is negotiable — a line with no family to bill
 * or nothing to charge is not a decision, it is a dead end.
 */
export const isBillable = (line, { allowJoinedLate = false } = {}) =>
  !line.alreadyCharged && !line.missingFamily && !line.zeroAmount
  && (allowJoinedLate || !line.joinedLate);

/**
 * Put the priced meetings on the ledger. This is the write.
 *
 * Called wherever a price is decided — saving a session, overriding one
 * student's price — and once a day by the sweep in cron.jobs.js. Safe to run
 * again as often as you like: the unique index on (studentId, sessionId) is
 * what makes a repeat a no-op rather than a second bill.
 *
 * Three things happen, in this order:
 *
 *  1. Billable lines with no charge yet are raised.
 *  2. Charges already raised whose price has since changed are CORRECTED in
 *     place — the amount is updated on the row that exists. Never deleted and
 *     re-created: an invoice line, a payment, or a receipt can be hanging off
 *     that id. This is the safety net that replaced the review screen; without
 *     it a mistyped price would be on a family's balance with no way back
 *     through the calendar.
 *  3. Charges for meetings that stopped pricing anybody — the price was
 *     cleared, the meeting was cancelled, the student left the roster — are
 *     corrected to zero, for the same reason and by the same rule. The row
 *     stays so the history of the correction stays with it. Only done when the
 *     caller names `sessionIds`: it is the save path asking "and what did this
 *     meeting used to charge?", a question the daily sweep cannot ask about
 *     meetings it can no longer see.
 *
 * A charge that has already reached an invoice is never touched by 2 or 3. That
 * document has been sent; the fix for it is a credit note, not a quiet edit.
 * Those are returned in `locked` so the caller can say so out loud.
 *
 * @returns {{created:number, corrected:number, zeroed:number, total:number,
 *            held:object[], locked:object[]}}
 */
export const raiseSessionCharges = async ({
  from, to, sessionIds, allowJoinedLate = false,
} = {}) => {
  const { lines } = await buildSessionCharges({ from, to, sessionIds });

  const fresh = lines.filter((l) => isBillable(l, { allowJoinedLate }));
  // Priced, unbilled, and deliberately not raised. Reported rather than
  // charged — see the file header.
  const held = lines.filter(
    (l) => !l.alreadyCharged && !l.zeroAmount && !isBillable(l, { allowJoinedLate })
  );

  const changed = lines.filter(
    (l) => l.alreadyCharged && l.chargedAmount !== l.amount
  );
  const corrections = changed.filter((l) => !l.chargeInvoiced);
  const locked = changed.filter((l) => l.chargeInvoiced);

  if (fresh.length > 0) {
    await prisma.transaction.createMany({
      data: fresh.map((l) => ({
        studentId: l.studentId,
        familyId: l.familyId,
        amount: l.amount,
        type: 'CHARGE',
        // Carries the student's name onto the charge itself, not just the
        // meeting's name — a sibling pair in the same class raises two
        // otherwise-identical lines, and this is what tells them apart on the
        // invoice a family actually reads.
        description: `${l.description} — ${l.studentName}`,
        date: l.date,
        sessionId: l.sessionId,
      })),
      // Belt and braces alongside the unique index: a concurrent second run
      // skips what it finds rather than failing the whole batch.
      skipDuplicates: true,
    });
  }

  for (const line of corrections) {
    await prisma.transaction.update({
      where: { id: line.chargeId },
      data: { amount: line.amount, description: `${line.description} — ${line.studentName}` },
    });
  }

  const zeroed = sessionIds ? await zeroOrphanedCharges(sessionIds, lines) : [];

  return {
    created: fresh.length,
    corrected: corrections.length,
    zeroed: zeroed.length,
    total: round2(fresh.reduce((sum, l) => sum + l.amount, 0)),
    held,
    locked,
  };
};

/**
 * Charges left behind by a meeting that stopped charging anybody, set to zero.
 *
 * Two ways to get here: the meeting was cancelled, or its price was cleared.
 * Both used to be invisible — the charge was never raised until an admin
 * approved it, so undoing the price before approval undid the charge. Now the
 * charge is already on a family's balance and taking the price off has to take
 * the money off with it.
 *
 * Deliberately keyed on the MEETING, not on the roster. A student who drops the
 * class still owes what was taught before they dropped, and their enrollment
 * row disappearing must never quietly erase a charge — that call belongs to an
 * admin, as a refund or a credit note. Re-pricing an individual is handled the
 * ordinary way instead: their line comes back at the new amount and the
 * correction pass updates it.
 *
 * Zeroed rather than deleted, and invoiced ones left alone — same rule as every
 * other correction here.
 */
const zeroOrphanedCharges = async (sessionIds, lines) => {
  const stillPricing = new Set(lines.filter((l) => l.amount > 0).map((l) => l.sessionId));
  const dead = sessionIds.filter((id) => !stillPricing.has(id));
  if (dead.length === 0) return [];

  const orphans = await prisma.transaction.findMany({
    where: { sessionId: { in: dead }, invoiceId: null, amount: { gt: 0 } },
    select: { id: true },
  });

  for (const orphan of orphans) {
    await prisma.transaction.update({ where: { id: orphan.id }, data: { amount: 0 } });
  }
  return orphans;
};

const emptySummary = () => ({
  sessions: 0, students: 0, billable: 0, alreadyCharged: 0, missingFamily: 0,
  joinedLate: 0, joinedLateTotal: 0, overridden: 0, waived: 0, total: 0,
});

const summarise = (lines) => {
  const billable = lines.filter((l) => isBillable(l));
  const overridden = lines.filter((l) => l.overridden);
  // Held back because the student joined after the meeting. Reported with its
  // money so the screen can say what is being *not* charged and why — silence
  // here would look like the sweep had quietly missed somebody.
  const late = lines.filter((l) => l.joinedLate && !l.alreadyCharged && !l.missingFamily && !l.zeroAmount);
  return {
    sessions: new Set(lines.map((l) => l.sessionId)).size,
    students: new Set(lines.map((l) => l.studentId)).size,
    billable: billable.length,
    alreadyCharged: lines.filter((l) => l.alreadyCharged).length,
    missingFamily: lines.filter((l) => l.missingFamily).length,
    joinedLate: late.length,
    joinedLateTotal: round2(late.reduce((sum, l) => sum + l.amount, 0)),
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
