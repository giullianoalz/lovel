import prisma from '../config/database.js';

/**
 * GET /api/billing/transactions
 * List all transactions, optionally filtered by familyId
 */
export const listTransactions = async (req, res, next) => {
  try {
    const { familyId } = req.query;
    const where = {};
    if (familyId) where.familyId = familyId;

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        student: { select: { id: true, fullName: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    });

    // Map to frontend format
    const mapped = transactions.map((t) => ({
      id: t.id,
      studentId: t.studentId,
      studentName: t.student?.fullName || null,
      familyId: t.familyId,
      amount: Number(t.amount),
      type: t.type.charAt(0).toUpperCase() + t.type.slice(1), // charge -> Charge
      description: t.description || '',
      date: t.date.toISOString().split('T')[0],
      invoiceId: t.invoice?.invoiceNumber || null,
    }));

    res.json({ transactions: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/transactions
 * Create a new transaction (Charge, Payment, Refund, Discount)
 */
export const createTransaction = async (req, res, next) => {
  try {
    const { familyId, studentId, amount, type, description, date } = req.body;

    if (!familyId || !amount || !type) {
      return res.status(400).json({ error: 'familyId, amount, and type are required.' });
    }

    const tx = await prisma.transaction.create({
      data: {
        familyId,
        studentId: studentId || null,
        amount: parseFloat(amount),
        type: type.toUpperCase(),
        description: description || `Manual ${type}`,
        date: date ? new Date(date) : new Date(),
      },
    });

    res.status(201).json({
      transaction: {
        id: tx.id,
        studentId: tx.studentId,
        familyId: tx.familyId,
        amount: Number(tx.amount),
        type: type.charAt(0).toUpperCase() + type.slice(1),
        description: tx.description,
        date: tx.date.toISOString().split('T')[0],
        invoiceId: null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/invoices
 * List all invoices, optionally filtered by familyId
 */
export const listInvoices = async (req, res, next) => {
  try {
    const { familyId } = req.query;
    const where = {};
    if (familyId) where.familyId = familyId;

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { lines: true },
    });

    const mapped = invoices.map((inv) => ({
      id: inv.invoiceNumber,
      familyId: inv.familyId,
      date: inv.date.toISOString().split('T')[0],
      dateRange: inv.dateRange || 'N/A',
      amount: Number(inv.totalAmount),
      status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
    }));

    res.json({ invoices: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices
 * Generate a new invoice from uninvoiced charge transactions
 */
export const createInvoice = async (req, res, next) => {
  try {
    const { familyId, transactionIds } = req.body;

    if (!familyId || !transactionIds || transactionIds.length === 0) {
      return res.status(400).json({ error: 'familyId and transactionIds are required.' });
    }

    // Calculate total from the specified transactions
    const txs = await prisma.transaction.findMany({
      where: { id: { in: transactionIds } },
    });

    const subtotal = txs.reduce((acc, t) => {
      if (t.type === 'CHARGE') return acc + Number(t.amount);
      return acc - Number(t.amount);
    }, 0);

    // Generate sequential invoice number
    const lastInvoice = await prisma.invoice.findFirst({
      orderBy: { invoiceNumber: 'desc' },
    });
    let nextNum = 4391;
    if (lastInvoice && lastInvoice.invoiceNumber.startsWith('LC-')) {
      nextNum = parseInt(lastInvoice.invoiceNumber.replace('LC-', '')) + 1;
    }
    const invoiceNumber = `LC-${nextNum}`;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        familyId,
        subtotal,
        totalAmount: subtotal,
        status: 'SENT',
        dateRange: 'Current Unbilled',
        dueDate: new Date(Date.now() + 30 * 86400000), // 30 days from now
        lines: {
          create: txs.map((t) => ({
            description: t.description || 'Charge',
            amount: t.amount,
          })),
        },
      },
    });

    // Mark transactions as invoiced
    await prisma.transaction.updateMany({
      where: { id: { in: transactionIds } },
      data: { invoiceId: invoice.id },
    });

    res.status(201).json({
      invoice: {
        id: invoice.invoiceNumber,
        familyId: invoice.familyId,
        date: invoice.date.toISOString().split('T')[0],
        dateRange: invoice.dateRange,
        amount: Number(invoice.totalAmount),
        status: 'Sent',
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────── EMA STEP UP ──────────────────────────── */

// Compute the next sequential LC-#### number (numeric, not lexicographic).
const nextLcNumber = async (tx) => {
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

// POST /api/billing/ema/generate
// Body: { groups: [{ studentName, studentId, total, poNumbers: [], lines: [{description, amount}] }] }
// Assigns one sequential LC-#### invoice per student group and records invoices.
export const generateEmaBatch = async (req, res, next) => {
  try {
    const { groups } = req.body;
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ message: 'groups array is required.' });
    }

    const results = await prisma.$transaction(async (tx) => {
      let nextNum = await nextLcNumber(tx);
      const out = [];

      for (const g of groups) {
        const invoiceNumber = `LC-${nextNum++}`;

        // Match student by name to attach the family.
        const student = g.studentName
          ? await tx.user.findFirst({
              where: { role: 'STUDENT', fullName: { equals: g.studentName, mode: 'insensitive' } },
              select: { id: true, familyMembers: { select: { familyId: true }, take: 1 } },
            })
          : null;
        const familyId = student?.familyMembers?.[0]?.familyId || null;
        const total = Number(g.total) || 0;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            studentId: student?.id || null,
            source: 'EMA',
            poNumbers: g.poNumbers || [],
            subtotal: total,
            totalAmount: total,
            status: 'SENT',
            dateRange: 'EMA Step Up Batch',
            lines: (g.lines && g.lines.length > 0)
              ? { create: g.lines.map(l => ({ description: l.description || 'EMA session', amount: Number(l.amount) || 0 })) }
              : undefined,
          },
        });

        out.push({
          ...g,
          invoiceNumber: invoice.invoiceNumber,
          familyId,
          matched: !!student,
        });
      }
      return out;
    });

    res.json({ groups: results });
  } catch (error) {
    next(error);
  }
};

// POST /api/billing/ema/reconcile
// Body: { lines: [{ poNumber, studentName, amount }] }
// Matches each remittance line to the invoice covering that PO #, records a
// scholarship payment, and marks invoices PAID/PARTIAL.
export const reconcileEmaRemittance = async (req, res, next) => {
  try {
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: 'lines array is required.' });
    }

    const report = await prisma.$transaction(async (tx) => {
      const r = { matched: [], unmatched: [], totalMatched: 0, invoicesPaid: [] };
      const touched = new Map();

      for (const line of lines) {
        const amount = Number(line.amount) || 0;
        const invoice = await tx.invoice.findFirst({
          where: {
            OR: [
              line.poNumber ? { poNumbers: { has: line.poNumber } } : undefined,
              line.poNumber ? { invoiceNumber: line.poNumber } : undefined,
            ].filter(Boolean),
          },
        });

        if (!invoice) { r.unmatched.push(line); continue; }

        const newPaid = Number(invoice.amountPaid) + amount;
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid } });

        await tx.payment.create({
          data: {
            familyId: invoice.familyId,
            invoiceId: invoice.id,
            amount,
            netAmount: amount,
            method: 'SCHOLARSHIP_EMA',
            status: 'COMPLETED',
            externalReference: line.poNumber || invoice.invoiceNumber,
            notes: `EMA Step Up remittance — ${line.poNumber || invoice.invoiceNumber}`,
          },
        });

        if (invoice.familyId) {
          await tx.transaction.create({
            data: {
              studentId: invoice.studentId || null,
              familyId: invoice.familyId,
              amount,
              type: 'PAYMENT',
              description: `EMA Step Up — ${line.poNumber || invoice.invoiceNumber}`,
              invoiceId: invoice.id,
            },
          });
        }

        r.matched.push({ ...line, invoiceNumber: invoice.invoiceNumber, familyId: invoice.familyId });
        r.totalMatched += amount;
        touched.set(invoice.id, { total: Number(invoice.totalAmount), paid: newPaid, number: invoice.invoiceNumber });
      }

      for (const [id, info] of touched) {
        const status = info.paid >= info.total ? 'PAID' : 'PARTIAL';
        await tx.invoice.update({ where: { id }, data: { status } });
        if (status === 'PAID') r.invoicesPaid.push(info.number);
      }

      return r;
    });

    res.json(report);
  } catch (error) {
    next(error);
  }
};
