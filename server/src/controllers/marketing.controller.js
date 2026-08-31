import prisma from '../config/database.js';
import { hasRole, isOnly } from '../utils/roles.js';
import path from 'path';
import fs from 'fs';
import { uploadFileToDrive, downloadFileFromDrive, drive, driveAuthMode } from '../config/drive.js';

// Ensure upload directory exists
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'marketing');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// POST /api/marketing/submissions — Teacher submits weekly content
export const createSubmission = async (req, res, next) => {
  try {
    const { weekOf, type, title, description } = req.body;
    const teacherId = req.user.id;

    if (!weekOf || !type) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'weekOf and type are required.',
      });
    }

    // Marketing can't use a submission it can't interpret, so a description of
    // the activity is mandatory — blank ones are what made the gallery unreadable.
    if (!description || !description.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'A description of the activity is required.',
      });
    }

    const submission = await prisma.marketingSubmission.create({
      data: {
        teacherId,
        weekOf: new Date(weekOf),
        type,
        title: title?.trim() || null,
        description: description.trim(),
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        photos: true,
      },
    });

    res.status(201).json({ submission });
  } catch (error) {
    next(error);
  }
};

// GET /api/marketing/submissions — List all submissions (with week filter)
export const listSubmissions = async (req, res, next) => {
  try {
    const { weekOf, type, status } = req.query;

    const where = {};

    // Teachers only see their own submissions
    if (isOnly(req.user, 'TEACHER')) {
      where.teacherId = req.user.id;
    }

    if (weekOf) where.weekOf = new Date(weekOf);
    if (type) where.type = type;
    if (status) where.status = status;

    // Hide submissions that carry neither photos nor a description — they say
    // nothing and can't be reviewed or posted. These piled up whenever a photo
    // upload failed after the record had already been created. A text-only
    // Student/Activity of the Week is still real content, so a description
    // alone is enough to keep a submission visible.
    where.OR = [
      { photos: { some: {} } },
      { AND: [{ description: { not: null } }, { description: { not: '' } }] },
    ];

    const submissions = await prisma.marketingSubmission.findMany({
      where,
      include: {
        teacher: { select: { id: true, fullName: true } },
        photos: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ submissions });
  } catch (error) {
    next(error);
  }
};

// GET /api/marketing/feed — what families see.
//
// Deliberately a separate endpoint rather than a role branch inside
// listSubmissions: that one is a review queue and exposes the pipeline —
// who submitted what, what is still pending. Parents get the finished product
// only, a submission an admin has already cleared. `submitted` never appears
// here, which is the entire point of the approval step.
export const FAMILY_VISIBLE_STATUSES = ['approved', 'posted'];

export const listFamilyFeed = async (req, res, next) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = req.query.before ? new Date(req.query.before) : null;

    const submissions = await prisma.marketingSubmission.findMany({
      where: {
        status: { in: FAMILY_VISIBLE_STATUSES },
        ...(before ? { createdAt: { lt: before } } : {}),
        // Same emptiness guard as the review queue: a card with neither photos
        // nor a description says nothing, and to a parent it reads as a bug.
        OR: [
          { photos: { some: {} } },
          { AND: [{ description: { not: null } }, { description: { not: '' } }] },
        ],
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        photos: { select: { id: true, fileName: true }, orderBy: { uploadedAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = submissions.length > take;
    const page = hasMore ? submissions.slice(0, take) : submissions;

    // fileUrl and driveFileId stay on the server. A family needs a photo's id
    // to stream its bytes through /photos/:id/file and nothing more; handing
    // out the Drive id would invite trying that file directly.
    res.json({
      submissions: page,
      hasMore,
      nextBefore: hasMore ? page[page.length - 1].createdAt : null,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/marketing/submissions/:id — Admin approves/marks as posted
export const updateSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, driveUrl } = req.body;

    const data = {};
    if (status) data.status = status;
    if (driveUrl) data.driveUrl = driveUrl;

    const updated = await prisma.marketingSubmission.update({
      where: { id },
      data,
      include: {
        teacher: { select: { id: true, fullName: true } },
        photos: true,
      },
    });

    res.json({ submission: updated });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/marketing/submissions/:id — roll back a submission whose photo
// upload failed. Deliberately refuses once photos exist, so a partial upload
// keeps whatever made it through and this can never destroy real content.
export const deleteSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;

    const submission = await prisma.marketingSubmission.findUnique({
      where: { id },
      include: { _count: { select: { photos: true } } },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Not Found', message: 'Submission not found.' });
    }

    if (!hasRole(req.user, 'ADMIN') && submission.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own submissions.' });
    }

    if (submission._count.photos > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This submission already has photos and cannot be discarded.',
      });
    }

    await prisma.marketingSubmission.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

// POST /api/marketing/submissions/:id/photos — Upload photos
export const uploadPhotos = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify submission exists and teacher owns it (or is admin)
    const submission = await prisma.marketingSubmission.findUnique({
      where: { id },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Not Found', message: 'Submission not found.' });
    }

    if (!hasRole(req.user, 'ADMIN') && submission.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only upload to your own submissions.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'No files uploaded.' });
    }

    // Local disk only survives where the process does. On Render it is wiped on
    // every restart, so a photo that never reached Drive is already lost the
    // moment it is written — recording it anyway is what produced 35 rows
    // pointing at bytes that no longer exist. A row is therefore only created
    // once the file is somewhere durable.
    const folderId = process.env.DRIVE_MARKETING_FOLDER_ID || null;
    const localDiskIsDurable = process.env.NODE_ENV === 'development';

    let driveError = null;

    const results = await Promise.all(
      req.files.map(async (file) => {
        let driveFileId = null;

        if (drive) {
          try {
            const driveFile = await uploadFileToDrive(file.path, file.originalname, file.mimetype, folderId);
            driveFileId = driveFile?.id || null;
          } catch (driveErr) {
            console.error(`[Marketing] Drive upload failed for ${file.originalname}:`, driveErr.message);
            driveError = driveErr.message;
          }
        }

        if (!driveFileId && !localDiskIsDurable) {
          // Nothing durable holds this file, so drop the upload rather than
          // promise the teacher it was saved.
          await fs.promises.unlink(file.path).catch(() => {});
          return { ok: false, fileName: file.originalname };
        }

        const photo = await prisma.marketingPhoto.create({
          data: {
            submissionId: id,
            fileUrl: `/uploads/marketing/${file.filename}`,
            fileName: file.originalname,
            driveFileId,
          },
        });
        return { ok: true, photo };
      })
    );

    const photos = results.filter(r => r.ok).map(r => r.photo);
    const failed = results.filter(r => !r.ok).map(r => r.fileName);

    if (failed.length > 0) {
      const reason = driveAuthMode === 'none'
        ? 'Google Drive is not configured on the server.'
        : driveAuthMode === 'service-account'
          ? 'Google Drive is using a service account, which has no storage quota. Set DRIVE_REFRESH_TOKEN.'
          : `Google Drive rejected the upload${driveError ? `: ${driveError}` : '.'}`;

      return res.status(502).json({
        error: 'Storage Error',
        message: `${failed.length} of ${req.files.length} photo(s) could not be stored. ${reason}`,
        failed,
        photos,
      });
    }

    res.status(201).json({ photos });
  } catch (error) {
    next(error);
  }
};

// GET /api/marketing/photos/:photoId/file — stream a photo's bytes.
// Local disk on Render is wiped on every restart, so Drive (if the photo made
// it there) is the durable copy; local disk is only a fallback for dev or for
// the brief window before the Drive upload finishes.
export const getPhotoFile = async (req, res, next) => {
  try {
    const { photoId } = req.params;

    const photo = await prisma.marketingPhoto.findUnique({
      where: { id: photoId },
      include: { submission: { select: { status: true } } },
    });
    if (!photo) {
      return res.status(404).json({ error: 'Not Found', message: 'Photo not found.' });
    }

    // The route is open to any signed-in user so families can load the gallery,
    // so the release check lives here: staff see everything, everyone else only
    // photos hanging off a submission an admin has already cleared. Without it,
    // a parent holding a photo id could pull a pending submission's pictures
    // straight out of the review queue.
    if (!hasRole(req.user, 'ADMIN', 'TEACHER')
        && !FAMILY_VISIBLE_STATUSES.includes(photo.submission?.status)) {
      return res.status(404).json({ error: 'Not Found', message: 'Photo not found.' });
    }

    if (photo.driveFileId) {
      try {
        const stream = await downloadFileFromDrive(photo.driveFileId);
        if (stream) {
          res.setHeader('Cache-Control', 'private, max-age=3600');
          stream.on('error', (err) => next(err));
          return stream.pipe(res);
        }
      } catch (driveErr) {
        console.error(`[Marketing] Drive download failed for photo ${photoId}, falling back to local disk:`, driveErr.message);
      }
    }

    const localPath = path.join(UPLOAD_DIR, path.basename(photo.fileUrl));
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    res.status(404).json({ error: 'Not Found', message: 'This photo is no longer available.' });
  } catch (error) {
    next(error);
  }
};

// GET /api/marketing/submissions/:id — Get a single submission with photos
export const getSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;

    const submission = await prisma.marketingSubmission.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, fullName: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
      },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Not Found', message: 'Submission not found.' });
    }

    res.json({ submission });
  } catch (error) {
    next(error);
  }
};
