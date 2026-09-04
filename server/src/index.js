import 'dotenv/config';
import express from 'express';
import { ACADEMY_TIMEZONE } from './utils/academyTime.js';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { firebaseAuth } from './config/firebase-admin.js';
import prisma from './config/database.js';

// Middleware
import { apiLimiter, ipLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { cacheStats } from './middleware/cache.js';
import { isTestLoginAuthorized } from './middleware/auth.js';
import { hasRole } from './utils/roles.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import emailRoutes from './routes/email.routes.js';
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
import waiversRoutes from './routes/waivers.routes.js';
import assignmentsRoutes from './routes/assignments.routes.js';
import announcementsRoutes from './routes/announcements.routes.js';
import medicalRoutes from './routes/medical.routes.js';
import lessonPlanRoutes from './routes/lessonPlan.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import rewardsRoutes from './routes/rewards.routes.js';
import importRoutes from './routes/import.routes.js';
import intakeRoutes from './routes/intake.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import integrationsRoutes from './routes/integrations.routes.js';
import payCategoriesRoutes from './routes/payCategories.routes.js';
import shiftsRoutes from './routes/shifts.routes.js';
import closuresRoutes from './routes/closures.routes.js';
import { startCronJobs } from './jobs/cron.jobs.js';

const app = express();
const httpServer = createServer(app);

// Render (and any similar host) puts a load balancer in front of us, so the
// socket address is the balancer's, not the caller's. Without this every
// request shares one `req.ip` — which silently made authLimiter a *global*
// 10-attempts-per-15-minutes budget for the whole internet, and would do the
// same to ipLimiter. `1` trusts exactly one hop: the client cannot forge
// X-Forwarded-For past the balancer, which `true` would allow. Inert locally,
// where no such header arrives.
app.set('trust proxy', 1);

// Allows phones/other devices on the same Wi-Fi, and any localhost port
// (Vite auto-increments when 5173 is busy — e.g. multiple sandboxed preview
// instances), to reach the dev server without opening CORS up in production.
const isLanDevOrigin = (origin) => {
  if (process.env.NODE_ENV !== 'development') return false;
  return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):517\d$/.test(origin || '')
    || /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin || '');
};

// Normalise (drop any trailing slash) so a FRONTEND_URL typo like
// "https://app.vercel.app/" still matches the browser's slash-less Origin header.
const stripSlash = (u) => (u || '').replace(/\/+$/, '');
const configuredOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
].filter(Boolean).map(stripSlash);

// Central allow-check: configured origins, any *.vercel.app deployment (so the
// production alias AND preview URLs both work without re-editing env vars), and
// LAN/localhost in dev.
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin / server-to-server / curl
  const o = stripSlash(origin);
  if (configuredOrigins.includes(o)) return true;
  if (/^https:\/\/lovel[a-z0-9-]*\.vercel\.app$/i.test(o)) return true;
  if (isLanDevOrigin(origin)) return true;
  return false;
};

// Socket.IO setup (will be used for chat & notifications later)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// Make io accessible to routes via req.app
app.set('io', io);

// ===========================================
// Socket.IO Authentication Middleware
// ===========================================
// Verifies the Firebase token (or dev bypass email) on every new connection.
// Without this, anyone could subscribe to admin_room or another user's
// notification feed by guessing their userId.

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const devEmail = socket.handshake.auth?.devEmail;

    // Dev bypass — defers to the same authorization helper as the HTTP
    // middleware so the two can't drift apart (see middleware/auth.js).
    if (devEmail && isTestLoginAuthorized(socket.handshake.auth?.devSecret)) {
      const devUser = await prisma.user.findUnique({
        where: { email: devEmail },
        select: { id: true, role: true, secondaryRoles: true, status: true },
      });
      if (devUser && devUser.status !== 'SUSPENDED') {
        socket.user = devUser;
        return next();
      }
    }

    if (!token) return next(new Error('Authentication required'));

    const decoded = await firebaseAuth.verifyIdToken(token);
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      select: { id: true, role: true, secondaryRoles: true, status: true },
    });

    if (!user) return next(new Error('User not found'));
    if (user.status === 'SUSPENDED') return next(new Error('Account suspended'));

    socket.user = user;
    next();
  } catch (err) {
    console.error('[Socket.IO Auth] Verification failed:', err.message);
    next(new Error('Invalid authentication token'));
  }
});

// ===========================================
// Global Middleware
// ===========================================

// Gzip compression — reduces response sizes significantly for JSON payloads
app.use(compression());

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS — reject by omitting headers (callback(null, false)) rather than throwing,
// so a blocked origin gets a clean CORS failure instead of a 500.
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  credentials: true,
}));

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing — raw body needed for Stripe webhooks
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Academy Feed media only. Feed posts render straight from this path
// (AcademyFeed.jsx builds `MEDIA_BASE + url`), so it has to stay reachable
// without a token.
//
// Scoped to that one subfolder on purpose: mounting all of `uploads/` here
// served chat attachments and marketing photos of students to anyone holding
// the URL, which silently defeated the authenticated routes that exist to gate
// exactly those files (getAttachmentFile, getPhotoFile — both check thread
// participation / role before streaming a byte). The frontend already fetches
// both through those routes, so nothing reads them from here.
app.use('/uploads/announcements', express.static(path.join(process.cwd(), 'uploads', 'announcements')));
app.use('/uploads/avatars', express.static(path.join(process.cwd(), 'uploads', 'avatars')));

// Rate limiting — the IP backstop runs first so a caller who evades the
// credential bucket (by varying the Authorization header, which is unverified
// this early) still hits a ceiling. See middleware/rateLimit.js.
app.use('/api/', ipLimiter);
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
app.use('/api/email', emailRoutes);
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
app.use('/api/intake', intakeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/behavior', behaviorRoutes);
app.use('/api/medical', medicalRoutes);
app.use('/api/class-fit', classfitRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/lesson-plans', lessonPlanRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/waivers', waiversRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/pay-categories', payCategoriesRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/closures', closuresRoutes);

// ===========================================
// Socket.IO Connection
// ===========================================

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id} (user: ${socket.user.id})`);

  // Joined here rather than only on the client's `join_user` below: chat now
  // delivers per recipient through this room whenever a teacher is in the
  // thread (each participant gets a different sender name — see
  // chat.controller.js broadcastMessage), so it has to exist for every socket
  // from the moment it connects, not once the bell happens to be mounted.
  socket.join(`user_${socket.user.id}`);

  // Clients only ever pass chat thread ids here, so membership is enforced
  // against ChatParticipant. Without this check any signed-in user could join
  // "admin_room" or another family's thread and receive its receive_message /
  // messages_read events live. admin_room and user_* have their own validated
  // handlers below and are never valid thread ids.
  socket.on('join_room', async (room) => {
    try {
      if (typeof room !== 'string' || room === 'admin_room' || room.startsWith('user_')) return;

      if (socket.user.role !== 'ADMIN') {
        const membership = await prisma.chatParticipant.findUnique({
          where: { threadId_userId: { threadId: room, userId: socket.user.id } },
          select: { isBlocked: true },
        });
        if (!membership || membership.isBlocked) return;
      }

      socket.join(room);
      console.log(`[Socket.IO] ${socket.id} joined room: ${room}`);
    } catch (err) {
      // Malformed ids (non-UUID) make the Prisma lookup throw — treat as a
      // denied join rather than crashing the handler.
      console.error(`[Socket.IO] join_room rejected for ${socket.id}:`, err.message);
    }
  });

  // Every signed-in user joins their own room so the server can push
  // notifications (chat messages, alerts, etc.) straight to them regardless
  // of which screen they currently have open.
  // Validated: users can only join their own notification room.
  socket.on('join_user', (userId) => {
    if (!userId || userId !== socket.user.id) return;
    socket.join(`user_${userId}`);
  });

  // Admin/front-desk users auto-join the admin_room for real-time alerts.
  // Validated: only ADMIN or RECEPTIONIST users are allowed into the admin room.
  socket.on('join_admin', () => {
    if (!hasRole(socket.user, 'ADMIN', 'RECEPTIONIST')) return;
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

  // Start all background scheduled jobs (overdue invoices, absences, snack
  // alerts) and catch up on any slot missed while the process was down.
  startCronJobs();

  // ── Keep-alive (Render free tier) ─────────────────────────────────────────
  // Free instances spin down after ~15 idle minutes; the next visitor then
  // waits 30-50s for a cold start ("the server is waking up" on the login
  // page). Pinging our own public URL every 10 minutes counts as inbound
  // traffic and keeps the instance warm. Render injects RENDER_EXTERNAL_URL
  // automatically, so this is inert everywhere else (local dev, tests).
  //
  // But warm around the clock costs ~744 instance-hours a month against a free
  // cap of 750, which is how the quota came within a few hours of running out
  // in August — and a suspended backend is a far worse outage than a slow
  // first request. So the ping keeps office hours instead.
  //
  // The window has to cover every scheduled job: the earliest is
  // recurring-charges at 06:00 and the latest is pay-accrual at 21:05
  // (see jobs/cron.jobs.js). Outside it nothing is scheduled, so the instance
  // is free to sleep and whoever knocks at 23:00 waits for the cold start.
  //
  // One thing this cannot do is wake itself at 06:00 — a sleeping instance
  // runs no timers. An external ping (cron-job.org, UptimeRobot) at ~05:50
  // covers that; without it the day's first visitor starts the process and
  // runStartupCatchUp() rescues the daily jobs, but any class-reminder slot
  // before that is simply gone.
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    const KEEP_ALIVE_MS = 10 * 60 * 1000;
    // Hours are the academy's wall clock, not the container's UTC.
    const START_HOUR = Number(process.env.KEEP_ALIVE_START_HOUR ?? 6);
    const END_HOUR = Number(process.env.KEEP_ALIVE_END_HOUR ?? 22); // exclusive
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ACADEMY_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    });
    const academyHour = () => Number(hourFormatter.format(new Date()));
    const withinWindow = () => {
      const h = academyHour();
      return START_HOUR <= END_HOUR
        ? h >= START_HOUR && h < END_HOUR
        // A window that wraps past midnight, if anyone ever configures one.
        : h >= START_HOUR || h < END_HOUR;
    };

    const ping = () => {
      if (!withinWindow()) return;
      fetch(`${externalUrl}/api/health`).catch((err) =>
        console.warn('[keep-alive] self-ping failed:', err.message));
    };
    // unref: a pending timer must never hold the process open on shutdown.
    setInterval(ping, KEEP_ALIVE_MS).unref();
    console.log(`  Keep-alive:  pinging ${externalUrl}/api/health every ${KEEP_ALIVE_MS / 60000}m, ${String(START_HOUR).padStart(2, '0')}:00-${String(END_HOUR).padStart(2, '0')}:00 ${ACADEMY_TIMEZONE}`);
  }
});


// ===========================================
// Graceful shutdown
// ===========================================
//
// Render stops an instance by sending SIGTERM and killing it if it has not
// exited shortly after — which on the free tier happens on every spin-down and
// every deploy, several times a day. Nothing here listened for it, so the
// process was torn down mid-flight: sockets dropped without a close frame,
// in-flight requests answered by nobody, and Prisma's connections left for the
// pooler to time out. Exit codes 137/143 look identical to a crash in Render's
// dashboard, which is exactly what makes a real crash hard to spot.
//
// Ordering matters. Stop taking new work first (the listener), then hang up on
// clients, then let the database go — releasing Prisma while a request is still
// running would fail that request rather than finish it.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

const shutdown = async (signal) => {
  // A second signal while the first is still draining means "stop waiting".
  if (shuttingDown) {
    console.warn(`[shutdown] ${signal} received again — exiting now.`);
    process.exit(0);
  }
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining.`);

  // Never let a hung connection turn a tidy shutdown into a SIGKILL: past this
  // point Render would kill us anyway, and exiting ourselves is cleaner.
  const failsafe = setTimeout(() => {
    console.warn('[shutdown] grace period elapsed — forcing exit.');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  failsafe.unref();

  try {
    await new Promise((resolve) => httpServer.close(resolve));
    console.log('[shutdown] HTTP server closed.');

    await new Promise((resolve) => io.close(resolve));
    console.log('[shutdown] Socket.IO closed.');

    await prisma.$disconnect();
    console.log('[shutdown] Database disconnected.');
  } catch (error) {
    console.error('[shutdown] Error while draining:', error);
  }

  clearTimeout(failsafe);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unhandled rejection leaves the process in an unknown state, and Node's
// default is to warn and carry on — so a leak or a half-applied write can keep
// running unnoticed. Log it loudly; deliberately not fatal, because killing a
// live API over one stray promise is worse than the alternative.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason);
});

export { app, io };
