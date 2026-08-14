import { PrismaClient } from '@prisma/client';
import { computePayrollSummary } from './src/services/payroll.service.js';

async function test() {
  try {
    const res = await computePayrollSummary(8, 2026);
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
