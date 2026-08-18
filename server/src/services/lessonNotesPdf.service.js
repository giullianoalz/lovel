/**
 * Renders a class's family-facing lesson notes as a PDF, for the student's
 * "Download notes" button in the portal.
 *
 * These are the same approved summaries the portal shows on screen, one entry
 * per session date — a student who missed a week, or who is revising before a
 * test, gets the whole term on paper instead of scrolling. Built from the note
 * rows themselves so nothing can appear here that the portal would not show.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same logo as the invoices and signed waivers, so paper and inbox match.
const logoBytes = await readFile(path.join(__dirname, '..', 'assets', 'waiver-logo.png'));

const PAGE = { width: 612, height: 792 };
const MARGIN = 56;
const BOTTOM = MARGIN + 30; // leaves room for the footer rule and page number

const INK = rgb(0.024, 0.306, 0.231);   // BRAND.text  #064e3b
const MUTED = rgb(0.392, 0.455, 0.545); // BRAND.muted #64748b
const RULE = rgb(0.886, 0.910, 0.941);

const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
      })
    : '—';

// Session.startTime is a Postgres TIME on a 1970 placeholder — a wall clock,
// not an instant — so it has to be read with the UTC getters or every class
// slides by the viewer's offset. Same rule as the frontend's time.js.
const formatTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// pdf-lib draws a string wherever it is told and will happily run it off the
// page, so a note of unknown length has to be broken into lines by measurement.
// Also splits on the author's own line breaks, which carry meaning in a plan.
const wrap = (text, font, size, maxWidth) => {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the column (a URL) still has to be cut.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
};

const fit = (text, font, size, maxWidth) => {
  let s = String(text ?? '');
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
};

/**
 * @param {object} klass  { name, subject, teacherName }
 * @param {object} student { fullName }
 * @param {Array}  notes  [{ date, startTime, endTime, notes }] — newest first
 */
export const buildLessonNotesPdf = async (klass, student, notes) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(logoBytes);

  const right = PAGE.width - MARGIN;
  const columnWidth = right - MARGIN;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  // ── Letterhead ──
  const logoDims = logo.scale(150 / logo.width);
  page.drawImage(logo, { x: MARGIN, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
  const heading = 'LESSON NOTES';
  page.drawText(heading, { x: right - bold.widthOfTextAtSize(heading, 18), y: y - 15, size: 18, font: bold, color: INK });
  const printed = `Printed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  page.drawText(printed, { x: right - font.widthOfTextAtSize(printed, 9), y: y - 30, size: 9, font, color: MUTED });

  y -= Math.max(logoDims.height, 44) + 24;

  page.drawText(fit(klass.name, bold, 15, columnWidth), { x: MARGIN, y, size: 15, font: bold, color: INK });
  y -= 16;
  const subtitle = [
    klass.subject,
    klass.teacherName ? `with ${klass.teacherName}` : null,
    student?.fullName || null,
  ].filter(Boolean).join('  ·  ');
  if (subtitle) {
    page.drawText(fit(subtitle, font, 10, columnWidth), { x: MARGIN, y, size: 10, font, color: MUTED });
    y -= 16;
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 24;

  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };

  if (notes.length === 0) {
    page.drawText('No lesson notes have been published for this class yet.', {
      x: MARGIN, y, size: 11, font, color: MUTED,
    });
  }

  for (const entry of notes) {
    const bodyLines = wrap(entry.notes, font, 10.5, columnWidth);
    // Keep the date heading with at least the first two lines of its note
    // rather than stranding it alone at the foot of a page.
    const headerBlock = 14 + 16 + Math.min(bodyLines.length, 2) * 14;
    if (y - headerBlock < BOTTOM) newPage();

    const when = formatDate(entry.date);
    page.drawText(when, { x: MARGIN, y, size: 11.5, font: bold, color: INK });
    const slot = [formatTime(entry.startTime), formatTime(entry.endTime)].filter(Boolean).join(' – ');
    if (slot) {
      page.drawText(slot, { x: right - font.widthOfTextAtSize(slot, 9.5), y, size: 9.5, font, color: MUTED });
    }
    y -= 15;

    for (const line of bodyLines) {
      if (y < BOTTOM) newPage();
      if (line) page.drawText(line, { x: MARGIN, y, size: 10.5, font, color: INK });
      y -= 14;
    }

    y -= 8;
    if (y > BOTTOM) {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.6, color: RULE });
      y -= 20;
    }
  }

  // ── Footer on every page, numbered once the total is known ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footerY = MARGIN - 6;
    p.drawLine({ start: { x: MARGIN, y: footerY + 16 }, end: { x: right, y: footerY + 16 }, thickness: 1, color: RULE });
    p.drawText('Love Learning Explorers', { x: MARGIN, y: footerY, size: 8.5, font: bold, color: INK });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: right - font.widthOfTextAtSize(label, 8.5), y: footerY, size: 8.5, font, color: MUTED });
  });

  return Buffer.from(await doc.save());
};

export const lessonNotesPdfFilename = (klass) =>
  `lesson-notes-${String(klass.name || 'class').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.pdf`;
