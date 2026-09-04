import test from 'node:test';
import assert from 'node:assert/strict';

import { salaryAccruals, paymentLine } from '../src/services/teacherPayments.service.js';

/**
 * The arithmetic behind a balance.
 *
 * The ledger's two halves are tested here rather than end to end: the earnings
 * side is already covered by the payroll tests, and what is new is how a salary
 * turns into monthly lines and how a signed adjustment lands in a column. Both
 * are pure, and both decide how much money a screen says is owed.
 */

const at = (iso) => new Date(`${iso}T00:00:00Z`);

test('a monthly salary accrues once per finished month', () => {
  const lines = salaryAccruals(
    { baseSalary: 4000, salaryPeriod: 'MONTHLY' },
    at('2026-06-14'),
    at('2026-09-04')
  );

  // June, July and August have ended. September has not.
  assert.deepEqual(lines.map((l) => l.date), ['2026-06-30', '2026-07-31', '2026-08-31']);
  assert.deepEqual(lines.map((l) => l.income), [4000, 4000, 4000]);
});

test('an annual salary is paid in twelfths, not all at once', () => {
  const [line] = salaryAccruals(
    { baseSalary: 63000, salaryPeriod: 'ANNUAL' },
    at('2026-08-01'),
    at('2026-09-04')
  );

  assert.equal(line.income, 5250);
  assert.match(line.detail, /twelfth/);
});

test('the month somebody is still working is not owed to them yet', () => {
  const lines = salaryAccruals(
    { baseSalary: 4000, salaryPeriod: 'MONTHLY' },
    at('2026-09-01'),
    at('2026-09-30')
  );

  // The 30th is the last day, and the month closes on it — so it counts.
  assert.equal(lines.length, 1);

  const midMonth = salaryAccruals(
    { baseSalary: 4000, salaryPeriod: 'MONTHLY' },
    at('2026-09-01'),
    at('2026-09-29')
  );
  assert.equal(midMonth.length, 0);
});

test('a salary of nothing accrues nothing', () => {
  // Deliberate zeros exist — the owners draw no salary — and must not turn into
  // a line, or every month would owe them $0.00 in writing.
  assert.deepEqual(salaryAccruals({ baseSalary: 0, salaryPeriod: 'MONTHLY' }, at('2026-01-01'), at('2026-09-04')), []);
  assert.deepEqual(salaryAccruals({ baseSalary: null, salaryPeriod: 'MONTHLY' }, at('2026-01-01'), at('2026-09-04')), []);
});

test('somebody with no hours and no payments accrues no salary at all', () => {
  // `from` is null when there is nothing on record to start from. Accruing
  // anyway would invent a start date and a balance with it.
  assert.deepEqual(salaryAccruals({ baseSalary: 4000, salaryPeriod: 'MONTHLY' }, null, at('2026-09-04')), []);
});

test('a payment brings a balance down', () => {
  const line = paymentLine({
    id: 'p1', kind: 'PAYMENT', amount: '410.00', paidAt: at('2026-09-04'),
    method: 'CHECK', reference: 'Check #1042', notes: null, recordedBy: { fullName: 'Tara Sanford' },
  });

  assert.equal(line.income, 0);
  assert.equal(line.payment, 410);
  assert.match(line.description, /Check/);
  assert.match(line.detail, /Check #1042/);
  assert.match(line.detail, /Tara Sanford/);
});

test('a positive adjustment is owed and a negative one is settled', () => {
  const bonus = paymentLine({
    id: 'a1', kind: 'ADJUSTMENT', amount: '250.00', paidAt: at('2026-09-01'),
    method: null, reference: null, notes: 'Opening balance carried over',
  });
  assert.equal(bonus.income, 250);
  assert.equal(bonus.payment, 0);
  assert.equal(bonus.description, 'Opening balance carried over');

  const correction = paymentLine({
    id: 'a2', kind: 'ADJUSTMENT', amount: '-180.00', paidAt: at('2026-09-02'),
    method: null, reference: null, notes: 'Frozen rate was $50, agreed rate is $30',
  });
  assert.equal(correction.income, 0);
  assert.equal(correction.payment, 180);
});

test('a running balance settles to zero when the whole of it is paid', () => {
  // The same fold the ledger does, over lines built the same way.
  const entries = [
    { income: 20, payment: 0 },
    { income: 20, payment: 0 },
    paymentLine({ id: 'p', kind: 'PAYMENT', amount: '40.00', paidAt: at('2026-09-04') }),
  ];

  let balance = 0;
  for (const entry of entries) balance = Math.round((balance + entry.income - entry.payment) * 100) / 100;

  assert.equal(balance, 0);
});
