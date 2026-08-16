import prisma from '../config/database.js';
import { hasRole, isOnly } from '../utils/roles.js';
import path from 'path';
import fs from 'fs';
import { uploadFileToDrive, downloadFileFromDrive, drive } from '../config/drive.js';

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

    const photos = await Promise.all(
      req.files.map(async (file) => {
        let driveFileId = null;
        
        // Attempt to upload to Google Drive if configured
        if (drive) {
          try {
            // Optional: specify a folder ID if you have one configured
            const folderId = process.env.DRIVE_MARKETING_FOLDER_ID || null;
            const driveFile = await uploadFileToDrive(file.path, file.originalname, file.mimetype, folderId);
            if (driveFile) {
              driveFileId = driveFile.id;
            }
          } catch (driveErr) {
            console.error(`Failed to upload ${file.originalname} to drive:`, driveErr);
            // We continue even if drive upload fails, so the local file record is created
          }
        }

        return prisma.marketingPhoto.create({
          data: {
            submissionId: id,
            fileUrl: `/uploads/marketing/${file.filename}`,
            fileName: file.originalname,
            driveFileId: driveFileId,
          },
        });
      })
    );

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

    const photo = await prisma.marketingPhoto.findUnique({ where: { id: photoId } });
    if (!photo) {
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
