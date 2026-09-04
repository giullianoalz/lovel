/**
 * A teacher can write to the board; an admin decides when it goes up.
 *
 * Three rules do the actual work, and each one is a way the review could be
 * walked around if it were missing:
 *
 *   publishesDirectly()   — who skips the queue. Only an admin.
 *   feedVisibilityWhere() — the where clause the feed is read through. An
 *                           unapproved post must not be in anyone's list but
 *                           its author's and the admins'.
 *   canSeeAnnouncement()  — the same answer for the pieces hanging off a post:
 *                           its photos and its reply thread. Without it, a
 *                           parent who guessed an id could read a post that no
 *                           admin has approved yet.
 *
 * Run with: npm test --prefix server
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

const { publishesDirectly, feedVisibilityWhere, canSeeAnnouncement } = await import(
  '../src/controllers/announcements.controller.js'
);

const ADMIN     = { id: 'admin-id',   role: 'ADMIN' };
const TEACHER   = { id: 'teacher-id', role: 'TEACHER' };
const PARENT    = { id: 'parent-id',  role: 'PARENT' };
// The reason hasRole() is permissive: one login, two hats.
const TEACHER_PARENT = { id: 'both-id', role: 'TEACHER', secondaryRoles: ['PARENT'] };

const post = (over = {}) => ({
  id: 'post-id',
  authorId: TEACHER.id,
  status: 'APPROVED',
  targetAudience: 'all',
  ...over,
});

// ── Who publishes, who submits ──────────────────────────────────────────────

test('an admin puts a post straight on the board', () => {
  assert.equal(publishesDirectly(ADMIN), true);
});

test('a teacher submits rather than publishes', () => {
  assert.equal(publishesDirectly(TEACHER), false);
});

test('a teacher who is also an admin publishes — the admin hat is the one that counts', () => {
  assert.equal(publishesDirectly({ id: 'x', role: 'TEACHER', secondaryRoles: ['ADMIN'] }), true);
});

// ── What the feed query lets through ────────────────────────────────────────

test('an admin reads the board unfiltered, queue included', () => {
  assert.deepEqual(feedVisibilityWhere(ADMIN), {});
});

test('a parent only ever matches approved posts', () => {
  const where = feedVisibilityWhere(PARENT);
  const [approved, own] = where.OR;
  assert.equal(approved.status, 'APPROVED');
  // The second arm is the author's own submissions; a parent has none, so it
  // can only ever match posts they wrote themselves.
  assert.deepEqual(own, { authorId: PARENT.id });
});

test("a teacher sees their own submission while it waits", () => {
  const where = feedVisibilityWhere(TEACHER);
  assert.ok(where.OR.some(arm => arm.authorId === TEACHER.id && arm.status === undefined));
});

test('a teacher who is also a parent matches both audiences', () => {
  const where = feedVisibilityWhere(TEACHER_PARENT);
  const audiences = where.OR[0].targetAudience.in;
  assert.deepEqual(audiences, ['all', 'teacher', 'parent']);
});

// ── Photos and replies follow the post ──────────────────────────────────────

test('a parent cannot reach a post that is still waiting for approval', () => {
  assert.equal(canSeeAnnouncement(PARENT, post({ status: 'PENDING' })), false);
});

test('a parent cannot reach a rejected post either', () => {
  assert.equal(canSeeAnnouncement(PARENT, post({ status: 'REJECTED' })), false);
});

test('the author reaches their own post in every state', () => {
  for (const status of ['PENDING', 'REJECTED', 'APPROVED']) {
    assert.equal(canSeeAnnouncement(TEACHER, post({ status })), true, status);
  }
});

test('another teacher cannot read a colleague\'s unapproved post', () => {
  const other = { id: 'other-teacher', role: 'TEACHER' };
  assert.equal(canSeeAnnouncement(other, post({ status: 'PENDING' })), false);
});

test('an admin reaches anything — reviewing it means reading it', () => {
  assert.equal(canSeeAnnouncement(ADMIN, post({ status: 'PENDING' })), true);
});

test('approval alone is not enough: the audience still has to match', () => {
  assert.equal(
    canSeeAnnouncement(PARENT, post({ authorId: 'someone-else', targetAudience: 'teacher' })),
    false
  );
  assert.equal(
    canSeeAnnouncement(PARENT, post({ authorId: 'someone-else', targetAudience: 'parent' })),
    true
  );
});
