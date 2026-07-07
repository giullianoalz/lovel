import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// Middleware
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { cacheStats } from './middleware/cache.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import familiesRoutes from './routes/families.routes.js';
import studentsRoutes from './routes/students.routes.js';
import classesRoutes from './routes/classes.routes.js';
import sessionsRoutes from './routes/sessions.routes.js';
import registrationRoutes from './routes/registration.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import billingRoutes from './routes/billing.routes.js';
import chatRoutes from './routes/chat.routes.js';
import behaviorRoutes from './routes/behavior.routes.js';
import classfitRoutes from './routes/classfit.routes.js';
import alertRoutes from './routes/alert.routes.js';
import marketingRoutes from './routes/marketing.routes.js';
import portalRoutes from './routes/portal.routes.js';
import assignmentsRoutes from './routes/assignments.routes.js';
import announcementsRoutes from './routes/announcements.routes.js';
import medicalRoutes from './routes/medical.routes.js';
import lessonPlanRoutes from './routes/lessonPlan.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import rewardsRoutes from './routes/rewards.routes.js';
import importRoutes from './routes/import.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import { startCronJobs } from './jobs/cron.jobs.js';

const app = express();
const httpServer = createServer(app);

// Allows phones/other devices on the same Wi-Fi, and any localhost port
// (Vite auto-increments when 5173 is busy — e.g. multiple sandboxed preview
// instances), to reach the dev server without opening CORS up in production.
const isLanDevOrigin = (origin) => {
  if (process.env.NODE_ENV !== 'development') return false;
  return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):517\d$/.test(origin || '')
    || /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin || '');
};

// Socket.IO setup (will be used for chat & notifications later)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      const allowed = [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'].filter(Boolean);
      if (!origin || allowed.includes(origin) || isLanDevOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// Make io accessible to routes via req.app
app.set('io', io);

// ===========================================
// Global Middleware
// ===========================================

// Gzip compression — reduces response sizes significantly for JSON payloads
app.use(compression());

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isLanDevOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing — raw body needed for Stripe webhooks
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (marketing photos, etc.)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Rate limiting
app.use('/api/', apiLimiter);

// ===========================================
// API Routes
// ===========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  });
});

// Cache debug (development only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/cache-stats', (req, res) => res.json(cacheStats()));
}

// Phase 1 routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/families', familiesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/behavior', behaviorRoutes);
app.use('/api/medical', medicalRoutes);
app.use('/api/class-fit', classfitRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/lesson-plans', lessonPlanRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/announcements', announcementsRoutes);

// app.use('/api/notifications', notificationsRoutes);
// app.use('/api/announcements', announcementsRoutes);

// ===========================================
// Socket.IO Connection
// ===========================================

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`[Socket.IO] ${socket.id} joined room: ${room}`);
  });

  // Admin/front-desk users auto-join the admin_room for real-time alerts
  socket.on('join_admin', () => {
    socket.join('admin_room');
    console.log(`[Socket.IO] ${socket.id} joined admin_room`);
  });

  socket.on('leave_room', (room) => {
    socket.leave(room);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// ===========================================
// Error Handling (must be last)
// ===========================================

app.use(notFoundHandler);
app.use(errorHandler);

// ===========================================
// Start Server
// ===========================================

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`
  🚀 Academy Management API
  ──────────────────────────
  Environment: ${process.env.NODE_ENV || 'development'}
  Port:        ${PORT}
  API:         http://localhost:${PORT}/api
  Health:      http://localhost:${PORT}/api/health
  WebSocket:   ws://localhost:${PORT}
  ──────────────────────────
  `);

  // Start all background scheduled jobs (overdue invoices, absences, snack alerts)
  startCronJobs();
});


export { app, io };
