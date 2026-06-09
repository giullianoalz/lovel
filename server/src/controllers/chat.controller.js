import prisma from '../config/database.js';

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

    const threads = participants.map(p => {
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
        lastMsg: lastMsg ? lastMsg.text : (thread.isBot ? 'Hello! I am your Academy Assistant.' : 'No messages yet'),
        time: lastMsg ? lastMsg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        unread: 0 // Mocked for now
      };
    });

    // Sort threads by latest message time
    threads.sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      // We should ideally sort by Date, but this is a rough approximation
      return 0; 
    });

    res.json({ threads });
  } catch (error) {
    next(error);
  }
};

// POST /api/chat
export const createThread = async (req, res, next) => {
  try {
    const { participantIds, name, isBot } = req.body;
    const userId = req.user.id;

    // Validate participantIds includes current user
    const allParticipants = Array.from(new Set([userId, ...(participantIds || [])]));

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
        time: msg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: isMe ? 'sent' : 'received'
      };
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
      time: newMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'received' // from the perspective of others
    };

    // Broadcast to other participants via Socket.IO
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(threadId).emit('receive_message', {
        threadId,
        message: formattedMessage
      });
    }

    res.status(201).json({ message: formattedMessage });
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
