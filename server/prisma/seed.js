import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed script — Populates the database with initial data
 * matching the current mock data from the frontend.
 *
 * Run with: npm run db:seed
 */
async function main() {
  console.log('🌱 Seeding database...\n');

  // =============================================
  // 1. PAYMENT SETTINGS (singleton)
  // =============================================
  const paymentSettings = await prisma.paymentSettings.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      passCcFeeToParent: false,
      ccFeePercentage: 2.90,
      ccFeeFixed: 0.30,
      autoSendReceipt: true,
    },
  });
  console.log('✅ Payment settings created');

  // =============================================
  // 2. USERS
  // =============================================
  const admin = await prisma.user.upsert({
    where: { email: 'lovelearningfl@gmail.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_admin_001',
      email: 'lovelearningfl@gmail.com',
      fullName: 'Academy Administrator',
      role: 'ADMIN',
      phone: '(555) 000-0001',
    },
  });

  const teacher1 = await prisma.user.upsert({
    where: { email: 'david.brown@academy.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_teacher_001',
      email: 'david.brown@academy.com',
      fullName: 'Prof. David Brown',
      role: 'TEACHER',
      phone: '(555) 200-0001',
    },
  });

  const teacher2 = await prisma.user.upsert({
    where: { email: 'sarah.jenkins@academy.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_teacher_002',
      email: 'sarah.jenkins@academy.com',
      fullName: 'Prof. Sarah Jenkins',
      role: 'TEACHER',
      phone: '(555) 200-0002',
    },
  });

  // Parents
  const parentElena = await prisma.user.upsert({
    where: { email: 'elena.garcia@example.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_parent_001',
      email: 'elena.garcia@example.com',
      fullName: 'Elena Garcia',
      role: 'PARENT',
      phone: '(555) 123-4567',
    },
  });

  const parentMichael = await prisma.user.upsert({
    where: { email: 'michael.doe@example.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_parent_002',
      email: 'michael.doe@example.com',
      fullName: 'Michael Doe',
      role: 'PARENT',
      phone: '(555) 987-6543',
    },
  });

  const parentCarlos = await prisma.user.upsert({
    where: { email: 'carlos.ramirez@example.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_parent_003',
      email: 'carlos.ramirez@example.com',
      fullName: 'Carlos Ramirez',
      role: 'PARENT',
      phone: '(555) 456-7890',
    },
  });

  // Students
  const studentMaria = await prisma.user.upsert({
    where: { email: 'maria.garcia@student.academy.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_student_001',
      email: 'maria.garcia@student.academy.com',
      fullName: 'Maria Garcia',
      role: 'STUDENT',
      age: 12,
      allergies: 'Peanuts, Shellfish',
      snackAuthorized: true,
      snackPunches: 8,
      prizePoints: 120,
    },
  });

  const studentJohn = await prisma.user.upsert({
    where: { email: 'john.doe@student.academy.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_student_002',
      email: 'john.doe@student.academy.com',
      fullName: 'John Doe',
      role: 'STUDENT',
      age: 15,
      allergies: 'None',
      snackAuthorized: false,
      snackPunches: 0,
      prizePoints: 45,
    },
  });

  const studentSofia = await prisma.user.upsert({
    where: { email: 'sofia.ramirez@student.academy.com' },
    update: {},
    create: {
      firebaseUid: 'firebase_student_003',
      email: 'sofia.ramirez@student.academy.com',
      fullName: 'Sofia Ramirez',
      role: 'STUDENT',
      allergies: 'Lactose Intolerant',
      snackAuthorized: true,
      snackPunches: 2,
      prizePoints: 0,
      status: 'INACTIVE',
    },
  });

  console.log('✅ Users created (1 admin, 2 teachers, 3 parents, 3 students)');

  // =============================================
  // 3. FAMILIES
  // =============================================
  const familyGarcia = await prisma.family.upsert({
    where: { id: '10000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '10000000-0000-0000-0000-000000000001',
      name: 'Garcia Family',
      tags: ['EMA', 'Fall 2025'],
    },
  });

  const familyDoe = await prisma.family.upsert({
    where: { id: '10000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '10000000-0000-0000-0000-000000000002',
      name: 'Doe Family',
      tags: ['Love Learning FL LLC'],
    },
  });

  const familyRamirez = await prisma.family.upsert({
    where: { id: '10000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'Ramirez Family',
      tags: [],
    },
  });

  console.log('✅ Families created (3)');

  // =============================================
  // 4. FAMILY MEMBERS
  // =============================================
  const memberships = [
    { familyId: familyGarcia.id, userId: parentElena.id, role: 'Mother', isInvoiceRecipient: true },
    { familyId: familyGarcia.id, userId: studentMaria.id, role: 'Student', isInvoiceRecipient: false },
    { familyId: familyDoe.id, userId: parentMichael.id, role: 'Father', isInvoiceRecipient: true },
    { familyId: familyDoe.id, userId: studentJohn.id, role: 'Student', isInvoiceRecipient: false },
    { familyId: familyRamirez.id, userId: parentCarlos.id, role: 'Father', isInvoiceRecipient: true },
    { familyId: familyRamirez.id, userId: studentSofia.id, role: 'Student', isInvoiceRecipient: false },
  ];

  for (const m of memberships) {
    await prisma.familyMember.upsert({
      where: { familyId_userId: { familyId: m.familyId, userId: m.userId } },
      update: {},
      create: m,
    });
  }

  console.log('✅ Family members linked');

  // =============================================
  // 5. CLASSES
  // =============================================
  // findFirst + create (not upsert) because Class has no unique constraint on
  // (name, teacherId) — re-running this seed must not spawn duplicate classes.
  const classMath = await prisma.class.findFirst({ where: { name: 'Math Foundations - Group A', teacherId: teacher1.id } })
    ?? await prisma.class.create({
      data: {
        name: 'Math Foundations - Group A',
        subject: 'Mathematics',
        teacherId: teacher1.id,
        type: 'IN_PERSON',
        maxStudents: 8,
      },
    });

  const classEnglish = await prisma.class.findFirst({ where: { name: 'Advanced English', teacherId: teacher2.id } })
    ?? await prisma.class.create({
      data: {
        name: 'Advanced English',
        subject: 'English',
        teacherId: teacher2.id,
        type: 'VIRTUAL',
        meetingUrl: 'https://zoom.us/j/123456789',
        maxStudents: 10,
      },
    });

  console.log('✅ Classes created (2)');

  // =============================================
  // 6. CLASS ENROLLMENTS
  // =============================================
  await prisma.classEnrollment.createMany({
    data: [
      { classId: classMath.id, studentId: studentMaria.id },
      { classId: classMath.id, studentId: studentJohn.id },
      { classId: classEnglish.id, studentId: studentMaria.id },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Enrollments created');

  // =============================================
  // 6b. CLASS SESSIONS (for today)
  // =============================================
  const todayDateStr = new Date().toISOString().split('T')[0];
  
  const sessionMath = await prisma.session.create({
    data: {
      classId: classMath.id,
      date: new Date(todayDateStr + 'T00:00:00Z'),
      startTime: new Date('1970-01-01T16:00:00Z'),
      endTime: new Date('1970-01-01T17:30:00Z'),
      status: 'SCHEDULED',
    },
  });

  const sessionEnglish = await prisma.session.create({
    data: {
      classId: classEnglish.id,
      date: new Date(todayDateStr + 'T00:00:00Z'),
      startTime: new Date('1970-01-01T18:00:00Z'),
      endTime: new Date('1970-01-01T19:00:00Z'),
      status: 'SCHEDULED',
    },
  });

  // Create initial attendance records
  await prisma.attendance.createMany({
    data: [
      { sessionId: sessionMath.id, studentId: studentMaria.id, status: 'PRESENT' },
      { sessionId: sessionMath.id, studentId: studentJohn.id, status: 'PRESENT' },
      { sessionId: sessionEnglish.id, studentId: studentMaria.id, status: 'PRESENT' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Class sessions created for today');

  // =============================================
  // 7. SNACK ITEMS
  // =============================================
  await prisma.snackItem.createMany({
    data: [
      { name: 'Apple Juice', costPunches: 2, imageUrl: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&h=400&fit=crop' },
      { name: 'Chocolate Chip Cookie', costPunches: 3, imageUrl: 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=400&h=400&fit=crop' },
      { name: 'Potato Chips', costPunches: 3, imageUrl: 'https://images.unsplash.com/photo-1566478989037-eade3f7e2bd9?w=400&h=400&fit=crop' },
      { name: 'Granola Bar', costPunches: 2, imageUrl: 'https://images.unsplash.com/photo-1590080873974-9a3dcac5ee63?w=400&h=400&fit=crop' },
      { name: 'Organic Fruit Snacks', costPunches: 1, imageUrl: 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=400&h=400&fit=crop' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Snack items created (5)');

  // =============================================
  // 8. DEFAULT NOTIFICATION PREFERENCES
  // =============================================
  const allUsers = [admin, teacher1, teacher2, parentElena, parentMichael, parentCarlos, studentMaria, studentJohn, studentSofia];
  const categories = [
    'class_reminders', 'snack_alerts', 'attendance_alerts',
    'payment_reminders', 'announcements', 'session_reports',
    'prize_updates', 'registration_updates',
  ];

  for (const user of allUsers) {
    for (const category of categories) {
      await prisma.notificationPreference.upsert({
        where: { userId_category: { userId: user.id, category } },
        update: {},
        create: {
          userId: user.id,
          category,
          inApp: true,
          email: ['class_reminders', 'attendance_alerts', 'payment_reminders', 'announcements'].includes(category),
          push: false,
          sms: false,
        },
      });
    }
  }

  console.log('✅ Notification preferences created for all users');

  // =============================================
  // 9. SHARED SPACES
  // =============================================
  await prisma.sharedSpace.createMany({
    data: [
      { name: 'Compass Cove (8th grade room)' },
      { name: 'Seagrass Spotlight (front room)' },
      { name: 'Circuit Reef (Computer Cart)' },
      { name: 'Seashell Lounge (curtain room)' },
      { name: 'Movement Room' },
      { name: 'Quiet Room' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Shared spaces created (6)');

  console.log('\n🎉 Seed completed successfully!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
