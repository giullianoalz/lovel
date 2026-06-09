import prisma from '../config/database.js';

export const createAssignment = async (req, res, next) => {
  try {
    const { classId, title, description, dueDate, maxScore } = req.body;
    
    // Ensure the teacher owns the class or is admin
    const assignment = await prisma.assignment.create({
      data: {
        classId,
        teacherId: req.user.id,
        title,
        description,
        dueDate: new Date(dueDate),
        maxScore: maxScore ? parseFloat(maxScore) : null,
      },
      include: {
        class: true,
      }
    });

    res.status(201).json({ message: 'Assignment created successfully', assignment });
  } catch (error) {
    next(error);
  }
};

export const listAssignments = async (req, res, next) => {
  try {
    const { classId } = req.query;
    const where = {};
    if (classId) where.classId = classId;
    
    // If student, only show assignments for classes they are enrolled in
    if (req.user.role === 'STUDENT') {
      const enrollments = await prisma.classEnrollment.findMany({
        where: { studentId: req.user.id },
        select: { classId: true }
      });
      const classIds = enrollments.map(e => e.classId);
      
      where.classId = classId ? classId : { in: classIds };
    }

    const assignments = await prisma.assignment.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        class: {
          select: { name: true, subject: true }
        },
        grades: req.user.role === 'STUDENT' ? {
          where: { studentId: req.user.id }
        } : true
      }
    });

    res.json({ assignments });
  } catch (error) {
    next(error);
  }
};

export const gradeAssignment = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;
    const { studentId, score, feedback } = req.body;

    // Use upsert to create or update the grade
    const grade = await prisma.grade.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId,
        }
      },
      update: {
        score: score ? parseFloat(score) : null,
        feedback,
        gradedAt: new Date()
      },
      create: {
        assignmentId,
        studentId,
        score: score ? parseFloat(score) : null,
        feedback,
        gradedAt: new Date()
      },
      include: {
        student: {
          select: { fullName: true }
        }
      }
    });

    res.json({ message: 'Grade saved successfully', grade });
  } catch (error) {
    next(error);
  }
};
