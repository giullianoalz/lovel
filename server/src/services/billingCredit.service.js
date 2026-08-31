/**
 * Family-ledger credit helpers. A family's running balance is the sum of all
 * its Transactions — CHARGE/REFUND increase what's owed, PAYMENT/DISCOUNT/CREDIT
 * reduce it. When that sum goes negative, the family has a credit surplus
 * (e.g. an EMA remittance that overpaid an invoice) that should offset the
 * next invoice instead of just sitting unapplied.
 */

const BALANCE_INCREASING_TYPES = new Set(['CHARGE', 'REFUND']);
const BALANCE_DECREASING_TYPES = new Set(['PAYMENT', 'DISCOUNT', 'CREDIT']);
const round2 = (n) => Math.round(n * 100) / 100;

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
 * On by default again as of 2026-08-20.
 *
 * This was off for as long as the migrated ledger was on the books. That
 * migration brought each family's old PAYMENTS across but, for 23 of them, not
 * the matching CHARGES — Brooks being the extreme case, $3,590 of payments
 * against $0 of charges. The surplus that left behind never existed, and this
 * function is what turned it into money: an invoice raised and silently marked
 * PAID from credit the family did not have, seven times ($4,534.25) before
 * anyone noticed.
 *
 * The migrated ledger has since been deleted in full — 1,886 transactions
 * across 99 families — so every balance the app now holds was raised by the
 * app itself and means what it says. Set APPLY_FAMILY_CREDIT=false to turn
 * auto-allocation back off if a future import ever makes balances doubtful
 * again; do that BEFORE loading the data, not after.
 */
const AUTO_APPLY_CREDIT = process.env.APPLY_FAMILY_CREDIT !== 'false';

/**
 * Applies any available family credit to a freshly-created invoice, up to its
 * total. Must run inside the same Prisma transaction that created the invoice.
 */
export const applyAvailableCredit = async (tx, { familyId, invoiceId, invoiceTotal }) => {
  if (!AUTO_APPLY_CREDIT) return { applied: 0 };
  if (!familyId || invoiceTotal <= 0) return { applied: 0 };

  // Measure the surplus that existed BEFORE this invoice's own charges. Those
  // charges are already CHARGE rows on the ledger (linked to invoiceId by the
  // caller), so a plain family balance would count them against the very credit
  // meant to pay them — a family with $30 credit getting a new $20 invoice would
  // see only $10 "available" and the invoice would stay SENT with a balance due,
  // triggering false overdue notices even though its credit covers it in full.
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

  // Only promote to PAID when the credit fully covers the invoice; partial
  // credit leaves the accounting status untouched (DRAFT/SENT/OVERDUE).
  const data = { amountPaid: applied };
  if (applied >= invoiceTotal) data.status = 'PAID';
  await tx.invoice.update({ where: { id: invoiceId }, data });

  return { applied };
};

/**
 * Spreads whatever credit a family has across several invoices raised together
 * — one per child, from one billing run.
 *
 * applyAvailableCredit measures the surplus that exists *outside the invoice it
 * is applying to*, which is right for a single document and wrong for a batch:
 * called in a loop, each sibling's invoice counts the other sibling's brand-new
 * charges as debt and both come back under-credited. A family with $300 credit
 * and two $200 children would absorb $100 twice instead of $300 once, leaving
 * the parent looking at a balance their credit already covers.
 *
 * So the surplus is measured once, against the ledger minus *every* charge in
 * this batch, and then handed out in order until it runs out.
 *
 * @param {string[]} batchTxIds every charge being invoiced in this run
 * @param {{id: string, total: number}[]} invoices in the order they should be paid down
 * @returns {Promise<Map<string, number>>} invoice id → amount applied
 */
export const applyCreditAcrossInvoices = async (tx, { familyId, batchTxIds, invoices }) => {
  const applied = new Map(invoices.map((i) => [i.id, 0]));
  if (!AUTO_APPLY_CREDIT || !familyId) return applied;

  const batch = new Set(batchTxIds);
  const familyTx = await tx.transaction.findMany({
    where: { familyId },
    select: { id: true, type: true, amount: true },
  });

  const priorBalance = familyTx.reduce((acc, t) => {
    if (batch.has(t.id)) return acc; // this run's own charges
    const amount = Number(t.amount);
    if (BALANCE_INCREASING_TYPES.has(t.type)) return acc + amount;
    if (BALANCE_DECREASING_TYPES.has(t.type)) return acc - amount;
    return acc;
  }, 0);

  let remaining = Math.max(0, -priorBalance);
  if (remaining <= 0) return applied;

  for (const inv of invoices) {
    if (remaining <= 0 || inv.total <= 0) continue;
    const amount = Math.round(Math.min(remaining, inv.total) * 100) / 100;
    remaining -= amount;
    applied.set(inv.id, amount);

    // Only promote to PAID when the credit fully covers the invoice; partial
    // credit leaves the accounting status untouched.
    const data = { amountPaid: amount };
    if (amount >= inv.total) data.status = 'PAID';
    await tx.invoice.update({ where: { id: inv.id }, data });
  }

  return applied;
};

/**
 * Credit traced to one specific student, for splitting a household invoice
 * back apart.
 *
 * applyCreditAcrossInvoices treats a family's credit as one pooled surplus,
 * because for a fresh billing run that's usually all the ledger tells you —
 * a Zelle payment recorded against the family carries no student. But a
 * *split* is un-mixing money that was already attributed: the registration
 * deposit Remi's parent paid is a Transaction with Remi's studentId on it,
 * same for Presley's. Pooling that and handing it out by invoice order (see
 * splitInvoice) would give one child's own payment to the other. Tracing it
 * back to the student it was actually paid for is what "split" is supposed
 * to mean.
 *
 * Transactions with no studentId (paid at the family level, not earmarked to
 * either child) are deliberately excluded here — that money stays pooled and
 * is not this function's to hand out; a future family-level invoice is where
 * it would apply.
 */
export const applyPerStudentCredit = async (tx, { familyId, studentId, batchTxIds, invoiceId, invoiceTotal }) => {
  if (!AUTO_APPLY_CREDIT || !familyId || !studentId || invoiceTotal <= 0) return { applied: 0 };

  const batch = new Set(batchTxIds);
  const studentTx = await tx.transaction.findMany({
    where: { familyId, studentId },
    select: { id: true, type: true, amount: true },
  });

  const priorBalance = studentTx.reduce((acc, t) => {
    if (batch.has(t.id)) return acc; // this split's own charges
    const amount = Number(t.amount);
    if (BALANCE_INCREASING_TYPES.has(t.type)) return acc + amount;
    if (BALANCE_DECREASING_TYPES.has(t.type)) return acc - amount;
    return acc;
  }, 0);

  const available = Math.max(0, -priorBalance);
  if (available <= 0) return { applied: 0 };

  const applied = Math.round(Math.min(available, invoiceTotal) * 100) / 100;
  const data = { amountPaid: applied };
  if (applied >= invoiceTotal) data.status = 'PAID';
  await tx.invoice.update({ where: { id: invoiceId }, data });

  return { applied };
};

/**
 * Sweeps a just-recorded payment onto whatever open invoice it was actually
 * for, instead of leaving it as floating credit until someone happens to
 * notice the family still shows a balance.
 *
 * This is the gap a manual "Add Transaction → Payment" left open: its
 * "Apply to Invoice" field defaults to nothing, and a registration deposit
 * paid after the family's invoice already existed (the common case — the
 * deposit usually lands days after the first charge) sat unattributed
 * forever. applyAvailableCredit/applyPerStudentCredit only ever ran at the
 * *invoice's* creation time, so a payment that arrived later never triggered
 * them.
 *
 * Scoped by student when the payment names one (paid down oldest-first,
 * across as many of that student's open invoices as it takes), or by family
 * when it doesn't (same, but restricted to invoices with no student
 * attribution — crediting a family-level payment onto one specific child's
 * bill would misattribute it to a sibling who didn't pay).
 *
 * Purely an allocation step, same as its single-invoice cousins: the payment
 * Transaction itself is left exactly as recorded (still invoiceId: null,
 * still the full amount) — only the target invoices' amountPaid/status move.
 */
export const sweepPaymentOntoOpenInvoices = async (tx, { familyId, studentId, amount }) => {
  if (!AUTO_APPLY_CREDIT || !familyId || amount <= 0) return { applied: 0 };

  const candidates = await tx.invoice.findMany({
    where: { familyId, status: { notIn: ['PAID', 'CANCELLED'] } },
    include: { lines: { include: { transaction: { select: { studentId: true } } } } },
    orderBy: [{ date: 'asc' }, { invoiceNumber: 'asc' }],
  });

  const matches = candidates.filter((inv) => {
    const students = new Set(inv.lines.map((l) => l.transaction?.studentId).filter(Boolean));
    return studentId ? (students.size === 1 && students.has(studentId)) : students.size === 0;
  });

  let remaining = amount;
  let applied = 0;
  for (const inv of matches) {
    if (remaining <= 0) break;
    const due = Number(inv.totalAmount) - Number(inv.amountPaid);
    if (due <= 0) continue;
    const give = Math.round(Math.min(remaining, due) * 100) / 100;
    const newPaid = round2(Number(inv.amountPaid) + give);
    const data = { amountPaid: newPaid };
    if (newPaid >= Number(inv.totalAmount)) data.status = 'PAID';
    await tx.invoice.update({ where: { id: inv.id }, data });
    remaining = round2(remaining - give);
    applied = round2(applied + give);
  }

  return { applied };
};

/**
 * Same sweep, run against ledger history rather than a payment just made —
 * for an invoice that already existed when its family's credit arrived, or
 * for cleaning up whatever an earlier bug left unattributed. Safe to call on
 * any invoice at any time: it recomputes from scratch and only ever raises
 * amountPaid, never lowers it below whatever real Payments already put there.
 */
export const applyCreditToExistingInvoice = async (tx, { invoice }) => {
  const students = new Set(
    invoice.lines.map((l) => l.transaction?.studentId).filter(Boolean)
  );
  if (students.size === 1) {
    // Every charge already on THIS invoice has to be excluded from the debt
    // side of the calculation, or applyPerStudentCredit counts the very
    // charges being paid down as additional debt on top of themselves —
    // available credit comes out near zero instead of covering the invoice.
    // (batchTxIds exists for exactly this; an empty array excludes nothing.)
    const batchTxIds = invoice.lines.map((l) => l.transactionId).filter(Boolean);
    return applyPerStudentCredit(tx, {
      familyId: invoice.familyId,
      studentId: [...students][0],
      batchTxIds,
      invoiceId: invoice.id,
      invoiceTotal: Number(invoice.totalAmount),
    });
  }
  return applyAvailableCredit(tx, {
    familyId: invoice.familyId,
    invoiceId: invoice.id,
    invoiceTotal: Number(invoice.totalAmount),
  });
};
