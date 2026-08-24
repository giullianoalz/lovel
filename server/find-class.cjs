const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cls = await prisma.class.findFirst();
  console.log('Class:', cls);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
