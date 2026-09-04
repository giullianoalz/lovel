import fs from 'fs';
import path from 'path';
import prisma from '../config/database.js';
import { allRoles, hasRole } from '../utils/roles.js';
import { invalidate } from '../middleware/cache.js';
import {
  drive, driveAuthMode, uploadFileToDrive, downloadFileWithType,
} from '../config/drive.js';
import { notifyAdmins, sendNotification } from '../jobs/notification.helper.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'announcements');

// Local disk only lasts as long as the process. On Render the container is
// replaced on every restart and comes back with an empty filesystem, so a
// photo that never reached Drive is gone before anyone reloads the feed —
// which is exactly how a post published on the 30th showed its pictures that
// evening and served four broken images the next morning. Drive is therefore
// the store; disk is kept only as a same-process fast path.
const localDiskIsDurable = () => process.env.NODE_ENV === 'development';

const isVideo = (mimetype) => (mimetype || '').startsWith('video/');

/**
 * Pushes the just-uploaded files to Drive and returns the rows worth writing.
 * A file that reached nowhere durable is dropped rather than recorded, so the
 * feed never lists media it cannot produce.
 */
const storeMediaFiles = async (files, startPosition = 0) => {
  if (files.length === 0) return { rows: [], failed: [], warning: null };

  // Falls back to the marketing folder so this works on the Render config as
  // it stands, with no new variable to set; point the announcements one at its
  // own folder to keep the two apart.
  const folderId = process.env.DRIVE_ANNOUNCEMENTS_FOLDER_ID || process.env.DRIVE_MARKETING_FOLDER_ID || null;
  let driveError = null;

  const results = await Promise.all(files.map(async (file, i) => {
    let driveFileId = null;

    if (drive) {
      try {
        const uploaded = await uploadFileToDrive(file.path, file.originalname, file.mimetype, folderId);
        driveFileId = uploaded?.id || null;
      } catch (err) {
        console.error(`[Announcements] Drive upload failed for ${file.originalname}:`, err.message);
        driveError = err.message;
      }
    }

    if (!driveFileId && !localDiskIsDurable()) {
      // Nothing durable holds it, so drop the file rather than promise the
      // author it was published.
      await fs.promises.unlink(file.path).catch(() => {});
      return { ok: false, fileName: file.originalname };
    }

    return {
      ok: true,
      row: {
        url: `/uploads/announcements/${file.filename}`,
        driveFileId,
        type: isVideo(file.mimetype) ? 'video' : 'image',
        position: startPosition + i,
      },
    };
  }));

  const rows = results.filter(r => r.ok).map(r => r.row);
  const failed = results.filter(r => !r.ok).map(r => r.fileName);

  // The post itself is the point, so losing its text because Drive is down
  // would be the worse failure: publish what made it and hand the rest back
  // for the composer to report.
  const warning = failed.length === 0 ? null
    : `${failed.length} of ${files.length} attachment(s) could not be saved. ` + (
      driveAuthMode === 'none'
        ? 'Google Drive is not configured on the server.'
        : driveAuthMode === 'service-account'
          ? 'Google Drive is using a service account, which has no storage quota. Set DRIVE_REFRESH_TOKEN.'
          : `Google Drive rejected the upload${driveError ? `: ${driveError}` : '.'}`
    );

  return { rows, failed, warning };
};


/**
 * Everything that happens the moment a post actually goes up: the live feed
 * gets it, and everyone it was aimed at gets a push.
 *
 * Split out of createAnnouncement because publishing is no longer the same
 * moment as writing. A teacher's post is written now and published when an
 * admin says so, and the audience must hear about it then — not at the moment
 * nobody could see it yet.
 */
const publishAnnouncement = (req, announcement) => {
  const io = req.app.get('io');
  if (io) io.emit('new_announcement', announcement);

  const audience = announcement.targetAudience;
  const roleFilter = audience === 'parent' ? 'PARENT' : audience === 'teacher' ? 'TEACHER' : null;
  prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(announcement.authorId ? { id: { not: announcement.authorId } } : {}),
      // Secondary roles count too, or a teacher who is also a parent would
      // never be pushed the announcements aimed at families.
      ...(roleFilter
        ? { OR: [{ role: roleFilter }, { secondaryRoles: { has: roleFilter } }] }
        : {}),
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
};

/**
 * Who may put a post straight on the board, and who is filing a draft.
 *
 * An admin publishes; anyone else on staff submits. The rule is the same one
 * that governs invitations and invoices here — nothing reaches families that an
 * admin has not read first — so the answer is exactly "is this person an
 * admin", not "which screen did they use".
 */
export const publishesDirectly = (user) => hasRole(user, 'ADMIN');

export const createAnnouncement = async (req, res, next) => {
  try {
    const { title, body, targetAudience, category, expiresAt, isPinned } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Validation Error', message: 'title and body are required.' });
    }

    // Only admins may pin a post to the top of the feed.
    const canPin = hasRole(req.user, 'ADMIN');
    const autoApprove = publishesDirectly(req.user);
    const files = req.files || [];

    const { rows: mediaRows, warning: mediaWarning } = await storeMediaFiles(files);

    const announcement = await prisma.announcement.create({
      data: {
        title,
        body,
        targetAudience: targetAudience || 'all',
        category: category || 'general',
        // imageUrl is a bare local path with nothing behind it, so new posts
        // leave it null and carry everything in `media`. The column stays on
        // the model only for posts written before that existed.
        imageUrl: null,
        isPinned: canPin && (isPinned === 'true' || isPinned === true),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        authorId: req.user.id,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        reviewedById: autoApprove ? req.user.id : null,
        reviewedAt: autoApprove ? new Date() : null,
        media: mediaRows.length > 0 ? { create: mediaRows } : undefined,
      },
      include: {
        author: { select: { fullName: true, role: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });

    invalidate('announcements:*'); // evict all users' announcement caches

    if (autoApprove) {
      publishAnnouncement(req, announcement);
    } else {
      // Nobody but the author and the admins can see it yet, so the queue has
      // to come to them rather than wait to be noticed.
      notifyAdmins({
        type: 'ANNOUNCEMENT_PENDING',
        title: '📝 Announcement waiting for approval',
        message: `${req.user.fullName} submitted "${announcement.title}".`,
        referenceType: 'announcement',
        referenceId: announcement.id,
        io: req.app.get('io'),
      }).catch(() => {});
    }

    res.status(201).json({
      message: autoApprove
        ? 'Announcement created successfully'
        : 'Submitted for admin approval. It goes up once an admin approves it.',
      announcement,
      ...(mediaWarning && { mediaWarning }),
    });
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
    if (!hasRole(req.user, 'ADMIN') && !isAuthor) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own posts.' });
    }

    await prisma.announcement.delete({ where: { id } });
    invalidate('announcements:*');
    res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    next(error);
  }
};

export const updateAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not Found' });

    // Only admins or the original author may edit.
    const isAuthor = existing.authorId === req.user.id;
    if (!hasRole(req.user, 'ADMIN') && !isAuthor) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only edit your own posts.' });
    }

    const { title, body, category, targetAudience, isPinned, removeMediaIds } = req.body;
    const canPin = hasRole(req.user, 'ADMIN');
    const newFiles = req.files || [];

    // An author who can't publish can't edit their way past the review either:
    // approving a post about the open house and finding it now says something
    // else is exactly what the approval is meant to prevent. Their edit sends
    // the post back to PENDING — including one that was rejected, which is the
    // normal way to answer the note and resubmit.
    const returnsToQueue = !publishesDirectly(req.user);

    // Start at 1000 so additions land after whatever the post already had.
    const { rows: mediaRows, warning: mediaWarning } = await storeMediaFiles(newFiles, 1000);

    // Optionally remove specific existing media items.
    if (removeMediaIds) {
      const ids = Array.isArray(removeMediaIds) ? removeMediaIds : [removeMediaIds];
      await prisma.announcementMedia.deleteMany({ where: { id: { in: ids }, announcementId: id } });
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title       !== undefined && { title }),
        ...(body        !== undefined && { body }),
        ...(category    !== undefined && { category }),
        ...(targetAudience !== undefined && { targetAudience }),
        ...(isPinned    !== undefined && canPin && { isPinned: isPinned === 'true' || isPinned === true }),
        ...(mediaRows.length > 0 && { media: { create: mediaRows } }),
        ...(returnsToQueue && {
          status: 'PENDING',
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
        }),
      },
      include: {
        author: { select: { fullName: true, role: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });

    invalidate('announcements:*');

    if (returnsToQueue) {
      notifyAdmins({
        type: 'ANNOUNCEMENT_PENDING',
        title: '📝 Announcement waiting for approval',
        message: `${req.user.fullName} updated "${updated.title}" and resubmitted it.`,
        referenceType: 'announcement',
        referenceId: updated.id,
        io: req.app.get('io'),
      }).catch(() => {});
    }

    res.json({
      message: returnsToQueue
        ? 'Saved and sent back for admin approval.'
        : 'Announcement updated.',
      announcement: updated,
      ...(mediaWarning && { mediaWarning }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Which posts this account may pull out of the feed.
 *
 * Audience is matched against every role the account holds, so a teacher who is
 * also a parent sees both the staff feed and the one meant for families.
 *
 * Admins get the board and the queue in one list — a post awaiting review sits
 * in place with its banner, so approving it happens where they were already
 * looking rather than on a second screen they have to remember to open.
 *
 * Everyone else gets what is approved and aimed at them, plus their own
 * submissions whatever state those are in: a teacher has to be able to watch
 * their post wait, and read the note if it comes back.
 */
export const feedVisibilityWhere = (user) =>
  hasRole(user, 'ADMIN')
    ? {}
    : {
        OR: [
          {
            status: 'APPROVED',
            targetAudience: { in: ['all', ...allRoles(user).map(r => r.toLowerCase())] },
          },
          { authorId: user.id },
        ],
      };

export const listAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const baseWhere = feedVisibilityWhere(req.user);

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
        // Threads are short — a handful of replies to an open house — so they
        // ride along with the feed rather than costing a request per card.
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, fullName: true, role: true } } },
        },
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

/**
 * Can this account see this announcement at all? Replies are gated on the same
 * answer as reading, so a "staff only" post can't be commented on — or read
 * back — by a parent who guessed the id.
 */
export const canSeeAnnouncement = (user, announcement) =>
  hasRole(user, 'ADMIN') ||
  // Its author, whatever state it is in — they wrote it and may be waiting on
  // it. For everyone else an unapproved post does not exist yet: it has not
  // been read by an admin, so it is not on the board and cannot be replied to.
  announcement.authorId === user.id ||
  (announcement.status === 'APPROVED' && (
    announcement.targetAudience === 'all' ||
    allRoles(user).map(r => r.toLowerCase()).includes(announcement.targetAudience)
  ));

/**
 * GET /api/announcements/media/:mediaId/file
 * Streams one carousel item. The bytes are never on a public URL: Drive holds
 * them privately and this route is what turns an id into pixels, so the same
 * audience rule that hides a staff-only post also hides its photos.
 */
export const getAnnouncementMediaFile = async (req, res, next) => {
  try {
    const { mediaId } = req.params;

    const media = await prisma.announcementMedia.findUnique({
      where: { id: mediaId },
      include: { announcement: { select: { targetAudience: true, status: true, authorId: true } } },
    });
    if (!media) return res.status(404).json({ error: 'Not Found' });
    // 404 rather than 403, as everywhere else here: whether a staff-only post
    // exists is not a parent's business either.
    if (!canSeeAnnouncement(req.user, media.announcement)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    if (media.driveFileId) {
      try {
        const file = await downloadFileWithType(media.driveFileId);
        if (file?.stream) {
          // Without a Content-Type, helmet's nosniff makes the browser refuse
          // to render a perfectly good image.
          if (file.mimeType) res.setHeader('Content-Type', file.mimeType);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          file.stream.on('error', (err) => next(err));
          return file.stream.pipe(res);
        }
      } catch (err) {
        console.error(`[Announcements] Drive download failed for media ${mediaId}, falling back to local disk:`, err.message);
      }
    }

    const localPath = path.join(UPLOAD_DIR, path.basename(media.url));
    if (fs.existsSync(localPath)) return res.sendFile(localPath);

    // Posted before this route existed, and wiped with the container since.
    res.status(404).json({ error: 'Not Found', message: 'This file is no longer available.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/announcements/:id/comments
 * Reply to an announcement. Open to every role that can see the post: the
 * whole point is that a parent can answer "are siblings welcome?" where
 * everyone else with the same question is already looking.
 */
export const addAnnouncementComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = (req.body?.body || '').trim();

    if (!body) {
      return res.status(400).json({ error: 'Validation Error', message: 'A reply can\'t be empty.' });
    }
    if (body.length > 2000) {
      return res.status(400).json({ error: 'Validation Error', message: 'A reply is limited to 2000 characters.' });
    }

    const announcement = await prisma.announcement.findUnique({ where: { id } });
    if (!announcement) return res.status(404).json({ error: 'Not Found' });
    // Same 404 rather than 403 for an audience mismatch: whether a staff-only
    // post exists isn't a parent's business either.
    if (!canSeeAnnouncement(req.user, announcement)) return res.status(404).json({ error: 'Not Found' });

    const comment = await prisma.announcementComment.create({
      data: { announcementId: id, authorId: req.user.id, body },
      include: { author: { select: { id: true, fullName: true, role: true } } },
    });

    invalidate('announcements:*'); // the thread rides along with the feed

    const io = req.app.get('io');
    if (io) io.emit('announcement_comment', { announcementId: id, comment });

    // Only the person who posted gets pushed. Notifying the whole audience
    // would turn one open-house question into 100 phone buzzes.
    if (announcement.authorId && announcement.authorId !== req.user.id) {
      import('../utils/pushNotifications.js').then(({ sendPushNotification }) => {
        sendPushNotification(
          [announcement.authorId],
          `💬 Reply on "${announcement.title}"`,
          `${req.user.fullName}: ${body.slice(0, 120)}`,
          { type: 'ACADEMY_FEED', announcementId: id, link: '/feed' }
        );
      }).catch(() => {});
    }

    res.status(201).json({ message: 'Reply posted.', comment });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/announcements/:id/comments/:commentId
 * Remove a reply. Its author can take back their own words; an admin can
 * clear anything off the board they own.
 */
export const deleteAnnouncementComment = async (req, res, next) => {
  try {
    const { id, commentId } = req.params;

    const comment = await prisma.announcementComment.findFirst({
      where: { id: commentId, announcementId: id },
    });
    if (!comment) return res.status(404).json({ error: 'Not Found' });

    if (comment.authorId !== req.user.id && !hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own replies.' });
    }

    await prisma.announcementComment.delete({ where: { id: commentId } });
    invalidate('announcements:*');

    const io = req.app.get('io');
    if (io) io.emit('announcement_comment_deleted', { announcementId: id, commentId });

    res.json({ message: 'Reply removed.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/announcements/:id/review
 * An admin says yes or no to a submitted post. Body: { decision: 'approve' |
 * 'reject', note? }.
 *
 * Approving is what publishes: only here does the audience get pushed, and
 * `publishedAt` is reset to now so the post appears at the top of the feed at
 * the moment it becomes true, not at the moment it was drafted.
 *
 * Rejecting keeps the post. The author sees the note and edits, which puts it
 * back in the queue — a rejection is a round of feedback, not a deletion.
 */
export const reviewAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const decision = String(req.body?.decision || '').toLowerCase();
    const note = (req.body?.note || '').trim() || null;

    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({
        error: 'Validation Error',
        message: "decision must be 'approve' or 'reject'.",
      });
    }

    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not Found' });

    // Re-approving something already on the board would push the whole academy
    // a second time for a post they have already read.
    if (existing.status === 'APPROVED' && decision === 'approve') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This post is already published.',
      });
    }

    const approved = decision === 'approve';
    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNote: note,
        ...(approved && { publishedAt: new Date() }),
      },
      include: {
        author: { select: { id: true, fullName: true, role: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });

    invalidate('announcements:*');

    if (approved) publishAnnouncement(req, announcement);

    // The author is told either way — waiting on silence is the thing that
    // makes an approval step feel like a wall.
    if (announcement.authorId && announcement.authorId !== req.user.id) {
      sendNotification({
        userId: announcement.authorId,
        type: 'ANNOUNCEMENT_REVIEWED',
        title: approved ? '✅ Your announcement is live' : '↩️ Your announcement needs changes',
        message: approved
          ? `"${announcement.title}" was approved and is on the board.`
          : `"${announcement.title}" was sent back${note ? `: ${note}` : '.'}`,
        referenceType: 'announcement',
        referenceId: announcement.id,
        link: '/feed',
      }).catch(() => {});
    }

    res.json({
      message: approved ? 'Announcement approved and published.' : 'Announcement sent back to its author.',
      announcement,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/announcements/pending
 * The admin's queue, oldest first — the one that has waited longest is the one
 * most likely to be about something happening tomorrow.
 */
export const listPendingAnnouncements = async (req, res, next) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: { status: 'PENDING' },
      include: {
        author: { select: { id: true, fullName: true, role: true } },
        media: { orderBy: { position: 'asc' } },
      },
      orderBy: { publishedAt: 'asc' },
    });
    res.json({ announcements, count: announcements.length });
  } catch (error) {
    next(error);
  }
};
