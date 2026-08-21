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

  // Transaction created first (without invoiceId yet) so the invoice's line
  // can link to it by id — that link is what makes the invoice editable
  // afterward without guessing which ledger row a line corresponds to.
  const transaction = await tx.transaction.create({
    data: {
      familyId,
      studentId,
      // termId without quarter identifies this as the registration deposit
      // (as opposed to a quarterly tuition charge, which always sets quarter)
      // — that's what lets cancelRegistrationRequest find and reverse it.
      termId,
      amount,
      type: 'CHARGE',
      description,
    },
  });

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      familyId,
      studentId,
      subtotal: amount,
      totalAmount: amount,
      status: 'DRAFT',
      dateRange: dateRange || 'Registration Deposit',
      dueDate: new Date(Date.now() + 30 * 86400000),
      lines: { create: [{ description, amount, transactionId: transaction.id }] },
    },
  });

  await tx.transaction.update({ where: { id: transaction.id }, data: { invoiceId: invoice.id } });

  const { applied } = await applyAvailableCredit(tx, { familyId, invoiceId: invoice.id, invoiceTotal: amount });

  return { invoice, transaction: { ...transaction, invoiceId: invoice.id }, applied };
};
