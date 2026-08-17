import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const sessions = await prisma.session.findMany({
    where: { 
      chargeAmount: { not: null },
      class: {
        enrollments: { some: { student: { status: 'ACTIVE' } } }
      }
    },
    include: { class: true },
    orderBy: { date: 'asc' }
  });
  
  const byClass = {};
  sessions.forEach(s => {
    if (!byClass[s.classId]) byClass[s.classId] = { class: s.class.name, sessions: [] };
    byClass[s.classId].sessions.push(s);
  });

  let modifiedCount = 0;

  for (const [classId, data] of Object.entries(byClass)) {
    if (data.sessions.length > 1) {
      console.log(`Class: ${data.class} (${classId}) - ${data.sessions.length} sessions with charge amount`);
      
      // Keep the first one, clear the rest
      const [firstSession, ...restSessions] = data.sessions;
      
      console.log(`  Keeping charge for session ${firstSession.id} on ${firstSession.date} ($${firstSession.chargeAmount})`);
      
      for (const s of restSessions) {
        console.log(`  Clearing charge for session ${s.id} on ${s.date} ($${s.chargeAmount})`);
        await prisma.session.update({
          where: { id: s.id },
          data: { chargeAmount: null }
        });
        modifiedCount++;
      }
    }
  }

  console.log(`Found ${modifiedCount} sessions to clear.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
