/**
 * Family-ledger credit helpers. A family's running balance is the sum of all
 * its Transactions — CHARGE/REFUND increase what's owed, PAYMENT/DISCOUNT/CREDIT
 * reduce it. When that sum goes negative, the family has a credit surplus
 * (e.g. an EMA remittance that overpaid an invoice) that should offset the
 * next invoice instead of just sitting unapplied.
 */

const BALANCE_INCREASING_TYPES = new Set(['CHARGE', 'REFUND']);
const BALANCE_DECREASING_TYPES = new Set(['PAYMENT', 'DISCOUNT', 'CREDIT']);

export const calculateFamilyBalance = async (tx, familyId) => {
  const transactions = await tx.transaction.findMany({ where: { familyId }, select: { type: true, amount: true } });
  return transactions.reduce((acc, t) => {
    const amount = Number(t.amount);
    if (BALANCE_INCREASING_TYPES.has(t.type)) return acc + amount;
    if (BALANCE_DECREASING_TYPES.has(t.type)) return acc - amount;
    return acc;
  }, 0);
};

/**
 * Applies any available family credit to a freshly-created invoice, up to its
 * total. Must run inside the same Prisma transaction that created the invoice.
 */
export const applyAvailableCredit = async (tx, { familyId, invoiceId, invoiceTotal }) => {
  if (!familyId || invoiceTotal <= 0) return { applied: 0 };

  // Measure the surplus that existed BEFORE this invoice's own charges. Those
  // charges are already CHARGE rows on the ledger (linked to invoiceId by the
  // caller), so a plain family balance would count them against the very credit
  // meant to pay them — a family with $30 credit getting a new $20 invoice would
  // see only $10 "available" and the invoice would stay PARTIAL, triggering false
  // overdue notices even though its credit covers the invoice in full.
  //
  // Filtering in JS rather than with `NOT: { invoiceId }` on purpose: in SQL
  // `invoiceId <> $id` drops rows where invoiceId IS NULL, and standalone credits
  // (an EMA overpayment) have a null invoiceId — exactly the surplus we must count.
  const familyTx = await tx.transaction.findMany({
    where: { familyId },
    select: { type: true, amount: true, invoiceId: true },
  });
  const priorBalance = familyTx.reduce((acc, t) => {
    if (t.invoiceId === invoiceId) return acc; // skip this invoice's own charges
    const amount = Number(t.amount);
    if (t.type === 'CHARGE' || t.type === 'REFUND') return acc + amount;
    if (t.type === 'PAYMENT' || t.type === 'DISCOUNT' || t.type === 'CREDIT') return acc - amount;
    return acc;
  }, 0);
  const availableCredit = Math.max(0, -priorBalance);
  if (availableCredit <= 0) return { applied: 0 };

  const applied = Math.min(availableCredit, invoiceTotal);

  // Allocation only — no ledger transaction. The surplus is already on the
  // books (that's WHY the balance is negative); the invoice's own charges are
  // already CHARGE rows. Writing another balance-decreasing CREDIT here would
  // count the same surplus twice and leave phantom credit on the account.
  const status = applied >= invoiceTotal ? 'PAID' : 'PARTIAL';
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: applied, status },
  });

  return { applied };
};
