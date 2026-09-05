import prisma from '../config/database.js';
import { hasRole } from '../utils/roles.js';
import { sendSms, isSmsConfigured } from '../services/sms.service.js';

/**
 * POST /api/sms/send-to-parent
 * Body: { studentId, message }
 *
 * Lets front desk/admin text a student's parent directly, for the cases a
 * parent isn't seeing push notifications or email (app not installed,
 * notifications off). Resolves the parent the same way the student profile
 * does — see withParentContact in students.controller.js — so this never
 * accepts an arbitrary phone number from the client.
 */
export const sendTextToParent = async (req, res, next) => {
  try {
    const { studentId, message } = req.body || {};
    if (!studentId || !message?.trim()) {
      return res.status(400).json({ error: 'Validation Error', message: 'studentId and message are required.' });
    }

    if (!isSmsConfigured()) {
      return res.status(409).json({
        error: 'SMS Not Configured',
        message: 'No SMS provider is set up yet. Set SMS_PROVIDER and the TWILIO_* env vars on the server.',
      });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        familyMembers: {
          take: 1,
          include: { family: { include: { members: { include: { user: true } } } } },
        },
      },
    });
    if (!student) {
      return res.status(404).json({ error: 'Not Found', message: 'That student does not exist.' });
    }

    const members = student.familyMembers?.[0]?.family?.members || [];
    const parents = members.filter((m) => hasRole(m.user, 'PARENT'));
    const parent = (parents.find((m) => m.isInvoiceRecipient) || parents[0])?.user || null;

    if (!parent?.phone) {
      return res.status(422).json({ error: 'No Phone On File', message: 'This student has no parent phone number on file.' });
    }

    const result = await sendSms({ to: parent.phone, body: message.trim() });
    if (!result.ok) {
      return res.status(502).json({ error: 'Send Failed', message: result.error });
    }

    res.json({ sent: true, to: parent.phone });
  } catch (error) {
    next(error);
  }
};
