/**
 * The link for one specific meeting — client-side twin of the server's
 * server/src/utils/meetingLink.js. Keep the two in step.
 *
 * A link set on the session wins (that meeting is online, whatever the class
 * normally is); a VIRTUAL class falls back to its class-level link; anything
 * else has no link, so an in-person day never advertises a Zoom option.
 */
export const resolveMeetingUrl = (session, cls = session?.class) =>
  session?.meetingUrl || (cls?.type === 'VIRTUAL' ? cls.meetingUrl : null) || null;
