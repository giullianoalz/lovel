/**
 * Love Learning — Google Form intake.
 *
 * Runs on every registration form submission: pushes the response into the
 * Academy Management API, then emails the family an acknowledgement.
 *
 * The API does all the thinking (deduplication, families, students,
 * applications). This file is deliberately a thin pipe — anything clever added
 * here becomes a second copy of logic that already exists server-side and will
 * drift away from it.
 *
 * ── Install ───────────────────────────────────────────────────────────────
 * The script runs under the personal account that owns the form, but the mail
 * goes out as the school. Gmail only allows that for an address you have
 * verified, so step 1 is not optional.
 *
 *  1. In Gmail as giullianoalz@gmail.com: Settings -> Accounts and Import ->
 *     "Send mail as" -> Add another email address -> lovelearningfl@gmail.com.
 *     Google emails a confirmation code to that inbox; open it and confirm.
 *     Until this is done the school address is not a usable sender.
 *  2. Open the form's response spreadsheet -> Extensions -> Apps Script.
 *  3. Paste this file in.
 *  4. Project Settings -> Script Properties, add:
 *         API_BASE_URL       <copy from the Render dashboard>
 *         FORM_INTAKE_SECRET <the same value set on Render>
 *         SEND_AS            lovelearningfl@gmail.com
 *
 *     API_BASE_URL is the service's own URL as shown at the top of its page in
 *     the Render dashboard, with no trailing /api — the script appends that.
 *     It is NOT derivable from the service name in render.yaml: the obvious
 *     guess, academy-management-api.onrender.com, answers "Not Found".
 *  5. Run `testConnection` once. It verifies the URL and the secret, confirms
 *     the alias is really verified, and triggers Google's authorisation
 *     prompt. Accept it. Do not continue until it prints OK on all three.
 *  6. Triggers (clock icon) -> Add Trigger -> function `onFormSubmit`,
 *     event source "From spreadsheet", event type "On form submit".
 *
 * If SEND_AS is left unset, mail comes from whoever authorised the trigger. If
 * it is set but not verified, nothing is sent to the family at all and you get
 * an alert instead — an email from the wrong address cannot be unsent, so this
 * fails loudly rather than quietly using the personal account.
 */

/* ── Configuration ───────────────────────────────────────────────────────── */

var SCHOOL_NAME = 'Love Learning';
var REPLY_TO = 'lovelearningfl@gmail.com';

// Include a "set your password" link in the welcome email so a new family
// lands with a working account. Set to false to send a plain acknowledgement.
var INCLUDE_INVITE_LINK = true;

// Errors are appended here instead of vanishing into the execution log, so a
// failed submission is visible to a human. Created on first use.
var ERROR_SHEET_NAME = 'Intake errors';

/**
 * Maps our fields to the form's questions. Matching is case-insensitive and by
 * substring, so rewording a question doesn't break the link as long as the
 * distinctive words survive. Everything NOT listed here is still forwarded
 * verbatim in `responses` and shown to staff — this list only picks out the
 * few fields the database has real columns for.
 */
var FIELD_MATCHERS = {
  email: ['email address', 'email'],
  parentName: ['parent first and last name', 'parent name'],
  parentPhone: ['parent phone'],
  address: ['residential address', 'address'],
  studentName: ['student first and last name', 'student name'],
  birthday: ['student birthday', 'birthday', 'date of birth'],
  ixl: ['just ixl access', 'ixl']
};

/* ── Entry point ─────────────────────────────────────────────────────────── */

function onFormSubmit(e) {
  var responses = readResponses(e);
  if (!responses) {
    logError('(no data)', 'Trigger fired with no response data — check the trigger is "On form submit".');
    return;
  }

  var payload = buildPayload(responses);

  if (!payload.email || !payload.studentName) {
    logError(payload.studentName || payload.email || '(unknown)',
      'Could not find the parent email or student name in the response. Check FIELD_MATCHERS against the current question wording.');
    return;
  }

  var result;
  try {
    result = postToApi(payload);
  } catch (err) {
    // The family is NOT in the system, so no welcome mail goes out — telling
    // someone they are registered when they aren't is worse than silence.
    logError(payload.studentName, 'API call failed: ' + err.message);
    notifyAdminOfFailure(payload, err.message);
    return;
  }

  // A resubmission or a retried trigger. Already handled, nothing to announce.
  if (result.duplicate) {
    logError(payload.studentName, 'Duplicate submission — already in the system, no email sent.', 'INFO');
    return;
  }

  try {
    sendWelcomeEmail(payload, result);
  } catch (err) {
    logError(payload.studentName, 'Saved to the system, but the welcome email failed: ' + err.message);
  }
}

/* ── Reading the response ────────────────────────────────────────────────── */

/**
 * `e.namedValues` keys answers by the question text, which is why this is
 * driven by a trigger rather than by parsing the CSV export: column positions
 * shift whenever a question is added, question text does not.
 */
function readResponses(e) {
  if (e && e.namedValues) {
    var flat = {};
    Object.keys(e.namedValues).forEach(function (q) {
      var v = e.namedValues[q];
      flat[q] = Array.isArray(v) ? v.filter(String).join('; ') : String(v || '');
    });
    return flat;
  }
  // Form-bound (rather than sheet-bound) trigger.
  if (e && e.response && e.response.getItemResponses) {
    var out = {};
    e.response.getItemResponses().forEach(function (ir) {
      var v = ir.getResponse();
      out[ir.getItem().getTitle()] = Array.isArray(v) ? v.join('; ') : String(v || '');
    });
    return out;
  }
  return null;
}

function findAnswer(responses, needles) {
  var questions = Object.keys(responses);
  for (var n = 0; n < needles.length; n++) {
    for (var q = 0; q < questions.length; q++) {
      if (questions[q].toLowerCase().indexOf(needles[n]) !== -1) {
        var v = String(responses[questions[q]] || '').trim();
        if (v) return v;
      }
    }
  }
  return '';
}

function buildPayload(responses) {
  var payload = {
    submittedAt: new Date().toISOString(),
    responses: responses,
    wantInviteLink: INCLUDE_INVITE_LINK
  };
  Object.keys(FIELD_MATCHERS).forEach(function (field) {
    payload[field] = findAnswer(responses, FIELD_MATCHERS[field]);
  });
  return payload;
}

/* ── API ─────────────────────────────────────────────────────────────────── */

function config(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing script property "' + key + '" — see the install notes at the top of this file.');
  return v;
}

function postToApi(payload) {
  var res = UrlFetchApp.fetch(config('API_BASE_URL').replace(/\/$/, '') + '/api/intake/form-response', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-intake-secret': config('FORM_INTAKE_SECRET') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code + ' — ' + body);

  return JSON.parse(body);
}

/* ── Email ───────────────────────────────────────────────────────────────── */

/**
 * An acknowledgement, NOT a confirmation.
 *
 * Nothing here may say the child has a place. Coves and electives are assigned
 * by staff against real capacity and priority holds, and this email goes out
 * seconds after submission, long before any of that has happened. It repeats
 * what the parent told us and says someone will be in touch.
 */
function sendWelcomeEmail(payload, result) {
  var student = (result.student && result.student.fullName) || payload.studentName;
  var parentFirst = (payload.parentName || '').split(' ')[0] || 'there';
  var subject = 'We received your registration for ' + student;

  var selections = summariseSelections(payload.responses);
  var invite = result.invite && result.invite.link;

  var html =
    '<div style="font-family:Arial,sans-serif;color:#222;max-width:560px;line-height:1.5">' +
      '<h2 style="margin-bottom:4px">Thank you, ' + escapeHtml(parentFirst) + '!</h2>' +
      '<p>We have received your registration for <strong>' + escapeHtml(student) + '</strong>. ' +
      'Here is what you told us:</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">' + selections + '</table>' +
      '<p><strong>What happens next:</strong> our team reviews every registration by hand to match each ' +
      'student with the right group and confirm availability. We will email you to confirm the placement ' +
      'and the cost before anything is finalised. Nothing is charged yet.</p>' +
      (invite
        ? '<p style="margin:20px 0;padding:14px;background:#f3f7ff;border-radius:8px">' +
          '<strong>Your family account is ready.</strong><br>' +
          'Set your password to follow your registration, schedule and billing:<br>' +
          '<a href="' + invite + '" style="color:#1d4ed8;font-weight:bold">Set your password</a>' +
          '<br><span style="font-size:12px;color:#666">This link is personal — please do not forward it.</span></p>'
        : '') +
      '<p>If anything above looks wrong, just reply to this email.</p>' +
      '<p style="margin-top:24px">— The ' + escapeHtml(SCHOOL_NAME) + ' team</p>' +
    '</div>';

  var options = {
    htmlBody: html,
    name: SCHOOL_NAME,
    replyTo: REPLY_TO
  };

  // The school address is a "Send mail as" alias on a personal account, so it
  // only works once verified. Refuse to fall back to the personal address: a
  // welcome email from the wrong sender reaches the family and cannot be
  // recalled, whereas this failure is visible, explained and re-sendable.
  var sendAs = PropertiesService.getScriptProperties().getProperty('SEND_AS');
  if (sendAs) {
    if (GmailApp.getAliases().indexOf(sendAs) === -1) {
      throw new Error(
        'SEND_AS is set to ' + sendAs + ' but that is not a verified alias on ' +
        Session.getEffectiveUser().getEmail() + '. Add it under Gmail -> Settings -> ' +
        'Accounts and Import -> "Send mail as" and confirm the code. Nothing was sent.'
      );
    }
    options.from = sendAs;
  }

  GmailApp.sendEmail(payload.email, subject, plainTextFallback(payload, student, invite), options);
}

/** Every answered question, in the form's own words. */
function summariseSelections(responses) {
  var skip = ['email address', 'timestamp'];
  var rows = '';
  Object.keys(responses).forEach(function (q) {
    var a = String(responses[q] || '').trim();
    if (!a) return;
    var ql = q.toLowerCase();
    for (var i = 0; i < skip.length; i++) if (ql.indexOf(skip[i]) !== -1) return;
    rows +=
      '<tr>' +
        '<td style="padding:6px 10px 6px 0;border-bottom:1px solid #eee;color:#555;vertical-align:top;width:45%">' +
          escapeHtml(q.split('\n')[0]) + '</td>' +
        '<td style="padding:6px 0;border-bottom:1px solid #eee"><strong>' + escapeHtml(a) + '</strong></td>' +
      '</tr>';
  });
  return rows || '<tr><td style="padding:6px 0">(no selections recorded)</td></tr>';
}

function plainTextFallback(payload, student, invite) {
  var lines = [
    'Thank you! We have received your registration for ' + student + '.',
    '',
    'Our team reviews every registration by hand to match each student with the right',
    'group and confirm availability. We will email you to confirm the placement and the',
    'cost before anything is finalised. Nothing is charged yet.',
    ''
  ];
  if (invite) lines.push('Set your password to access your family account: ' + invite, '');
  lines.push('If anything looks wrong, just reply to this email.', '', '— The ' + SCHOOL_NAME + ' team');
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Failure visibility ──────────────────────────────────────────────────── */

function logError(student, message, level) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) { console.error(student + ': ' + message); return; }
    var sheet = ss.getSheetByName(ERROR_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ERROR_SHEET_NAME);
      sheet.appendRow(['When', 'Level', 'Student', 'What happened']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), level || 'ERROR', student, message]);
  } catch (err) {
    console.error('Could not write to the error sheet: ' + err.message);
  }
  if (level !== 'INFO') console.error(student + ': ' + message);
}

/** A registration that never reached the system needs a human, now. */
function notifyAdminOfFailure(payload, reason) {
  try {
    GmailApp.sendEmail(REPLY_TO, 'Form intake FAILED — ' + (payload.studentName || 'unknown student'),
      'A registration was submitted but could not be saved to the system.\n\n' +
      'Student: ' + payload.studentName + '\n' +
      'Parent:  ' + payload.parentName + ' <' + payload.email + '>\n' +
      'Reason:  ' + reason + '\n\n' +
      'No welcome email was sent. The response is still in the spreadsheet — add the family by hand.');
  } catch (err) {
    console.error('Could not send the failure alert: ' + err.message);
  }
}

/* ── Install-time check ──────────────────────────────────────────────────── */

/**
 * Run this manually before the first real submission.
 *
 * Prints every question on the form and which of our fields (if any) it feeds.
 * The commonest failure by far is a question worded differently from what
 * FIELD_MATCHERS looks for — the response still arrives, but the parent email
 * or the student name comes through empty and the whole row is rejected. This
 * shows that mismatch in ten seconds instead of after a lost registration.
 */
function listFormQuestions() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var claimed = {};
  Object.keys(FIELD_MATCHERS).forEach(function (field) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').toLowerCase();
      var needles = FIELD_MATCHERS[field];
      for (var n = 0; n < needles.length; n++) {
        if (h.indexOf(needles[n]) !== -1 && !claimed[i]) { claimed[i] = field; return; }
      }
    }
  });

  Logger.log('--- Questions on the form ---');
  headers.forEach(function (h, i) {
    if (!String(h || '').trim()) return;
    Logger.log((claimed[i] ? '[' + claimed[i] + '] ' : '[ passed through ] ') + String(h).split('\n')[0]);
  });

  var missing = Object.keys(FIELD_MATCHERS).filter(function (f) {
    for (var k in claimed) if (claimed[k] === f) return false;
    return true;
  });
  Logger.log(missing.length
    ? '\nNOT MATCHED: ' + missing.join(', ') + ' — edit FIELD_MATCHERS so it matches your wording. ' +
      '"email" and "studentName" are required; the rest are optional.'
    : '\nAll fields matched.');
}

/** Run this manually once. Checks everything and sends nothing. */
function testConnection() {
  var res = UrlFetchApp.fetch(config('API_BASE_URL').replace(/\/$/, '') + '/api/intake/ping', {
    headers: { 'x-intake-secret': config('FORM_INTAKE_SECRET') },
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() === 200
    ? 'OK  API reachable and the secret matches.'
    : 'BAD API said HTTP ' + res.getResponseCode() + ' — ' + res.getContentText());

  var running = Session.getEffectiveUser().getEmail();
  var aliases = GmailApp.getAliases();
  Logger.log('OK  Script runs as: ' + running);
  Logger.log('    Verified aliases: ' + (aliases.length ? aliases.join(', ') : '(none)'));

  var sendAs = PropertiesService.getScriptProperties().getProperty('SEND_AS');
  if (!sendAs) {
    Logger.log('BAD SEND_AS is not set — mail would go out as ' + running + ', not as the school.');
  } else if (aliases.indexOf(sendAs) === -1) {
    Logger.log('BAD SEND_AS is ' + sendAs + ' but it is NOT verified. Add it under Gmail -> ' +
      'Settings -> Accounts and Import -> "Send mail as", confirm the emailed code, then re-run this.');
  } else {
    Logger.log('OK  Mail will be sent as: ' + sendAs);
  }
}
