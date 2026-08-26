import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';
import { hasRole } from '../utils/roles.js';
import { uploadBufferToDrive } from '../config/drive.js';
import {
  WAIVER_SECTIONS,
  WAIVER_TITLE,
  WAIVER_VERSION,
} from '../constants/waiverText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'waiver-logo.png');
// Read once at module load and reused for every PDF — a signature is common
// enough that re-reading a 34KB file from disk per request would add up, and
// the logo never changes at runtime.
const logoBytes = await readFile(LOGO_PATH);

// A drawn signature arrives as a data URL from the canvas. Anything else is
// either a mistake or someone poking at the endpoint, and it would land in the
// PDF as a broken image months later — so it is rejected at the door.
const SIGNATURE_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_BYTES = 500_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Is this actually a complete PNG?
 *
 * It has to be checked structurally, here, because pdf-lib's decoder does not
 * reject a damaged image — it spins on one, forever, blocking the event loop
 * and with it the whole API. That cannot be caught with try/catch and it cannot
 * be timed out, so the only defence is never handing it something broken.
 *
 * Walking the chunk table is enough: a truncated or corrupt file either fails
 * the magic bytes, declares a chunk that runs past the end of the buffer, or
 * simply never reaches IEND.
 */
const isCompletePng = (buffer) => {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return false;

  let offset = 8;
  let sawIhdr = false;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    // Chunk must fit entirely — 4 length + 4 type + data + 4 CRC.
    if (offset + 12 + length > buffer.length) return false;
    if (offset === 8 && type !== 'IHDR') return false;
    if (type === 'IHDR') sawIhdr = true;
    if (type === 'IEND') return sawIhdr;

    offset += 12 + length;
  }

  return false; // ran out of bytes before IEND
};

// Every family the caller belongs to. Both the sign and download paths need it
// for the same reason: a parent may only touch their own children's waivers.
const familyIdsFor = async (userId) => {
  const memberships = await prisma.familyMember.findMany({
    where: { userId },
    select: { familyId: true },
  });
  return memberships.map((m) => m.familyId);
};

// GET /api/waivers/document — the wording the parent is about to sign.
// Served rather than duplicated in the frontend so the screen and the generated
// PDF can never show different text.
export const getWaiverDocument = (req, res) => {
  res.json({ version: WAIVER_VERSION, title: WAIVER_TITLE, sections: WAIVER_SECTIONS });
};

// POST /api/waivers — a parent signs for one child.
export const signWaiver = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { studentId, minorName, parentName, signatureData, photoOptOut } = req.body;

    if (!studentId || !minorName?.trim() || !parentName?.trim() || !signatureData) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'studentId, minorName, parentName and signatureData are all required.',
      });
    }

    if (!signatureData.startsWith(SIGNATURE_PREFIX) || signatureData.length > MAX_SIGNATURE_BYTES) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'The signature could not be read. Please draw it again.',
      });
    }

    // See isCompletePng: a damaged image here would hang the process outright,
    // both on this request and on every future download of the stored row.
    if (!isCompletePng(Buffer.from(signatureData.slice(SIGNATURE_PREFIX.length), 'base64'))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'The signature image is incomplete. Please draw it again.',
      });
    }

    // The child must sit in one of this parent's families.
    const familyIds = await familyIdsFor(parentId);
    const childLink = await prisma.familyMember.findFirst({
      where: { userId: studentId, familyId: { in: familyIds } },
      select: { familyId: true },
    });
    if (!childLink) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This student is not in your family.',
      });
    }

    const existing = await prisma.liabilityWaiver.findUnique({
      where: { studentId },
      select: { id: true, signedAt: true },
    });
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A waiver has already been signed for this student.',
        waiverId: existing.id,
        signedAt: existing.signedAt,
      });
    }

    const waiver = await prisma.liabilityWaiver.create({
      data: {
        studentId,
        familyId: childLink.familyId,
        signedById: parentId,
        minorName: minorName.trim(),
        parentName: parentName.trim(),
        signatureData,
        documentVersion: WAIVER_VERSION,
        // Frozen at the moment of signing — see the model comment. Deep-cloned
        // via JSON round-trip so nothing ever aliases the live WAIVER_SECTIONS
        // array a future edit could mutate in place.
        documentSnapshot: JSON.parse(JSON.stringify({ title: WAIVER_TITLE, sections: WAIVER_SECTIONS })),
        photoOptOut: photoOptOut === true,
        ipAddress: req.ip || null,
      },
    });

    // The portal caches the parent's children, waiver flag included — drop it so
    // the "waiver required" banner disappears on the next load.
    invalidate(`portal:parent:${parentId}`);

    // Archive a copy to Drive. This is a backup, not the record of truth — the
    // row just created is — so a Drive hiccup must never fail the signature
    // itself. Awaited anyway (signing is a rare, one-per-child action) so the
    // response can honestly say whether the archive landed.
    let archived = false;
    try {
      const pdfBytes = await buildWaiverPdf(waiver);
      const safeName = waiver.minorName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
      const driveFile = await uploadBufferToDrive(
        Buffer.from(pdfBytes),
        `waiver-${safeName || 'signed'}-${waiver.id}.pdf`,
        'application/pdf',
        process.env.DRIVE_WAIVERS_FOLDER_ID || null
      );
      if (driveFile?.id) {
        await prisma.liabilityWaiver.update({ where: { id: waiver.id }, data: { driveFileId: driveFile.id } });
        archived = true;
      }
    } catch (driveErr) {
      console.error(`[Waivers] Failed to archive waiver ${waiver.id} to Drive:`, driveErr.message);
    }

    res.status(201).json({ success: true, id: waiver.id, signedAt: waiver.signedAt, archived });
  } catch (error) {
    next(error);
  }
};

// GET /api/waivers — staff compliance list: every student, signed or not.
export const listWaivers = async (req, res, next) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        fullName: true,
        status: true,
        noPhotosOverride: true,
        liabilityWaiver: {
          select: { id: true, signedAt: true, parentName: true, documentVersion: true, photoOptOut: true },
        },
        familyMembers: {
          select: { family: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { fullName: 'asc' },
    });

    res.json(
      students.map((s) => ({
        studentId: s.id,
        studentName: s.fullName,
        status: s.status,
        familyName: s.familyMembers[0]?.family?.name || null,
        signed: Boolean(s.liabilityWaiver),
        waiverId: s.liabilityWaiver?.id || null,
        signedAt: s.liabilityWaiver?.signedAt || null,
        signedByName: s.liabilityWaiver?.parentName || null,
        documentVersion: s.liabilityWaiver?.documentVersion || null,
        // The waiver's own opt-out and the staff override are two independent
        // switches — either one alone is enough to keep a kid off camera, so
        // the UI is handed both plus the OR'd result it actually needs to badge.
        photoOptOut: s.liabilityWaiver?.photoOptOut || false,
        noPhotosOverride: s.noPhotosOverride,
        noPhotos: Boolean(s.liabilityWaiver?.photoOptOut) || s.noPhotosOverride,
      }))
    );
  } catch (error) {
    next(error);
  }
};

// PUT /api/waivers/:studentId/no-photos — staff-set flag, independent of
// whatever the waiver itself says. Covers a request that arrives after
// signing, or a family with no waiver on file yet.
export const setNoPhotosOverride = async (req, res, next) => {
  try {
    const { noPhotos } = req.body;
    if (typeof noPhotos !== 'boolean') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'noPhotos must be true or false.',
      });
    }

    const student = await prisma.user.update({
      where: { id: req.params.studentId, role: 'STUDENT' },
      data: { noPhotosOverride: noPhotos },
      select: { id: true, fullName: true, noPhotosOverride: true },
    });

    res.json({ message: 'Updated.', student });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Not Found', message: 'Student not found.' });
    }
    next(error);
  }
};

// GET /api/waivers/:id/pdf — the signed document, as proof.
//
// Built fresh on every request instead of stored: the row already holds
// everything the document says, and a stored file is one more thing that can go
// missing or fall out of step with the record.
export const getWaiverPdf = async (req, res, next) => {
  try {
    const waiver = await prisma.liabilityWaiver.findUnique({
      where: { id: req.params.id },
    });
    if (!waiver) {
      return res.status(404).json({ error: 'Not Found', message: 'Waiver not found.' });
    }

    const isStaff = hasRole(req.user, ['ADMIN', 'RECEPTIONIST']);
    if (!isStaff) {
      const familyIds = await familyIdsFor(req.user.id);
      if (!familyIds.includes(waiver.familyId)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This waiver does not belong to your family.',
        });
      }
    }

    const pdf = await buildWaiverPdf(waiver);

    const safeName = waiver.minorName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="waiver-${safeName || 'signed'}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (error) {
    next(error);
  }
};

/* ── PDF rendering ───────────────────────────────────────────────────────── */

const PAGE = { width: 612, height: 792 };
const MARGIN = 56;
const BODY_SIZE = 9.5;
const LINE_HEIGHT = 13;

// pdf-lib draws a string wherever you put it and will happily run it off the
// page, so lines have to be measured and broken by hand.
const wrap = (text, font, size, maxWidth) => {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildWaiverPdf = async (waiver) => {
  // The wording this waiver was actually signed under, not whatever the
  // template says today — see the documentSnapshot column comment.
  const title = waiver.documentSnapshot?.title || WAIVER_TITLE;
  const sections = waiver.documentSnapshot?.sections || WAIVER_SECTIONS;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE.width - MARGIN * 2;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  // Start a new page whenever the next block would not fit.
  const ensureRoom = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    }
  };

  const writeLines = (text, { size = BODY_SIZE, style = font, indent = 0, gap = LINE_HEIGHT } = {}) => {
    for (const line of wrap(text, style, size, maxWidth - indent)) {
      ensureRoom(gap);
      page.drawText(line, { x: MARGIN + indent, y, size, font: style, color: rgb(0.1, 0.1, 0.12) });
      y -= gap;
    }
  };

  const writeCentered = (text, { size = BODY_SIZE, style = font, color = rgb(0.1, 0.1, 0.12) } = {}) => {
    const width = style.widthOfTextAtSize(text, size);
    page.drawText(text, { x: MARGIN + (maxWidth - width) / 2, y, size, font: style, color });
  };

  const logoImage = await doc.embedPng(logoBytes);
  const logoDims = logoImage.scaleToFit(72, 72);
  page.drawImage(logoImage, {
    x: MARGIN + (maxWidth - logoDims.width) / 2,
    y: y - logoDims.height,
    width: logoDims.width,
    height: logoDims.height,
  });
  y -= logoDims.height + 14;

  writeCentered(title, { size: 15, style: bold });
  y -= 20;
  writeCentered('The Love Camp', { size: 9, color: rgb(0.4, 0.4, 0.46) });
  y -= 16;
  writeCentered(`Prepared for: ${waiver.minorName}`, { size: 9.5, style: bold });
  y -= 22;

  for (const section of sections) {
    ensureRoom(34);
    y -= 6;
    writeLines(section.heading, { size: 10.5, style: bold, gap: 15 });
    for (const paragraph of section.paragraphs || []) {
      writeLines(paragraph);
      y -= 4;
    }
    for (const bullet of section.bullets || []) {
      writeLines(`•  ${bullet}`, { indent: 10 });
      y -= 2;
    }
    // The paper form's opt-out is a blank line the parent hand-writes "No
    // Photos" on; the checked box on the digital form is that same choice, so
    // it belongs printed right where that line would be, not off in the audit
    // stamp where nobody reviewing this page would think to look.
    if (section.heading === 'PHOTO & VIDEO RELEASE') {
      y -= 4;
      writeLines(
        waiver.photoOptOut
          ? '[X] No Photos — this parent has opted their child OUT of photo/video use.'
          : '[ ] No Photos (not checked — photo/video use as described above is permitted).',
        { style: waiver.photoOptOut ? bold : font }
      );
    }
  }

  // Signature block, kept whole: splitting the names away from the signature
  // across a page break makes the document read as if something is missing.
  ensureRoom(150);
  y -= 20;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE.width - MARGIN, y },
    thickness: 0.7,
    color: rgb(0.75, 0.75, 0.8),
  });
  y -= 26;

  const col2 = MARGIN + maxWidth / 2;
  const field = (label, value, x, baseline, width = maxWidth / 2 - 20) => {
    page.drawText(value, { x, y: baseline, size: 11, font, color: rgb(0.1, 0.1, 0.12) });
    page.drawLine({
      start: { x, y: baseline - 5 },
      end: { x: x + width, y: baseline - 5 },
      thickness: 0.7,
      color: rgb(0.6, 0.6, 0.66),
    });
    page.drawText(label, { x, y: baseline - 17, size: 8, font, color: rgb(0.42, 0.42, 0.5) });
  };

  // The current form only asks for the parent/guardian's printed name here —
  // which child it covers is stated once, up top ("Prepared for: ...").
  field('Print Parent/Guardian Name', waiver.parentName, MARGIN, y, maxWidth - 40);
  y -= 60;

  const signaturePng = await doc.embedPng(waiver.signatureData);
  const sigWidth = Math.min(maxWidth / 2 - 20, 200);
  const sigDims = signaturePng.scaleToFit(sigWidth, 46);
  page.drawImage(signaturePng, {
    x: MARGIN,
    y: y - 2,
    width: sigDims.width,
    height: sigDims.height,
  });

  const signedDate = new Date(waiver.signedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  field('Date', signedDate, col2, y + 10);

  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + maxWidth / 2 - 20, y },
    thickness: 0.7,
    color: rgb(0.6, 0.6, 0.66),
  });
  page.drawText('Parent/Guardian Signature', {
    x: MARGIN,
    y: y - 12,
    size: 8,
    font,
    color: rgb(0.42, 0.42, 0.5),
  });

  // The audit line. It is what makes this an electronic record rather than a
  // picture of one: who signed, from where, against which version of the text.
  y -= 40;
  ensureRoom(30);
  const stamp = [
    `Signed electronically on ${new Date(waiver.signedAt).toLocaleString('en-US')}`,
    waiver.ipAddress ? `from ${waiver.ipAddress}` : null,
    `· document version ${waiver.documentVersion}`,
    `· record ${waiver.id}`,
  ]
    .filter(Boolean)
    .join(' ');
  writeLines(stamp, { size: 7.5, gap: 10 });

  return doc.save();
};
