import prisma from '../config/database.js';
import { isWaveConfigured } from '../config/wave.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  verifyState,
  getConnectionStatus,
  getConnectionRow,
  listAccounts,
  saveAccountMapping,
  disconnect,
  createIncomeTransaction,
} from '../services/wave.service.js';

const frontendUrl = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

// GET /api/integrations/wave — connection status (+ account options when connected)
export const waveStatus = async (req, res, next) => {
  try {
    const status = await getConnectionStatus();
    let accounts = null;
    if (status.connected) {
      try {
        accounts = await listAccounts();
      } catch (e) {
        // Token could be revoked on Wave's side; surface as a soft warning.
        accounts = { error: e.message };
      }
    }
    res.json({ configured: isWaveConfigured(), status, accounts });
  } catch (error) {
    next(error);
  }
};

// GET /api/integrations/wave/connect — returns the Wave authorize URL to open
export const waveConnect = async (req, res, next) => {
  try {
    if (!isWaveConfigured()) {
      return res.status(400).json({
        error: 'Not Configured',
        message: 'Wave OAuth credentials (WAVE_CLIENT_ID / WAVE_CLIENT_SECRET / WAVE_REDIRECT_URI) are not set on the server.',
      });
    }
    res.json({ url: buildAuthorizeUrl(req.user.id) });
  } catch (error) {
    next(error);
  }
};

// GET /api/integrations/wave/callback — OAuth redirect target (no auth middleware;
// trust is established by the signed state param, not a session cookie).
export const waveCallback = async (req, res, next) => {
  const back = (params) => res.redirect(`${frontendUrl()}/settings/integrations?${new URLSearchParams(params)}`);
  try {
    const { code, state, error } = req.query;
    if (error) return back({ wave: 'error', reason: String(error) });
    const claims = state ? verifyState(String(state)) : null;
    if (!code || !claims) return back({ wave: 'error', reason: 'invalid_state' });

    await exchangeCode(String(code), claims.userId);
    return back({ wave: 'connected' });
  } catch (err) {
    return back({ wave: 'error', reason: (err.message || 'exchange_failed').slice(0, 120) });
  }
};

// PUT /api/integrations/wave/accounts — save the deposit/income account mapping
export const waveSaveAccounts = async (req, res, next) => {
  try {
    const { anchorAccountId, incomeAccountId } = req.body;
    if (!anchorAccountId || !incomeAccountId) {
      return res.status(400).json({ error: 'Validation Error', message: 'Both a deposit and an income account are required.' });
    }
    const status = await saveAccountMapping({ anchorAccountId, incomeAccountId });
    res.json({ status });
  } catch (error) {
    if (/valid Wave/.test(error.message)) {
      return res.status(400).json({ error: 'Validation Error', message: error.message });
    }
    next(error);
  }
};

// POST /api/integrations/wave/disconnect
export const waveDisconnect = async (req, res, next) => {
  try {
    await disconnect();
    res.json({ status: { connected: false } });
  } catch (error) {
    next(error);
  }
};

// ── Income sync ──────────────────────────────────────────────────────────────

// Completed, positive, not-yet-synced payments in [from, to] (by paidAt||createdAt).
const eligiblePayments = async (from, to) => {
  const start = new Date(from);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  const payments = await prisma.payment.findMany({
    where: {
      status: 'COMPLETED',
      waveSyncedAt: null,
      amount: { gt: 0 },
      OR: [
        { paidAt: { gte: start, lte: end } },
        { AND: [{ paidAt: null }, { createdAt: { gte: start, lte: end } }] },
      ],
    },
    include: {
      family: { select: { name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
  });
  return payments;
};

const describePayment = (p) =>
  `${p.method} payment${p.invoice ? ` · Inv ${p.invoice.invoiceNumber}` : ''}${p.family?.name ? ` · ${p.family.name}` : ''}`;

// POST /api/integrations/wave/sync/preview — { from, to } → what would be pushed
export const waveSyncPreview = async (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'Validation Error', message: 'from and to dates are required.' });

    const status = await getConnectionStatus();
    if (!status.readyToSync) {
      return res.status(400).json({ error: 'Not Ready', message: 'Connect Wave and map both accounts before syncing.' });
    }

    const payments = await eligiblePayments(from, to);
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);
    res.json({
      count: payments.length,
      total: total.toFixed(2),
      items: payments.map((p) => ({
        id: p.id,
        date: (p.paidAt || p.createdAt),
        amount: Number(p.amount).toFixed(2),
        description: describePayment(p),
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/integrations/wave/sync — actually push the eligible payments to Wave
export const waveSyncRun = async (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'Validation Error', message: 'from and to dates are required.' });

    const connection = await getConnectionRow();
    const status = await getConnectionStatus();
    if (!status.readyToSync) {
      return res.status(400).json({ error: 'Not Ready', message: 'Connect Wave and map both accounts before syncing.' });
    }

    const payments = await eligiblePayments(from, to);
    const results = { synced: 0, failed: 0, errors: [] };

    // Sequential on purpose: keeps well under Wave's rate limits and gives a
    // deterministic, resumable outcome (each success is committed immediately).
    for (const p of payments) {
      try {
        const waveTxId = await createIncomeTransaction({
          connection,
          payment: p,
          amount: p.amount,
          description: describePayment(p),
        });
        await prisma.payment.update({
          where: { id: p.id },
          data: { waveTransactionId: waveTxId, waveSyncedAt: new Date() },
        });
        results.synced += 1;
      } catch (e) {
        results.failed += 1;
        if (results.errors.length < 10) results.errors.push({ paymentId: p.id, message: e.message });
      }
    }

    res.json({ ...results, attempted: payments.length });
  } catch (error) {
    next(error);
  }
};
