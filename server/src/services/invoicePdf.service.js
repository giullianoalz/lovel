/**
 * Renders an invoice as a PDF, for the copy attached to the emailed invoice
 * and for the admin's "Download PDF" button.
 *
 * Deliberately plain: this is a document a family may print, forward to a
 * scholarship administrator, or keep for their records, so it states the
 * figures and nothing else. It is built from the invoice row rather than from
 * the email template, so a change to the email's wording can never alter what
 * the attached document says the family owes.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PAYMENT_METHODS, paymentMethodValue } from '../config/paymentMethods.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same logo as the emails and the signed waivers, so paper and inbox match.
const logoBytes = await readFile(path.join(__dirname, '..', 'assets', 'waiver-logo.png'));

const PAGE = { width: 612, height: 792 };
const MARGIN = 56;

const INK = rgb(0.024, 0.306, 0.231);   // BRAND.text  #064e3b
const MUTED = rgb(0.392, 0.455, 0.545); // BRAND.muted #64748b
const RULE = rgb(0.886, 0.910, 0.941);
const TINT = rgb(0.941, 0.992, 0.957);  // BRAND.greenTint #f0fdf4

const money = (n) => `$${Number(n).toFixed(2)}`;

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';

/**
 * Text the standard fonts can actually draw.
 *
 * These are WinAnsi-encoded, and pdf-lib does not substitute a missing glyph
 * — it throws, which fails the whole document. Descriptions and names are
 * typed by people and pasted from spreadsheets, so a curly quote or an emoji
 * is a matter of time, and none of them is worth losing an invoice over.
 * Anything outside the encoding is replaced rather than dropped, so a mangled
 * character never silently changes what a line says.
 */
const safe = (text) => String(text ?? '')
  .replace(/[‐-―−]/g, '-')   // dashes and the typographic minus
  .replace(/[‘’‛]/g, "'")
  .replace(/[“”‟]/g, '"')
  .replace(/…/g, '...')
  .replace(/\s/g, ' ')                       // tabs/newlines have no meaning on one line
  // WinAnsi is Latin-1 plus a handful of extras already handled above; the
  // rest (CJK, emoji, combining marks) has no glyph to fall back to.
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

// pdf-lib draws a string wherever it is told and will happily run it off the
// page, so anything of unknown length has to be measured and truncated.
const fit = (text, font, size, maxWidth) => {
  let s = safe(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}...`;
};

export const buildInvoicePdf = async (invoice) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(logoBytes);

  const page = doc.addPage([PAGE.width, PAGE.height]);
  const right = PAGE.width - MARGIN;
  let y = PAGE.height - MARGIN;

  // ── Letterhead ──
  const logoWidth = 150;
  const logoDims = logo.scale(logoWidth / logo.width);
  page.drawImage(logo, { x: MARGIN, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });

  page.drawText('INVOICE', { x: right - bold.widthOfTextAtSize('INVOICE', 20), y: y - 16, size: 20, font: bold, color: INK });
  const numText = invoice.invoiceNumber;
  page.drawText(numText, { x: right - font.widthOfTextAtSize(numText, 11), y: y - 32, size: 11, font, color: MUTED });

  y -= Math.max(logoDims.height, 44) + 26;

  // ── Bill-to and dates, side by side ──
  const billTo = invoice.family?.name || invoice.student?.fullName || 'Family';
  page.drawText('BILL TO', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  page.drawText('INVOICE DATE', { x: right - 170, y, size: 8, font: bold, color: MUTED });
  y -= 14;
  page.drawText(fit(billTo, bold, 12, 280), { x: MARGIN, y, size: 12, font: bold, color: INK });
  page.drawText(formatDate(invoice.date), { x: right - 170, y, size: 11, font, color: INK });
  y -= 15;
  if (invoice.student?.fullName) {
    page.drawText(fit(`Student: ${invoice.student.fullName}`, font, 10, 280), { x: MARGIN, y, size: 10, font, color: MUTED });
  }
  page.drawText('DUE', { x: right - 170, y: y + 1, size: 8, font: bold, color: MUTED });
  page.drawText(formatDate(invoice.dueDate), { x: right - 130, y, size: 10, font, color: INK });

  y -= 34;

  // ── Line items ──
  const amountX = right;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 15;
  page.drawText('DESCRIPTION', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  const amtHead = 'AMOUNT';
  page.drawText(amtHead, { x: amountX - bold.widthOfTextAtSize(amtHead, 8), y, size: 8, font: bold, color: MUTED });
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 20;

  for (const line of invoice.lines) {
    const label = fit(line.description || 'Charge', font, 10.5, right - MARGIN - 110);
    page.drawText(label, { x: MARGIN, y, size: 10.5, font, color: INK });
    const amt = money(line.amount);
    page.drawText(amt, { x: amountX - font.widthOfTextAtSize(amt, 10.5), y, size: 10.5, font, color: INK });
    y -= 20;
    // A very long invoice would run off the bottom; stop before it does and
    // say so rather than silently dropping lines a family is being charged for.
    if (y < MARGIN + 140) {
      page.drawText('… continued — see the invoice in your parent portal for the full list.', {
        x: MARGIN, y, size: 9, font, color: MUTED,
      });
      y -= 20;
      break;
    }
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 22;

  // ── Totals ──
  const totalsRow = (label, value, { strong = false } = {}) => {
    const f = strong ? bold : font;
    const size = strong ? 12 : 10.5;
    page.drawText(label, { x: right - 200, y, size, font: f, color: strong ? INK : MUTED });
    page.drawText(value, { x: amountX - f.widthOfTextAtSize(value, size), y, size, font: f, color: INK });
    y -= strong ? 20 : 17;
  };

  totalsRow('Subtotal', money(invoice.subtotal));
  // An ASCII hyphen, not the typographic minus U+2212 the email uses: the
  // standard fonts here are WinAnsi-encoded and pdf-lib *throws* on a
  // character it cannot encode. With U+2212 every part-paid invoice failed to
  // render at all — no PDF to download, and the emailed copy erroring out.
  if (Number(invoice.amountPaid) > 0) totalsRow('Paid', `-${money(invoice.amountPaid)}`);

  // Drawn as a self-contained block rather than through totalsRow: that helper
  // treats `y` as a text baseline, but a filled box needs `y` to be its own
  // top edge — reusing it here is what let the box creep up into the
  // Subtotal row above it instead of sitting cleanly below it.
  const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  y -= 12; // clearance below the last row before the highlighted total
  const boxHeight = 34;
  const boxTop = y;
  const boxBottom = boxTop - boxHeight;
  page.drawRectangle({ x: right - 220, y: boxBottom, width: 220, height: boxHeight, color: TINT });

  const totalLabel = balance > 0 ? 'Balance due' : 'Paid in full';
  const totalValue = money(Math.max(0, balance));
  const textBaseline = boxBottom + boxHeight / 2 - 4.5; // vertically centers a 12pt line
  page.drawText(totalLabel, { x: right - 200, y: textBaseline, size: 12, font: bold, color: INK });
  page.drawText(totalValue, { x: amountX - bold.widthOfTextAtSize(totalValue, 12), y: textBaseline, size: 12, font: bold, color: INK });

  y = boxBottom - 14;

  const footerY = MARGIN + 24;
  const footerRuleY = footerY + 22;

  // ── How to pay ──
  // The PDF is the copy that gets printed, filed, and forwarded to a
  // scholarship administrator — detached from the email that carried the
  // accounts. A document that states a balance without saying where to send
  // it makes the family come back and ask.
  //
  // Pinned just above the footer rather than flowing under the total, so it
  // sits in the same place on every invoice — a family that has paid once
  // knows where to look, whether the invoice has three lines or thirty.
  //
  // Suppressed once the balance is settled, same as the email: instructions
  // for paying something already paid only invite paying it twice.
  const ROW = 15;
  const lastRowY = footerRuleY + 20;
  const firstRowY = lastRowY + (PAYMENT_METHODS.length - 1) * ROW;
  const headingY = firstRowY + 17;
  const blockRuleY = headingY + 12;

  let lastPage = page;
  if (balance > 0) {
    // Totals that ran this far down would collide with the block, which is
    // anchored and cannot move — so the block takes a page of its own,
    // pinned the same way at the bottom of that one.
    if (y < blockRuleY + 12) lastPage = doc.addPage([PAGE.width, PAGE.height]);

    lastPage.drawLine({ start: { x: MARGIN, y: blockRuleY }, end: { x: right, y: blockRuleY }, thickness: 1, color: RULE });
    lastPage.drawText('HOW TO PAY', { x: MARGIN, y: headingY, size: 8, font: bold, color: MUTED });

    PAYMENT_METHODS.forEach((method, i) => {
      const rowY = firstRowY - i * ROW;
      const label = safe(`${method.name} - ${method.detail}: `);
      lastPage.drawText(label, { x: MARGIN, y: rowY, size: 9.5, font: bold, color: INK });
      const valueX = MARGIN + bold.widthOfTextAtSize(label, 9.5);
      lastPage.drawText(
        fit(paymentMethodValue(method, invoice.invoiceNumber), font, 9.5, right - valueX),
        { x: valueX, y: rowY, size: 9.5, font, color: MUTED },
      );
    });
  }

  // ── Footer ──
  // On whichever page ended up last, so a spilled payment block doesn't leave
  // the contact line stranded on page one.
  lastPage.drawLine({ start: { x: MARGIN, y: footerRuleY }, end: { x: right, y: footerRuleY }, thickness: 1, color: RULE });
  lastPage.drawText('Love Learning Explorers', { x: MARGIN, y: footerY + 6, size: 9, font: bold, color: INK });
  lastPage.drawText('Questions about this invoice? Reply to the email it came with and the front desk will help.', {
    x: MARGIN, y: footerY - 6, size: 8.5, font, color: MUTED,
  });

  return Buffer.from(await doc.save());
};

export const invoicePdfFilename = (invoice) => `${invoice.invoiceNumber}.pdf`;
