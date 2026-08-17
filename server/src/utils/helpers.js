/**
 * Utility helpers used across the backend
 */

/**
 * Generate an invoice number like 'LC-4391'
 * @param {string} prefix - Invoice prefix (default: 'LC-')
 * @param {number} number - Sequential number
 * @returns {string}
 */
export const generateInvoiceNumber = (prefix = 'LC-', number) => {
  return `${prefix}${number}`;
};

/**
 * Calculate credit card processing fee
 * @param {number} amount - Payment amount
 * @param {number} feePercentage - Fee percentage (default: 2.9)
 * @param {number} feeFixed - Fixed fee (default: 0.30)
 * @returns {{ fee: number, total: number }}
 */
export const calculateProcessingFee = (amount, feePercentage = 2.9, feeFixed = 0.30) => {
  const fee = parseFloat(((amount * feePercentage / 100) + feeFixed).toFixed(2));
  return {
    fee,
    total: parseFloat((amount + fee).toFixed(2)),
  };
};

/**
 * Format currency amount
 * @param {number} amount
 * @returns {string}
 */
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

/**
 * Generate a deduplication key for notifications
 * Prevents sending the same notification twice
 * @param {string} type - Notification type
 * @param {string} userId - Target user
 * @param {string} referenceId - Related entity ID
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string}
 */
export const generateDedupKey = (type, userId, referenceId, date) => {
  return `${type}:${userId}:${referenceId}:${date}`;
};

/**
 * Sleep helper for async operations
 * @param {number} ms - Milliseconds to sleep
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Most rows a single list response will ever return. */
export const MAX_PAGE_SIZE = 1000;

/**
 * Resolve ?page/?limit for a roster-shaped list endpoint (students, classes,
 * families, staff).
 *
 * These collections are bounded — hundreds of rows, not millions — and every
 * screen in the app wants the whole thing. A small default meant each new
 * caller silently rendered only the first page until someone noticed the
 * missing records, so the default here is "everything", and paging is
 * opt-in via an explicit limit. A caller can still tell a truncated list
 * from a complete one by the `total` these endpoints return alongside rows.
 *
 * @param {{ page?: any, limit?: any }} query - Raw req.query values
 * @returns {{ page: number, limit: number, skip: number, take: number }}
 */
export const resolvePaging = ({ page, limit } = {}) => {
  const resolvedPage = Math.max(1, parseInt(page, 10) || 1);
  const resolvedLimit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(limit, 10) || MAX_PAGE_SIZE)
  );
  return {
    page: resolvedPage,
    limit: resolvedLimit,
    skip: (resolvedPage - 1) * resolvedLimit,
    take: resolvedLimit,
  };
};
