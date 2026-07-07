import { Resend } from 'resend';
import { formatCurrency } from '../utils/helpers.js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const IXL_LABELS = {
  NONE: 'Ninguno',
  CORE: 'IXL Core',
  CORE_SPANISH: 'IXL Core + Spanish',
};

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

const buildBillingEmailHtml = ({ studentName, className, electiveNames, request, term }) => `
  <div style="font-family: Arial, sans-serif; color: #222; max-width: 560px;">
    <h2>Confirmación de inscripción — ${term.name}</h2>
    <p>Hola, este es el desglose de facturación para <strong>${studentName}</strong> (${className}).</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tbody>
        <tr><td style="padding: 6px 0;">Tarifa base</td><td style="text-align: right;">${formatCurrency(request.baseRate)}</td></tr>
        <tr><td style="padding: 6px 0;">Electivas${electiveNames.length ? ` (${electiveNames.join(', ')})` : ''}</td><td style="text-align: right;">${formatCurrency(request.electivesTotal)}</td></tr>
        <tr><td style="padding: 6px 0;">Plan IXL (${IXL_LABELS[request.ixlPlan] || 'Ninguno'})</td><td style="text-align: right;">${formatCurrency(request.ixlTotal)}</td></tr>
        <tr style="border-top: 1px solid #ccc; font-weight: bold;"><td style="padding: 6px 0;">Total trimestral</td><td style="text-align: right;">${formatCurrency(request.totalQuarterly)}</td></tr>
        <tr style="color: #b45309; font-weight: bold;"><td style="padding: 6px 0;">Depósito requerido (15%)</td><td style="text-align: right;">${formatCurrency(request.depositAmount)}</td></tr>
      </tbody>
    </table>
    <p>Fecha límite del depósito: <strong>${formatDate(request.depositDueDate)}</strong>.</p>
    <p>Adjuntamos el calendario académico 2026.</p>
  </div>
`;

/**
 * Sends the registration billing confirmation email.
 * Never throws — returns { ok, error } so the caller can persist emailStatus without
 * rolling back the enrollment that already happened.
 */
export const sendRegistrationBillingEmail = async ({ to, studentName, className, electiveNames = [], request, term }) => {
  if (!resend) {
    return { ok: false, error: 'RESEND_API_KEY no configurada' };
  }

  try {
    const attachments = [];
    if (term.calendarAssetUrl) {
      attachments.push({ path: term.calendarAssetUrl, filename: 'Calendario-2026.pdf' });
    }

    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@lovelearning.app',
      to,
      subject: `Confirmación de inscripción y facturación — ${term.name}`,
      html: buildBillingEmailHtml({ studentName, className, electiveNames, request, term }),
      attachments,
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
