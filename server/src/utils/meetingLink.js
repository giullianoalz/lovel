/**
 * The link for one specific meeting.
 *
 * A Class can be IN_PERSON, VIRTUAL or HYBRID, but a *session* is only ever one
 * or the other, and that's the thing a family clicks on. So:
 *
 *   - a link set on the session wins — that meeting is online, whatever the
 *     class normally is (the Tuesday of an otherwise in-person Algebra 1);
 *   - a VIRTUAL class falls back to its class link — every meeting is online,
 *     nobody should have to paste the same URL onto every session;
 *   - anything else has no link, on purpose. A class-level link on an IN_PERSON
 *     or HYBRID class is only a default to prefill when marking one session
 *     virtual — showing it everywhere is what sends people to Zoom on a day the
 *     room is expecting them.
 */
export const resolveMeetingUrl = (session, cls = session?.class) =>
  session?.meetingUrl || (cls?.type === 'VIRTUAL' ? cls.meetingUrl : null) || null;

/** Is this particular meeting online? */
export const isVirtualSession = (session, cls = session?.class) =>
  Boolean(resolveMeetingUrl(session, cls));
