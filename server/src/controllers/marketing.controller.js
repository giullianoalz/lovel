import prisma from '../config/database.js';
import path from 'path';
import fs from 'fs';

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
      req.files.map((file) =>
        prisma.marketingPhoto.create({
          data: {
            submissionId: id,
            fileUrl: `/uploads/marketing/${file.filename}`,
            fileName: file.originalname,
          },
        })
      )
    );

    res.status(201).json({ photos });
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
