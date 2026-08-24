const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const student = await prisma.user.findFirst({
    where: { fullName: { contains: 'Burbuja', mode: 'insensitive' } }
  });

  if (!student) {
    console.log('Student not found');
    return;
  }

  const cls = await prisma.class.findFirst({
    where: {
      type: { in: ['IN_PERSON', 'HYBRID'] },
    }
  });

  if (!cls) {
    console.log('No IN_PERSON or HYBRID class found');
    return;
  }

  const existing = await prisma.classEnrollment.findUnique({
    where: {
      classId_studentId: {
        studentId: student.id,
        classId: cls.id
      }
    }
  });

  if (!existing) {
    const enrollment = await prisma.classEnrollment.create({
      data: {
        studentId: student.id,
        classId: cls.id,
        status: 'ENROLLED',
      }
    });
    console.log('Successfully enrolled Burbuja:', enrollment);
  } else {
    console.log('Burbuja is already enrolled in this class.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
