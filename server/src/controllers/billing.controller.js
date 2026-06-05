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
