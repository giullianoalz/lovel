import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import {
  getThreads,
  createThread,
  getMessages,
  sendMessage,
  uploadAttachment,
  getAttachmentFile,
  blockContact,
  createGroupThread,
  resolveThread,
  markThreadUnread,
  getMyChildrensTeachers
} from '../controllers/chat.controller.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'chat');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `chat-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — chat attachments, not video uploads
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx/;
    const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
    if (extValid) return cb(null, true);
    cb(new Error('That file type is not allowed in chat.'));
  },
});

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

// POST /api/chat/:threadId/attachment — Send a file (image/document)
router.post('/:threadId/attachment', authenticate, upload.single('file'), uploadAttachment);

// GET /api/chat/:threadId/messages/:messageId/file — Stream an attachment
router.get('/:threadId/messages/:messageId/file', authenticate, getAttachmentFile);

// POST /api/chat/:threadId/block — Toggle block status for a contact
router.post('/:threadId/block', authenticate, blockContact);

// POST /api/chat/group — Create a group thread
router.post('/group', authenticate, createGroupThread);

// PUT /api/chat/:threadId/resolve — Resolve a thread
router.put('/:threadId/resolve', authenticate, resolveThread);

// PUT /api/chat/:threadId/unread — Re-flag a thread as unread (reply later)
router.put('/:threadId/unread', authenticate, markThreadUnread);

export default router;
