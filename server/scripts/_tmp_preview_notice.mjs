import { PrismaClient } from '@prisma/client';
import { buildInvoiceEmailHtml, toPreviewHtml } from '../src/services/email.service.js';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();

const MESSAGE = `We're resending your invoice with a refreshed payment link — the card button in the original email had a technical issue on our end and would not have gone through.

If the "Pay by card" button below still doesn't work for any reason, please log into your Parent Portal and pay from the Account & Payments tab instead. We're sorry for the inconvenience!`;

const invoice = await prisma.invoice.findUnique({
  where: { invoiceNumber: 'LC-4460' },
  include: { lines: true },
});

const html = toPreviewHtml(buildInvoiceEmailHtml({
  invoice,
  message: MESSAGE,
  checkoutUrl: 'https://checkout.stripe.com/c/pay/PREVIEW_ONLY',
}));

writeFileSync('_tmp_notice_preview.html', html);
console.log('Written to server/_tmp_notice_preview.html');
await prisma.$disconnect();
