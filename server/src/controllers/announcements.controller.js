import prisma from '../config/database.js';

export const createAnnouncement = async (req, res, next) => {
  try {
    const { title, body, targetAudience, expiresAt } = req.body;
    
    const announcement = await prisma.announcement.create({
      data: {
        title,
        body,
        targetAudience: targetAudience || 'all',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        authorId: req.user.id
      }
    });

    res.status(201).json({ message: 'Announcement created successfully', announcement });
  } catch (error) {
    next(error);
  }
};

export const listAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Determine the user's audience groups based on role
    // For simplicity, we fetch all non-expired announcements that match 'all' or the user's role
    const announcements = await prisma.announcement.findMany({
      where: {
        OR: [
          { targetAudience: 'all' },
          { targetAudience: req.user.role.toLowerCase() }
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } }
            ]
          }
        ]
      },
      include: {
        author: { select: { fullName: true } },
        reads: {
          where: { userId }
        }
      },
      orderBy: { publishedAt: 'desc' }
    });

    // Format response to include an isRead boolean
    const formatted = announcements.map(ann => ({
      ...ann,
      isRead: ann.reads && ann.reads.length > 0
    }));

    res.json({ announcements: formatted });
  } catch (error) {
    next(error);
  }
};

export const markAnnouncementRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Use upsert to avoid unique constraint violations if called multiple times
    const read = await prisma.announcementRead.upsert({
      where: {
        userId_announcementId: {
          userId,
          announcementId: id
        }
      },
      update: {
        readAt: new Date()
      },
      create: {
        userId,
        announcementId: id
      }
    });

    res.json({ message: 'Announcement marked as read', read });
  } catch (error) {
    next(error);
  }
};
