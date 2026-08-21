/**
 * Where a family can send money, stated once for every document that tells
 * them so.
 *
 * The emailed invoice and the attached PDF both have to answer "how do I pay
 * this?", and they used to answer it from separate literals — which is how a
 * changed Venmo handle ends up corrected in the inbox and still wrong on the
 * sheet someone printed. Both now read this file.
 *
 * `src/components/Portal/ParentPortal.jsx` keeps its own copy on purpose: it
 * is browser code that cannot import from the server, and its entries carry
 * JSX icons and copy-to-clipboard affordances that have no meaning on paper.
 * Changing an account here means changing it there too.
 *
 * `value` may be a function of the invoice number, for the methods where the
 * invoice number *is* the reference the family has to quote.
 */
export const PAYMENT_METHODS = [
  { name: 'Zelle', detail: 'Send to', value: 'lovelearningfl@gmail.com' },
  { name: 'Venmo', detail: 'Username', value: '@LoveLearningFL' },
  { name: 'PayPal', detail: 'Send to', value: 'lovelearningfl@gmail.com' },
  {
    name: 'EMA · Step Up for Students',
    detail: 'Direct Pay on EMA Marketplace/Providers/Love Camp using invoice #',
    value: (invoiceNumber) => invoiceNumber,
  },
];

/** The line a family reads, with `value` resolved against this invoice. */
export const paymentMethodValue = (method, invoiceNumber) =>
  (typeof method.value === 'function' ? method.value(invoiceNumber) : method.value);
