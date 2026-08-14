const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const user = await prisma.user.findFirst({
    where: { fullName: { contains: 'Coniglio', mode: 'insensitive' } },
    include: { familyMembers: { include: { family: true } } }
  });
  console.log(user);
  
  const child = await prisma.user.findFirst({
    where: { 
      familyMembers: { some: { familyId: user?.familyMembers[0]?.familyId, role: 'CHILD' } }
    }
  });
  console.log("Child:", child);

  // Check how many students exist
  const students = await prisma.user.count({ where: { role: 'STUDENT' }});
  console.log("Total students:", students);
  
  // Find a student with that last name
  const student = await prisma.user.findFirst({
    where: { role: 'STUDENT', fullName: { contains: 'Coniglio', mode: 'insensitive' } }
  });
  console.log("Student:", student);
}
run().finally(() => prisma.$disconnect());
