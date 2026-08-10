/**
 * Backfill: rewrite chat notifications that still name a guardian.
 *
 * Chat now shows teachers "Ana's Parent" instead of the guardian's real name
 * (server/src/utils/parentPrivacy.js), and the notification title is built the
 * same way — but only for rows created from that point on. Every chat_message
 * notification already sitting in a teacher's bell still reads "New message
 * from Maria Gonzalez". This rewrites those titles in place.
 *
 * Only `chat_message` rows are touched. The other notification types name
 * students, not guardians, and go to parents or admins.
 *
 * Usage:
 *   node scripts/mask-parent-names-in-notifications.js            # dry run
 *   node scripts/mask-parent-names-in-notifications.js --apply    # write
 *
 * Dry run is the default on purpose: DATABASE_URL points at the live Neon
 * database, so the first run should only ever print what it would change.
 */

import 'dotenv/config';
// The shared client, unlike backup-db.js: buildParentMaskMap below runs on it,
// and two clients would mean two connection pools for one short job. If
// NODE_ENV=development makes the query log drown this script's output, run it
// with NODE_ENV unset.
import prisma from '../src/config/database.js';
import { buildParentMaskMap, masksParentIdentity } from '../src/utils/parentPrivacy.js';

const APPLY = process.argv.includes('--apply');

const TITLE_PREFIX = 'New message from ';

/**
 * Who sent the message this notification announced.
 *
 * The dedupKey is `chat-message:<messageId>:<recipientId>`, so the exact
 * message — and therefore the exact sender — is recoverable. Rows predating
 * that key fall back to the thread: the guardians in it whose name the title
 * actually spells out.
 */
async function resolveSenderId(notification) {
  const messageId = notification.dedupKey?.startsWith('chat-message:')
    ? notification.dedupKey.split(':')[1]
    : null;

  if (messageId) {
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { senderId: true },
    });
    if (message?.senderId) return message.senderId;
  }

  if (!notification.referenceId) return null;

  const named = notification.title.slice(TITLE_PREFIX.length).trim();
  if (!named) return null;

  const participants = await prisma.chatParticipant.findMany({
    where: { threadId: notification.referenceId },
    select: { user: { select: { id: true, fullName: true } } },
  });
  return participants.find((p) => p.user.fullName === named)?.user.id || null;
}

async function main() {
  const notifications = await prisma.notification.findMany({
    where: { type: 'chat_message', title: { startsWith: TITLE_PREFIX } },
    select: {
      id: true,
      title: true,
      dedupKey: true,
      referenceId: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, role: true, secondaryRoles: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Only a teacher's own bell is a disclosure. A parent's or an admin's row
  // keeps the real name.
  const teacherRows = notifications.filter((n) => masksParentIdentity(n.user));

  console.log(`chat_message notifications: ${notifications.length} total, ${teacherRows.length} on a teacher's bell`);

  let rewritten = 0;
  let unresolved = 0;
  let alreadyFine = 0;

  for (const n of teacherRows) {
    const senderId = await resolveSenderId(n);
    if (!senderId) {
      unresolved += 1;
      console.warn(`  ? ${n.id} — sender not resolvable, left as-is: "${n.title}"`);
      continue;
    }

    // Same helper the live code path uses, so the backfilled titles and the new
    // ones read identically — including the own-family exemption.
    const maskMap = await buildParentMaskMap(n.user, [senderId]);
    const label = maskMap.get(senderId);
    if (!label) {
      alreadyFine += 1;
      continue;
    }

    const newTitle = `${TITLE_PREFIX}${label}`;
    if (newTitle === n.title) {
      alreadyFine += 1;
      continue;
    }

    console.log(`  → ${n.user.fullName}: "${n.title}" → "${newTitle}"`);
    if (APPLY) {
      await prisma.notification.update({ where: { id: n.id }, data: { title: newTitle } });
    }
    rewritten += 1;
  }

  console.log('');
  console.log(`${APPLY ? 'Rewritten' : 'Would rewrite'}: ${rewritten}`);
  console.log(`Already masked or not a guardian: ${alreadyFine}`);
  if (unresolved) console.log(`Unresolved senders (untouched): ${unresolved}`);
  if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply to commit.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
