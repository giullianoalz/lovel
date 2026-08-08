import { applyAvailableCredit } from './billingCredit.service.js';

// Numeric max, not string sort — `invoiceNumber` is text, so a naive ORDER BY
// desc breaks once numbers hit 5 digits ("LC-4391" > "LC-10000" lexicographically).
export const nextLcNumber = async (tx) => {
  const invoices = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: 'LC-' } },
    select: { invoiceNumber: true },
  });
  let max = 4390;
  for (const inv of invoices) {
    const n = parseInt(inv.invoiceNumber.replace('LC-', ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
};

/**
 * Raises a CHARGE that is invoiced immediately, rather than left as a loose
 * transaction for the admin's manual "generate invoice" step — used where a
 * charge (e.g. the registration deposit) must be billed to the family the
 * moment it's raised.
 */
export const raiseInvoicedCharge = async (tx, { familyId, studentId = null, termId = null, amount, description, dateRange }) => {
  const invoiceNumber = `LC-${await nextLcNumber(tx)}`;

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      familyId,
      studentId,
      subtotal: amount,
      totalAmount: amount,
      status: 'SENT',
      dateRange: dateRange || 'Registration Deposit',
      dueDate: new Date(Date.now() + 30 * 86400000),
      lines: { create: [{ description, amount }] },
    },
  });

  const transaction = await tx.transaction.create({
    data: {
      familyId,
      studentId,
      // termId without quarter identifies this as the registration deposit
      // (as opposed to a quarterly tuition charge, which always sets quarter)
      // — that's what lets cancelRegistrationRequest find and reverse it.
      termId,
      invoiceId: invoice.id,
      amount,
      type: 'CHARGE',
      description,
    },
  });

  const { applied } = await applyAvailableCredit(tx, { familyId, invoiceId: invoice.id, invoiceTotal: amount });

  return { invoice, transaction, applied };
};
