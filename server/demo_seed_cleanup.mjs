import prisma from './src/config/database.js';
import fs from 'fs';

// Removes exactly the demo rows created by demo_seed.mjs (tracked in
// demo_seed_ids.json) — nothing else. Sessions/enrollments cascade from the
// classes, but we delete them explicitly first to be safe/order-independent.
const idsUrl = new URL('./demo_seed_ids.json', import.meta.url);
if (!fs.existsSync(idsUrl)) {
  console.error('demo_seed_ids.json not found — nothing to clean up.');
  process.exit(1);
}
const ids = JSON.parse(fs.readFileSync(idsUrl, 'utf8'));

const r1 = await prisma.spaceReservation.deleteMany({ where: { id: { in: ids.reservationIds || [] } } });
const r2 = await prisma.timeOffRequest.deleteMany({ where: { id: { in: ids.ptoIds || [] } } });
const r3 = await prisma.session.deleteMany({ where: { id: { in: ids.sessionIds || [] } } });
const r4 = await prisma.classEnrollment.deleteMany({ where: { id: { in: ids.enrollmentIds || [] } } });
const r5 = await prisma.class.deleteMany({ where: { id: { in: ids.classIds || [] } } });

console.log('Demo data removed:', {
  reservations: r1.count, pto: r2.count, sessions: r3.count, enrollments: r4.count, classes: r5.count,
});
fs.unlinkSync(idsUrl);
process.exit(0);
