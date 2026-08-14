const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const student = await prisma.user.findFirst({
    where: { role: 'STUDENT', fullName: { contains: 'Coniglio', mode: 'insensitive' } },
    include: { familyMembers: true }
  });
  console.log("Student familyMembers:", student.familyMembers);
}
run().finally(() => prisma.$disconnect());
