import { z } from 'zod';

/**
 * Reusable validation schemas using Zod
 */

export const registerUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  role: z.enum(['ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'RECEPTIONIST']),
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

// ── Request-payload schemas for the critical parent- and money-facing routes ──
// Every schema uses .passthrough(): zod strips unknown keys by default, which
// would silently drop fields a controller still reads. Passthrough keeps them,
// so validation only *adds* guarantees (required fields present, ids are UUIDs,
// numbers are numbers) without changing what reaches the handler. Free-form
// strings are checked for presence only — no brittle format regexes that could
// reject a valid variation the frontend already sends.
const uuid = z.string().uuid('Must be a valid id');

export const registrationRequestSchema = z.object({
  termId: uuid,
  studentId: uuid,
  firstChoiceClassId: uuid,
  secondChoiceClassId: z.string().optional().nullable(),
  electiveIds: z.array(z.string()).optional(),
  ixlPlan: z.string().optional(),
}).passthrough();

export const termIdQuerySchema = z.object({ termId: uuid }).passthrough();

export const createSessionSchema = z.object({
  classId: uuid,
  date: z.string().min(1, 'date is required'),
  startTime: z.string().min(1, 'startTime is required'),
  endTime: z.string().min(1, 'endTime is required'),
}).passthrough();

export const updateAttendanceSchema = z.object({
  attendanceRecords: z.array(z.object({
    studentId: uuid,
    status: z.string().min(1, 'status is required'),
  })),
}).passthrough();

export const cancelStudentSchema = z.object({ studentId: uuid }).passthrough();

export const resolveCancellationSchema = z.object({
  finalChargePercent: z.coerce.number().min(0).max(100),
}).passthrough();

export const createTransactionSchema = z.object({
  familyId: uuid,
  amount: z.coerce.number(),
  type: z.string().min(1, 'type is required'),
}).passthrough();

/**
 * Two ways to raise an invoice, and the body says which:
 *
 *  - { familyId, transactionIds } bundles charges that already exist on the
 *    ledger (the calendar-charge sweep).
 *  - { studentId, lines } writes one from scratch for a single student, each
 *    line raising its own charge. This is the per-student path; it does not
 *    need anything to be on the ledger first.
 *
 * Deliberately not a plain `.optional()` on both pairs: that would accept an
 * empty body and leave the controller to work out what was meant. A body must
 * pick one shape, and picking neither (or both) is a validation error here
 * rather than a surprise 400 further in.
 */
export const createInvoiceSchema = z.object({
  familyId: uuid.optional(),
  transactionIds: z.array(uuid).min(1, 'transactionIds must not be empty').optional(),
  studentId: uuid.optional(),
  lines: z.array(z.object({
    description: z.string().trim().min(1, 'each line needs a description'),
    amount: z.coerce.number().positive('each line needs a positive amount'),
  })).min(1, 'lines must not be empty').optional(),
}).passthrough().superRefine((body, ctx) => {
  const bundling = body.transactionIds !== undefined;
  const manual = body.lines !== undefined;
  if (bundling === manual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Send either transactionIds (to bill existing charges) or lines (to write an invoice from scratch), not both.',
    });
    return;
  }
  if (bundling && !body.familyId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['familyId'], message: 'familyId is required when sending transactionIds.' });
  }
  if (manual && !body.studentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['studentId'], message: 'studentId is required when sending lines.' });
  }
});

export const createPickupAuthSchema = z.object({
  pickupPerson: z.string().min(1, 'pickupPerson is required'),
  validDate: z.string().min(1, 'validDate is required'),
  // Omitted or empty means "all my children" — the portal offers that, and one
  // grandparent collecting three siblings shouldn't need three codes.
  studentId: uuid.optional().or(z.literal('')),
  relationship: z.string().optional(),
}).passthrough();

/**
 * A family registering itself.
 *
 * Note what is absent: no `email`, no `password`, no `role`. The email is taken
 * from the verified Firebase token and the roles are written by the controller,
 * so none of the three can be chosen by the caller. This is not .passthrough()
 * for the same reason — an unknown key must not reach the handler here.
 */
export const familySignupSchema = z.object({
  parent: z.object({
    fullName: z.string().min(2, 'Your full name is required'),
    phone: z.string().max(20).optional(),
  }),
  children: z.array(
    z.object({
      fullName: z.string().min(2, "Each child's name is required"),
      age: z.coerce.number().int().min(1).max(25).optional().nullable(),
      allergies: z.string().max(500).optional(),
      medicalNotes: z.string().max(1000).optional(),
      interests: z.array(z.string().max(40)).max(10).optional(),
      ixlPlan: z.enum(['NONE', 'CORE', 'CORE_SPANISH']).optional(),
    })
  ).min(1, 'Add at least one child').max(10, 'Contact the academy to register more than 10 children'),
  scholarship: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Middleware factory to validate a request against a Zod schema.
 *
 * @param schema  Zod schema
 * @param source  'body' (default), 'query', or 'params'
 *
 * Body is reassigned with the parsed (coerced) result. Query/params are only
 * validated in place — Express 5 exposes req.query as a getter, so reassigning
 * it throws; parsing purely for its throw-on-invalid side effect still yields a
 * clean 400 without mutating the read-only object.
 */
export const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'body') req.body = parsed;
      next();
    } catch (error) {
      next(error); // ZodError -> 400 via errorHandler
    }
  };
};
