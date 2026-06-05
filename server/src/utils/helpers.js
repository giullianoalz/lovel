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
