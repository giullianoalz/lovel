/**
 * One-off: weekly payroll summary (Mon-Sun), CSV output.
 *
 * The app's payroll screen (payroll.service.js) is month-scoped. Payroll is
 * actually settled weekly, so this re-uses its rate cascade and its rules about
 * what counts as worked, scoping the query to a Monday-Sunday range instead. It
 * reports what is payable and, separately, the hours somebody struck off — so
 * nothing gets settled without the deductions being visible next to it.
 *
 * Usage: node scripts/weekly-payroll-summary.mjs [YYYY-MM-DD monday]
 * Defaults to the current week if no date is given.
 */
import prisma from '../src/config/database.js';
import {
  loadPayCategories, sessionCategory, shiftCategory, sessionHours, resolveRate,
  paidSessionsWhere, absentSessionsWhere, isShiftPayable,
} from '../src/services/payroll.service.js';
import { CANCELLATION_WINDOW_HOURS } from '../src/constants/cancellationPolicy.js';
import fs from 'node:fs';

const round2 = (n) => Math.round(n * 100) / 100;
const toNumber = (v) => (v == null ? null : parseFloat(v));

const rateContextFor = (person, categories) => ({
  hourlyRate: toNumber(person.hourlyRate),
  flatRateOnly: Boolean(person.flatRateOnly),
  salaried: person.baseSalary != null,
  overrides: new Map((person.payRates || []).map((r) => [r.category, parseFloat(r.hourlyRate)])),
  categories,
});

function mondayOf(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

const argDate = process.argv[2];
const startDate = mondayOf(argDate);
const endDate = new Date(startDate);
endDate.setUTCDate(startDate.getUTCDate() + 6);
endDate.setUTCHours(23, 59, 59, 999);
const fmt = (d) => d.toISOString().slice(0, 10);

console.log(`Weekly payroll summary: ${fmt(startDate)} to ${fmt(endDate)}`);

// The rules themselves live in payroll.service.js and are imported, never
// restated: this script exists to reformat the week, not to have an opinion
// about what counts as worked. When the rule changed to "the hour has passed",
// the copy that used to live here would have gone on paying by the old one.
const paidSessions = paidSessionsWhere(startDate, endDate);
const absentSessions = absentSessionsWhere(startDate, endDate);

const PAID_SESSION_SELECT = {
  id: true, date: true, startTime: true, endTime: true, status: true,
  meetingUrl: true, payCategoryKey: true, payRateOverride: true,
  paidRate: true, paidRateSource: true,
  attendance: { where: { status: 'PRESENT' }, select: { id: true } },
  cancellations: { where: { hoursBeforeClass: { lt: CANCELLATION_WINDOW_HOURS } }, select: { id: true } },
};

const [categoryList, staff, absences] = await Promise.all([
  loadPayCategories(),
  prisma.user.findMany({
    where: {
      OR: [
        { role: 'TEACHER' }, { secondaryRoles: { has: 'TEACHER' } },
        { role: 'RECEPTIONIST' }, { secondaryRoles: { has: 'RECEPTIONIST' } },
        { taughtClasses: { some: { sessions: { some: paidSessions } } } },
        { coTaughtClasses: { some: { sessions: { some: paidSessions } } } },
        { baseSalary: { not: null } }, { hourlyRate: { not: null } },
        { workShifts: { some: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } } } },
        { taughtClasses: { some: { sessions: { some: absentSessions } } } },
        { coTaughtClasses: { some: { sessions: { some: absentSessions } } } },
      ],
    },
    orderBy: { fullName: 'asc' },
    select: {
      id: true, fullName: true, role: true, secondaryRoles: true,
      baseSalary: true, salaryPeriod: true, hourlyRate: true, flatRateOnly: true,
      payRates: { select: { category: true, hourlyRate: true } },
      taughtClasses: { select: { id: true, name: true, type: true, meetingUrl: true, sessions: { where: paidSessions, select: PAID_SESSION_SELECT } } },
      coTaughtClasses: { select: { id: true, name: true, type: true, meetingUrl: true, sessions: { where: paidSessions, select: PAID_SESSION_SELECT } } },
      workShifts: {
        where: { date: { gte: startDate, lte: endDate } },
        select: {
          id: true, date: true, startTime: true, endTime: true, title: true, status: true,
          payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
          absentAt: true, absentReason: true, absentBy: { select: { fullName: true } },
        },
      },
    },
  }),
  prisma.session.findMany({
    where: absentSessions,
    select: {
      id: true, date: true, startTime: true, endTime: true,
      absentReason: true, absentBy: { select: { fullName: true } },
      class: { select: { name: true, teacherId: true, coTeachers: { select: { id: true } } } },
    },
    orderBy: { date: 'asc' },
  }),
]);

const categories = new Map(categoryList.map((c) => [c.key, c]));

const absencesByPerson = new Map();
for (const s of absences) {
  const entry = {
    date: fmt(new Date(s.date)),
    title: s.class?.name || 'Session',
    hours: round2(sessionHours(s)),
    reason: `Marked absent${s.absentBy?.fullName ? ` by ${s.absentBy.fullName}` : ''}${s.absentReason ? ` — ${s.absentReason}` : ''}`,
  };
  const owners = [s.class?.teacherId, ...(s.class?.coTeachers || []).map((t) => t.id)];
  for (const id of owners) {
    if (!id) continue;
    if (!absencesByPerson.has(id)) absencesByPerson.set(id, []);
    absencesByPerson.get(id).push(entry);
  }
}

const rows = [];
for (const person of staff) {
  const context = rateContextFor(person, categories);
  const lines = [];
  for (const cls of [...person.taughtClasses, ...person.coTaughtClasses]) {
    for (const s of cls.sessions) {
      const hours = sessionHours(s);
      const frozen = s.paidRate != null;
      const { rate, source } = frozen
        ? { rate: toNumber(s.paidRate), source: s.paidRateSource || 'frozen' }
        : resolveRate(sessionCategory(s, cls), context, toNumber(s.payRateOverride));
      lines.push({ kind: 'class', date: fmt(new Date(s.date)), title: cls.name, hours: round2(hours), rate, amount: round2(hours * rate) });
    }
  }

  const workedShifts = person.workShifts.filter((sh) => isShiftPayable(sh));
  const absentShifts = person.workShifts.filter((sh) => sh.absentAt);
  for (const shift of workedShifts) {
    const hours = sessionHours(shift);
    const frozen = shift.paidRate != null;
    const { rate, source } = frozen
      ? { rate: toNumber(shift.paidRate), source: shift.paidRateSource || 'frozen' }
      : resolveRate(shiftCategory(shift), context, toNumber(shift.payRateOverride));
    lines.push({ kind: 'shift', date: fmt(new Date(shift.date)), title: shift.title || 'Shift', hours: round2(hours), rate, amount: round2(hours * rate) });
  }

  // Not "pending" any more — nothing waits on a human to be paid. What is left
  // is what somebody deliberately struck off, which is worth its own section
  // precisely because the person losing the hours never sees it happen.
  const pendingList = [
    ...(absencesByPerson.get(person.id) || []),
    ...absentShifts.map((sh) => ({
      date: fmt(new Date(sh.date)),
      title: sh.title || 'Shift',
      hours: round2(sessionHours(sh)),
      reason: `Marked absent${sh.absentBy?.fullName ? ` by ${sh.absentBy.fullName}` : ''}${sh.absentReason ? ` — ${sh.absentReason}` : ''}`,
    })),
  ];

  const totalHours = round2(lines.reduce((n, l) => n + l.hours, 0));
  const totalAmount = round2(lines.reduce((n, l) => n + l.amount, 0));
  const pendingHours = round2(pendingList.reduce((n, p) => n + p.hours, 0));

  if (lines.length === 0 && pendingList.length === 0) continue;

  rows.push({
    person: person.fullName,
    role: [person.role, ...(person.secondaryRoles || [])].join('/'),
    lines,
    totalHours,
    totalAmount,
    pendingList,
    pendingHours,
  });
}

// --- CSV output ---
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rowsOut = [];
rowsOut.push(['Weekly Payroll Summary', `${fmt(startDate)} to ${fmt(endDate)}`]);
rowsOut.push([]);
rowsOut.push(['TO BE PAID THIS WEEK']);
rowsOut.push(['Staff', 'Role', 'Date', 'Item', 'Hours', 'Rate', 'Amount']);
for (const r of rows) {
  if (r.lines.length === 0) continue;
  for (const l of r.lines) {
    rowsOut.push([r.person, r.role, l.date, l.title, l.hours, l.rate, l.amount]);
  }
  rowsOut.push([r.person, '', '', 'TOTAL', r.totalHours, '', r.totalAmount]);
  rowsOut.push([]);
}
const grandHours = round2(rows.reduce((n, r) => n + r.totalHours, 0));
const grandAmount = round2(rows.reduce((n, r) => n + r.totalAmount, 0));
rowsOut.push(['GRAND TOTAL', '', '', '', grandHours, '', grandAmount]);
rowsOut.push([]);
rowsOut.push(['STRUCK OFF — HOURS ON THE CALENDAR THAT ARE NOT BEING PAID']);
rowsOut.push(['Staff', 'Role', 'Date', 'Item', 'Hours', 'Reason']);
let anyPending = false;
for (const r of rows) {
  if (r.pendingList.length === 0) continue;
  anyPending = true;
  for (const p of r.pendingList) {
    rowsOut.push([r.person, r.role, p.date, p.title, p.hours, p.reason]);
  }
  rowsOut.push([r.person, '', '', 'UNPAID SUBTOTAL', r.pendingHours, '']);
  rowsOut.push([]);
}
if (!anyPending) rowsOut.push(['(nothing struck off — every hour on the calendar this week is being paid)']);

const csv = rowsOut.map((row) => row.map(esc).join(',')).join('\n');
const outPath = `weekly-payroll-${fmt(startDate)}.csv`;
fs.writeFileSync(outPath, csv);
console.log(`Written: ${outPath}`);
console.log(`Grand total: ${grandHours}h / $${grandAmount}`);

await prisma.$disconnect();
