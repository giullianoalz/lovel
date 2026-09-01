/**
 * Quarterly tuition.
 *
 * ⚠️ NOT THE LIVE BILLING PATH — and running it would double-bill.
 *
 * The academy charges families from the calendar instead: a price typed onto the
 * first week of each class, which charges it as soon as it is saved. Confirmed
 * by the admin on 2026-08-15 ("yo solo uso el flujo del calendario"). See
 * sessionCharges.service.js.
 *
 * Both systems price the same classes and neither knows about the other. The
 * term carries regularRate $400 and the electives their $130 priceOverride, and
 * those same amounts now sit on Session.chargeAmount for the first week of each
 * class. The unique indexes that make each run safe to repeat are different —
 * (studentId, termId, quarter) here versus (studentId, sessionId) there — so the
 * database will NOT stop a family being charged once by each. It only stops each
 * system charging twice by itself.
 *
 * Everything below still works and is left in place in case the term-based route
 * is ever picked back up. It simply is not executed today.
 *
 * A term is billed in two quarters at the same rate, so the charges are raised
 * twice. The amount is read off the roster *as it stands when the run happens*
 * rather than off what the family originally registered for — that is the whole
 * point: a student who only attends the first eight weeks, or who moves to a
 * different cove mid-term, is billed for what they are actually enrolled in.
 *
 * Nothing here writes. `buildQuarterCharges` is the preview an admin approves;
 * the controller is what turns approved lines into Transactions.
 */

import prisma from '../config/database.js';

const IXL_PRICES = { NONE: 0, CORE: 5, CORE_SPANISH: 10 };
const ELECTIVE_PRICE_DEFAULT = 130;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Works out what each enrolled student owes for one quarter of a term.
 *
 * @param {string} termId
 * @param {number} quarter — 1 or 2
 * @param {boolean} creditDeposit — subtract the deposit already paid at
 *        registration from the first quarter. Defaults on: registration now
 *        only charges the 15% deposit (invoiced immediately), so Q1 must
 *        credit it back or the family would be billed for it twice. Still an
 *        override, not hardcoded, so an operator can turn it off for a term
 *        billed the old way (deposit rolled into a single 100% charge).
 */
export const buildQuarterCharges = async (termId, quarter, { creditDeposit = true } = {}) => {
  const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

  // Every active enrolment in a class belonging to this term. A student sitting
  // in two of them (a cove plus Biology, say) pays for both, so these are summed
  // per student rather than deduplicated.
  const enrollments = await prisma.classEnrollment.findMany({
    where: { status: 'active', class: { termId } },
    include: {
      class: { select: { id: true, name: true, groupType: true, priceOverride: true } },
      student: {
        select: {
          id: true,
          fullName: true,
          familyMembers: { select: { familyId: true }, take: 1 },
        },
      },
    },
  });

  // Electives and the IXL plan aren't part of an enrolment — they're chosen once
  // on the registration request — so they're looked up per student and carried
  // into both quarters.
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
  const requests = studentIds.length
    ? await prisma.registrationRequest.findMany({
        where: { termId, studentId: { in: studentIds } },
        select: {
          studentId: true,
          ixlPlan: true,
          depositAmount: true,
          electiveChoices: { select: { elective: { select: { name: true, price: true } } } },
        },
      })
    : [];
  const requestByStudent = new Map(requests.map((r) => [r.studentId, r]));

  // Anything this run already raised, so a re-run reports "already charged"
  // instead of looking like it silently skipped someone.
  const existing = studentIds.length
    ? await prisma.transaction.findMany({
        where: { termId, quarter, studentId: { in: studentIds } },
        select: { studentId: true, amount: true },
      })
    : [];
  const chargedByStudent = new Map(existing.map((t) => [t.studentId, Number(t.amount)]));

  const termRate = (groupType) =>
    Number(groupType === 'ANCHORED' ? term.anchoredRate : term.regularRate) || 0;

  const byStudent = new Map();
  for (const e of enrollments) {
    const entry = byStudent.get(e.studentId) || {
      studentId: e.studentId,
      studentName: e.student.fullName,
      familyId: e.student.familyMembers[0]?.familyId || null,
      classes: [],
      classesTotal: 0,
    };
    // A class carrying its own price uses it; 0 is a real price, not "unset".
    const price = e.class.priceOverride === null || e.class.priceOverride === undefined
      ? termRate(e.class.groupType)
      : Number(e.class.priceOverride) || 0;
    entry.classes.push({ name: e.class.name, price });
    entry.classesTotal = round2(entry.classesTotal + price);
    byStudent.set(e.studentId, entry);
  }

  const lines = [...byStudent.values()].map((entry) => {
    const req = requestByStudent.get(entry.studentId);
    const electives = (req?.electiveChoices || []).map((c) => ({
      name: c.elective.name,
      price: c.elective.price != null ? Number(c.elective.price) : ELECTIVE_PRICE_DEFAULT,
    }));
    const electivesTotal = round2(electives.reduce((s, x) => s + x.price, 0));
    const ixlTotal = IXL_PRICES[req?.ixlPlan] ?? 0;

    const gross = round2(entry.classesTotal + electivesTotal + ixlTotal);
    const depositCredit = quarter === 1 && creditDeposit && req?.depositAmount
      ? round2(Number(req.depositAmount))
      : 0;
    const amount = round2(Math.max(0, gross - depositCredit));

    return {
      ...entry,
      electives,
      electivesTotal,
      ixlTotal,
      gross,
      depositCredit,
      amount,
      // Two reasons a line can't be raised, kept apart so the UI can explain
      // which: already billed, or nobody to bill it to.
      alreadyCharged: chargedByStudent.has(entry.studentId),
      chargedAmount: chargedByStudent.get(entry.studentId) ?? null,
      missingFamily: !entry.familyId,
    };
  });

  lines.sort((a, b) => a.studentName.localeCompare(b.studentName));

  const billable = lines.filter((l) => !l.alreadyCharged && !l.missingFamily);
  return {
    term: { id: term.id, name: term.name, quarter2StartsAt: term.quarter2StartsAt },
    quarter,
    creditDeposit,
    lines,
    summary: {
      students: lines.length,
      billable: billable.length,
      alreadyCharged: lines.filter((l) => l.alreadyCharged).length,
      missingFamily: lines.filter((l) => l.missingFamily).length,
      total: round2(billable.reduce((s, l) => s + l.amount, 0)),
    },
  };
};
