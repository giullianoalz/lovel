import { z } from 'zod';

/**
 * Reusable validation schemas using Zod
 */

export const registerUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  role: z.enum(['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']),
  phone: z.string().optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().url().optional().nullable(),
  age: z.number().int().min(1).max(100).optional(),
  allergies: z.string().optional(),
});

export const createFamilySchema = z.object({
  name: z.string().min(2, 'Family name must be at least 2 characters'),
  tags: z.array(z.string()).optional(),
  members: z.array(
    z.object({
      userId: z.string().uuid(),
      role: z.string().optional(),
      isInvoiceRecipient: z.boolean().optional(),
    })
  ).optional(),
});

export const updateStudentHealthSchema = z.object({
  allergies: z.string().optional(),
  snackAuthorized: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Middleware factory to validate request body against a Zod schema
 */
export const validate = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error); // Will be caught by errorHandler
    }
  };
};
