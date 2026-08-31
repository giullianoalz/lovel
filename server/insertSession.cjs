const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const lori = '4e125204-f679-4cb4-bf54-28f9488e9455';
  const noah = '078545e5-220b-45af-bc9b-9b30e7831132';
  const paul = '25dfb313-f912-4ef2-87b3-77fdf14e75ef';
  const clsId = '4b3c72bf-750a-4bae-9dab-30e7b54d4f35';
  
  // Date: Aug 26, 2026 (this past Wednesday)
  const dateStr = '2026-08-26';
  const date = new Date(`${dateStr}T00:00:00Z`);
  const startTime = new Date(`${dateStr}T11:00:00Z`); // 11 AM
  const endTime = new Date(`${dateStr}T13:00:00Z`);   // 1 PM

  // Create the session
  const session = await prisma.session.create({
    data: {
      classId: clsId,
      date,
      startTime,
      endTime,
      payRateOverride: 30, // $30 payroll
    }
  });

  console.log('Created Session:', session.id);

  // Set charge overrides (sin cobro cliente)
  await prisma.sessionChargeOverride.createMany({
    data: [
      { sessionId: session.id, studentId: noah, amount: 0, reason: 'Manual override (sin cobro cliente)' },
      { sessionId: session.id, studentId: paul, amount: 0, reason: 'Manual override (sin cobro cliente)' }
    ]
  });

  console.log('Added charge overrides for Noah and Paul');
  
  // Create attendance records so the payroll registers it?
  // Payroll usually depends on COMPLETED status for classes, or if it's past date.
  // Wait, the status defaults to SCHEDULED. Should we mark it COMPLETED?
  await prisma.session.update({
    where: { id: session.id },
    data: { status: 'COMPLETED' }
  });
  console.log('Marked session COMPLETED');
}

main().catch(console.error).finally(() => prisma.$disconnect());
