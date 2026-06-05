/**
 * Role-Based Access Control (RBAC) Middleware
 * Use after the authenticate middleware to restrict routes by role.
 *
 * Usage:
 *   router.get('/admin-only', authenticate, requireRole('ADMIN'), handler)
 *   router.get('/staff', authenticate, requireRole('ADMIN', 'TEACHER'), handler)
 */

/**
 * Requires the authenticated user to have one of the specified roles
 * @param  {...string} allowedRoles - 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT'
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }

    next();
  };
};

/**
 * Requires the user to be the resource owner OR have an admin/teacher role.
 * Checks req.params.id against req.user.id
 */
export const requireSelfOrRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    const isOwner = req.params.id === req.user.id;
    const hasRole = allowedRoles.includes(req.user.role);

    if (!isOwner && !hasRole) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only access your own resources, or you need an elevated role.',
      });
    }

    next();
  };
};
