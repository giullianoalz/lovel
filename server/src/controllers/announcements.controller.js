import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';

export const createAnnouncement = async (req, res, next) => {
  try {
    const { title, body, targetAudience, category, expiresAt, isPinned } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Validation Error', message: 'title and body are required.' });
    }

    // Only admins may pin a post to the top of the feed.
    const canPin = req.user.role === 'ADMIN';
    const files = req.files || [];
    const isVideo = (mimetype) => mimetype.startsWith('video/');

    const announcement = await prisma.announcement.create({
      data: {
        title,
        body,
        targetAudience: targetAudience || 'all',
        category: category || 'general',
        // imageUrl kept for backwards compatibility with older posts; new posts use `media`.
        imageUrl: files[0] && !isVideo(files[0].mimetype) ? `/uploads/announcements/${files[0].filename}` : null,
        isPinned: canPin && (isPinned === 'true' || isPinned === true),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        authorId: req.user.id,
        media: files.length > 0 ? {
          create: files.map((file, i) => ({
            url: `/uploads/announcements/${file.filename}`,
            type: isVideo(file.mimetype) ? 'video' : 'image',
            position: i,
          })),
        } : undefined,
      },
      include: {
        author: { select: { fullName: true, role: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });

    invalidate('announcements:*'); // evict all users' announcement caches

    const io = req.app.get('io');
    if (io) io.emit('new_announcement', announcement);

    // Push notification to everyone in the target audience, so parents/staff
    // find out even if they don't have the app open.
    const audience = announcement.targetAudience;
    const roleFilter = audience === 'parent' ? 'PARENT' : audience === 'teacher' ? 'TEACHER' : null;
    prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        id: { not: req.user.id },
        ...(roleFilter ? { role: roleFilter } : {}),
      },
      select: { id: true },
    }).then(recipients => {
      import('../utils/pushNotifications.js').then(({ sendPushNotification }) => {
        sendPushNotification(
          recipients.map(r => r.id),
          `📣 ${announcement.title}`,
          announcement.body,
          { type: 'ACADEMY_FEED', announcementId: announcement.id, link: '/feed' }
        );
      });
    }).catch(() => {});

    res.status(201).json({ message: 'Announcement created successfully', announcement });
  } catch (error) {
    next(error);
  }
};

export const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not Found' });

    const isAuthor = existing.authorId === req.user.id;
    if (req.user.role !== 'ADMIN' && !isAuthor) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own posts.' });
    }

    await prisma.announcement.delete({ where: { id } });
    invalidate('announcements:*');
    res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    next(error);
  }
};

export const listAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const baseWhere = req.user.role === 'ADMIN' 
      ? {} 
      : {
          OR: [
            { targetAudience: 'all' },
            { targetAudience: req.user.role.toLowerCase() }
          ]
        };

    const announcements = await prisma.announcement.findMany({
      where: {
        ...baseWhere,
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
        author: { select: { fullName: true, role: true } },
        reads: {
          where: { userId }
        },
        media: { orderBy: { position: 'asc' } },
      },
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }]
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

    invalidate(`announcements:${req.user.id}`); // stale isRead flag for this user
    res.json({ message: 'Announcement marked as read', read });
  } catch (error) {
    next(error);
  }
};
