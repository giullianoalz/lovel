/**
 * Love Learning Explorers — Google Form → app intake.
 *
 * Add this as a NEW file (Intake.gs) in the existing "LoveLearning -
 * Registration" script project, bound to the responses spreadsheet.
 *
 * It deliberately does NOT define `onFormSubmit`. That handler already exists
 * in Code.gs and writes the billing columns; Apps Script shares one scope
 * across files, so a second definition would silently replace the first and
 * the sheet would quietly stop being priced. Instead this exposes `sendToApp`,
 * which the existing handler calls at the end — see SETUP step 4.
 *
 * Why the welcome email goes out from here rather than from the app: the app's
 * mailer (Resend) needs a verified sending domain, which is still pending.
 * MailApp needs nothing. This works today and keeps working after Resend lands.
 *
 * ---------------------------------------------------------------------------
 * SETUP (once)
 *
 * 1. Project Settings → Script Properties → add:
 *      INTAKE_URL     https://<your-api>.onrender.com/api/intake
 *      INTAKE_SECRET  <the same value as FORM_INTAKE_SECRET on Render>
 *      ADMIN_EMAIL    <where failures should be reported>
 *
 * 2. Run `testConnection`. It must log HTTP 200.
 *
 * 3. Run `logSheetHeaders` and check the log against QUESTION_PATTERNS below —
 *    the patterns have to match this sheet's real column headers.
 *
 * 4. In Code.gs, add one line at the end of `onFormSubmit`:
 *
 *        sendToApp(e);
 *
 *    Put it AFTER the four setValue calls, so a network problem here can never
 *    cost you the billing columns.
 *
 * 5. Optional: run `backfillFromSheet()` to push rows submitted before the
 *    integration existed. Safe to re-run — the app reports duplicates and
 *    writes nothing. It does not email anyone unless you pass true.
 * ---------------------------------------------------------------------------
 */

const ACADEMY_NAME = 'Love Learning Explorers';

/**
 * How each payload field is found among the sheet's column headers.
 *
 * Matched loosely and case-insensitively, because the form's wording changes
 * between seasons and an exact-string map would silently start dropping fields
 * the first time somebody edits a question. First pattern that hits wins, so
 * order matters: specific before general ("student name" before "name").
 */
const QUESTION_PATTERNS = {
  email: [/parent.*e-?mail/i, /e-?mail/i],
  parentName: [/parent.*name/i, /guardian.*name/i, /your name/i],
  parentPhone: [/parent.*phone/i, /phone/i, /cell/i, /mobile/i],
  // "Email Address" also contains "address" and comes first in the sheet, so a
  // bare /address/i silently mapped the parent's email into the address field.
  // Match the real column explicitly and never fall back to a bare "address".
  address: [/residential.*address/i, /home.*address/i, /street/i, /^\s*address\s*$/i],
  studentName: [/student.*name/i, /child.*name/i, /camper.*name/i],
  birthday: [/birth/i, /\bdob\b/i],
  ixl: [/ixl/i],
};

/** Longest question title kept in `responses`, which becomes parentNotes. */
const MAX_QUESTION_LENGTH = 80;

/**
 * Posts one submission to the app and welcomes the family.
 *
 * Never throws: it is called from the end of `onFormSubmit`, and a registration
 * must not appear to fail because our API had a bad minute. Failures are
 * mailed to ADMIN_EMAIL so somebody can enter that one by hand.
 *
 * @param {Object} e The same event object `onFormSubmit` receives.
 */
function sendToApp(e) {
  try {
    if (!e) return;
    const responses = readNamedValues(e);
    const payload = buildPayload(responses, e);

    if (!payload.email || !payload.studentName) {
      throw new Error(
        'No parent email / student name found. Run logSheetHeaders and fix ' +
        'QUESTION_PATTERNS. Headers seen: ' + JSON.stringify(Object.keys(responses))
      );
    }

    const result = postToApp('/form-response', payload);

    // A re-fired trigger or a parent submitting twice lands here. The app wrote
    // nothing the second time, so welcoming them again would just be noise.
    if (result.duplicate) {
      Logger.log('Duplicate for %s — nothing written, no email sent.', payload.email);
      return;
    }

    sendWelcomeEmail(payload, result);
    Logger.log('Ingested %s / %s (invite link: %s)', payload.email, payload.studentName,
      result.invite && result.invite.link ? 'yes' : 'no');
  } catch (error) {
    reportFailure(error, e);
  }
}

/**
 * { "Column header": "answer" } for this submission.
 *
 * `e.namedValues` keys by the question title and values are arrays, which is
 * what a spreadsheet-bound onFormSubmit provides. Falls back to pairing
 * `e.values` against the header row for callers that only have raw values —
 * the backfill takes that path.
 */
function readNamedValues(e) {
  const out = {};

  if (e.namedValues) {
    Object.keys(e.namedValues).forEach(function (key) {
      const value = [].concat(e.namedValues[key]).map(formatCell).filter(String).join('; ').trim();
      if (value) out[shortenQuestion(key)] = value;
    });
    return out;
  }

  if (e.values) {
    const headers = getHeaders();
    headers.forEach(function (header, i) {
      const value = formatCell(e.values[i]);
      if (header && value !== '') out[shortenQuestion(header)] = value;
    });
  }
  return out;
}

/**
 * One cell as the app should receive it.
 *
 * Date cells matter: reading the sheet hands back real Date objects, whose
 * toString is "Tue Jun 07 2016 00:00:00 GMT-0400 (...)" — a shape the backend's
 * parseBirthday matches neither as M/D/YYYY nor as ISO, so every birthday
 * arrived null. Normalise to the ISO date it does understand.
 */
function formatCell(value) {
  if (value instanceof Date) {
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return value == null ? '' : String(value).trim();
}

/**
 * Question titles on this form carry the whole explanatory blurb — the Learning
 * Group one alone is ~1500 characters. They end up in parentNotes, where staff
 * read them, so keep the first line and cap it. The answer is the point.
 */
function shortenQuestion(title) {
  const firstLine = String(title).split('\n')[0].trim();
  return firstLine.length > MAX_QUESTION_LENGTH
    ? firstLine.slice(0, MAX_QUESTION_LENGTH - 1) + '…'
    : firstLine;
}

function buildPayload(responses, e) {
  const timestamp = (e && e.values && e.values[0]) ? new Date(e.values[0]) : new Date();

  return {
    email: String(pick(responses, QUESTION_PATTERNS.email) || '').toLowerCase().trim(),
    parentName: pick(responses, QUESTION_PATTERNS.parentName),
    parentPhone: pick(responses, QUESTION_PATTERNS.parentPhone),
    address: pick(responses, QUESTION_PATTERNS.address),
    studentName: pick(responses, QUESTION_PATTERNS.studentName),
    birthday: pick(responses, QUESTION_PATTERNS.birthday),
    ixl: pick(responses, QUESTION_PATTERNS.ixl),
    submittedAt: isNaN(timestamp) ? new Date().toISOString() : timestamp.toISOString(),
    // Everything verbatim, including the fields mapped above. Staff place
    // children from the parent's own words, and a question added to the form
    // later still lands somewhere useful instead of being dropped.
    responses: responses,
    wantInviteLink: true,
  };
}

/** First answer whose column header matches any of `patterns`. */
function pick(responses, patterns) {
  const headers = Object.keys(responses);
  for (var i = 0; i < patterns.length; i++) {
    for (var j = 0; j < headers.length; j++) {
      if (patterns[i].test(headers[j])) return responses[headers[j]];
    }
  }
  return '';
}

function getHeaders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function postToApp(path, payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INTAKE_URL');
  const secret = props.getProperty('INTAKE_SECRET');
  if (!url || !secret) throw new Error('INTAKE_URL / INTAKE_SECRET are not set in Script Properties.');

  const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-intake-secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('Intake returned ' + code + ': ' + body);
  return JSON.parse(body);
}

/**
 * The portal welcome. Deliberately says nothing about money — Code.gs already
 * owns the billing summary, and two emails disagreeing about a deposit is
 * worse than either one alone.
 */
function sendWelcomeEmail(payload, result) {
  const invite = result.invite || {};
  const parentName = (result.parent && result.parent.fullName) || payload.parentName || 'there';
  const studentName = (result.student && result.student.fullName) || payload.studentName;
  const firstName = String(parentName).split(' ')[0];

  // No link when they already had a login, or when Firebase hiccuped. Either
  // way the family still gets a welcome — a missing button beats silence.
  const linkBlock = invite.link
    ? '<p style="margin: 24px 0;">' +
      '<a href="' + invite.link + '" style="background: #2563eb; color: #fff; padding: 12px 22px; ' +
      'border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">' +
      'Set my password</a></p>' +
      '<p style="font-size: 13px; color: #555;">' +
      'If the link shows an error, try it in a private/incognito window — some antivirus ' +
      'extensions block it. If it has expired, just reply and we\'ll send a new one.</p>'
    : '<p style="font-size: 15px; line-height: 1.5;">You can sign in with the account you ' +
      'already have. If you\'ve forgotten your password, use "Forgot password" on the login page.</p>';

  const html =
    '<div style="font-family: Arial, sans-serif; color: #222; max-width: 560px;">' +
      '<h2 style="margin: 0 0 12px; color: #2e7d32;">Welcome to ' + ACADEMY_NAME + '</h2>' +
      '<p style="font-size: 15px; line-height: 1.5;">Hi ' + escapeHtml(firstName) + ',</p>' +
      '<p style="font-size: 15px; line-height: 1.5;">' +
        'We\'ve received your registration for <strong>' + escapeHtml(studentName) + '</strong>. ' +
        'Our team is reviewing placement and will follow up with the schedule and invoice.' +
      '</p>' +
      '<p style="font-size: 15px; line-height: 1.5;">' +
        'In the meantime, set up your parent portal to see your schedule, reports, invoices, ' +
        'and messages with teachers.' +
      '</p>' +
      linkBlock +
      '<p style="margin-top: 28px; font-size: 12px; color: #777;">Questions? Just reply to this email.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: payload.email,
    subject: 'Welcome to ' + ACADEMY_NAME + ' — ' + studentName + '\'s registration',
    htmlBody: html,
    name: ACADEMY_NAME,
  });
}

function reportFailure(error, e) {
  Logger.log('Intake failed: %s', (error && error.stack) || error);
  const admin = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!admin) return;

  let dump = '(no event)';
  try { if (e) dump = JSON.stringify(readNamedValues(e), null, 2); } catch (ignored) {}

  MailApp.sendEmail({
    to: admin,
    subject: '[' + ACADEMY_NAME + '] Form intake FAILED — needs manual entry',
    body:
      'A registration came in but could not be saved to the app.\n\n' +
      'Error: ' + ((error && error.message) || error) + '\n\n' +
      'The row is still safe in the responses sheet, and its billing columns were ' +
      'written normally. Only the app copy is missing.\n\n' +
      'Response:\n' + dump,
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Setup helpers: run these by hand from the editor ------------------------

/** Step 2 — confirms the URL and secret before any live traffic. */
function testConnection() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INTAKE_URL');
  const secret = props.getProperty('INTAKE_SECRET');
  if (!url || !secret) throw new Error('Set INTAKE_URL and INTAKE_SECRET in Script Properties first.');

  const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/ping', {
    headers: { 'x-intake-secret': secret },
    muteHttpExceptions: true,
  });
  Logger.log('HTTP %s — %s', response.getResponseCode(), response.getContentText());
}

/** Step 3 — dumps the real column headers and what the mapping resolves to. */
function logSheetHeaders() {
  const headers = getHeaders();
  Logger.log('--- Column headers ---');
  headers.forEach(function (h, i) { Logger.log('%s. %s', i + 1, h); });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() < 2) { Logger.log('(no responses yet)'); return; }

  // Raw, not stringified: formatCell has to see real Date objects to normalise
  // them, and String() would already have flattened them to an unparseable shape.
  const fake = { values: sheet.getRange(sheet.getLastRow(), 1, 1, headers.length).getValues()[0] };
  const responses = readNamedValues(fake);

  Logger.log('--- Latest row, as the script reads it ---');
  Logger.log(JSON.stringify(responses, null, 2));
  Logger.log('--- What the payload mapping resolves to ---');
  Logger.log(JSON.stringify(buildPayload(responses, fake), null, 2));
}

/**
 * Step 5 — pushes rows submitted before this integration existed.
 *
 * Safe to re-run: the app matches families on the parent's email and students
 * on name-within-family, so rows already present come back as duplicates and
 * write nothing. Emails are off unless you explicitly pass true — replaying a
 * season of registrations should not mail every family a fresh welcome.
 */
function backfillFromSheet(sendEmails) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const headers = getHeaders();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Nothing to backfill.'); return; }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let ingested = 0, duplicates = 0, failed = 0;

  rows.forEach(function (row, i) {
    try {
      const fake = { values: row };
      const responses = readNamedValues(fake);
      const payload = buildPayload(responses, fake);
      if (!payload.email || !payload.studentName) { failed++; return; }

      const result = postToApp('/form-response', payload);
      if (result.duplicate) { duplicates++; return; }
      ingested++;
      if (sendEmails === true) sendWelcomeEmail(payload, result);
    } catch (error) {
      failed++;
      Logger.log('Row %s failed: %s', i + 2, error.message);
    }
  });

  Logger.log('Backfill done — %s new, %s already present, %s failed.', ingested, duplicates, failed);
}
