import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { WAVE } from '../config/wave.js';

/**
 * Wave accounting service: OAuth token lifecycle, encrypted token storage, and a
 * thin GraphQL client. The WaveConnection table holds at most one row (the
 * academy's single Wave business), so everything here operates on that singleton.
 */

// ── Token encryption (AES-256-GCM) ───────────────────────────────────────────
// Tokens are secrets; never store them in plaintext or return them to clients.
const encKey = () => {
  const secret = process.env.WAVE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('WAVE_TOKEN_SECRET or JWT_SECRET must be set to store Wave tokens.');
  return crypto.scryptSync(secret, 'wave-token-v1', 32);
};

const encrypt = (plain) => {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};

const decrypt = (blob) => {
  if (!blob) return null;
  const [ivB64, tagB64, dataB64] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
};

// ── OAuth state (CSRF) ───────────────────────────────────────────────────────
// Stateless signed state so we don't need a server-side session store.
export const signState = (userId) =>
  jwt.sign({ userId, nonce: crypto.randomBytes(8).toString('hex') }, process.env.JWT_SECRET, { expiresIn: '10m' });

export const verifyState = (state) => {
  try {
    return jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

// ── Connection singleton ─────────────────────────────────────────────────────
export const getConnectionRow = () => prisma.waveConnection.findFirst();

/** Public-safe view of the connection (no tokens). */
export const getConnectionStatus = async () => {
  const row = await getConnectionRow();
  const connected = Boolean(row?.accessToken && row?.businessId);
  return {
    connected,
    businessId: row?.businessId || null,
    businessName: row?.businessName || null,
    anchorAccountId: row?.anchorAccountId || null,
    anchorAccountName: row?.anchorAccountName || null,
    incomeAccountId: row?.incomeAccountId || null,
    incomeAccountName: row?.incomeAccountName || null,
    // Income can only be synced once both accounts are mapped.
    readyToSync: connected && Boolean(row?.anchorAccountId && row?.incomeAccountId),
    connectedAt: row?.connectedAt || null,
  };
};

export const buildAuthorizeUrl = (userId) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: WAVE.clientId,
    redirect_uri: WAVE.redirectUri,
    scope: WAVE.scopes,
    state: signState(userId),
  });
  return `${WAVE.authorizeUrl}?${params.toString()}`;
};

const persistTokens = async (tokenResp, userId) => {
  const expiresAt = new Date(Date.now() + (Number(tokenResp.expires_in || 3600) * 1000));
  const existing = await getConnectionRow();
  const data = {
    accessToken: encrypt(tokenResp.access_token),
    refreshToken: encrypt(tokenResp.refresh_token),
    tokenExpiresAt: expiresAt,
    scope: tokenResp.scope || WAVE.scopes,
    connectedById: userId || existing?.connectedById || null,
    connectedAt: new Date(),
  };
  const row = existing
    ? await prisma.waveConnection.update({ where: { id: existing.id }, data })
    : await prisma.waveConnection.create({ data });
  return row;
};

/** Exchange an authorization code for tokens and persist them. */
export const exchangeCode = async (code, userId) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: WAVE.clientId,
    client_secret: WAVE.clientSecret,
    redirect_uri: WAVE.redirectUri,
    code,
  });
  const resp = await fetch(WAVE.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(`Wave token exchange failed: ${json.error_description || json.error || resp.status}`);
  }
  const row = await persistTokens(json, userId);
  // Learn which business these tokens belong to and cache its name.
  const business = await primaryBusiness(row);
  if (business) {
    await prisma.waveConnection.update({
      where: { id: row.id },
      data: { businessId: business.id, businessName: business.name },
    });
  }
  return getConnectionStatus();
};

const refreshTokens = async (row) => {
  const refreshToken = decrypt(row.refreshToken);
  if (!refreshToken) throw new Error('No Wave refresh token on file — reconnect required.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: WAVE.clientId,
    client_secret: WAVE.clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch(WAVE.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(`Wave token refresh failed: ${json.error_description || json.error || resp.status}`);
  }
  // Wave may or may not rotate the refresh token; keep the old one if absent.
  if (!json.refresh_token) json.refresh_token = refreshToken;
  return persistTokens(json, row.connectedById);
};

/** Returns a valid (refreshed if needed) access token, or null if not connected. */
const getValidAccessToken = async () => {
  let row = await getConnectionRow();
  if (!row?.accessToken) return null;
  // Refresh a minute before expiry to avoid mid-request 401s.
  if (!row.tokenExpiresAt || row.tokenExpiresAt.getTime() - Date.now() < 60_000) {
    row = await refreshTokens(row);
  }
  return decrypt(row.accessToken);
};

// ── GraphQL client ───────────────────────────────────────────────────────────
export const waveGraphql = async (query, variables = {}) => {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Wave is not connected.');
  const resp = await fetch(WAVE.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Wave API error: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json.data;
};

// The first business on the account. Most Wave users have exactly one; if there
// are several the admin can override businessId later via config.
const primaryBusiness = async (row) => {
  const token = decrypt(row.accessToken);
  const resp = await fetch(WAVE.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: `query { businesses(page:1,pageSize:10){ edges{ node{ id name } } } }` }),
  });
  const json = await resp.json();
  return json.data?.businesses?.edges?.[0]?.node || null;
};

export const listBusinesses = async () => {
  const data = await waveGraphql(`query { businesses(page:1,pageSize:50){ edges{ node{ id name } } } }`);
  return (data.businesses?.edges || []).map((e) => e.node);
};

/**
 * Accounts for the connected business, split into the two groups the admin maps:
 * `deposit` (assets money lands in) and `income` (revenue categories).
 */
// Fetches accounts of a single Wave account type. Filtering by `types` at the
// GraphQL level matters here: this business has ~200 auto-generated per-customer
// Accounts Receivable sub-accounts (also ASSET type), which filled page 1 and
// pushed every real bank/income account off the end when this queried
// unfiltered and split client-side.
const fetchAccountsByType = async (businessId, type, excludedSubtypes) => {
  const data = await waveGraphql(
    `query($businessId: ID!, $types: [AccountTypeValue!], $excludedSubtypes: [AccountSubtypeValue!]) {
      business(id: $businessId) {
        accounts(page: 1, pageSize: 200, types: $types, excludedSubtypes: $excludedSubtypes) {
          edges { node { id name type { name value } subtype { name value } } }
        }
      }
    }`,
    { businessId, types: [type], excludedSubtypes: excludedSubtypes || null },
  );
  return (data.business?.accounts?.edges || []).map((e) => e.node);
};

export const listAccounts = async () => {
  const row = await getConnectionRow();
  if (!row?.businessId) throw new Error('No Wave business selected.');
  const [assetNodes, incomeNodes] = await Promise.all([
    // Excludes the auto-generated per-customer receivable and transfer-clearing
    // accounts — hundreds of "Accounts Receivable"/"Transfer Clearing" entries
    // that swamp the real bank/cash accounts an admin would pick as a deposit.
    fetchAccountsByType(row.businessId, 'ASSET', ['RECEIVABLE', 'RECEIVABLE_INVOICES', 'RECEIVABLE_OTHER', 'TRANSFERS']),
    fetchAccountsByType(row.businessId, 'INCOME'),
  ]);
  const toOption = (n) => ({ id: n.id, name: n.name, subtype: n.subtype?.name });
  return {
    deposit: assetNodes.map(toOption),
    income: incomeNodes.map(toOption),
    all: [...assetNodes, ...incomeNodes].map((n) => ({ id: n.id, name: n.name, type: n.type?.value })),
  };
};

export const saveAccountMapping = async ({ anchorAccountId, incomeAccountId }) => {
  const row = await getConnectionRow();
  if (!row) throw new Error('Wave is not connected.');
  const { deposit, income } = await listAccounts();
  const anchor = deposit.find((a) => a.id === anchorAccountId);
  const inc = income.find((a) => a.id === incomeAccountId);
  if (!anchor) throw new Error('Selected deposit account is not a valid Wave asset account.');
  if (!inc) throw new Error('Selected income account is not a valid Wave income account.');
  await prisma.waveConnection.update({
    where: { id: row.id },
    data: {
      anchorAccountId: anchor.id,
      anchorAccountName: anchor.name,
      incomeAccountId: inc.id,
      incomeAccountName: inc.name,
    },
  });
  return getConnectionStatus();
};

export const disconnect = async () => {
  const row = await getConnectionRow();
  if (row) await prisma.waveConnection.delete({ where: { id: row.id } });
  return { connected: false };
};

/**
 * Create one income money-transaction in Wave for a payment. Uses the payment id
 * as Wave's externalId so a repeat call for the same payment is rejected by Wave
 * rather than double-posting income.
 */
export const createIncomeTransaction = async ({ connection, payment, amount, description }) => {
  const data = await waveGraphql(
    `mutation($input: MoneyTransactionCreateInput!) {
      moneyTransactionCreate(input: $input) {
        didSucceed
        inputErrors { message code path }
        transaction { id }
      }
    }`,
    {
      input: {
        businessId: connection.businessId,
        externalId: payment.id,
        date: (payment.paidAt || payment.createdAt).toISOString().slice(0, 10),
        description: description || `Payment ${payment.id.slice(0, 8)}`,
        anchor: {
          accountId: connection.anchorAccountId,
          amount: Number(amount).toFixed(2),
          direction: 'DEPOSIT',
        },
        lineItems: [
          {
            accountId: connection.incomeAccountId,
            amount: Number(amount).toFixed(2),
            balance: 'INCREASE',
          },
        ],
      },
    },
  );
  const result = data.moneyTransactionCreate;
  if (!result?.didSucceed) {
    const msg = (result?.inputErrors || []).map((e) => e.message).join('; ') || 'unknown error';
    throw new Error(msg);
  }
  return result.transaction?.id || null;
};

// ── Invoice sync ─────────────────────────────────────────────────────────────
// Pushes each app invoice to Wave as Accounts Receivable at creation time (see
// syncInvoiceToWave, called from billing.controller.js and
// registration.controller.js right after each invoice-creating transaction
// commits — never from inside one, since a failed Wave call must never roll
// back a real invoice, and holding a DB transaction open across a network call
// would starve the connection pool).

const inputErrorMessage = (result, fallback) =>
  (result?.inputErrors || []).map((e) => e.message).join('; ') || fallback;

/** Finds a Wave Customer by email, creating one if none matches. */
const findOrCreateCustomer = async (businessId, { email, name }) => {
  const found = await waveGraphql(
    `query($businessId: ID!, $email: String) {
      business(id: $businessId) {
        customers(page: 1, pageSize: 1, email: $email) {
          edges { node { id } }
        }
      }
    }`,
    { businessId, email },
  );
  const existing = found.business?.customers?.edges?.[0]?.node;
  if (existing) return existing.id;

  const created = await waveGraphql(
    `mutation($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        didSucceed
        inputErrors { message code path }
        customer { id }
      }
    }`,
    { input: { businessId, name: name || email, email } },
  );
  const result = created.customerCreate;
  if (!result?.didSucceed) throw new Error(inputErrorMessage(result, 'Failed to create Wave customer.'));
  return result.customer.id;
};

/**
 * The one Wave Product every synced invoice line bills against — invoiceCreate
 * takes a productId per line, not a bare account. Created once against the
 * connection's mapped income account and cached on WaveConnection.waveProductId.
 */
const getOrCreateDefaultProduct = async (row) => {
  if (row.waveProductId) return row.waveProductId;
  const created = await waveGraphql(
    `mutation($input: ProductCreateInput!) {
      productCreate(input: $input) {
        didSucceed
        inputErrors { message code path }
        product { id }
      }
    }`,
    {
      input: {
        businessId: row.businessId,
        name: 'Tuition & Fees',
        unitPrice: '0.00',
        incomeAccountId: row.incomeAccountId,
      },
    },
  );
  const result = created.productCreate;
  if (!result?.didSucceed) throw new Error(inputErrorMessage(result, 'Failed to create Wave product.'));
  await prisma.waveConnection.update({ where: { id: row.id }, data: { waveProductId: result.product.id } });
  return result.product.id;
};

const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);

// Our PaymentMethod enum is broader than Wave's (scholarship methods, WAVE
// itself for card payments already processed through Stripe, etc.) — anything
// without a direct match falls back to OTHER rather than failing the sync.
const WAVE_PAYMENT_METHODS = new Set(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CREDIT_CARD', 'OTHER', 'PAYPAL', 'UNSPECIFIED']);
const mapPaymentMethod = (method) => (WAVE_PAYMENT_METHODS.has(method) ? method : 'OTHER');

/**
 * Records every not-yet-synced COMPLETED payment on an invoice as a manual
 * payment against its just-created Wave invoice, and marks each Payment
 * synced (reusing Payment.waveTransactionId/waveSyncedAt from the payment→
 * income sync) so that separate feature never re-posts the same money as an
 * unlinked income transaction. One payment's failure is logged and skipped
 * rather than aborting the rest — a partial reconciliation beats none.
 */
const recordInvoicePayments = async (row, invoiceId, waveInvoiceId) => {
  const payments = await prisma.payment.findMany({
    where: { invoiceId, status: 'COMPLETED', amount: { gt: 0 }, waveSyncedAt: null },
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
  });
  for (const payment of payments) {
    try {
      const data = await waveGraphql(
        `mutation($input: InvoicePaymentCreateManualInput!) {
          invoicePaymentCreateManual(input: $input) {
            didSucceed
            inputErrors { message code path }
            invoicePayment { id }
          }
        }`,
        {
          input: {
            invoiceId: waveInvoiceId,
            paymentAccountId: row.anchorAccountId,
            amount: Number(payment.amount).toFixed(2),
            paymentDate: dateOnly(payment.paidAt || payment.createdAt),
            paymentMethod: mapPaymentMethod(payment.method),
            exchangeRate: '1',
            memo: `Synced from app payment ${payment.id.slice(0, 8)}`,
          },
        },
      );
      const result = data.invoicePaymentCreateManual;
      if (!result?.didSucceed) throw new Error(inputErrorMessage(result, 'Failed to record Wave payment.'));
      await prisma.payment.update({
        where: { id: payment.id },
        data: { waveTransactionId: result.invoicePayment.id, waveSyncedAt: new Date() },
      });
    } catch (error) {
      console.error(`[Wave] Failed to record payment ${payment.id} against invoice ${waveInvoiceId}:`, error);
    }
  }
};

/**
 * Every invoice number currently in Wave, as a Map of number -> {id, status}.
 *
 * This exists because Wave is NOT an empty book: invoices were filed there by
 * hand for years (the EMA Step Up workflow did exactly that, which is why our
 * LC-#### sequence was made to continue Wave's). Pushing an invoice whose
 * number is already there would double-bill the family in the real accounts,
 * so both the backfill and each individual sync check against this first.
 * Requires the invoice:read scope.
 */
export const listWaveInvoiceNumbers = async () => {
  const row = await getConnectionRow();
  if (!row?.businessId) throw new Error('No Wave business selected.');
  const byNumber = new Map();
  let page = 1;
  // Paginated: this business has years of history, well past one page.
  for (;;) {
    const data = await waveGraphql(
      `query($businessId: ID!, $page: Int!) {
        business(id: $businessId) {
          invoices(page: $page, pageSize: 200) {
            pageInfo { totalPages }
            edges { node { id invoiceNumber status total { value } customer { name } } }
          }
        }
      }`,
      { businessId: row.businessId, page },
    );
    const conn = data.business?.invoices;
    if (!conn) break;
    for (const e of conn.edges) {
      if (e.node?.invoiceNumber) byNumber.set(e.node.invoiceNumber, e.node);
    }
    if (page >= (conn.pageInfo?.totalPages || 1)) break;
    page += 1;
  }
  return byNumber;
};

/**
 * Syncs one invoice to Wave as an approved (SAVED) invoice against the mapped
 * income account. Idempotent (skips if already synced) and never throws —
 * callers fire this after their own transaction commits and do not await
 * error handling; failures are recorded on the invoice for the admin to see
 * and retry from Settings > Integrations.
 */
export const syncInvoiceToWave = async (invoiceId, existingWaveNumbers = null) => {
  try {
    const status = await getConnectionStatus();
    if (!status.readyToSync) return;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: true,
        family: {
          select: {
            name: true,
            members: {
              select: { isInvoiceRecipient: true, user: { select: { email: true } } },
            },
          },
        },
      },
    });
    // Gone (e.g. deleted right after creation) or already pushed — nothing to do.
    if (!invoice || invoice.waveInvoiceId) return;

    if (!invoice.family) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { waveSyncError: 'No family on invoice — nothing to bill in Wave.' } });
      return;
    }
    const recipient = invoice.family.members.find((m) => m.isInvoiceRecipient) || invoice.family.members[0];
    const email = recipient?.user?.email;
    if (!email) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { waveSyncError: 'No invoice-recipient email on file for this family.' } });
      return;
    }

    // Never create a second Wave invoice under a number Wave already carries —
    // years of invoices were filed there by hand, and duplicating one bills the
    // family twice in the real books. Recorded as an error, not silently
    // skipped: an admin has to decide whether the two are really the same
    // document before anything links them.
    const knownNumbers = existingWaveNumbers || await listWaveInvoiceNumbers();
    const clash = knownNumbers.get(invoice.invoiceNumber);
    if (clash) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { waveSyncError: `Wave already has an invoice numbered ${invoice.invoiceNumber} (${clash.customer?.name || 'unknown customer'}, $${clash.total?.value ?? '?'}). Not synced — resolve by hand so the family is not billed twice.` },
      });
      return;
    }

    const row = await getConnectionRow();
    const customerId = await findOrCreateCustomer(row.businessId, { email, name: invoice.family.name });
    const productId = await getOrCreateDefaultProduct(row);

    const items = invoice.lines.length > 0
      ? invoice.lines.map((l) => ({
          productId,
          description: l.description,
          quantity: String(l.quantity || 1),
          unitPrice: (Number(l.amount) / (l.quantity || 1)).toFixed(2),
        }))
      : [{ productId, description: invoice.dateRange || 'Charges', quantity: '1', unitPrice: Number(invoice.totalAmount).toFixed(2) }];

    const data = await waveGraphql(
      `mutation($input: InvoiceCreateInput!) {
        invoiceCreate(input: $input) {
          didSucceed
          inputErrors { message code path }
          invoice { id }
        }
      }`,
      {
        input: {
          businessId: row.businessId,
          customerId,
          status: 'SAVED',
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: dateOnly(invoice.date),
          dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : undefined,
          items,
        },
      },
    );
    const result = data.invoiceCreate;
    if (!result?.didSucceed) throw new Error(inputErrorMessage(result, 'Failed to create Wave invoice.'));

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { waveInvoiceId: result.invoice.id, waveSyncedAt: new Date(), waveSyncError: null },
    });

    // Record any money already collected on this invoice (credit applied at
    // creation, or a payment made before this invoice happened to sync) as a
    // manual payment against the Wave invoice — otherwise it sits in Wave as
    // fully unpaid AR despite really being settled. This also marks the
    // underlying Payment rows synced so the separate payment→income sync
    // (Settings > Integrations "Sync income to Wave") never re-posts the same
    // money as a second, unlinked income transaction.
    await recordInvoicePayments(row, invoiceId, result.invoice.id);
  } catch (error) {
    console.error(`[Wave] Failed to sync invoice ${invoiceId}:`, error);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { waveSyncError: String(error.message || error).slice(0, 500) },
    }).catch(() => {});
  }
};

// ── Backfill (reconciliation) ───────────────────────────────────────────────
// One-time-ish catch-up for invoices raised before this integration existed
// (or that failed their automatic sync) — same syncInvoiceToWave underneath,
// just run over every not-yet-synced invoice instead of one just created.

const backfillCandidates = () => prisma.invoice.findMany({
  where: { waveInvoiceId: null, status: { not: 'CANCELLED' } },
  select: {
    id: true, invoiceNumber: true, date: true, totalAmount: true, amountPaid: true, status: true,
    family: { select: { name: true } },
  },
  orderBy: { date: 'asc' },
});

/**
 * What would be pushed to Wave, without pushing anything — for admin review.
 * Flags each invoice whose number Wave already carries: those are the ones
 * that would double-bill a family, and the run below refuses them.
 */
export const previewInvoiceBackfill = async () => {
  const [invoices, knownNumbers] = await Promise.all([backfillCandidates(), listWaveInvoiceNumbers()]);
  return invoices.map((inv) => {
    const clash = knownNumbers.get(inv.invoiceNumber);
    return {
      invoiceNumber: inv.invoiceNumber,
      date: inv.date.toISOString().slice(0, 10),
      family: inv.family?.name || null,
      total: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      status: inv.status,
      // Present only when Wave already has this number — needs a human call.
      alreadyInWave: clash
        ? { customer: clash.customer?.name || null, total: clash.total?.value ?? null, status: clash.status }
        : null,
    };
  });
};

/**
 * Pushes every not-yet-synced invoice, sequentially, sharing syncInvoiceToWave's
 * error handling. Wave's existing invoice numbers are read once up front rather
 * than per invoice — one round trip instead of ~70, and a consistent snapshot.
 */
export const runInvoiceBackfill = async () => {
  const invoices = await backfillCandidates();
  const knownNumbers = await listWaveInvoiceNumbers();
  const results = [];
  for (const inv of invoices) {
    await syncInvoiceToWave(inv.id, knownNumbers);
    const after = await prisma.invoice.findUnique({
      where: { id: inv.id },
      select: { waveInvoiceId: true, waveSyncError: true },
    });
    results.push({
      invoiceNumber: inv.invoiceNumber,
      ok: Boolean(after?.waveInvoiceId),
      error: after?.waveSyncError || null,
    });
  }
  return results;
};
