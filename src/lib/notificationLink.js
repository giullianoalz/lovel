// Maps a notification to the screen where its underlying activity lives, so
// clicking the bell item takes you straight to it. Role-aware: only returns a
// route the current role can actually reach (otherwise the ProtectedRoute
// would just bounce them to the dashboard). Returns null when there's no
// sensible destination — the item is then just marked read, not navigated.
export function getNotificationLink(item, role) {
  if (!item) return null;
  const isStaff = role === 'ADMIN' || role === 'TEACHER';

  // Broadcast announcements always live in the feed.
  if (item.source === 'announcement') return '/feed';

  switch (item.referenceType) {
    case 'chat_thread':
      // Deep-link straight to the thread; ChatHub opens it from ?thread=.
      return item.referenceId ? `/chat?thread=${item.referenceId}` : '/chat';

    case 'behaviorLog':
      return isStaff ? '/behavior' : null;

    case 'classAlert':
    case 'sessionCancellation':
      return role === 'ADMIN' ? '/alerts' : null;

    case 'medicalLog':
      return role === 'ADMIN' ? '/medical' : null;

    case 'lesson_plan':
      return role === 'ADMIN' ? '/lesson-plans' : null;

    case 'payment':
    case 'invoice':
      if (role === 'ADMIN') return '/billing';
      return role === 'PARENT' ? '/portal/parent' : null;

    case 'snackReload':
      if (role === 'ADMIN') return '/alerts';
      return role === 'PARENT' ? '/portal/parent' : null;

    // Low-punch warning from the nightly cron. Staff top a student up from the
    // snack cabinet in the students list; a parent acts on their own child from
    // the portal, where the reload request waits for approval.
    case 'snack':
      if (isStaff) return '/students';
      return role === 'PARENT' ? '/portal/parent' : null;

    case 'class':
      return role === 'ADMIN' ? '/registration' : '/calendar';

    case 'session':
      return '/calendar';

    case 'student':
      return isStaff ? '/students' : null;

    default:
      return null;
  }
}
