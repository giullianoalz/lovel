-- First migrate any existing invoices with status 'partial' to the correct status
-- If the invoice was emailed (sentAt not null), set to 'sent'; otherwise set to 'draft'
UPDATE invoices
SET status = CASE
  WHEN sent_at IS NOT NULL THEN 'sent'::invoice_status
  ELSE 'draft'::invoice_status
END
WHERE status = 'partial'::invoice_status;

-- Also fix invoices that are 'sent' but were never actually emailed
UPDATE invoices
SET status = 'draft'::invoice_status
WHERE status = 'sent'::invoice_status AND sent_at IS NULL;

-- Now remove the 'partial' value from the enum
ALTER TYPE invoice_status RENAME TO invoice_status_old;
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

ALTER TABLE invoices
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE invoice_status USING status::text::invoice_status,
  ALTER COLUMN status SET DEFAULT 'draft'::invoice_status;

DROP TYPE invoice_status_old;
