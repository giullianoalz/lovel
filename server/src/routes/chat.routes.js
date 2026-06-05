import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getThreads,
  createThread,
  getMessages,
  sendMessage,
  blockContact
} from '../controllers/chat.controller.js';

const router = Router();

// GET /api/chat — List all threads for current user
router.get('/', authenticate, getThreads);

// POST /api/chat — Create a new thread
router.post('/', authenticate, createThread);

// GET /api/chat/:threadId/messages — Get messages for a thread
router.get('/:threadId/messages', authenticate, getMessages);

// POST /api/chat/:threadId/messages — Send a new message
router.post('/:threadId/messages', authenticate, sendMessage);

// POST /api/chat/:threadId/block — Toggle block status for a contact
router.post('/:threadId/block', authenticate, blockContact);

export default router;
