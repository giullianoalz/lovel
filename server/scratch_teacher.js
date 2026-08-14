import { PrismaClient } from '@prisma/client';
import { computeTeacherPayroll } from './src/services/payroll.service.js';

async function test() {
  try {
    const res = await computeTeacherPayroll('99a81a5b-6a82-461f-b451-235cb0e5d935', 8, 2026);
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
