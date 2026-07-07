import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getThreads,
  createThread,
  getMessages,
  sendMessage,
  blockContact,
  createGroupThread,
  resolveThread,
  getMyChildrensTeachers
} from '../controllers/chat.controller.js';

const router = Router();

// GET /api/chat — List all threads for current user
router.get('/', authenticate, getThreads);

// GET /api/chat/my-teachers — list the current parent's children's teachers
router.get('/my-teachers', authenticate, getMyChildrensTeachers);

// POST /api/chat — Create a new thread
router.post('/', authenticate, createThread);

// GET /api/chat/:threadId/messages — Get messages for a thread
router.get('/:threadId/messages', authenticate, getMessages);

// POST /api/chat/:threadId/messages — Send a new message
router.post('/:threadId/messages', authenticate, sendMessage);

// POST /api/chat/:threadId/block — Toggle block status for a contact
router.post('/:threadId/block', authenticate, blockContact);

// POST /api/chat/group — Create a group thread
router.post('/group', authenticate, createGroupThread);

// PUT /api/chat/:threadId/resolve — Resolve a thread
router.put('/:threadId/resolve', authenticate, resolveThread);

export default router;
