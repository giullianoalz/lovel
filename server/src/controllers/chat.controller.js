import path from 'path';
import fs from 'fs';
import prisma from '../config/database.js';
import { generateAssistantReply } from '../services/ai.service.js';
import { findContactInfo } from '../utils/contentFilter.js';
import { uploadFileToDrive, downloadFileFromDrive, drive } from '../config/drive.js';

const CHAT_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'chat');

const formatAttachment = (msg) => ({
  fileUrl: msg.fileUrl || null,
  fileName: msg.fileName || null,
  fileType: msg.fileType || null,
});

/** Returns true if `now` (HH:MM, local) falls within a quiet-hours window that may wrap midnight. */
function isWithinQuietHours(start, end, now = new Date()) {
  if (!start || !end) return false;
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e; // window wraps past midnight
}

// GET /api/chat
export const getThreads = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { status = 'ACTIVE' } = req.query;

    // Find all threads the user is part of
    const participants = await prisma.chatParticipant.findMany({
      where: {
        userId,
        thread: { status: status.toUpperCase() }
      },
      include: {
        thread: {
          include: {
            participants: {
              include: { user: true }
            },
            messages: {
              orderBy: { sentAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    // Real unread counts: messages from someone else, sent after this
    // participant last opened the thread (or since they joined, if never opened).
    const unreadCounts = await Promise.all(
      participants.map(p =>
        prisma.chatMessage.count({
          where: {
            threadId: p.threadId,
            senderId: { not: userId },
            sentAt: { gt: p.lastReadAt || p.joinedAt },
          },
        })
      )
    );

    const threads = participants.map((p, idx) => {
      const thread = p.thread;
      // Find the other participants to determine the thread name if not set
      const otherParticipants = thread.participants.filter(part => part.userId !== userId);
      const otherNames = otherParticipants.map(part => part.user.fullName).join(', ');

      const lastMsg = thread.messages[0];
      const isBlocked = p.isBlocked;

      // Extract roles of other participants
      const roles = otherParticipants.map(part => {
        let role = part.user.role.charAt(0).toUpperCase() + part.user.role.slice(1).toLowerCase();
        if (role === 'Admin') role = 'Admin Staff';
        return role;
      });

      return {
        id: thread.id,
        name: thread.name || otherNames || 'System Assistant',
        isBot: thread.isBot,
        status: thread.status,
        isBlocked: isBlocked,
        roles: roles,
        lastMsg: lastMsg ? (lastMsg.text || (lastMsg.fileName ? `📎 ${lastMsg.fileName}` : 'Attachment')) : (thread.isBot ? 'Hello! I am your Academy Assistant.' : 'No messages yet'),
        timestamp: lastMsg ? lastMsg.sentAt.getTime() : thread.createdAt.getTime(),
        time: lastMsg ? lastMsg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        unread: unreadCounts[idx],
      };
    });

    // Sort threads by latest message time
    threads.sort((a, b) => b.timestamp - a.timestamp);

    res.json({ threads });
  } catch (error) {
    next(error);
  }
};

// GET /api/chat/my-teachers — list the teachers of the current parent's children (for "Message Teacher")
export const getMyChildrensTeachers = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const familyMembers = await prisma.familyMember.findMany({
      where: { userId },
      include: { family: { include: { members: { select: { userId: true, user: { select: { id: true, role: true } } } } } } },
    });

    const studentIds = familyMembers.flatMap(fm =>
      fm.family.members.filter(m => m.user.role === 'STUDENT').map(m => m.userId)
    );

    if (studentIds.length === 0) return res.json({ teachers: [] });

    const enrollments = await prisma.classEnrollment.findMany({
      where: { studentId: { in: studentIds }, status: 'active' },
      include: {
        class: {
          include: { teacher: { select: { id: true, fullName: true } } },
        },
        student: { select: { id: true, fullName: true } },
      },
    });

    const seen = new Map();
    for (const e of enrollments) {
      if (!e.class.teacher) continue;
      const key = e.class.teacher.id;
      if (!seen.has(key)) {
        seen.set(key, { id: e.class.teacher.id, fullName: e.class.teacher.fullName, students: new Set() });
      }
      seen.get(key).students.add(e.student.fullName);
    }

    res.json({ teachers: Array.from(seen.values()).map(t => ({ ...t, students: Array.from(t.students) })) });
  } catch (error) {
    next(error);
  }
};

// Returns true if userA and userB are allowed to open a direct chat thread.
// This is the actual enforcement boundary — the frontend only ever offers
// "safe" targets (assigned teacher, admins), but the API must not trust that,
// since a rogue teacher/parent account calling it directly could otherwise
// message any family in the academy (a real business risk: teachers have
// contacted families outside their own roster to poach students).
const canOpenDirectThread = async (userA, userB) => {
  if (userA === userB) return true;

  const [a, b] = await prisma.user.findMany({
    where: { id: { in: [userA, userB] } },
    select: { id: true, role: true },
  });
  if (!a || !b) return false;

  // Admins can reach, and be reached by, anyone.
  if (a.role === 'ADMIN' || b.role === 'ADMIN') return true;
  // Staff-to-staff direct messages are fine — the poaching risk is staff
  // reaching families that aren't theirs, not colleagues talking to each other.
  if (a.role === 'TEACHER' && b.role === 'TEACHER') return true;

  const teacher = a.role === 'TEACHER' ? a : (b.role === 'TEACHER' ? b : null);
  const other = teacher === a ? b : a;

  if (teacher && (other.role === 'PARENT' || other.role === 'STUDENT')) {
    const studentIds = other.role === 'STUDENT'
      ? [other.id]
      : (await prisma.familyMember.findMany({
          where: { userId: other.id, family: { members: { some: { user: { role: 'STUDENT' } } } } },
          select: { family: { select: { members: { select: { userId: true, user: { select: { role: true } } } } } } },
        })).flatMap((fm) => fm.family.members.filter((m) => m.user.role === 'STUDENT').map((m) => m.userId));

    if (studentIds.length === 0) return false;
    const enrolled = await prisma.classEnrollment.findFirst({
      where: { studentId: { in: studentIds }, status: 'active', class: { teacherId: teacher.id } },
    });
    return !!enrolled;
  }

  // PARENT <-> PARENT or PARENT/STUDENT <-> a family that isn't theirs: only
  // allowed if they're actually in the same family (e.g. two co-parents).
  const sameFamily = await prisma.familyMember.findFirst({
    where: { userId: a.id, family: { members: { some: { userId: b.id } } } },
  });
  return !!sameFamily;
};

// POST /api/chat
export const createThread = async (req, res, next) => {
  try {
    const { participantIds, name, isBot } = req.body;
    const userId = req.user.id;

    // Validate participantIds includes current user
    const allParticipants = Array.from(new Set([userId, ...(participantIds || [])]));

    // This endpoint only creates direct 1:1 threads — group threads must go
    // through POST /api/chat/group, which builds its own participant list
    // server-side instead of trusting a client-supplied array.
    if (!isBot && allParticipants.length !== 2 && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can start a thread with multiple participants directly.' });
    }

    if (!isBot && allParticipants.length === 2 && req.user.role !== 'ADMIN') {
      const [a, b] = allParticipants;
      const allowed = await canOpenDirectThread(a, b);
      if (!allowed) {
        return res.status(403).json({ error: 'You are not allowed to message this person.' });
      }
    }

    // For direct 1:1 threads, reuse an existing thread between the same two users
    // instead of creating a duplicate every time "Message Teacher" is clicked.
    if (!isBot && allParticipants.length === 2) {
      const [a, b] = allParticipants;
      const existingThreads = await prisma.chatThread.findMany({
        where: {
          isBot: false,
          participants: { some: { userId: a } }
        },
        include: { participants: { include: { user: true } } },
      });
      const existing = existingThreads.find(t => 
        t.participants.length === 2 && 
        t.participants.some(p => p.userId === b)
      );
      if (existing) {
        return res.status(200).json({ thread: existing });
      }
    }

    const thread = await prisma.chatThread.create({
      data: {
        name: name || null,
        isBot: isBot || false,
        participants: {
          create: allParticipants.map(id => ({
            userId: id
          }))
        }
      },
      include: {
        participants: {
          include: { user: true }
        }
      }
    });

    res.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
};

// POST /api/chat/group
export const createGroupThread = async (req, res, next) => {
  try {
    const { groupType, classId } = req.body; // CLASS, MANAGEMENT, OCEAN_NAVIGATORS
    const userId = req.user.id;
    let participantIds = [];
    let name = '';

    // CLASS groups every parent of that class into one thread (they'd be able
    // to message each other), and OCEAN_NAVIGATORS is the internal staff
    // channel — neither is something a parent or student should be able to
    // spin up. MANAGEMENT stays open to everyone: reaching admins is allowed.
    if ((groupType === 'CLASS' || groupType === 'OCEAN_NAVIGATORS') && !['TEACHER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed to create this group thread.' });
    }

    if (groupType === 'CLASS' && classId) {
      const enrollments = await prisma.classEnrollment.findMany({
        where: { classId },
        select: { studentId: true, class: true }
      });
      const students = enrollments.map(e => e.studentId);
      
      const parents = await prisma.familyMember.findMany({
        where: { userId: { in: students } },
        select: { family: { select: { members: { select: { userId: true, user: { select: { role: true } } } } } } }
      });
      
      participantIds = parents.flatMap(f => f.family.members.filter(m => m.user.role === 'PARENT').map(m => m.userId));
      name = `Class ${enrollments[0]?.class?.name || 'Announcements'}`;
    } else if (groupType === 'MANAGEMENT') {
      const managers = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      participantIds = managers.map(m => m.id);
      name = 'Management Team';
    } else if (groupType === 'OCEAN_NAVIGATORS') {
      const staff = await prisma.user.findMany({ where: { role: { in: ['TEACHER', 'ADMIN'] } }, select: { id: true } });
      participantIds = staff.map(s => s.id);
      name = 'Ocean Navigators';
    }

    participantIds.push(userId);
    const uniqueParticipants = Array.from(new Set(participantIds));

    // Reuse the existing group thread instead of spawning a new one every time
    // someone clicks "Message Management" / "Ocean Navigators".
    if (name) {
      const existing = await prisma.chatThread.findFirst({
        where: { name, participants: { some: { userId } } },
        include: { participants: { include: { user: true } } },
      });
      if (existing) return res.status(200).json({ thread: existing });
    }

    const thread = await prisma.chatThread.create({
      data: {
        name,
        participants: {
          create: uniqueParticipants.map(id => ({ userId: id }))
        }
      },
      include: { participants: { include: { user: true } } }
    });

    res.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
};

// GET /api/chat/:threadId/messages
export const getMessages = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.id;

    // Verify user is in this thread
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        threadId_userId: { threadId, userId }
      }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant in this thread' });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { sentAt: 'asc' },
      include: {
        sender: true
      }
    });

    const formattedMessages = messages.map(msg => {
      const isMe = msg.senderId === userId;
      return {
        id: msg.id,
        senderId: msg.senderId,
        sender: isMe ? 'Me' : (msg.sender ? msg.sender.fullName : 'System'),
        text: msg.text,
        ...formatAttachment(msg),
        time: msg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: isMe ? 'sent' : 'received'
      };
    });

    // Opening the thread marks everything up to now as read for this user.
    await prisma.chatParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });

    res.json({ messages: formattedMessages });
  } catch (error) {
    next(error);
  }
};

// POST /api/chat/:threadId/messages
export const sendMessage = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    // Validate participant and check if blocked
    const participant = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      include: { thread: true }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant in this thread' });
    }
    
    if (participant.isBlocked) {
      return res.status(403).json({ error: 'Forbidden', message: 'You have blocked this contact' });
    }

    // All contact between students, parents, teachers and staff must stay inside
    // the app — reject messages that share an email address or phone number.
    if (!participant.thread.isBot) {
      const contactCheck = findContactInfo(text);
      if (contactCheck.blocked) {
        return res.status(400).json({
          error: 'contact_info_blocked',
          message: contactCheck.reason === 'email'
            ? 'For everyone\'s safety, email addresses can\'t be shared in chat. Please keep all communication inside the app.'
            : 'For everyone\'s safety, phone numbers can\'t be shared in chat. Please keep all communication inside the app.',
        });
      }
    }

    const newMessage = await prisma.chatMessage.create({
      data: {
        threadId,
        senderId: userId,
        text
      },
      include: {
        sender: true
      }
    });

    const formattedMessage = {
      id: newMessage.id,
      senderId: newMessage.senderId,
      sender: newMessage.sender.fullName,
      text: newMessage.text,
      ...formatAttachment(newMessage),
      time: newMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'received' // from the perspective of others
    };

    // Broadcast to other participants via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(threadId).emit('receive_message', {
        threadId,
        message: formattedMessage
      });
    }

    // Respond immediately with the user's message so the UI never waits on the AI.
    res.status(201).json({ message: formattedMessage });

    // Quiet Hours: if any other participant (a teacher) has quiet hours active right
    // now, send their auto-response once per thread per day and flag the manager if
    // the teacher hasn't replied within 1 business day.
    if (!participant.thread.isBot && req.user.role !== 'TEACHER') {
      (async () => {
        try {
          const otherParticipants = await prisma.chatParticipant.findMany({
            where: { threadId, userId: { not: userId } },
            include: { user: true },
          });
          const quietTeacher = otherParticipants.find(p =>
            p.user.role === 'TEACHER' &&
            isWithinQuietHours(p.user.quietHoursStart, p.user.quietHoursEnd)
          );
          if (!quietTeacher) return;

          const today = new Date().toISOString().slice(0, 10);
          const dedupKey = `quiet-hours-autoreply:${threadId}:${quietTeacher.userId}:${today}`;

          const alreadySentToday = await prisma.chatMessage.findFirst({
            where: {
              threadId,
              senderId: null,
              sentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
              text: { contains: quietTeacher.user.autoResponderMessage || 'quiet hours' },
            },
          });
          if (alreadySentToday) return;

          const autoText = quietTeacher.user.autoResponderMessage ||
            `${quietTeacher.user.fullName} has quiet hours enabled and will respond within 1 business day.`;

          const autoMessage = await prisma.chatMessage.create({
            data: { threadId, senderId: null, text: autoText },
          });

          if (io) {
            io.to(threadId).emit('receive_message', {
              threadId,
              message: {
                id: autoMessage.id,
                senderId: null,
                sender: 'Auto-response',
                text: autoMessage.text,
                time: autoMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'received',
              },
            });
          }

          // Schedule a manager follow-up notification if the teacher hasn't replied
          // within 1 business day (created now, surfaced by a periodic job).
          const managers = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
          await prisma.notification.createMany({
            data: managers.map(m => ({
              userId: m.id,
              type: 'quiet_hours_followup',
              title: 'Quiet Hours Follow-up Needed',
              message: `${quietTeacher.user.fullName} received a message during quiet hours and hasn't replied yet. Follow up if no response within 1 business day.`,
              channel: 'in_app',
              referenceType: 'chat_thread',
              referenceId: threadId,
              dedupKey,
            })),
            skipDuplicates: true,
          });
        } catch (qhError) {
          console.error('Quiet hours auto-response failed:', qhError.message);
        }
      })();
    }

    // If this is the AI Assistant thread, generate the bot reply asynchronously
    // (can be slow on a local model) and deliver it over Socket.IO when ready.
    if (participant.thread.isBot) {
      (async () => {
        // Signal "typing…" to the room while we generate.
        if (io) io.to(threadId).emit('assistant_typing', { threadId });
        try {
          const recent = await prisma.chatMessage.findMany({
            where: { threadId },
            orderBy: { sentAt: 'asc' },
            take: 20,
          });
          const history = recent.map(m => ({
            role: m.senderId === null ? 'assistant' : 'user',
            text: m.text,
          }));

          const replyText = await generateAssistantReply(history, {
            role: req.user.role,
            name: req.user.fullName,
          });

          const botMessage = await prisma.chatMessage.create({
            data: { threadId, senderId: null, text: replyText },
          });

          if (io) {
            io.to(threadId).emit('receive_message', {
              threadId,
              message: {
                id: botMessage.id,
                senderId: null,
                sender: 'Academy Assistant',
                text: botMessage.text,
                time: botMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'received',
              },
            });
          }
        } catch (aiError) {
          console.error('AI assistant reply failed:', aiError.message);
          if (io) {
            io.to(threadId).emit('receive_message', {
              threadId,
              message: {
                id: `err_${Date.now()}`,
                senderId: null,
                sender: 'Academy Assistant',
                text: "Sorry, I had trouble responding just now. Please try again or contact the Love Learning team.",
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'received',
              },
            });
          }
        }
      })();
    }
  } catch (error) {
    next(error);
  }
};

// POST /api/chat/:threadId/attachment — send a file (image/document) as a chat message.
// Uses multer (see chat.routes.js) to save the file to disk before this runs.
export const uploadAttachment = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Validation Error', message: 'A file is required.' });
    }

    const participant = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      include: { thread: true }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant in this thread' });
    }

    if (participant.isBlocked) {
      return res.status(403).json({ error: 'Forbidden', message: 'You have blocked this contact' });
    }

    // Local disk is wiped on every Render restart — Drive is the durable copy.
    // We still keep the local file as a fallback for the local-dev/no-Drive case.
    let driveFileId = null;
    if (drive) {
      try {
        const folderId = process.env.DRIVE_CHAT_FOLDER_ID || null;
        const driveFile = await uploadFileToDrive(req.file.path, req.file.originalname, req.file.mimetype, folderId);
        driveFileId = driveFile?.id || null;
      } catch (driveErr) {
        console.error(`[Chat] Failed to upload attachment ${req.file.originalname} to Drive:`, driveErr.message);
      }
    }

    const newMessage = await prisma.chatMessage.create({
      data: {
        threadId,
        senderId: userId,
        text: '',
        fileUrl: `/uploads/chat/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        driveFileId,
      },
      include: { sender: true }
    });

    const formattedMessage = {
      id: newMessage.id,
      senderId: newMessage.senderId,
      sender: newMessage.sender.fullName,
      text: newMessage.text,
      ...formatAttachment(newMessage),
      time: newMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'received'
    };

    const io = req.app.get('io');
    if (io) {
      io.to(threadId).emit('receive_message', { threadId, message: formattedMessage });
    }

    res.status(201).json({ message: formattedMessage });
  } catch (error) {
    next(error);
  }
};

// GET /api/chat/:threadId/messages/:messageId/file — stream an attachment.
// Gated on thread participation (the old express.static /uploads/chat route
// had no such check — anyone with the URL could fetch it).
export const getAttachmentFile = async (req, res, next) => {
  try {
    const { threadId, messageId } = req.params;
    const userId = req.user.id;

    const participant = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant in this thread' });
    }

    const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.threadId !== threadId || !message.fileUrl) {
      return res.status(404).json({ error: 'Not Found', message: 'Attachment not found.' });
    }

    if (message.driveFileId) {
      try {
        const stream = await downloadFileFromDrive(message.driveFileId);
        if (stream) {
          res.setHeader('Cache-Control', 'private, max-age=3600');
          stream.on('error', (err) => next(err));
          return stream.pipe(res);
        }
      } catch (driveErr) {
        console.error(`[Chat] Drive download failed for message ${messageId}, falling back to local disk:`, driveErr.message);
      }
    }

    const localPath = path.join(CHAT_UPLOAD_DIR, path.basename(message.fileUrl));
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    res.status(404).json({ error: 'Not Found', message: 'This attachment is no longer available.' });
  } catch (error) {
    next(error);
  }
};

// POST /api/chat/:threadId/block
export const blockContact = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.id;

    const participant = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant in this thread' });
    }

    const updatedParticipant = await prisma.chatParticipant.update({
      where: { id: participant.id },
      data: { isBlocked: !participant.isBlocked }
    });

    res.json({ isBlocked: updatedParticipant.isBlocked });
  } catch (error) {
    next(error);
  }
};

// PUT /api/chat/:threadId/resolve
export const resolveThread = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.id;

    const participant = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a participant' });
    }

    const updatedThread = await prisma.chatThread.update({
      where: { id: threadId },
      data: { status: 'RESOLVED' }
    });

    res.json({ message: 'Thread resolved', thread: updatedThread });
  } catch (error) {
    next(error);
  }
};
