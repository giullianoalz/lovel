import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Chat...');

  // Get Admin and Teacher users
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const teacher = await prisma.user.findFirst({ where: { role: 'TEACHER' } });
  const parent = await prisma.user.findFirst({ where: { role: 'PARENT' } });

  if (!admin || !teacher || !parent) {
    console.log('Users not found, please run the main seed.js first.');
    return;
  }

  // 1. Thread: Admin & Teacher
  await prisma.chatThread.create({
    data: {
      participants: {
        create: [
          { userId: admin.id },
          { userId: teacher.id }
        ]
      },
      messages: {
        create: [
          {
            senderId: admin.id,
            text: 'Hello! I wanted to discuss the upcoming schedule changes.'
          },
          {
            senderId: teacher.id,
            text: 'Sure, I am available after my 3 PM class.'
          }
        ]
      }
    }
  });

  // 2. Thread: Admin & Parent
  await prisma.chatThread.create({
    data: {
      participants: {
        create: [
          { userId: admin.id },
          { userId: parent.id }
        ]
      },
      messages: {
        create: [
          {
            senderId: parent.id,
            text: 'Hi, I need help with paying the recent invoice.'
          },
          {
            senderId: admin.id,
            text: 'Hello, you can do that from the Billing section in your dashboard.'
          }
        ]
      }
    }
  });

  // 3. System Bot Thread for Admin
  await prisma.chatThread.create({
    data: {
      isBot: true,
      name: 'System Assistant',
      participants: {
        create: [
          { userId: admin.id }
        ]
      },
      messages: {
        create: [
          {
            senderId: null, // System message
            text: 'Hello! I am your Academy Assistant. How can I help you today?'
          }
        ]
      }
    }
  });

  console.log('Chat seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
