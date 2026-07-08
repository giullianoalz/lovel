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
export const applyAvailableCredit = async (tx, { familyId, studentId = null, invoiceId, invoiceTotal }) => {
  if (!familyId || invoiceTotal <= 0) return { applied: 0 };

  const balance = await calculateFamilyBalance(tx, familyId);
  const availableCredit = Math.max(0, -balance);
  if (availableCredit <= 0) return { applied: 0 };

  const applied = Math.min(availableCredit, invoiceTotal);

  await tx.transaction.create({
    data: {
      familyId,
      studentId,
      invoiceId,
      amount: applied,
      type: 'CREDIT',
      description: 'Available credit applied automatically',
    },
  });

  const status = applied >= invoiceTotal ? 'PAID' : 'PARTIAL';
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: applied, status },
  });

  return { applied };
};
