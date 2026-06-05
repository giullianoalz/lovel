import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding today session...');
  
  // Find a class
  const cls = await prisma.class.findFirst();
  if (!cls) {
    console.log('No class found');
    return;
  }
  
  const today = new Date();
  
  // Create a session for today
  const session = await prisma.session.create({
    data: {
      classId: cls.id,
      date: today,
      startTime: new Date(`1970-01-01T16:00:00Z`),
      endTime: new Date(`1970-01-01T17:30:00Z`),
      status: 'SCHEDULED'
    }
  });

  // Get enrollments for this class
  const enrollments = await prisma.classEnrollment.findMany({
    where: { classId: cls.id }
  });

  // Create attendance
  for (const en of enrollments) {
    await prisma.attendance.create({
      data: {
        sessionId: session.id,
        studentId: en.studentId,
        status: 'PRESENT'
      }
    });
  }

  console.log('✅ Session created for today:', session.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
