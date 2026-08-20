import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const classes = await prisma.class.findMany({
  include: {
    enrollments: { where: { status: 'active' }, select: { student: { select: { fullName: true } } } },
    sessions: { where: { chargeAmount: { not: null } }, orderBy: { date: 'asc' }, include: {
      chargeOverrides: { include: { student: { select: { fullName: true } } } },
      charges: true,
    } },
  },
});

const rows = [];
for (const c of classes) {
  for (const s of c.sessions) {
    const base = Number(s.chargeAmount);
    const ov = new Map(s.chargeOverrides.map((o) => [o.student.fullName, Number(o.amount)]));
    const total = c.enrollments.reduce((a, e) => a + (ov.has(e.student.fullName) ? ov.get(e.student.fullName) : base), 0);
    const raised = s.charges.reduce((a, t) => a + Number(t.amount), 0);
    rows.push({
      day: DAY[s.date.getUTCDay()], date: s.date.toISOString().slice(0, 10),
      cls: c.name, grp: c.groupType, base, total, raised, pending: s.charges.length === 0,
      kind: base >= 400 ? 'cove' : 'electiva',
    });
  }
}

for (const kind of ['cove', 'electiva']) {
  console.log('\n########## ' + kind.toUpperCase() + 'S ##########');
  const byDay = {};
  for (const r of rows.filter((x) => x.kind === kind)) (byDay[r.day] = byDay[r.day] || []).push(r);
  let g = 0;
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    if (!byDay[d]) continue;
    let sub = 0;
    console.log('\n' + d + ':');
    for (const r of byDay[d].sort((a, b) => a.cls.localeCompare(b.cls))) {
      sub += r.total;
      console.log('   ' + r.cls.padEnd(34) + ' $' + String(r.total).padEnd(6) + (r.pending ? '  PENDIENTE DE APROBAR' : '  facturado $' + r.raised + (r.raised !== r.total ? '   <-- no coincide' : '')));
    }
    console.log('   ' + '-'.repeat(34) + ' $' + sub);
    g += sub;
  }
  console.log('\n  TOTAL ' + kind + 's: $' + g);
}
await prisma.$disconnect();
