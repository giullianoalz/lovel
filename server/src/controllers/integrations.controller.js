import prisma from '../config/database.js';
import { drive, driveAuthMode } from '../config/drive.js';
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
// Takes no `next`: a failure here has to come back as a redirect the browser can
// render, not as an error handed to the JSON error middleware.
export const waveCallback = async (req, res) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Drive status
//
// Drive fails silently by design of the thing it talks to: a missing token
// leaves `drive` null and every upload is simply skipped, and a stale folder id
// 404s inside a Promise.all nobody watches. That invisibility is what let the
// marketing hub run for weeks storing zero photos while telling teachers their
// submission had gone through, and what lost 35 photos before that.
//
// So: one endpoint that actually calls Drive and reports what came back. It
// answers the only question worth asking after a deploy — is the Drive this
// process can reach the same one the folder ids point at?
//
// Reports no secrets. Token values never appear, only whether one is present.
const DRIVE_FOLDERS = [
  { env: 'DRIVE_MARKETING_FOLDER_ID', label: 'Marketing photos' },
  { env: 'DRIVE_CHAT_FOLDER_ID',      label: 'Chat attachments' },
  { env: 'DRIVE_WAIVERS_FOLDER_ID',   label: 'Signed waivers' },
  { env: 'DRIVE_SNACKS_FOLDER_ID',    label: 'Snack photos', fallback: 'DRIVE_MARKETING_FOLDER_ID' },
];

export const driveStatus = async (req, res, next) => {
  try {
    const result = {
      authMode: driveAuthMode,
      // The distinction the logs bury: "service-account" looks configured and
      // can never store a byte, because a service account on a non-Workspace
      // account has a hard quota of zero.
      canStore: driveAuthMode === 'oauth',
      hasRefreshToken: !!process.env.DRIVE_REFRESH_TOKEN,
      account: null,
      quota: null,
      folders: [],
      problems: [],
      healthy: false,
    };

    if (driveAuthMode === 'none') {
      result.problems.push('Google Drive is not configured. Set DRIVE_REFRESH_TOKEN (plus GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET) on this service. Until then every photo, chat attachment and signed waiver upload is rejected.');
      return res.json({ drive: result });
    }

    if (driveAuthMode === 'service-account') {
      result.problems.push('Drive is falling back to a service account, which has zero storage quota — every upload will fail. Set DRIVE_REFRESH_TOKEN on this service.');
    }

    try {
      const about = await drive.about.get({ fields: 'user(emailAddress),storageQuota' });
      result.account = about.data.user?.emailAddress || null;
      const q = about.data.storageQuota || {};
      if (q.limit) {
        result.quota = {
          limitBytes: Number(q.limit),
          usageBytes: Number(q.usage || 0),
          percentUsed: Math.round((Number(q.usage || 0) / Number(q.limit)) * 100),
        };
        if (result.quota.percentUsed >= 95) {
          result.problems.push(`Drive is ${result.quota.percentUsed}% full. Uploads start failing at 100%.`);
        }
      }
    } catch (err) {
      result.problems.push(`Could not reach Drive at all: ${err.message}. The credentials are probably expired or revoked.`);
      return res.json({ drive: result });
    }

    // A folder id is only meaningful against the account the token belongs to.
    // After the move to a new Google account this is exactly what broke: the
    // token was swapped and the ids still pointed into the old account's Drive.
    for (const f of DRIVE_FOLDERS) {
      const id = process.env[f.env] || (f.fallback ? process.env[f.fallback] : null);
      const entry = {
        env: f.env, label: f.label, id: id || null,
        usingFallback: !process.env[f.env] && !!id,
        reachable: false, name: null, writable: false, error: null,
      };

      if (!id) {
        entry.error = 'not set';
        result.problems.push(`${f.label}: ${f.env} is not set — uploads land loose in the account's My Drive root instead of a folder.`);
        result.folders.push(entry);
        continue;
      }

      try {
        const meta = await drive.files.get({
          fileId: id,
          fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
          supportsAllDrives: true,
        });
        entry.reachable = true;
        entry.name = meta.data.name;
        entry.writable = !!meta.data.capabilities?.canAddChildren;
        if (meta.data.trashed) {
          entry.error = 'in trash';
          result.problems.push(`${f.label}: folder "${meta.data.name}" is in the trash.`);
        } else if (!entry.writable) {
          result.problems.push(`${f.label}: folder "${meta.data.name}" is not writable by ${result.account}.`);
        }
      } catch (err) {
        entry.error = err.message;
        result.problems.push(`${f.label}: folder id ${id} is not reachable from ${result.account} (${err.message}). This is what a folder id left over from a different Google account looks like.`);
      }

      result.folders.push(entry);
    }

    result.healthy = result.canStore && result.problems.length === 0;
    res.json({ drive: result });
  } catch (error) {
    next(error);
  }
};
