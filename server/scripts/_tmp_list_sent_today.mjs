import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const start = new Date('2026-08-21T00:00:00-04:00'); // Eastern (Florida)
const end = new Date('2026-08-22T00:00:00-04:00');

const notifs = await prisma.notification.findMany({
  where: {
    type: 'NEW_INVOICE',
    referenceType: 'invoice',
    createdAt: { gte: start, lt: end },
  },
  orderBy: { createdAt: 'asc' },
});

console.log(`Found ${notifs.length} NEW_INVOICE notifications today (Eastern time) — one per (invoice, recipient) sent`);

const invoiceIds = [...new Set(notifs.map(n => n.referenceId))];
const invoices = await prisma.invoice.findMany({
  where: { id: { in: invoiceIds } },
  include: { family: { select: { name: true } } },
});
const byId = Object.fromEntries(invoices.map(i => [i.id, i]));

for (const id of invoiceIds) {
  const inv = byId[id];
  if (!inv) { console.log(`${id}\t(invoice not found)`); continue; }
  const balance = Number(inv.totalAmount) - Number(inv.amountPaid);
  console.log(`${inv.invoiceNumber}\t${inv.family?.name || '(no family)'}\t$${balance.toFixed(2)} owed\tstatus:${inv.status}\tstripeLink:${inv.stripePaymentLinkId ? 'yes' : 'no'}`);
}
await prisma.$disconnect();
