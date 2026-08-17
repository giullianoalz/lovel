import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const sessions = await prisma.session.findMany({
    where: { 
      class: {
        enrollments: { some: { student: { status: 'ACTIVE' } } }
      }
    },
    include: { class: true },
    orderBy: { date: 'asc' }
  });
  
  let totalWithCharges = 0;
  const groups = {};

  sessions.forEach(s => {
    const hasOverrides = s.chargeOverrides && Object.keys(s.chargeOverrides).length > 0;
    const hasAmount = s.chargeAmount !== null && s.chargeAmount > 0;
    
    if (hasAmount || hasOverrides) {
      totalWithCharges++;
      if (!groups[s.classId]) {
        groups[s.classId] = { className: s.class.name, sessions: [] };
      }
      groups[s.classId].sessions.push({
        id: s.id,
        date: s.date,
        amount: s.chargeAmount,
        overrides: s.chargeOverrides
      });
    }
  });

  console.log(`Total sessions with charges for active students: ${totalWithCharges}`);
  
  let modifiedCount = 0;

  for (const [classId, data] of Object.entries(groups)) {
    if (data.sessions.length > 1) {
      console.log(`Class: ${data.className} (${classId}) has ${data.sessions.length} sessions with charges`);
      
      const [first, ...rest] = data.sessions;
      
      for (const s of rest) {
        // Uncomment to clear duplicates
        /*
        await prisma.session.update({
          where: { id: s.id },
          data: { chargeAmount: null, chargeOverrides: {} }
        });
        */
        modifiedCount++;
      }
    }
  }

  console.log(`Duplicates to clear: ${modifiedCount}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
