import prisma from './src/config/database.js';

// Marker embedded in createdAt-adjacent data so cleanup is precise. We record
// every id we create into demo_seed_ids.json and delete exactly those later.
const T = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);
const D = (iso) => new Date(`${iso}T00:00:00Z`);

const created = { classIds: [], sessionIds: [], enrollmentIds: [], ptoIds: [], reservationIds: [] };

const teachers = await prisma.user.findMany({ where: { role: 'TEACHER' }, select: { id: true, fullName: true } });
const students = await prisma.user.findMany({ where: { role: 'STUDENT' }, select: { id: true }, take: 8 });
const spaces = await prisma.sharedSpace.findMany({ select: { id: true, name: true } });
const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });

if (teachers.length < 1) { console.error('No teachers found'); process.exit(1); }
const brown = teachers.find(t => /brown/i.test(t.fullName)) || teachers[0];
const jenkins = teachers.find(t => /jenkins/i.test(t.fullName)) || teachers[teachers.length - 1];

// ── Classes (this week, July 12–18 2026). subject uses the color keywords the
//    frontend maps on (math/science/languages/arts). ──────────────────────
const classDefs = [
  { name: 'Math Foundations — Group A', subject: 'math',      teacherId: brown.id,   type: 'IN_PERSON' },
  { name: 'Spanish Immersion',          subject: 'languages', teacherId: jenkins.id, type: 'IN_PERSON' },
  { name: 'Science Lab',                subject: 'science',   teacherId: brown.id,   type: 'IN_PERSON' },
  { name: 'Art Studio',                 subject: 'arts',      teacherId: jenkins.id, type: 'IN_PERSON' },
  { name: 'Zoom Algebra Tutoring',      subject: 'math',      teacherId: brown.id,   type: 'VIRTUAL'   },
  { name: 'Reading Group',              subject: 'languages', teacherId: jenkins.id, type: 'IN_PERSON' },
  { name: 'Homeschool Pod',             subject: 'science',   teacherId: brown.id,   type: 'IN_PERSON' },
  { name: 'PERT Prep',                  subject: 'math',      teacherId: jenkins.id, type: 'IN_PERSON' },
];

const cls = {};
for (const def of classDefs) {
  const c = await prisma.class.create({ data: { ...def, maxStudents: 12, status: 'active' } });
  created.classIds.push(c.id);
  cls[def.name] = c.id;
  // enroll a few students so the "N students" counts render
  const pick = students.slice(0, 2 + Math.floor(Math.random() * 4));
  for (const s of pick) {
    const e = await prisma.classEnrollment.create({ data: { classId: c.id, studentId: s.id } }).catch(() => null);
    if (e) created.enrollmentIds.push(e.id);
  }
}

// ── Sessions — a full week, with Thursday Jul 16 deliberately busy ──────────
const sessionDefs = [
  // Mon Jul 13
  ['Math Foundations — Group A', '2026-07-13', '16:00', '17:30'],
  ['Spanish Immersion',          '2026-07-13', '13:00', '14:00'],
  // Tue Jul 14
  ['Science Lab',                '2026-07-14', '10:00', '11:00'],
  ['Zoom Algebra Tutoring',      '2026-07-14', '14:00', '15:00'],
  // Wed Jul 15
  ['Homeschool Pod',             '2026-07-15', '09:00', '12:00'],
  ['Reading Group',              '2026-07-15', '13:00', '14:00'],
  // Thu Jul 16 (the day the user was looking at — make it busy)
  ['Reading Group',              '2026-07-16', '10:30', '11:30'],
  ['Zoom Algebra Tutoring',      '2026-07-16', '13:00', '14:00'],
  ['Math Foundations — Group A', '2026-07-16', '13:00', '14:00'],
  ['Art Studio',                 '2026-07-16', '15:00', '16:00'],
  ['Science Lab',                '2026-07-16', '16:00', '17:00'],
  // Fri Jul 17
  ['PERT Prep',                  '2026-07-17', '13:00', '14:00'],
  ['Art Studio',                 '2026-07-17', '15:00', '16:00'],
];

for (const [name, date, start, end] of sessionDefs) {
  const s = await prisma.session.create({
    data: { classId: cls[name], date: D(date), startTime: T(start), endTime: T(end), status: 'SCHEDULED' },
  });
  created.sessionIds.push(s.id);
}

// ── PTO: Jenkins out Friday Jul 17 (Vacation) ──────────────────────────────
const pto = await prisma.timeOffRequest.create({
  data: { teacherId: jenkins.id, type: 'PTO', date: D('2026-07-17'), status: 'APPROVED', reason: 'Family trip' },
});
created.ptoIds.push(pto.id);

// ── Meeting: Staff Meeting Thursday Jul 16 12:00–13:00 in the first space ───
if (spaces.length && admin) {
  const r = await prisma.spaceReservation.create({
    data: {
      spaceId: spaces[0].id,
      userId: admin.id,
      startTime: new Date('2026-07-16T12:00:00Z'),
      endTime: new Date('2026-07-16T13:00:00Z'),
      purpose: 'All-Staff Meeting',
    },
  });
  created.reservationIds.push(r.id);
}

const fs = await import('fs');
fs.writeFileSync(new URL('./demo_seed_ids.json', import.meta.url), JSON.stringify(created, null, 2));
console.log('Demo data created:', {
  classes: created.classIds.length,
  sessions: created.sessionIds.length,
  enrollments: created.enrollmentIds.length,
  pto: created.ptoIds.length,
  reservations: created.reservationIds.length,
});
process.exit(0);
