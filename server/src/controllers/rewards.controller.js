import prisma from '../config/database.js';
import { canUseSnackPunches } from '../utils/snackEligibility.js';
import { uploadBufferToDrive, downloadFileWithType, downloadThumbnail, drive } from '../config/drive.js';
import { maybeCreateReloadRequest } from '../services/snackReload.service.js';

/* ──────────────────────────── SNACK CABINET ──────────────────────────── */

// Snack photos get their own Drive folder when one is configured. Until then
// they share the Marketing Hub folder, which already exists and is already
// wired up on both ends — a second folder id that nobody sets is how the chat
// and waiver folders ended up pointing at nothing.
const snackFolderId = () =>
  process.env.DRIVE_SNACKS_FOLDER_ID || process.env.DRIVE_MARKETING_FOLDER_ID;

// The API path that streams a snack's photo back.
// The cabinet only ever draws these as tiles, so it asks for the thumbnail.
// The full-size original stays one query string away for anything that wants it.
const snackImagePath = (id) => `/rewards/snacks/${id}/image?size=thumb`;

// A data URI exactly as the phone's FileReader produces it.
const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

/**
 * Turns whatever the client sent for a snack photo into something small enough
 * to keep in Postgres.
 *
 * A plain http(s) URL is already just a string and passes straight through — a
 * few seeded rows point at Unsplash. A base64 data URI is the case that cost us
 * 62 MB: decode it, push the bytes to Drive, and keep only the file id. If
 * Drive is not configured the upload is refused rather than quietly falling
 * back to storing the data URI, which is how the column filled up to begin
 * with.
 */
const storeSnackImage = async (image, snackName) => {
  const value = (image || '').trim();
  if (!value) return { driveFileId: null, imageUrl: null };
  if (/^https?:\/\//i.test(value)) return { driveFileId: null, imageUrl: value };

  const match = value.match(DATA_URI);
  if (!match) {
    const err = new Error('Unrecognised image format — send a data URI or an http(s) URL.');
    err.status = 400;
    throw err;
  }
  if (!drive) {
    const err = new Error('Photo uploads need Google Drive, which is not configured on this server.');
    err.status = 503;
    throw err;
  }

  const [, mimeType, b64] = match;
  const buffer = Buffer.from(b64, 'base64');
  const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const safeName = (snackName || 'snack').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const file = await uploadBufferToDrive(
    buffer,
    `snack-${safeName}-${Date.now()}.${ext}`,
    mimeType,
    snackFolderId()
  );
  if (!file?.id) {
    const err = new Error('Drive accepted the upload but returned no file id.');
    err.status = 502;
    throw err;
  }
  return { driveFileId: file.id, imageUrl: null };
};

/** The shape the cabinet UI consumes. */
const snackView = (s) => ({
  id: s.id,
  name: s.name,
  costPunches: s.costPunches,
  // Drive-backed photos need our auth header, so the client pulls them through
  // ProtectedImage instead of pointing an <img> straight at the path.
  image: s.driveFileId ? '' : (s.imageUrl || ''),
  imagePath: s.driveFileId ? snackImagePath(s.id) : null,
});

// GET /api/rewards/snacks — list active snack items
export const listSnacks = async (req, res, next) => {
  try {
    const items = await prisma.snackItem.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      // Explicit select on purpose: image_url can still hold a legacy data URI
      // on a row the backfill has not reached, and listing the cabinet is no
      // place to drag seven megabytes of it across the wire.
      select: { id: true, name: true, costPunches: true, driveFileId: true, imageUrl: true },
    });
    res.json({ snacks: items.map(snackView) });
  } catch (error) {
    next(error);
  }
};

// GET /api/rewards/snacks/:id/image — stream a snack photo's bytes from Drive.
export const getSnackImage = async (req, res, next) => {
  try {
    const snack = await prisma.snackItem.findUnique({
      where: { id: req.params.id },
      select: { driveFileId: true },
    });
    if (!snack?.driveFileId) {
      return res.status(404).json({ error: 'Not Found', message: 'This snack has no photo.' });
    }

    const file = req.query.size === 'thumb'
      ? (await downloadThumbnail(snack.driveFileId)) || (await downloadFileWithType(snack.driveFileId))
      : await downloadFileWithType(snack.driveFileId);
    if (!file?.stream) {
      return res.status(404).json({ error: 'Not Found', message: 'This photo is no longer available.' });
    }
    // helmet sends X-Content-Type-Options: nosniff, so a response with no
    // Content-Type is not rendered as an image — it is offered as a download or
    // dropped. The type has to come from Drive, not from a guess.
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    // A snack photo never changes once uploaded — a new picture means a new
    // Drive file — so the browser can hold it instead of refetching sixteen
    // images every time somebody opens the cabinet.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    file.stream.on('error', (err) => next(err));
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks — create a snack item
export const createSnack = async (req, res, next) => {
  try {
    const { name, cost, image } = req.body;
    if (!name || cost === undefined || isNaN(parseInt(cost))) {
      return res.status(400).json({ message: 'name and cost are required.' });
    }
    const { driveFileId, imageUrl } = await storeSnackImage(image, name);
    const item = await prisma.snackItem.create({
      data: { name, costPunches: parseInt(cost), driveFileId, imageUrl },
    });
    res.status(201).json({ snack: snackView(item) });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/rewards/snacks/:id — soft-delete a snack item
export const deleteSnack = async (req, res, next) => {
  try {
    await prisma.snackItem.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Snack removed.' });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks/purchase — { studentId, snackId }
// Decrements punches and records the purchase atomically.
export const purchaseSnack = async (req, res, next) => {
  try {
    const { studentId, snackId } = req.body;
    if (!studentId || !snackId) {
      return res.status(400).json({ message: 'studentId and snackId are required.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [student, snack] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: studentId } }),
        tx.snackItem.findUniqueOrThrow({ where: { id: snackId } }),
      ]);

      // Snack punches are for in-person students only — block online-only students.
      if (!(await canUseSnackPunches(studentId, tx))) {
        return { onlineStudent: true };
      }

      if (snack.costPunches > student.snackPunches) {
        return { insufficientBalance: true, currentBalance: student.snackPunches };
      }

      const newBalance = student.snackPunches - snack.costPunches;
      await tx.user.update({ where: { id: studentId }, data: { snackPunches: newBalance } });
      await tx.snackPurchase.create({
        data: { studentId, snackId, punchesUsed: snack.costPunches },
      });
      return { newBalance, snackName: snack.name };
    });

    if (result.onlineStudent) {
      return res.status(403).json({
        message: 'Snack punches are only available to in-person students.',
      });
    }

    if (result.insufficientBalance) {
      return res.status(400).json({
        message: `Student only has ${result.currentBalance} punches — cannot afford this snack.`,
      });
    }

    // Card just ran out — ask the parent to approve a paid reload (best-effort,
    // never blocks the purchase response).
    if (result.newBalance <= 0) {
      await maybeCreateReloadRequest(studentId, req.user?.id);
    }

    res.json({ success: true, newBalance: result.newBalance, snackName: result.snackName });
  } catch (error) {
    next(error);
  }
};

// GET /api/rewards/snacks/reload-requests?status=APPROVED
// Front-desk queue of reload requests. Defaults to parent-approved ones that
// are waiting to be topped up + charged.
export const listReloadRequests = async (req, res, next) => {
  try {
    const status = req.query.status || 'APPROVED';
    const requests = await prisma.snackReloadRequest.findMany({
      where: { status },
      orderBy: { decidedAt: 'asc' },
      include: {
        student: { select: { id: true, fullName: true } },
        family: { select: { id: true, name: true } },
      },
    });
    res.json({
      requests: requests.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.student?.fullName || 'Student',
        familyName: r.family?.name || null,
        punchCount: r.punchCount,
        price: Number(r.price),
        status: r.status,
        decidedAt: r.decidedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks/reload-requests/:id/fulfill
// Adds the approved punches to the student AND records the CHARGE against the
// family, atomically. Only allowed once the parent has approved.
export const fulfillReloadRequest = async (req, res, next) => {
  try {
    const fulfilledById = req.user.id;

    const request = await prisma.snackReloadRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!request) {
      return res.status(404).json({ message: 'Reload request not found.' });
    }
    if (request.status !== 'APPROVED') {
      return res.status(409).json({
        message: `This request is ${request.status.toLowerCase()} — only parent-approved reloads can be fulfilled.`,
      });
    }

    // Online-only students can't hold snack punches — refuse the top-up.
    if (!(await canUseSnackPunches(request.studentId))) {
      return res.status(403).json({
        message: 'Snack punches are only available to in-person students.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atomically claim the request first (same idempotency pattern as
      // resolveCancellation): a double-click, two admins on the same queue, or
      // a network retry must never add punches or charge the family twice.
      const claimed = await tx.snackReloadRequest.updateMany({
        where: { id: request.id, status: 'APPROVED' },
        data: { status: 'FULFILLED', fulfilledById, fulfilledAt: new Date() },
      });
      if (claimed.count === 0) return { alreadyFulfilled: true };

      const student = await tx.user.update({
        where: { id: request.studentId },
        data: { snackPunches: { increment: request.punchCount } },
        select: { snackPunches: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          studentId: request.studentId,
          familyId: request.familyId,
          amount: request.price,
          type: 'CHARGE',
          description: `Snack punch reload — ${request.punchCount} punch(es)`,
        },
      });

      await tx.snackReloadRequest.update({
        where: { id: request.id },
        data: { transactionId: transaction.id },
      });

      return { newBalance: student.snackPunches };
    });

    if (result.alreadyFulfilled) {
      return res.status(409).json({ message: 'This reload was already fulfilled.' });
    }

    res.json({ success: true, newBalance: result.newBalance });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────── SEASHELLS / PRIZES ──────────────────────── */

// POST /api/rewards/seashells/award — { studentIds[], reason, points }
// Bulk-awards seashells and logs each in prize history.
export const awardSeashells = async (req, res, next) => {
  try {
    const { studentIds, reason, points } = req.body;
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    const pts = parseInt(points);
    if (ids.length === 0 || isNaN(pts) || !reason) {
      return res.status(400).json({ message: 'studentIds, reason and points are required.' });
    }

    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { seashells: { increment: pts } },
      }),
      prisma.prizeHistory.createMany({
        data: ids.map(id => ({ studentId: id, reason, points: pts, type: 'EARNED' })),
      }),
    ]);

    res.json({ success: true, awarded: ids.length, points: pts });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/seashells/redeem — { studentId, reason, points }
export const redeemSeashells = async (req, res, next) => {
  try {
    const { studentId, reason, points } = req.body;
    const pts = parseInt(points);
    if (!studentId || isNaN(pts) || !reason) {
      return res.status(400).json({ message: 'studentId, reason and points are required.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.user.findUniqueOrThrow({ where: { id: studentId } });
      if (pts > student.seashells) {
        return { insufficientBalance: true, currentBalance: student.seashells };
      }
      const newBalance = student.seashells - pts;
      await tx.user.update({ where: { id: studentId }, data: { seashells: newBalance } });
      await tx.prizeHistory.create({
        data: { studentId, reason, points: pts, type: 'REDEEMED' },
      });
      return { newBalance };
    });

    if (result.insufficientBalance) {
      return res.status(400).json({
        message: `Student only has ${result.currentBalance} seashells — cannot redeem ${pts}.`,
      });
    }

    res.json({ success: true, newBalance: result.newBalance });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/seashells/remove — { studentId, reason, points }
// Takes shells off a balance without a prize changing hands: a miscounted
// award, shells given to the wrong student, a behaviour correction. Logged as
// REMOVED so prize history never claims the student got something for them.
export const removeSeashells = async (req, res, next) => {
  try {
    const { studentId, reason, points } = req.body;
    const pts = parseInt(points);
    if (!studentId || isNaN(pts) || pts <= 0 || !reason) {
      return res.status(400).json({ message: 'studentId, reason and a positive points amount are required.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.user.findUniqueOrThrow({ where: { id: studentId } });
      if (pts > student.seashells) {
        return { insufficientBalance: true, currentBalance: student.seashells };
      }
      const newBalance = student.seashells - pts;
      await tx.user.update({ where: { id: studentId }, data: { seashells: newBalance } });
      await tx.prizeHistory.create({
        data: { studentId, reason, points: pts, type: 'REMOVED' },
      });
      return { newBalance };
    });

    if (result.insufficientBalance) {
      return res.status(400).json({
        message: `Student only has ${result.currentBalance} seashells — cannot remove ${pts}.`,
      });
    }

    res.json({ success: true, newBalance: result.newBalance });
  } catch (error) {
    next(error);
  }
};
