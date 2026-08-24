import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const start = new Date('2026-08-21T00:00:00-04:00'); // Eastern (Florida)
const end = new Date('2026-08-22T00:00:00-04:00');

const invoices = await prisma.invoice.findMany({
  where: {
    createdAt: { gte: start, lt: end },
    status: { in: ['SENT', 'PARTIAL'] },
  },
  include: { family: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
});

console.log(`Found ${invoices.length} invoices sent today (Eastern time)`);
for (const inv of invoices) {
  const balance = Number(inv.totalAmount) - Number(inv.amountPaid);
  console.log(`${inv.invoiceNumber}\t${inv.family?.name || '(no family)'}\t$${balance.toFixed(2)} owed\tcreated ${inv.createdAt.toISOString()}\tstripeLink:${inv.stripePaymentLinkId ? 'yes' : 'no'}`);
}
await prisma.$disconnect();
