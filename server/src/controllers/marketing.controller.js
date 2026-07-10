import prisma from '../config/database.js';
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

    const submission = await prisma.marketingSubmission.create({
      data: {
        teacherId,
        weekOf: new Date(weekOf),
        type,
        title: title || null,
        description: description || null,
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
    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    }

    if (weekOf) where.weekOf = new Date(weekOf);
    if (type) where.type = type;
    if (status) where.status = status;

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

    if (req.user.role !== 'ADMIN' && submission.teacherId !== req.user.id) {
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
