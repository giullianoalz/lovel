import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Finding session charges...');
  const charges = await prisma.transaction.findMany({
    where: { 
      type: 'CHARGE', 
      sessionId: { not: null } 
    },
    include: {
      session: {
        include: {
          class: true
        }
      },
      invoiceLine: true // these are the InvoiceLines connected to this transaction
    }
  });

  console.log(`Found ${charges.length} session charges.`);
  let updatedCount = 0;

  for (const charge of charges) {
    if (!charge.session || !charge.session.class) continue;

    const className = charge.session.class.name;
    const note = charge.session.chargeNote?.trim();

    // The new logic:
    const correctDescription = note 
      ? `${className} - ${note}`
      : (className || 'Session');

    // If the description doesn't match the correct one, update it!
    if (charge.description !== correctDescription) {
      console.log(`Updating [${charge.id}] from "${charge.description}" to "${correctDescription}"`);
      
      await prisma.transaction.update({
        where: { id: charge.id },
        data: { description: correctDescription }
      });

      // Also update the invoice line connected to this transaction, if any
      if (charge.invoiceLine) {
        await prisma.invoiceLine.update({
          where: { id: charge.invoiceLine.id },
          data: { description: correctDescription }
        });
      }
      
      updatedCount++;
    }
  }

  console.log(`Updated ${updatedCount} records.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
