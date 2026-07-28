/**
 * Global Error Handler Middleware
 * Catches all unhandled errors and returns a consistent JSON response.
 * Must be registered AFTER all routes in Express.
 */
export const errorHandler = (err, req, res, _next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err);

  // Prisma known errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: `A record with that unique field already exists.`,
      field: err.meta?.target,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested record was not found.',
    });
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid request data.',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Stripe errors
  if (err.type === 'StripeCardError') {
    return res.status(400).json({
      error: 'Payment Error',
      message: err.message,
    });
  }

  if (err.type === 'StripeInvalidRequestError') {
    return res.status(400).json({
      error: 'Payment Configuration Error',
      message: 'Invalid payment request. Please contact support.',
    });
  }

  // Default error.
  //
  // Detail is opt-in, not opt-out. Asking "is this production?" meant an
  // environment that simply never set NODE_ENV — a typo, a new staging box, a
  // host that doesn't inject it — served raw `err.message` to callers, which
  // for an unhandled Prisma error is the failing query's shape: table and
  // column names, constraint names, sometimes the offending value. Asking "is
  // this explicitly development?" makes the unset case fall to the safe side.
  // Same reasoning as the test-login bypass in middleware/auth.js: a missing
  // variable must never be what turns a protection off.
  //
  // The full error, including the stack, is already on the server's own log
  // above — nothing is lost for debugging, it just stops being a response.
  const isDev = process.env.NODE_ENV === 'development';
  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    error: 'Internal Server Error',
    message: isDev ? (err.message || 'Unknown error') : 'An internal server error occurred.',
    ...(isDev && { stack: err.stack }),
  });
};

/**
 * 404 handler for unmatched routes
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found.`,
  });
};
