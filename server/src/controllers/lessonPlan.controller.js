import prisma from '../config/database.js';
import path from 'path';
import fs from 'fs';

// Ensure upload directory exists
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'lesson_plans');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// POST /api/lesson-plans
export const createLessonPlan = async (req, res, next) => {
  try {
    const { title, date, classId, content, videoLink } = req.body;
    const teacherId = req.user.id;

    if (!title || !date) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'title and date are required.',
      });
    }

    let fileUrl = null;
    let fileName = null;

    if (req.file) {
      fileUrl = `/uploads/lesson_plans/${req.file.filename}`;
      fileName = req.file.originalname;
    }

    const lessonPlan = await prisma.lessonPlan.create({
      data: {
        title,
        date: new Date(date),
        teacherId,
        classId: classId || null,
        content: content || null,
        fileUrl,
        fileName,
        videoLink: videoLink || null,
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

// GET /api/lesson-plans
export const listLessonPlans = async (req, res, next) => {
  try {
    const { classId, teacherId, from, to } = req.query;

    const where = {};
    if (classId) where.classId = classId;
    if (teacherId) where.teacherId = teacherId;

    // For teachers, only show their own lesson plans
    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    }

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const lessonPlans = await prisma.lessonPlan.findMany({
      where,
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ lessonPlans });
  } catch (error) {
    next(error);
  }
};

// GET /api/lesson-plans/:id
export const getLessonPlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lessonPlan = await prisma.lessonPlan.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
      },
    });

    if (!lessonPlan) {
      return res.status(404).json({ error: 'Not Found', message: 'Lesson Plan not found.' });
    }

    res.json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};
