import React, { useState, useEffect } from 'react';
import { 
  DollarSign, AlertCircle, Coffee, Filter, Download, Send, X, CheckCircle, 
  CreditCard, History, ChevronLeft, ChevronRight, Plus, MoreVertical, Calendar as CalendarIcon, Search,
  UploadCloud, FileText, Check, User, Trash2, Pencil, ExternalLink, Eye, Mail, Receipt, Layers, GitFork, HandCoins,
  Clock, MinusCircle, CircleDot
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { database } from '../../lib/database';
import { getSocket } from '../../lib/socket';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import EmailPreviewModal from '../Layout/EmailPreviewModal';
import SessionChargesPanel from './SessionChargesPanel';
import BlockBillingPanel from './BlockBillingPanel';
import { defaultInvoiceSubject, defaultInvoiceMessage, INVOICE_FIXED_NOTE } from '../../lib/emailDefaults';
import './BillingPanel.css';

const formatDateUS = (dateStr) => {
  if (!dateStr) return '';
  if (dateStr.includes('/') && dateStr.split('/').pop().length === 2) return dateStr; 
  const [y, m, d] = dateStr.split('T')[0].split('-');
  if (!y || !m || !d) return dateStr;
  return `${m}/${d}/${y.slice(-2)}`;
};

// Full date + time for the "Sent" column — the date alone is ambiguous when
// the same invoice is re-sent multiple times in the same day.
const formatDateTimeUS = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${h}:${min} ${ampm}`;
};

const STATUS_CONFIG = {
  paid:    { icon: CheckCircle,  label: 'Paid' },
  partial: { icon: CircleDot,    label: 'Partial' },
  sent:    { icon: Send,         label: 'Sent' },
  draft:   { icon: FileText,     label: 'Draft' },
  pending: { icon: Clock,        label: 'Pending' },
  overdue: { icon: AlertCircle,  label: 'Overdue' },
  cancelled: { icon: MinusCircle, label: 'Cancelled' },
};

const BillingPanel = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [families, setFamilies] = useState([]);
  const [students, setStudents] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFamily, setSelectedFamilyState] = useState(null);
  const [activeTab, setActiveTab] = useState('Account'); // 'Account' | 'Invoices'

  // Which family is open lives in the URL (?family=<id>), not just component
  // state — a refresh, a bookmark, or a link pasted from Slack all reload
  // this component from scratch, and state-only selection had nothing to
  // rebuild it from, dropping the admin back on the family list every time.
  const selectFamily = (family) => {
    setSelectedFamilyState(family);
    setSearchParams(family ? { family: family.id } : {}, { replace: !family });
  };

  // Restores the URL's family once the list has loaded — the id alone isn't
  // enough to render the detail view, so this waits for `families` rather
  // than racing it.
  useEffect(() => {
    if (selectedFamily || families.length === 0) return;
    const familyId = searchParams.get('family');
    if (!familyId) return;
    const match = families.find(f => f.id === familyId);
    if (match) setSelectedFamilyState(match);
    // A stale/bad id in the URL (family deleted, typo'd link) is left alone
    // rather than silently cleared — falling through to the family list is
    // enough, and rewriting the URL here would fight the effect that's
    // meant to keep it in sync with a real selection.
  }, [families]);
  const [familySearch, setFamilySearch] = useState('');
  const [onlyOwing, setOnlyOwing] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyCardPaid, setOnlyCardPaid] = useState(false);

  // Modal States
  const [isAddTxModalOpen, setIsAddTxModalOpen] = useState(false);
  const [isEmaModalOpen, setIsEmaModalOpen] = useState(false);
  // Meetings priced on the calendar, waiting to be turned into real charges.
  const [isSessionChargesOpen, setIsSessionChargesOpen] = useState(false);
  // Billing a block of classes to a whole roster before they are taught — the
  // many-families counterpart of the per-family block on a family's ledger.
  const [isBlockBillingOpen, setIsBlockBillingOpen] = useState(false);
  const [emaSyncState, setEmaSyncState] = useState({ step: 1, matched: 0, newInvoices: [] });
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [reconcile, setReconcile] = useState({ step: 1, text: '', lines: [], report: null });
  const [isParsingPreview, setIsParsingPreview] = useState(false);
  const [newTxForm, setNewTxForm] = useState({ type: 'Payment', amount: '', date: new Date().toISOString().split('T')[0], description: '', studentId: '', paymentMethod: '', invoiceId: '', repeatMonthly: false, repeatUntil: '' });
  // The family's standing arrangements. Kept apart from `transactions` because
  // they are instructions, not money — nothing here is on anyone's balance.
  const [recurringCharges, setRecurringCharges] = useState([]);
  const [refundModal, setRefundModal] = useState(null); // { invoice, payment, amount, reason }
  // Invoice being written by hand for a single student: { studentId, lines: [{ description, amount }] }
  const [studentInvoice, setStudentInvoice] = useState(null);

  const loadBilling = async () => {
    setLoading(true);
    setError(null);
    try {
      // Independent fetches — run them in parallel instead of one at a time.
      const [fams, studs, txs, invs, recurring] = await Promise.all([
        database.fetchFamilies(),
        database.fetchStudents(),
        database.fetchAllTransactions(),
        database.fetchAllInvoices(),
        // Every family's arrangements in one call, filtered client-side per
        // family — the list is small and this keeps switching families instant.
        database.fetchRecurringCharges(null, { includeInactive: true }),
      ]);
      setRecurringCharges(recurring);
      setFamilies(fams);
      setStudents(studs);
      setTransactions(txs);
      setInvoices(invs);
    } catch (err) {
      setError(err.userMessage || 'Could not load billing data. Real financial figures could not be verified, so nothing is shown — please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  // Live push: a parent paying by card settles via the Stripe webhook, which
  // may land while an admin is sitting on this exact screen. Join admin_room
  // and refetch on the signal instead of leaving the invoice looking unpaid
  // until someone happens to reload.
  useEffect(() => {
    const socket = getSocket();
    socket.emit('join_admin');
    const onBillingUpdated = () => loadBilling();
    socket.on('billing_updated', onBillingUpdated);
    return () => socket.off('billing_updated', onBillingUpdated);
  }, []);

  // Whether a family has ever paid by card through the parent portal's
  // Stripe checkout — the ledger has no separate "payment method" concept,
  // so this reads it off the invoices' embedded payments instead.
  const familyHasCardPayment = (familyId) => invoices.some(inv =>
    inv.familyId === familyId && inv.payments?.some(p => p.method === 'STRIPE_CARD' && p.status !== 'REFUNDED'));

  const calculateFamilyBalance = (familyId) => {
    const famTxs = transactions.filter(t => t.familyId === familyId);
    // Charges/Refunds increase balance owing, Payments/Discounts/Credits decrease it
    return famTxs.reduce((acc, t) => {
      const type = t.type.toLowerCase();
      if (type === 'charge' || type === 'refund') return acc + Math.abs(t.amount);
      if (type === 'payment' || type === 'discount' || type === 'credit') return acc - Math.abs(t.amount);
      return acc;
    }, 0);
  };

  // Only money the academy asks for can stand every month. A payment or a
  // refund is a thing that happened once; repeating it would invent history.
  const isRepeatable = newTxForm.type === 'Charge';

  const familyRecurring = selectedFamily
    ? recurringCharges.filter(r => r.familyId === selectedFamily.id)
    : [];

  const handleToggleRecurring = async (charge) => {
    try {
      const updated = await database.updateRecurringCharge(charge.id, { active: !charge.active });
      setRecurringCharges(prev => prev.map(r => (r.id === charge.id ? updated : r)));
      toast.success(updated.active ? 'Recurring charge resumed.' : 'Recurring charge paused — it will not be raised again.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not update the recurring charge.');
    }
  };

  const handleDeleteRecurring = async (charge) => {
    try {
      const res = await database.deleteRecurringCharge(charge.id);
      setRecurringCharges(prev => prev.filter(r => r.id !== charge.id));
      toast.success(res.message || 'Recurring charge removed.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove the recurring charge.');
    }
  };

  const handleAddTransaction = async () => {
    if (!newTxForm.amount || isNaN(newTxForm.amount)) return;
    setLoading(true);

    try {
      // 1. Create the charge
      const newTx = await database.addTransaction({
        familyId: selectedFamily.id,
        studentId: newTxForm.studentId || null,
        amount: parseFloat(newTxForm.amount),
        type: newTxForm.type,
        description: newTxForm.description || `Manual ${newTxForm.type}`,
        date: newTxForm.date,
        paymentMethod: newTxForm.type === 'Payment' ? (newTxForm.paymentMethod || null) : null,
        invoiceId: newTxForm.type === 'Payment' ? (newTxForm.invoiceId || null) : null,
      });

      // No invoice is raised here. The charge sits on the ledger until the
      // period it belongs to is billed from the Invoices tab — see
      // openBillRange, and createTransaction on the server for why.
      if (newTx.type.toLowerCase() === 'charge') {
        toast.success('Charge added to the ledger. Bill it with the rest of its period.');
      }

      // 3. If it repeats, record the arrangement for the months after this one.
      //    Today's charge was already raised above, so the schedule starts next
      //    month — starting it today would bill the family twice for August.
      if (isRepeatable && newTxForm.repeatMonthly) {
        const first = new Date(`${newTxForm.date}T00:00:00Z`);
        const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
        await database.addRecurringCharge({
          familyId: selectedFamily.id,
          studentId: newTxForm.studentId || null,
          amount: parseFloat(newTxForm.amount),
          description: newTxForm.description || `Monthly ${newTxForm.type}`,
          dayOfMonth: first.getUTCDate(),
          startDate: nextMonth.toISOString().slice(0, 10),
          endDate: newTxForm.repeatUntil || null,
        });
        toast.success(`It will repeat every month on day ${first.getUTCDate()}.`);
      }

      setIsAddTxModalOpen(false);
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not save the transaction. Please try again.');
    }
  };

  const [deletingTxId, setDeletingTxId] = useState(null);

  // Only offered on rows the server would actually accept — see `deletable`
  // in listTransactions. The 409 case (invoiced/paid) is still handled here
  // too, since the list this ran from could be a few seconds stale.
  const handleDeleteTransaction = async (tx) => {
    if (!window.confirm(`Remove this ${tx.type.toLowerCase()} of $${Math.abs(tx.amount).toFixed(2)}? This cannot be undone.`)) return;
    setDeletingTxId(tx.id);
    try {
      await database.deleteTransaction(tx.id);
      setTransactions(prev => prev.filter(t => t.id !== tx.id));
      toast.success('Transaction removed.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove the transaction.');
    } finally {
      setDeletingTxId(null);
    }
  };

  const [generatingInvoiceTxId, setGeneratingInvoiceTxId] = useState(null);

  // Bills exactly this one charge — the row-level counterpart to "Bill a
  // period". A charge created or edited straight in the ledger (a manual
  // entry, a correction after a voided invoice) has no invoice until someone
  // sweeps it up, and "Bill a period" only surfaces from the Invoices tab and
  // pulls in everything pending, not just the row an admin is looking at.
  const handleGenerateInvoiceForTx = async (tx) => {
    setGeneratingInvoiceTxId(tx.id);
    try {
      const created = await database.generateInvoice(selectedFamily.id, [tx.id]);
      toast.success(`Invoice ${created[0]?.id} created.`);
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not generate the invoice.');
    } finally {
      setGeneratingInvoiceTxId(null);
    }
  };

  // The row-level "⋮" menu, and the edit panel it (or clicking the date)
  // opens. Only one menu is ever open, so the open row's id is the whole
  // state — no per-row component needed.
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [editTxPanel, setEditTxPanel] = useState(null); // { tx, date, amount, description, studentId }
  const [savingTxEdit, setSavingTxEdit] = useState(false);

  // Any click outside a menu closes it — without this the menu stays open
  // behind the panel it just launched.
  useEffect(() => {
    if (!openRowMenuId) return;
    const close = () => setOpenRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openRowMenuId]);

  const openEditTx = (tx) => {
    setOpenRowMenuId(null);
    setEditTxPanel({
      tx,
      date: tx.date.split('T')[0],
      amount: Math.abs(tx.amount).toFixed(2),
      description: tx.description || '',
      studentId: tx.studentId || '',
    });
  };

  const handleSaveTxEdit = async () => {
    const amount = parseFloat(editTxPanel.amount);
    if (!isFinite(amount) || amount <= 0) {
      toast.error('Amount must be a positive number.');
      return;
    }
    if (!editTxPanel.date) {
      toast.error('A date is required.');
      return;
    }
    setSavingTxEdit(true);
    try {
      await database.updateTransaction(editTxPanel.tx.id, {
        date: editTxPanel.date,
        amount,
        description: editTxPanel.description,
        studentId: editTxPanel.studentId || null,
      });
      toast.success('Transaction updated.');
      setEditTxPanel(null);
      // Full reload rather than a local patch: editing an invoiced charge also
      // moves its invoice's total and status, which this screen shows too.
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not update the transaction.');
    } finally {
      setSavingTxEdit(false);
    }
  };

  // Delete from inside the edit panel (the trash icon in its header) — closes
  // the panel on success so it isn't left showing a row that no longer exists.
  const handleDeleteFromPanel = async () => {
    const tx = editTxPanel.tx;
    if (!window.confirm(`Remove this ${tx.type.toLowerCase()} of $${Math.abs(tx.amount).toFixed(2)}? This cannot be undone.`)) return;
    setSavingTxEdit(true);
    try {
      await database.deleteTransaction(tx.id);
      toast.success('Transaction removed.');
      setEditTxPanel(null);
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove the transaction.');
    } finally {
      setSavingTxEdit(false);
    }
  };

  const [voidingInvoiceId, setVoidingInvoiceId] = useState(null);

  const [splittingInvoiceId, setSplittingInvoiceId] = useState(null);
  const [applyingCreditId, setApplyingCreditId] = useState(null);

  const handleApplyCredit = async (inv) => {
    setApplyingCreditId(inv.dbId);
    try {
      const res = await database.applyCreditToInvoice(inv.dbId);
      toast[res.applied > 0 ? 'success' : 'info'](res.message);
      if (res.applied > 0) await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not apply credit.');
    } finally {
      setApplyingCreditId(null);
    }
  };

  const handleSplitInvoice = async (inv) => {
    if (!window.confirm(
      `Split ${inv.id} into one invoice per student?\n\n`
      + `${inv.id} keeps its number for whichever student owes the most; `
      + `every other student gets a new LC-#### number. The family's total `
      + `balance does not change.`
    )) return;
    setSplittingInvoiceId(inv.dbId);
    try {
      const res = await database.splitInvoice(inv.dbId);
      toast.success(res.message || 'Invoice split.');
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not split the invoice.');
    } finally {
      setSplittingInvoiceId(null);
    }
  };

  // Voiding removes the document only. Its charges go back to the ledger as
  // unbilled, which is what makes "void it and raise a correct one" work —
  // they show up again under Unbilled, ready to go onto the new invoice. An
  // admin who wants a charge gone deletes that row from the ledger instead.
  const handleVoidInvoice = async (inv) => {
    if (!window.confirm(
      `Void invoice ${inv.id} ($${inv.amount.toFixed(2)})?\n\n`
      + `The document goes away, but its charges stay on the family's ledger as `
      + `unbilled — invoice them again from Unbilled, or delete them one by one `
      + `if they shouldn't be there at all.`
    )) return;
    setVoidingInvoiceId(inv.dbId);
    try {
      const res = await database.voidInvoice(inv.dbId);
      toast.success(res?.message || 'Invoice voided.');
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not void the invoice.');
    } finally {
      setVoidingInvoiceId(null);
    }
  };

  // Combining several of a family's invoices into one document. Approving
  // calendar charges in two batches leaves the family holding two invoices for
  // the same weeks, and nobody wants three envelopes for one month.
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState([]);
  const [merging, setMerging] = useState(false);

  // Ids left ticked from the family you were just looking at would otherwise
  // still be armed on the next one's screen.
  useEffect(() => { setSelectedInvoiceIds([]); }, [selectedFamily?.id]);

  const toggleInvoiceSelected = (dbId) => {
    setSelectedInvoiceIds(prev => (
      prev.includes(dbId) ? prev.filter(id => id !== dbId) : [...prev, dbId]
    ));
  };

  const handleMergeInvoices = async () => {
    const picked = familyInvoices.filter(i => selectedInvoiceIds.includes(i.dbId));
    const total = picked.reduce((sum, i) => sum + i.amount, 0);
    const keeps = [...picked].sort((a, b) => (
      new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id, 'en', { numeric: true })
    ))[0];

    if (!window.confirm(
      `Combine ${picked.length} invoices into ${keeps.id} ($${total.toFixed(2)})?\n\n`
      + `The others disappear and their charges move onto ${keeps.id}, which goes `
      + `back to draft for you to review. The family's balance does not change.`
    )) return;

    setMerging(true);
    try {
      const res = await database.mergeInvoices(selectedInvoiceIds);
      setSelectedInvoiceIds([]);
      toast.success(res.message || 'Invoices combined.');
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not combine those invoices.');
    } finally {
      setMerging(false);
    }
  };

  // The invoice document: its full specification, its PDF, and emailing it.
  // `detail` is fetched rather than taken from the list row — the list carries
  // only what the table shows, and this panel states what a family owes.
  const [invoiceDetail, setInvoiceDetail] = useState(null); // { loading, invoice, recipient }
  const [sendInvoiceModal, setSendInvoiceModal] = useState(null); // { invoice, recipient }
  const [sendingInvoice, setSendingInvoice] = useState(false);

  const openInvoiceDetail = async (inv) => {
    setInvoiceDetail({ loading: true, invoice: null, recipient: null });
    try {
      const data = await database.fetchInvoice(inv.dbId);
      setInvoiceDetail({ loading: false, ...data });
    } catch (err) {
      setInvoiceDetail(null);
      toast.error(err.response?.data?.message || err.userMessage || 'Could not load the invoice.');
    }
  };

  const handleDownloadPdf = async (invoice) => {
    try {
      const blob = await database.fetchInvoicePdf(invoice.dbId);
      // Object URL rather than pointing an <a> at the endpoint directly: the
      // route needs the auth header, which a plain browser navigation drops.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoiceNumber || invoice.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not build the PDF.');
    }
  };

  const openSendInvoice = async (inv) => {
    try {
      const { invoice, recipient } = await database.fetchInvoice(inv.dbId);
      if (!recipient) {
        toast.error('This family has no email address on file, so there is nobody to send this to.');
        return;
      }
      setSendInvoiceModal({ invoice, recipient });
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not prepare the email.');
    }
  };

  const handleSendInvoice = async ({ subject, message }) => {
    setSendingInvoice(true);
    try {
      const res = await database.sendInvoice(sendInvoiceModal.invoice.dbId, { subject, message });
      toast.success(res.message || 'Invoice sent.');
      setSendInvoiceModal(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not send the invoice.');
    } finally {
      setSendingInvoice(false);
    }
  };

  // Editing an invoice's line items — { invoice, lines: [{ id?, description, amount }] }.
  // Lines without an `id` are new; a line present when the modal opened but
  // missing on save is taken off the invoice, and its charge goes back to the
  // ledger as unbilled rather than being deleted. Same rule as the Void button
  // — nothing on this screen destroys a charge. That is only ever done on
  // purpose, one row at a time, with Delete Transaction on the Ledger tab.
  const [editInvoiceModal, setEditInvoiceModal] = useState(null);
  const [savingInvoiceEdit, setSavingInvoiceEdit] = useState(false);

  const openEditInvoice = (inv) => {
    setEditInvoiceModal({
      invoice: inv,
      lines: (inv.lines || []).map(l => ({ id: l.id, description: l.description, amount: l.amount.toFixed(2) })),
      openedAt: Date.now(),
    });
  };

  const updateEditLine = (index, field, value) => {
    setEditInvoiceModal(prev => ({
      ...prev,
      lines: prev.lines.map((l, i) => i === index ? { ...l, [field]: value } : l),
    }));
  };

  const addEditLine = () => {
    setEditInvoiceModal(prev => ({ ...prev, lines: [...prev.lines, { description: '', amount: '' }] }));
  };

  const removeEditLine = (index) => {
    setEditInvoiceModal(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  };

  const handleSaveInvoiceEdit = async () => {
    const lines = editInvoiceModal.lines.map(l => ({ id: l.id, description: l.description.trim(), amount: parseFloat(l.amount) }));
    if (lines.some(l => !l.description || !isFinite(l.amount) || l.amount <= 0)) {
      toast.error('Every line needs a description and a positive amount.');
      return;
    }
    if (lines.length === 0 && !window.confirm(
      'This removes every line, which voids the whole invoice.\n\n'
      + 'Its charges stay on the ledger as unbilled, so you can invoice them again.\n\nContinue?'
    )) {
      return;
    }
    setSavingInvoiceEdit(true);
    try {
      const res = await database.editInvoice(editInvoiceModal.invoice.dbId, lines);
      toast.success(res?.message || (lines.length === 0 ? 'Invoice voided.' : 'Invoice updated.'));
      setEditInvoiceModal(null);
      await loadBilling();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not save the invoice.');
    } finally {
      setSavingInvoiceEdit(false);
    }
  };

  const handleRefund = async () => {
    if (!refundModal?.payment) return;
    const amount = parseFloat(refundModal.amount);
    if (!amount || isNaN(amount) || amount <= 0) return;
    setLoading(true);
    try {
      await database.refundPayment(refundModal.payment.id, { amount, reason: refundModal.reason });
      toast.success('Refund processed.');
      setRefundModal(null);
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not process the refund. Please try again.');
    }
  };

  /* Invoice written by hand for one student. `lines` always holds at least one
     row so the form opens with something to type into. */
  const openStudentInvoice = () => {
    const familyStudents = students.filter(s => s.familyId === selectedFamily.id);
    if (familyStudents.length === 0) {
      toast.info('This family has no students to invoice.');
      return;
    }
    setStudentInvoice({
      studentId: familyStudents.length === 1 ? familyStudents[0].id : '',
      lines: [{ description: '', amount: '' }],
    });
  };

  const studentInvoiceTotal = studentInvoice
    ? studentInvoice.lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
    : 0;

  const handleCreateStudentInvoice = async () => {
    const { studentId, lines } = studentInvoice;
    if (!studentId) {
      toast.error('Pick the student this invoice is for.');
      return;
    }
    // Drop blank rows rather than rejecting them — an empty trailing line is
    // how people leave a form, not a mistake worth an error message.
    const filled = lines
      .map(l => ({ description: l.description.trim(), amount: parseFloat(l.amount) }))
      .filter(l => l.description || !isNaN(l.amount));
    if (filled.length === 0) {
      toast.error('Add at least one line before creating the invoice.');
      return;
    }
    const bad = filled.find(l => !l.description || isNaN(l.amount) || l.amount <= 0);
    if (bad) {
      toast.error('Every line needs a description and an amount greater than zero.');
      return;
    }

    setLoading(true);
    try {
      const invoice = await database.createStudentInvoice(studentId, filled);
      setStudentInvoice(null);
      setActiveTab('Invoices');
      await loadBilling();
      toast.success(`Invoice ${invoice.id} created for $${invoice.amount.toFixed(2)}.`);
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not create the invoice. Please try again.');
    }
  };

  // Billing a period, not "everything outstanding". A family accumulates
  // charges continuously — calendar sweeps, manual entries, standing monthly
  // arrangements — and sweeping the lot into one document mixes September's
  // tuition with a snack reload from July. The admin names the window, so the
  // invoice matches the period the family is actually being asked about.
  const [billRangeModal, setBillRangeModal] = useState(null); // { from, to }

  const pendingCharges = selectedFamily
    ? transactions.filter(t => t.familyId === selectedFamily.id && t.type === 'Charge' && !t.invoiceId)
    : [];

  const openBillRange = () => {
    if (pendingCharges.length === 0) {
      toast.info('No pending charges to invoice.');
      return;
    }
    // Opens spanning everything outstanding, which is what the button used to
    // do without asking. Narrowing from there is the point; widening past the
    // oldest pending charge would have nothing to find.
    const dates = pendingCharges.map(t => t.date).sort();
    setBillRangeModal({ from: dates[0], to: dates[dates.length - 1] });
  };

  // Dates are plain yyyy-mm-dd strings on both sides, so comparing them as
  // strings is the same as comparing the days — and avoids parsing them into
  // Dates, which would drag the browser's timezone into a date-only question.
  const chargesInRange = billRangeModal
    ? pendingCharges.filter(t => t.date >= billRangeModal.from && t.date <= billRangeModal.to)
    : [];
  const rangeTotal = chargesInRange.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // How the server is about to split them: one invoice per child, plus one for
  // anything charged to the household rather than a student. Shown before the
  // click so "Create 2 Invoices" is never a surprise.
  const rangeGroups = (() => {
    const map = new Map();
    for (const t of chargesInRange) {
      const key = t.studentId || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return [...map.entries()].map(([studentId, charges]) => ({
      studentId,
      name: studentId
        ? (students.find(s => s.id === studentId)?.name ?? 'Student')
        : 'Family charges',
      charges,
      total: charges.reduce((sum, t) => sum + Math.abs(t.amount), 0),
    }));
  })();

  const handleGenerateInvoice = async () => {
    if (chargesInRange.length === 0) return;
    setLoading(true);
    try {
      const created = await database.generateInvoice(selectedFamily.id, chargesInRange.map(t => t.id));
      setBillRangeModal(null);
      setActiveTab('Invoices');
      toast.success(created.length === 1
        ? `Invoice ${created[0].id} created.`
        : `${created.length} invoices created — one per student.`);
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not generate the invoice. Please try again.');
    }
  };

  /* ─────────────── Billing a block of classes before they run ─────────────
   * "Bill a period" can only gather charges that already exist, and a charge
   * only exists once the meeting has been priced and swept — i.e. after it was
   * taught. A family that wants to settle the next eight weeks now had no path
   * through this screen at all: typing the block as a manual invoice takes the
   * money but leaves the meetings unlinked, so the sweep bills every one of
   * them a second time when those weeks arrive.
   *
   * This picks the meetings off the calendar instead, future ones included, and
   * bills them with their sessionId attached — which is exactly what the sweep
   * looks at before charging. Prepaying and the calendar can no longer collide.
   */
  const [blockModal, setBlockModal] = useState(null);
  const [blockData, setBlockData] = useState(null); // { classes, sessions } from the server
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockError, setBlockError] = useState(null);

  const isoPlusDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const openBlockModal = () => {
    setBlockData(null);
    setBlockError(null);
    setBlockModal({
      studentId: familyStudents.length === 1 ? familyStudents[0].id : '',
      classId: '',
      from: isoPlusDays(0),
      to: isoPlusDays(90),
      picked: new Set(),
      // How the block is priced: the same number on every meeting, one total
      // split across them, or whatever each is already worth on the calendar.
      priceMode: 'each',
      amount: '',
      description: '',
      dueDate: '',
    });
  };

  // Refetches whenever the block's shape changes. The picked set is cleared
  // with it — a session id from the previous window may not even be on screen
  // any more, and billing something the admin can no longer see is the one
  // outcome this screen must never produce.
  useEffect(() => {
    if (!blockModal?.studentId) { setBlockData(null); return; }
    let cancelled = false;
    setBlockLoading(true);
    setBlockError(null);
    database.fetchBlockSessions({
      studentId: blockModal.studentId,
      classId: blockModal.classId || undefined,
      from: blockModal.from,
      to: blockModal.to,
    })
      .then(data => { if (!cancelled) setBlockData(data); })
      .catch(err => { if (!cancelled) setBlockError(err.userMessage || 'Could not load this student’s scheduled classes.'); })
      .finally(() => { if (!cancelled) setBlockLoading(false); });
    return () => { cancelled = true; };
  }, [blockModal?.studentId, blockModal?.classId, blockModal?.from, blockModal?.to]);

  const blockSessions = blockData?.sessions ?? [];
  const blockPicked = blockSessions.filter(s => blockModal?.picked.has(s.id) && !s.alreadyCharged);

  // What each picked meeting would be billed at, under the current pricing
  // choice. Shown before the click because "block of 8" hides how much any one
  // week costs, and a $980 typo is only obvious next to the other lines.
  const blockAmountNum = parseFloat(blockModal?.amount);
  const blockLineAmount = (session, index) => {
    if (!blockModal) return null;
    if (Number.isFinite(blockAmountNum) && blockAmountNum > 0) {
      if (blockModal.priceMode === 'each') return blockAmountNum;
      // Split to the cent, remainder on the first line — the same arithmetic
      // the server does, so the preview and the invoice agree.
      const each = Math.floor((blockAmountNum * 100) / blockPicked.length) / 100;
      return index === 0
        ? Math.round((each + (blockAmountNum - each * blockPicked.length)) * 100) / 100
        : each;
    }
    return session.price;
  };

  const blockUnpriced = blockPicked.filter((s, i) => {
    const amount = blockLineAmount(s, i);
    return amount == null || amount <= 0;
  }).length;
  const blockTotal = blockPicked.reduce((sum, s, i) => sum + (blockLineAmount(s, i) || 0), 0);

  const toggleBlockSession = (sessionId) => {
    setBlockModal(prev => {
      const picked = new Set(prev.picked);
      if (picked.has(sessionId)) picked.delete(sessionId);
      else picked.add(sessionId);
      return { ...prev, picked };
    });
  };

  const handleCreateBlockInvoice = async () => {
    if (blockPicked.length === 0) return;
    setLoading(true);
    try {
      const result = await database.createBlockInvoice({
        studentId: blockModal.studentId,
        sessionIds: blockPicked.map(s => s.id),
        // Only one of the two ever goes up; leaving both off tells the server
        // to use each meeting's own price.
        unitAmount: blockModal.priceMode === 'each' && blockModal.amount ? blockModal.amount : undefined,
        blockAmount: blockModal.priceMode === 'total' && blockModal.amount ? blockModal.amount : undefined,
        description: blockModal.description || undefined,
        dueDate: blockModal.dueDate || undefined,
      });
      setBlockModal(null);
      setBlockData(null);
      setActiveTab('Invoices');
      await loadBilling();
      toast.success(
        `Invoice ${result.invoice.id} created for $${result.invoice.amount.toFixed(2)} — ${result.billed} class${result.billed === 1 ? '' : 'es'} billed in advance.`
      );
      if (result.skipped?.length) {
        toast.info(`${result.skipped.length} of the classes you picked were already billed and were left off.`);
      }
    } catch (err) {
      setLoading(false);
      toast.error(err.response?.data?.message || err.userMessage || 'Could not create the block invoice.');
    }
  };

  // EMA CSV column indices (0-based) for the Step Up "DO NOT EDIT" export.
  const EMA_COL = { PO_NUM: 0, PURCHASE_DATE: 1, STUDENT_NAME: 3, STUDENT_ID: 4, PROVIDER_ID: 6, START_DATE: 7, END_DATE: 8, AMOUNT: 9, INVOICE_NUM: 10 };
  const PROVIDER_ID = '20000720';

  // Backend returns dates as ISO (yyyy-mm-dd); the Step Up CSV uses MM/DD/YYYY.
  const isoToUsDate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  };

  const handleEmaFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setEmaSyncState({ ...emaSyncState, step: 2 });

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target.result;
      const lines = csvText.split('\n');

      if (lines.length < 3) {
        toast.error('Invalid CSV format — expected the "DO NOT EDIT" Step Up export with two header rows.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
        return;
      }

      // Parse data rows (everything after the two header rows), grouping by student.
      const parsedRows = []; // { cols, studentName, studentId, amount }
      const groupMap = new Map(); // key -> { key, studentName, studentId, total, rowIndexes }

      // Step Up quotes most fields ("Deaglan Scott", "20650594", ...) — a plain
      // split(',') leaves those quotes in the string, so names/IDs never match
      // anything in the DB and every row comes back unmatched. Strip them.
      const unquote = (s) => (s || '').trim().replace(/^"(.*)"$/, '$1').trim();

      for (let i = 2; i < lines.length; i++) {
        if (!lines[i].trim()) { parsedRows.push(null); continue; }
        const cols = lines[i].split(',');
        const poNumber = unquote(cols[EMA_COL.PO_NUM]);
        const studentName = unquote(cols[EMA_COL.STUDENT_NAME]);
        const studentId = unquote(cols[EMA_COL.STUDENT_ID]);
        const amount = parseFloat(cols[EMA_COL.AMOUNT]) || 0;
        // A file that already carries these was filled in and submitted to Step
        // Up before — by hand, or by an earlier run. Step Up now has those
        // numbers and dates on record, so they win over anything we'd pick:
        // re-deriving them would leave our books disagreeing with the state's.
        const csvInvoiceNumber = unquote(cols[EMA_COL.INVOICE_NUM]);
        const csvStartDate = unquote(cols[EMA_COL.START_DATE]);

        if (!studentName) { parsedRows.push({ cols, skip: true }); continue; }

        const key = studentId || studentName.toLowerCase();
        if (!groupMap.has(key)) {
          groupMap.set(key, { key, studentName, emaStudentId: studentId, total: 0, rowIndexes: [], poNumbers: [], rows: [], csvInvoiceNumber: '' });
        }
        const g = groupMap.get(key);
        g.total += amount;
        g.rowIndexes.push(parsedRows.length);
        // First one wins — all of a student's rows carry the same invoice.
        if (csvInvoiceNumber && !g.csvInvoiceNumber) g.csvInvoiceNumber = csvInvoiceNumber;
        if (poNumber) { g.poNumbers.push(poNumber); g.rows.push({ poNumber, amount }); }
        parsedRows.push({ cols, studentName, studentId, amount, poNumber, key, csvStartDate });
      }

      const groups = Array.from(groupMap.values());
      if (groups.length === 0) {
        toast.error('No student rows found in the CSV.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
        return;
      }

      // Assign sequential LC-#### invoice numbers (one per student) and record invoices.
      try {
        const enriched = await database.processEmaBatch(groups);
        const invoiceByKey = new Map(enriched.map(g => [g.key, g]));

        // Rebuild the CSV with the columns filled in. START/END DATE come from
        // the student's own completed meetings (see backend) — never from the
        // batch's purchase date, which is not the session date.
        let unmatchedDateCount = 0;
        let blankInvoiceCount = 0;
        const updatedLines = [lines[0], lines[1]];
        for (const row of parsedRows) {
          if (!row) { updatedLines.push(''); continue; }
          const cols = row.cols;
          if (!row.skip && row.key && invoiceByKey.has(row.key)) {
            const group = invoiceByKey.get(row.key);
            // A date already in the file was submitted to Step Up as-is; keep
            // it rather than re-deriving a different one from the schedule.
            const sessionDate = row.csvStartDate
              || (row.poNumber ? isoToUsDate(group.rowDates?.[row.poNumber]) : null);
            cols[EMA_COL.PROVIDER_ID] = PROVIDER_ID;
            if (sessionDate) {
              cols[EMA_COL.START_DATE] = sessionDate;
              cols[EMA_COL.END_DATE] = sessionDate;
            } else {
              // Nothing in the system dates this row — leave it blank rather
              // than fabricate a date; the admin must verify and fill it by
              // hand. This goes to a real state scholarship filing.
              cols[EMA_COL.START_DATE] = '';
              cols[EMA_COL.END_DATE] = '';
              unmatchedDateCount++;
            }
            // Blank when the student has several open invoices and the batch
            // can't tell which one Step Up is paying. Step Up accepts a blank
            // BUSINESS INVOICE #; writing the string "null" would not be.
            cols[EMA_COL.INVOICE_NUM] = group.invoiceNumber || '';
            if (!group.invoiceNumber) blankInvoiceCount++;
          }
          updatedLines.push(cols.join(','));
        }

        const blob = new Blob([updatedLines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        if (unmatchedDateCount > 0) {
          toast.error(`${unmatchedDateCount} row${unmatchedDateCount !== 1 ? 's' : ''} could not be dated from the schedule — left blank. Fill them in manually before submitting.`);
        }
        if (blankInvoiceCount > 0) {
          toast.error(`${blankInvoiceCount} row${blankInvoiceCount !== 1 ? 's' : ''} have more than one open invoice — pick the right one by hand before submitting.`);
        }

        setEmaSyncState({
          step: 3,
          matched: enriched.length,
          rowCount: parsedRows.filter(r => r && !r.skip).length,
          groups: enriched,
          unmatchedDateCount,
          blankInvoiceCount,
          reusedCount: enriched.filter(g => g.reusedInvoice).length,
          downloadUrl: url,
        });
        await loadBilling();
      } catch (err) {
        toast.error(err.userMessage || 'Could not generate EMA invoices. No invoices were created — please try again.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
      }
    };
    reader.readAsText(file);
  };

  const resetEmaSync = () => {
    setIsEmaModalOpen(false);
    if (emaSyncState.downloadUrl) {
      URL.revokeObjectURL(emaSyncState.downloadUrl);
    }
    setTimeout(() => setEmaSyncState({ step: 1, matched: 0, newInvoices: [], downloadUrl: null }), 300);
  };

  // --- EMA Step Up remittance reconciliation ---
  // Parse pasted/uploaded remittance text. Each line carries a Step Up PO #
  // (e.g. 25670936-1) and a net amount; the student name is best-effort.
  const parseRemittance = (raw) => {
    const out = [];
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const poMatch = line.match(/\d{5,}-\d+/);
      const amounts = line.match(/[\d,]+\.\d{2}/g);
      if (!poMatch || !amounts) continue;
      const poNumber = poMatch[0];
      const amount = parseFloat(amounts[amounts.length - 1].replace(/,/g, ''));
      // Student name = what's left after stripping PO #, amounts and date-like tokens.
      const studentName = line
        .replace(poNumber, '')
        .replace(/[\d,]+\.\d{2}/g, '')
        .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s,;|]+|[\s,;|]+$/g, '')
        .trim();
      out.push({ poNumber, amount, studentName });
    }
    return out;
  };

  const handleParseRemittance = async (text) => {
    const lines = parseRemittance(text);
    if (lines.length === 0) {
      toast.error('No rows found with "PO # + amount". Paste the Step Up remittance lines (e.g. "25670936-1   6/5/2026   Liam Killian   250.00").');
      return;
    }
    // Preview via the same PO#-matching the backend will actually use on
    // confirm (dryRun: true, no writes) — a client-side guess here previously
    // always showed "no match" because the loaded invoice list doesn't carry
    // poNumbers/studentName, which silently diverged from what confirm did.
    const linesWithIndex = lines.map((l, i) => ({ ...l, _idx: i }));
    setIsParsingPreview(true);
    try {
      const preview = await database.reconcileEmaRemittance(linesWithIndex, { dryRun: true });
      const statusByIdx = new Map();
      preview.matched.forEach(l => statusByIdx.set(l._idx, { matched: true, alreadyReconciled: false, invoiceNumber: l.invoiceNumber }));
      preview.alreadyReconciled.forEach(l => statusByIdx.set(l._idx, { matched: false, alreadyReconciled: true, invoiceNumber: l.invoiceNumber }));
      preview.unmatched.forEach(l => statusByIdx.set(l._idx, { matched: false, alreadyReconciled: false, invoiceNumber: null }));
      const annotated = linesWithIndex.map(l => ({ ...l, ...statusByIdx.get(l._idx) }));
      setReconcile({ step: 2, text, lines: annotated, report: null });
    } catch (err) {
      toast.error(err.userMessage || 'Could not preview this remittance. Please try again.');
    } finally {
      setIsParsingPreview(false);
    }
  };

  const handleRemittanceFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleParseRemittance(ev.target.result);
    reader.readAsText(file);
  };

  const handleConfirmReconcile = async () => {
    try {
      const report = await database.reconcileEmaRemittance(reconcile.lines);
      setReconcile(r => ({ ...r, step: 3, report }));
      await loadBilling();
    } catch (err) {
      toast.error(err.userMessage || 'Could not reconcile the payment. No invoices were marked paid — please try again.');
    }
  };

  const resetReconcile = () => {
    setIsReconcileOpen(false);
    setTimeout(() => setReconcile({ step: 1, text: '', lines: [], report: null }), 300);
  };

  if (error) return <div className="billing-container"><ErrorBanner message={error} onRetry={loadBilling} /></div>;

  if (loading && families.length === 0) return (
    <div className="billing-container" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div className="spinner" style={{ marginBottom: '16px' }}></div>
      <p style={{ color: 'var(--text-muted)' }}>Loading financial data...</p>
    </div>
  );

  // --- MAIN DASHBOARD VIEW (List of Families) ---
  if (!selectedFamily) {
    const totalOwing = families.reduce((acc, f) => acc + calculateFamilyBalance(f.id), 0);
    const totalCardPayments = invoices.reduce((acc, inv) => acc + (inv.payments || [])
      .filter(p => p.method === 'STRIPE_CARD' && p.status !== 'REFUNDED')
      .reduce((sum, p) => sum + p.amount, 0), 0);

    return (
      <div className="billing-container">
        <header className="billing-header">
          <div className="billing-header-title">
            <h1>Billing & Invoices</h1>
            <p>Manage family accounts, process payments, and generate invoices.</p>
          </div>
          <div className="billing-quick-actions">
            <button className="btn-action outline" onClick={() => setIsSessionChargesOpen(true)}>
              <Receipt size={16} /> Calendar Charges
            </button>
            {/* Forward-looking twin of Calendar Charges: that one releases what
                has been taught, this one bills what has not. */}
            <button className="btn-action outline" onClick={() => setIsBlockBillingOpen(true)}>
              <Layers size={16} /> Bill Blocks
            </button>
            <button className="btn-action primary" onClick={() => setIsEmaModalOpen(true)}>
              <UploadCloud size={16} /> EMA Auto-Sync
            </button>
            <button className="btn-action secondary" onClick={() => setIsReconcileOpen(true)}>
              <CheckCircle size={16} /> Reconcile Payment
            </button>
          </div>
        </header>

        <div className="billing-metrics">
          <div className="metric-card">
            <div className="metric-icon alert"><DollarSign size={24} /></div>
            <div className="metric-info">
              <h3>Total Balance Owing</h3>
              <p>${totalOwing.toFixed(2)}</p>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon success"><CheckCircle size={24} /></div>
            <div className="metric-info">
              <h3>Active Families</h3>
              <p>{families.filter(f => students.some(s => s.familyId === f.id && s.hasActiveClasses)).length}</p>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon success"><CreditCard size={24} /></div>
            <div className="metric-info">
              <h3>Paid by Card (Stripe)</h3>
              <p>${totalCardPayments.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h2>Family Accounts</h2>
            <div className="table-actions">
              <button
                className={`btn-filter ${onlyActive ? 'active' : ''}`}
                onClick={() => setOnlyActive(v => !v)}
                title="Show only active families"
              >
                <User size={16} /> {onlyActive ? 'Active only ✓' : 'Active only'}
              </button>
              <button
                className={`btn-filter ${onlyOwing ? 'active' : ''}`}
                onClick={() => setOnlyOwing(v => !v)}
                title="Show only families with a balance owing"
              >
                <Filter size={16} /> {onlyOwing ? 'Owing only ✓' : 'Owing only'}
              </button>
              <button
                className={`btn-filter ${onlyCardPaid ? 'active' : ''}`}
                onClick={() => setOnlyCardPaid(v => !v)}
                title="Show only families who have paid by credit card (Stripe)"
              >
                <CreditCard size={16} /> {onlyCardPaid ? 'Paid by card ✓' : 'Paid by card'}
              </button>
              <div className="billing-search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search family, contact, or tag..."
                  value={familySearch}
                  onChange={e => setFamilySearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Family Name</th>
                  <th>Primary Contact</th>
                  <th>Balance Owing</th>
                  <th style={{ width: '60px', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {families.filter(f => {
                  if (onlyOwing && calculateFamilyBalance(f.id) <= 0) return false;
                  if (onlyActive && !students.some(s => s.familyId === f.id && s.hasActiveClasses)) return false;
                  if (onlyCardPaid && !familyHasCardPayment(f.id)) return false;

                  const q = familySearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    f.name.toLowerCase().includes(q) ||
                    f.contacts.some(c => (c.name || '').toLowerCase().includes(q)) ||
                    f.tags.some(t => t.toLowerCase().includes(q))
                  );
                }).map(f => {
                  const bal = calculateFamilyBalance(f.id);
                  const primary = f.contacts.find(c => c.isInvoiceRecipient) || f.contacts[0];
                  return (
                    <tr key={f.id} onClick={() => selectFamily(f)} className="clickable-row">
                      <td style={{fontWeight: 600, color: 'var(--primary)'}}>
                        {f.name}
                        {familyHasCardPayment(f.id) && (
                          <CreditCard size={14} style={{ marginLeft: '6px', verticalAlign: 'middle', color: 'var(--text-muted)' }} title="Has paid by credit card (Stripe)" />
                        )}
                      </td>
                      <td>{primary ? primary.name : 'N/A'}</td>
                      <td style={{fontWeight: 700, color: bal > 0 ? '#dc2626' : 'var(--text-main)'}}>${bal.toFixed(2)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="icon-btn ghost" onClick={(e) => { e.stopPropagation(); selectFamily(f); }}>
                          <ChevronRight size={20} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Meetings given a price on the calendar. Reloads the ledger on the
            way out so the charges it raised show up on the family accounts
            behind it, rather than only after a refresh. */}
        {isSessionChargesOpen && (
          <SessionChargesPanel
            onClose={() => setIsSessionChargesOpen(false)}
            onDone={loadBilling}
          />
        )}

        {/* A block of classes billed to a whole roster in advance. Same reload
            on the way out, for the same reason. */}
        {isBlockBillingOpen && (
          <BlockBillingPanel
            onClose={() => setIsBlockBillingOpen(false)}
            onDone={loadBilling}
          />
        )}

        {/* EMA Sync Modal */}
        {isEmaModalOpen && (
          <div className="modal-overlay" onClick={resetEmaSync}>
            <div className="tx-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '600px'}}>
              <div className="modal-head">
                <h3>EMA Scholarship Auto-Sync</h3>
                <button onClick={resetEmaSync}><X size={20}/></button>
              </div>

              {emaSyncState.step === 1 && (
                <div style={{textAlign: 'center', padding: '20px'}}>
                  <div style={{background: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '40px 20px', marginBottom: '24px'}}>
                    <UploadCloud size={48} color="var(--primary)" style={{marginBottom: '16px'}} />
                    <h3 style={{marginBottom: '8px', color: 'var(--text-main)'}}>Upload EMA Approval CSV</h3>
                    <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px'}}>
                      Drop the 'Pending Approvals' CSV file from Step Up For Students here.
                    </p>
                    <label className="btn-send" style={{cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px'}}>
                      <FileText size={16} /> Select CSV File
                      <input type="file" accept=".csv" style={{display: 'none'}} onChange={handleEmaFileUpload} />
                    </label>
                  </div>
                  <p style={{fontSize: '13px', color: 'var(--text-muted)'}}>
                    The system matches each student, dates every row from their completed meetings, and fills in "BUSINESS INVOICE #" — reusing the invoice they already have open, since the scholarship pays what was already billed. A student with nothing open gets a new LC-XXXX.
                  </p>
                </div>
              )}

              {emaSyncState.step === 2 && (
                <div style={{textAlign: 'center', padding: '40px 20px'}}>
                  <div className="spinner" style={{marginBottom: '24px'}}></div>
                  <h3 style={{color: 'var(--text-main)', marginBottom: '8px'}}>Processing CSV...</h3>
                  <p style={{color: 'var(--text-muted)', fontSize: '14px'}}>Matching students and generating invoices...</p>
                </div>
              )}

              {emaSyncState.step === 3 && (
              <div style={{padding: '20px'}}>
                <div style={{textAlign: 'center', marginBottom: '20px'}}>
                  <CheckCircle size={48} color="#10b981" style={{marginBottom: '12px'}} />
                  <h2 style={{color: 'var(--text-main)', marginBottom: '4px'}}>CSV Ready</h2>
                  <p style={{color: 'var(--text-muted)', fontSize: '14px'}}>
                    <strong>{emaSyncState.matched}</strong> student{emaSyncState.matched !== 1 ? 's' : ''} across <strong>{emaSyncState.rowCount}</strong> session row{emaSyncState.rowCount !== 1 ? 's' : ''}
                    {emaSyncState.reusedCount > 0 && <> — <strong>{emaSyncState.reusedCount}</strong> matched to an invoice that already existed</>}.
                  </p>
                </div>

                <div style={{maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '20px'}}>
                  <table className="ledger-table" style={{margin: 0}}>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Invoice #</th>
                        <th style={{textAlign: 'center'}}>Sessions</th>
                        <th style={{textAlign: 'right'}}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(emaSyncState.groups || []).map(g => (
                        <tr key={g.key}>
                          <td>
                            {g.studentName}
                            {!g.matched && (
                              <span title="No matching student in system — nothing was invoiced and the row was left blank" style={{marginLeft: '6px', fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px'}}>unmatched</span>
                            )}
                          </td>
                          <td style={{fontWeight: 600, color: 'var(--primary)'}}>
                            {g.invoiceNumber || <span style={{color: '#b45309', fontWeight: 500}}>pick by hand</span>}
                            {g.reusedInvoice && (
                              <span title="Existing open invoice — the scholarship is paying part of what was already billed" style={{marginLeft: '6px', fontSize: '11px', color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '6px', fontWeight: 500}}>existing</span>
                            )}
                            {g.ambiguousInvoice && (
                              <span title="This student has more than one open invoice — the batch can't tell which one Step Up is paying" style={{marginLeft: '6px', fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px', fontWeight: 500}}>ambiguous</span>
                            )}
                          </td>
                          <td style={{textAlign: 'center'}}>
                            {g.rowIndexes.length}
                            {g.unmatchedRowCount > 0 && (
                              <span title="No completed meeting in the schedule to date this row — left blank" style={{marginLeft: '6px', fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px'}}>
                                {g.unmatchedRowCount} no date
                              </span>
                            )}
                          </td>
                          <td style={{textAlign: 'right', fontWeight: 700}}>${g.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {emaSyncState.unmatchedDateCount > 0 && (
                  <div style={{background: '#fef3c7', color: '#92400e', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left'}}>
                    <AlertCircle size={16} style={{flexShrink: 0}} />
                    <span><strong>{emaSyncState.unmatchedDateCount}</strong> row{emaSyncState.unmatchedDateCount !== 1 ? 's' : ''} had no completed meeting in the schedule to date {emaSyncState.unmatchedDateCount !== 1 ? 'them' : 'it'} — Start/End Date left blank. Fill {emaSyncState.unmatchedDateCount !== 1 ? 'them' : 'it'} in manually before submitting.</span>
                  </div>
                )}

                {emaSyncState.blankInvoiceCount > 0 && (
                  <div style={{background: '#fef3c7', color: '#92400e', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left'}}>
                    <AlertCircle size={16} style={{flexShrink: 0}} />
                    <span><strong>{emaSyncState.blankInvoiceCount}</strong> row{emaSyncState.blankInvoiceCount !== 1 ? 's' : ''} belong to a student with more than one open invoice, so Business Invoice # was left blank rather than guessed. Pick the right one before submitting.</span>
                  </div>
                )}

                <div style={{background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left'}}>
                  <Check size={16} style={{flexShrink: 0}} />
                  <span>Filled <strong>Provider ID</strong>, <strong>Start/End dates</strong> from the schedule, and the <strong>Business Invoice #</strong> — reusing the student's open invoice where one exists. Upload the file to Step Up.</span>
                </div>

                <div className="modal-actions" style={{justifyContent: 'center'}}>
                  <a
                    href={emaSyncState.downloadUrl}
                    download="EMA_Completed.csv"
                    className="btn-send"
                    style={{display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none'}}
                  >
                    <Download size={16} /> Download Completed CSV
                  </a>
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        {/* EMA Remittance Reconciliation Modal */}
        {isReconcileOpen && (
          <div className="modal-overlay" onClick={resetReconcile}>
            <div className="tx-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '640px'}}>
              <div className="modal-head">
                <h3>Reconcile EMA Payment</h3>
                <button onClick={resetReconcile}><X size={20}/></button>
              </div>

              {reconcile.step === 1 && (
                <div style={{padding: '8px 4px'}}>
                  <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px'}}>
                    Paste the lines from the Step Up <strong>Remittance Advice</strong> (each line has a PO #, student, and net amount), or upload it as a CSV. The system matches each PO # back to its invoice and marks it paid.
                  </p>
                  <textarea
                    className="form-control"
                    rows={8}
                    placeholder={'25670936-1   6/5/2026   Liam Killian   250.00\n25670944-1   6/5/2026   Emma Killian   250.00\n25677573-1   6/5/2026   jasper theis   60.00'}
                    value={reconcile.text}
                    onChange={e => setReconcile(r => ({ ...r, text: e.target.value }))}
                    style={{width: '100%', fontFamily: 'monospace', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box'}}
                  />
                  <div className="modal-actions" style={{marginTop: '16px', justifyContent: 'space-between'}}>
                    <label className="btn-cancel" style={{cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px'}}>
                      <FileText size={16} /> Upload CSV
                      <input type="file" accept=".csv,.txt" style={{display: 'none'}} onChange={handleRemittanceFileUpload} />
                    </label>
                    <button className="btn-send" onClick={() => handleParseRemittance(reconcile.text)} disabled={!reconcile.text.trim() || isParsingPreview}>
                      {isParsingPreview ? 'Matching…' : 'Parse & Preview'}
                    </button>
                  </div>
                </div>
              )}

              {reconcile.step === 2 && (
                <div style={{padding: '8px 4px'}}>
                  <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '12px'}}>
                    Found <strong>{reconcile.lines.length}</strong> payment line{reconcile.lines.length !== 1 ? 's' : ''}. Review the matches, then confirm to mark invoices paid.
                  </p>
                  <div style={{maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '16px'}}>
                    <table className="ledger-table" style={{margin: 0}}>
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>Student</th>
                          <th>Invoice</th>
                          <th style={{textAlign: 'right'}}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconcile.lines.map((l, idx) => (
                          <tr key={idx}>
                            <td style={{fontFamily: 'monospace', fontSize: '12px'}}>{l.poNumber}</td>
                            <td>{l.studentName || '—'}</td>
                            <td>
                              {l.matched && <span style={{fontWeight: 600, color: 'var(--primary)'}}>{l.invoiceNumber}</span>}
                              {l.alreadyReconciled && <span title="Already applied in a previous reconciliation — will be skipped" style={{fontSize: '11px', color: '#1e40af', background: '#dbeafe', padding: '1px 6px', borderRadius: '6px'}}>already reconciled</span>}
                              {!l.matched && !l.alreadyReconciled && <span title="No invoice covers this PO #" style={{fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px'}}>no match</span>}
                            </td>
                            <td style={{textAlign: 'right', fontWeight: 700}}>${l.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="modal-actions" style={{justifyContent: 'space-between'}}>
                    <button className="btn-cancel" onClick={() => setReconcile(r => ({ ...r, step: 1 }))}>Back</button>
                    <button className="btn-send" onClick={handleConfirmReconcile}>
                      Confirm & Apply {reconcile.lines.filter(l => l.matched).length} payment{reconcile.lines.filter(l => l.matched).length !== 1 ? 's' : ''}
                    </button>
                  </div>
                </div>
              )}

              {reconcile.step === 3 && reconcile.report && (
                <div style={{textAlign: 'center', padding: '20px'}}>
                  <CheckCircle size={48} color="#10b981" style={{marginBottom: '12px'}} />
                  <h2 style={{color: 'var(--text-main)', marginBottom: '8px'}}>Payment Reconciled</h2>
                  <p style={{color: 'var(--text-muted)', marginBottom: '20px'}}>
                    Applied <strong>${reconcile.report.totalMatched.toFixed(2)}</strong> across <strong>{reconcile.report.matched.length}</strong> line{reconcile.report.matched.length !== 1 ? 's' : ''}.
                    {' '}<strong>{reconcile.report.invoicesPaid.length}</strong> invoice{reconcile.report.invoicesPaid.length !== 1 ? 's' : ''} marked paid.
                  </p>
                  {reconcile.report.unmatched.length > 0 && (
                    <div style={{background: '#fef3c7', color: '#92400e', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', textAlign: 'left'}}>
                      <strong>{reconcile.report.unmatched.length}</strong> line{reconcile.report.unmatched.length !== 1 ? 's' : ''} could not be matched to an invoice (PO #: {reconcile.report.unmatched.map(u => u.poNumber).join(', ')}). Review these manually.
                    </div>
                  )}
                  {reconcile.report.alreadyReconciled?.length > 0 && (
                    <div style={{background: '#dbeafe', color: '#1e40af', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', textAlign: 'left'}}>
                      <strong>{reconcile.report.alreadyReconciled.length}</strong> line{reconcile.report.alreadyReconciled.length !== 1 ? 's' : ''} skipped — already reconciled in a previous submission (PO #: {reconcile.report.alreadyReconciled.map(u => u.poNumber).join(', ')}).
                    </div>
                  )}
                  <div className="modal-actions" style={{justifyContent: 'center'}}>
                    <button className="btn-send" onClick={resetReconcile}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- FAMILY DETAILED VIEW ---
  const familyTxs = transactions.filter(t => t.familyId === selectedFamily.id).sort((a,b) => new Date(a.date) - new Date(b.date)); // Sort oldest first for running balance
  
  // Calculate running balance. Convention: positive = family owes money, negative = family has a credit.
  // Matches calculateFamilyBalance() above so the family list and this detail view never disagree.
  let runningBal = 0;
  const ledgerTxs = familyTxs.map(tx => {
    const type = tx.type.toLowerCase();
    if (type === 'charge') runningBal += Math.abs(tx.amount);
    if (type === 'payment' || type === 'discount' || type === 'credit') runningBal -= Math.abs(tx.amount);
    if (type === 'refund') runningBal += Math.abs(tx.amount);
    return { ...tx, runningBalance: runningBal };
  }).reverse(); // Reverse back to newest first for display

  const familyInvoices = invoices.filter(i => i.familyId === selectedFamily.id).sort((a,b) => new Date(b.date) - new Date(a.date));
  const currentBalance = ledgerTxs.length > 0 ? ledgerTxs[0].runningBalance : 0;
  const primaryContact = selectedFamily.contacts.find(c => c.isInvoiceRecipient) || selectedFamily.contacts[0];

  // Map students for this family dynamically from Neon PostgreSQL
  const familyStudents = students.filter(s => s.familyId === selectedFamily.id);

  // Charges sitting on the ledger that no invoice has picked up yet — what the
  // "Bill pending charges" button offers to sweep, and why it only appears at
  // all. The window it actually bills is chosen in the modal (see openBillRange).
  const pendingChargeCount = pendingCharges.length;

  return (
    <div className="billing-container">
      <button className="btn-back" onClick={() => selectFamily(null)}>
        <ChevronLeft size={16} /> Back to Families & Invoices
      </button>

      <div className="family-billing-layout">
        {/* Left Sidebar */}
        {/* Left Sidebar */}
        <div className="family-sidebar">
          <h2>{selectedFamily.name}</h2>
          
          <div className="sidebar-section styled-card">
            <h3><User size={16} /> Students</h3>
            <div className="students-list">
              {familyStudents.map((s, idx) => (
                <div key={idx} className="billing-student-row">
                  <span>{s.name}</span>
                  <span className={`badge-status ${s.status.toLowerCase()}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section styled-card">
            <h3><Mail size={16} /> Contacts</h3>
            <div className="billing-contact-row">
              <span>{primaryContact ? primaryContact.name : 'Unknown'}</span>
              <span className="badge-recipient">Invoice Recipient</span>
            </div>
          </div>
        </div>

        {/* Right Main Content */}
        <div className="family-main-content">
          <div className="billing-tabs-modern">
            <button className={`tab-btn-modern ${activeTab === 'Account' ? 'active' : ''}`} onClick={() => setActiveTab('Account')}>Account Ledger</button>
            <button className={`tab-btn-modern ${activeTab === 'Invoices' ? 'active' : ''}`} onClick={() => setActiveTab('Invoices')}>Invoices</button>
          </div>

          {activeTab === 'Account' && (
            <div className="tab-pane">
              
              <div className="account-status-card">
                <div className="status-balance-info">
                  {currentBalance > 0 ? (
                    <>
                      <span className="status-label">Balance Owing</span>
                      <span className="status-amount text-danger">${currentBalance.toFixed(2)}</span>
                    </>
                  ) : currentBalance < 0 ? (
                    <>
                      <span className="status-label">Credit on Account</span>
                      <span className="status-amount text-success">${Math.abs(currentBalance).toFixed(2)}</span>
                    </>
                  ) : (
                    <>
                      <span className="status-label">Account Status</span>
                      <span className="status-amount text-success">Paid in Full</span>
                    </>
                  )}
                </div>
                <div className="status-actions">
                  <button className="btn-action primary" onClick={() => setIsAddTxModalOpen(true)}>
                    <Plus size={16} /> Add Transaction
                  </button>
                  {/* Charging forward, not backward: the classes this covers
                      have not been taught yet, which is why it cannot be a
                      variation of "Bill a period" below. */}
                  <button className="btn-action" onClick={openBlockModal}>
                    <Layers size={16} /> Bill a block in advance
                  </button>
                </div>
              </div>

              {/* Standing arrangements. Above the ledger on purpose: this is
                  what the family will owe next month, and it explains charges
                  that appear on their own. */}
              {familyRecurring.length > 0 && (
                <div className="recurring-section">
                  <h4><History size={15} /> Repeats every month</h4>
                  {familyRecurring.map(r => (
                    <div key={r.id} className={`recurring-row ${r.active ? '' : 'paused'}`}>
                      <div className="recurring-main">
                        <strong>{r.description}</strong>
                        <span className="recurring-meta">
                          ${r.amount.toFixed(2)} · day {r.dayOfMonth} of the month
                          {r.studentName && <> · {r.studentName}</>}
                          {r.endDate && <> · until {formatDateUS(r.endDate)}</>}
                          {r.chargesRaised > 0 && <> · {r.chargesRaised} charged so far</>}
                        </span>
                      </div>
                      {!r.active && <span className="recurring-paused-tag">Paused</span>}
                      <div className="recurring-actions">
                        <button className="recurring-btn" onClick={() => handleToggleRecurring(r)}>
                          {r.active ? 'Pause' : 'Resume'}
                        </button>
                        <button className="recurring-btn danger" onClick={() => handleDeleteRecurring(r)}>
                          Stop
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="table-scroll">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Student</th>
                      <th>Description</th>
                      <th>Charges & Discounts</th>
                      <th>Payments & Refunds</th>
                      <th>Balance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                  {ledgerTxs.map(tx => {
                    const type = tx.type.toLowerCase();
                    return (
                      <tr key={tx.id}>
                        <td>
                          <div className="tx-date">
                            <button className="tx-date-link" onClick={() => openEditTx(tx)}>
                              {formatDateUS(tx.date)}
                            </button>
                            {tx.invoiceId && <span className="inv-pill">{tx.invoiceId}</span>}
                          </div>
                        </td>
                        <td>{tx.studentId ? (students.find(s => s.id === tx.studentId)?.name || 'Student') : '—'}</td>
                        <td>{tx.description}</td>
                        <td>
                          {type === 'charge' && <span className="tx-charge">Charge ${tx.amount.toFixed(2)}</span>}
                          {type === 'discount' && <span className="tx-discount">Discount -${Math.abs(tx.amount).toFixed(2)}</span>}
                        </td>
                        <td>
                          {type === 'payment' && <span className="tx-payment">Payment ${Math.abs(tx.amount).toFixed(2)}</span>}
                          {type === 'refund' && <span className="tx-refund">Refund ${Math.abs(tx.amount).toFixed(2)}</span>}
                          {type === 'credit' && <span className="tx-payment">Credit ${Math.abs(tx.amount).toFixed(2)}</span>}
                        </td>
                        <td style={{fontWeight: 700, color: tx.runningBalance > 0 ? '#dc2626' : '#166534'}}>
                          {tx.runningBalance < 0 ? `($${Math.abs(tx.runningBalance).toFixed(2)} credit)` : `$${tx.runningBalance.toFixed(2)}`}
                        </td>
                        <td>
                          <div className="tx-row-menu" onClick={e => e.stopPropagation()}>
                            <button
                              className="tx-delete-btn"
                              title="Actions"
                              onClick={() => setOpenRowMenuId(openRowMenuId === tx.id ? null : tx.id)}
                            >
                              <MoreVertical size={16} />
                            </button>
                            {openRowMenuId === tx.id && (
                              <div className="tx-row-dropdown">
                                {/* A charge raised by machinery says so, and offers the
                                    source first — editing the row alone leaves whatever
                                    generated it still holding the old number. */}
                                {tx.origin && tx.origin.kind !== 'MANUAL' && (
                                  <>
                                    <div className="tx-row-origin">From: {tx.origin.label}</div>
                                    {tx.origin.href && (
                                      <button onClick={() => navigate(tx.origin.href)}>
                                        <ExternalLink size={14} /> Go to {tx.origin.label}
                                      </button>
                                    )}
                                  </>
                                )}
                                <button onClick={() => openEditTx(tx)}>
                                  <Pencil size={14} /> Edit Transaction
                                </button>
                                {type === 'charge' && !tx.invoiceId && (
                                  <button
                                    onClick={() => { setOpenRowMenuId(null); handleGenerateInvoiceForTx(tx); }}
                                    disabled={generatingInvoiceTxId === tx.id}
                                  >
                                    <Receipt size={14} /> Generate Invoice
                                  </button>
                                )}
                                <button
                                  className="danger"
                                  onClick={() => { setOpenRowMenuId(null); handleDeleteTransaction(tx); }}
                                  disabled={deletingTxId === tx.id}
                                >
                                  <Trash2 size={14} /> Delete Transaction
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {ledgerTxs.length === 0 && <tr><td colSpan="7" className="text-center text-muted">No transactions found.</td></tr>}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {activeTab === 'Invoices' && (
            <div className="tab-pane">
              <div className="ledger-actions" style={{justifyContent: 'flex-start', gap: '0.5rem'}}>
                <button className="action-btn primary" onClick={openStudentInvoice}>
                  <Plus size={16} /> New Invoice
                </button>
                {/* Only offered when it has something to sweep. Rendering it
                    always is how the old single button came to look broken:
                    with nothing unbilled it could only shrug. */}
                {/* Always offered, even at zero. Hiding it when nothing is
                    pending is how it became invisible: an admin looking for
                    "where do I make an invoice for September" found no button
                    at all and no reason why. It says its own count instead. */}
                <button className="action-btn" onClick={openBillRange} disabled={pendingChargeCount === 0}>
                  <Receipt size={16} />
                  {pendingChargeCount === 0
                    ? 'Bill a period — nothing pending'
                    : `Bill a period (${pendingChargeCount} charge${pendingChargeCount === 1 ? '' : 's'} waiting)`}
                </button>
                {selectedInvoiceIds.length >= 2 && (
                  <button className="action-btn" onClick={handleMergeInvoices} disabled={merging}>
                    <Layers size={16} /> Combine {selectedInvoiceIds.length} invoices
                  </button>
                )}
              </div>

              <table className="ledger-table">
                <thead>
                  <tr>
                    <th style={{ width: '32px' }}></th>
                    <th>Invoice Date</th>
                    <th>Date Range</th>
                    <th>Invoice Amount</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {familyInvoices.map(inv => (
                    <tr key={inv.id}>
                      <td>
                        {/* Only an invoice nothing has been paid against can
                            be folded into another — same rule the server
                            enforces, shown here so the box isn't offered on a
                            row that would only come back refused. */}
                        {inv.voidable && inv.amountPaid === 0 && (
                          <input
                            type="checkbox"
                            checked={selectedInvoiceIds.includes(inv.dbId)}
                            onChange={() => toggleInvoiceSelected(inv.dbId)}
                            title="Select to combine with another invoice"
                          />
                        )}
                      </td>
                      <td style={{color: 'var(--primary)', fontWeight: 600}}>{formatDateUS(inv.date)}</td>
                      <td>{inv.dateRange}</td>
                      <td style={{fontWeight: 700}}>${inv.amount.toFixed(2)}</td>
                      <td>
                        {inv.sentAt ? (
                          <span className="sent-indicator sent" title={`Sent on ${formatDateTimeUS(inv.sentAt)}`}>
                            <Mail size={13} />
                            <span>{formatDateTimeUS(inv.sentAt)}</span>
                          </span>
                        ) : (
                          <span className="sent-indicator not-sent">
                            <span>Not sent</span>
                          </span>
                        )}
                      </td>
                      <td>
                        {(() => {
                          const key = inv.status.toLowerCase();
                          const cfg = STATUS_CONFIG[key] || { icon: FileText, label: inv.status };
                          const Icon = cfg.icon;
                          return (
                            <span className={`status-badge ${key}`}>
                              <Icon size={13} />
                              {cfg.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="tx-delete-btn"
                          title="View the full invoice"
                          onClick={() => openInvoiceDetail(inv)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="tx-delete-btn"
                          title="Email this invoice with its PDF attached"
                          onClick={() => openSendInvoice(inv)}
                        >
                          <Mail size={14} />
                        </button>
                        {inv.payments?.filter(p => p.status !== 'REFUNDED').length > 0 && (
                          <button
                            className="action-btn"
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() => {
                              const payment = inv.payments.find(p => p.status !== 'REFUNDED');
                              setRefundModal({ invoice: inv, payment, amount: payment.amount.toFixed(2), reason: '' });
                            }}
                          >
                            Refund
                          </button>
                        )}
                        {inv.editable && (
                          <button
                            className="tx-delete-btn"
                            title="Edit this invoice's line items"
                            onClick={() => openEditInvoice(inv)}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {inv.splittable && (
                          <button
                            className="tx-delete-btn"
                            title="Split into one invoice per student"
                            onClick={() => handleSplitInvoice(inv)}
                            disabled={splittingInvoiceId === inv.dbId}
                          >
                            <GitFork size={14} />
                          </button>
                        )}
                        {!['Paid', 'Cancelled'].includes(inv.status) && (
                          <button
                            className="tx-delete-btn"
                            title="Apply any existing account credit (e.g. a deposit paid after this invoice) to this invoice"
                            onClick={() => handleApplyCredit(inv)}
                            disabled={applyingCreditId === inv.dbId}
                          >
                            <HandCoins size={14} />
                          </button>
                        )}
                        {inv.voidable && (
                          <button
                            className="tx-delete-btn"
                            title="Void this invoice — removes the document; its charges go back to Unbilled"
                            onClick={() => handleVoidInvoice(inv)}
                            disabled={voidingInvoiceId === inv.dbId}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {familyInvoices.length === 0 && <tr><td colSpan="6" className="text-center text-muted">No invoices generated yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction Modal */}
      {studentInvoice && (
        <div className="modal-overlay" onClick={() => setStudentInvoice(null)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>New Invoice</h3>
              <button onClick={() => setStudentInvoice(null)}><X size={20}/></button>
            </div>

            <div className="tx-form">
              <div className="form-group">
                <label htmlFor="si-student">Student</label>
                <select
                  id="si-student"
                  className="form-control"
                  value={studentInvoice.studentId}
                  onChange={e => setStudentInvoice({ ...studentInvoice, studentId: e.target.value })}
                >
                  <option value="">— Select a student —</option>
                  {familyStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Line items</label>
                {studentInvoice.lines.map((line, i) => (
                  <div key={i} className="si-line">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. September COVE tuition"
                      value={line.description}
                      onChange={e => {
                        const lines = [...studentInvoice.lines];
                        lines[i] = { ...lines[i], description: e.target.value };
                        setStudentInvoice({ ...studentInvoice, lines });
                      }}
                    />
                    <input
                      type="number"
                      className="form-control si-amount"
                      placeholder="$0.00"
                      min="0"
                      step="0.01"
                      value={line.amount}
                      onChange={e => {
                        const lines = [...studentInvoice.lines];
                        lines[i] = { ...lines[i], amount: e.target.value };
                        setStudentInvoice({ ...studentInvoice, lines });
                      }}
                    />
                    <button
                      type="button"
                      className="si-remove"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={studentInvoice.lines.length === 1}
                      onClick={() => setStudentInvoice({
                        ...studentInvoice,
                        lines: studentInvoice.lines.filter((_, idx) => idx !== i),
                      })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="si-add"
                  onClick={() => setStudentInvoice({
                    ...studentInvoice,
                    lines: [...studentInvoice.lines, { description: '', amount: '' }],
                  })}
                >
                  <Plus size={14} /> Add line
                </button>
              </div>

              <div className="si-total">
                <span>Total</span>
                <strong>${studentInvoiceTotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button className="action-btn" onClick={() => setStudentInvoice(null)}>Cancel</button>
              <button className="action-btn primary" onClick={handleCreateStudentInvoice} disabled={loading}>
                {loading ? 'Creating…' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill a block up front — the classes here may not have happened yet. */}
      {blockModal && (
        <div className="modal-overlay" onClick={() => setBlockModal(null)}>
          <div className="tx-modal blk-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Bill a block in advance</h3>
              <button onClick={() => setBlockModal(null)}><X size={20}/></button>
            </div>

            <div className="tx-form">
              <p className="text-muted" style={{ marginTop: 0, fontSize: '13px' }}>
                One invoice for a run of classes, charged before they are taught.
                Each class is billed against its own calendar entry, so approving it
                later in Calendar Charges will not bill the family a second time.
              </p>

              <div className="br-range">
                <div className="form-group">
                  <label htmlFor="blk-student">Student</label>
                  <select
                    id="blk-student"
                    className="form-control"
                    value={blockModal.studentId}
                    onChange={e => setBlockModal({ ...blockModal, studentId: e.target.value, classId: '', picked: new Set() })}
                  >
                    <option value="">— Select a student —</option>
                    {familyStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="blk-class">Class</label>
                  <select
                    id="blk-class"
                    className="form-control"
                    value={blockModal.classId}
                    disabled={!blockData}
                    onChange={e => setBlockModal({ ...blockModal, classId: e.target.value, picked: new Set() })}
                  >
                    <option value="">All their classes</option>
                    {(blockData?.classes ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="br-range">
                <div className="form-group">
                  <label htmlFor="blk-from">From</label>
                  <input
                    id="blk-from"
                    type="date"
                    className="form-control"
                    value={blockModal.from}
                    max={blockModal.to}
                    onChange={e => setBlockModal({ ...blockModal, from: e.target.value, picked: new Set() })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="blk-to">To</label>
                  <input
                    id="blk-to"
                    type="date"
                    className="form-control"
                    value={blockModal.to}
                    min={blockModal.from}
                    onChange={e => setBlockModal({ ...blockModal, to: e.target.value, picked: new Set() })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Price the block</label>
                <div className="blk-price-modes">
                  {[
                    { key: 'each', label: 'Same amount per class' },
                    { key: 'total', label: 'One total, split evenly' },
                  ].map(mode => (
                    <button
                      key={mode.key}
                      type="button"
                      className={`blk-mode ${blockModal.priceMode === mode.key ? 'active' : ''}`}
                      onClick={() => setBlockModal({ ...blockModal, priceMode: mode.key })}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  className="form-control"
                  min="0"
                  step="0.01"
                  placeholder={blockModal.priceMode === 'each' ? 'Amount per class (leave empty to use each class’s own price)' : 'Total for the whole block'}
                  value={blockModal.amount}
                  onChange={e => setBlockModal({ ...blockModal, amount: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>
                  {blockPicked.length} class{blockPicked.length === 1 ? '' : 'es'} selected
                  {blockLoading && ' — loading…'}
                </label>
                {blockError && <p className="text-danger" style={{ fontSize: '13px' }}>{blockError}</p>}
                {!blockModal.studentId ? (
                  <p className="text-muted" style={{ fontSize: '13px' }}>Pick a student to see their scheduled classes.</p>
                ) : (!blockLoading && blockSessions.length === 0) ? (
                  <p className="text-muted" style={{ fontSize: '13px' }}>
                    No scheduled classes in this window. Widen the dates, or check the student’s enrolments.
                  </p>
                ) : (
                  <div className="blk-list">
                    {blockSessions.map((s) => {
                      const picked = blockModal.picked.has(s.id) && !s.alreadyCharged;
                      const amount = picked ? blockLineAmount(s, blockPicked.findIndex(p => p.id === s.id)) : s.price;
                      return (
                        <label key={s.id} className={`blk-row ${s.alreadyCharged ? 'billed' : ''} ${picked ? 'picked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={picked}
                            disabled={s.alreadyCharged}
                            onChange={() => toggleBlockSession(s.id)}
                          />
                          <span className="blk-date">{formatDateUS(s.date)}</span>
                          <span className="blk-name">{s.className}{s.note ? ` · ${s.note}` : ''}</span>
                          {s.alreadyCharged ? (
                            <span className="blk-tag">Already billed{s.chargedInvoice ? ` · ${s.chargedInvoice}` : ''}</span>
                          ) : (
                            <strong className={amount == null || amount <= 0 ? 'text-danger' : ''}>
                              {amount == null || amount <= 0 ? 'No price' : `$${amount.toFixed(2)}`}
                            </strong>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {blockUnpriced > 0 && (
                <p className="text-danger" style={{ fontSize: '13px' }}>
                  {blockUnpriced} of the selected classes have no price on the calendar.
                  Name an amount above, or drop them from the block.
                </p>
              )}

              <div className="form-group">
                <label htmlFor="blk-desc">What this invoice is for (optional)</label>
                <input
                  id="blk-desc"
                  type="text"
                  className="form-control"
                  placeholder="e.g. Anchored — Fall block, Sep–Oct"
                  value={blockModal.description}
                  onChange={e => setBlockModal({ ...blockModal, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="blk-due">Due date (optional)</label>
                <input
                  id="blk-due"
                  type="date"
                  className="form-control"
                  value={blockModal.dueDate}
                  onChange={e => setBlockModal({ ...blockModal, dueDate: e.target.value })}
                />
                <p className="repeat-hint">Left empty, the invoice is due 30 days from today — the same as every other invoice here.</p>
              </div>

              <div className="si-total">
                <span>Invoice total</span>
                <strong>${blockTotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button className="action-btn" onClick={() => setBlockModal(null)}>Cancel</button>
              <button
                className="action-btn primary"
                onClick={handleCreateBlockInvoice}
                disabled={loading || blockPicked.length === 0 || blockUnpriced > 0}
              >
                {loading ? 'Creating…' : `Create Invoice ($${blockTotal.toFixed(2)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {billRangeModal && (
        <div className="modal-overlay" onClick={() => setBillRangeModal(null)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Bill a period</h3>
              <button onClick={() => setBillRangeModal(null)}><X size={20}/></button>
            </div>

            <div className="tx-form">
              <p className="text-muted" style={{ marginTop: 0, fontSize: '13px' }}>
                One invoice for every pending charge dated inside this window.
                Anything outside it stays unbilled and waits for its own invoice.
              </p>

              <div className="br-range">
                <div className="form-group">
                  <label htmlFor="br-from">From</label>
                  <input
                    id="br-from"
                    type="date"
                    className="form-control"
                    value={billRangeModal.from}
                    max={billRangeModal.to}
                    onChange={e => setBillRangeModal({ ...billRangeModal, from: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="br-to">To</label>
                  <input
                    id="br-to"
                    type="date"
                    className="form-control"
                    value={billRangeModal.to}
                    min={billRangeModal.from}
                    onChange={e => setBillRangeModal({ ...billRangeModal, to: e.target.value })}
                  />
                </div>
              </div>

              {/* The charges themselves, not just a count — this is the last
                  screen before a family is asked for money, so what lands on
                  each invoice should be readable here first. Grouped by child
                  because that is how they are about to be billed. */}
              <div className="form-group">
                <label>
                  {chargesInRange.length} charge{chargesInRange.length === 1 ? '' : 's'} in this period
                  {rangeGroups.length > 1 && ` — ${rangeGroups.length} separate invoices`}
                </label>
                {chargesInRange.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: '13px' }}>
                    No pending charges fall in this window. Widen the dates.
                  </p>
                ) : (
                  rangeGroups.map(g => (
                    <div key={g.studentId || 'family'} className="br-group">
                      <div className="br-group-head">
                        <span>{g.name}</span>
                        <strong>${g.total.toFixed(2)}</strong>
                      </div>
                      <ul className="br-lines">
                        {g.charges.map(t => (
                          <li key={t.id}>
                            <span>{formatDateUS(t.date)}</span>
                            <span className="br-desc">{t.description}</span>
                            <strong>${Math.abs(t.amount).toFixed(2)}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>

              <div className="si-total">
                <span>{rangeGroups.length > 1 ? 'Total across all invoices' : 'Invoice total'}</span>
                <strong>${rangeTotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button className="action-btn" onClick={() => setBillRangeModal(null)}>Cancel</button>
              <button
                className="action-btn primary"
                onClick={handleGenerateInvoice}
                disabled={loading || chargesInRange.length === 0}
              >
                {loading
                  ? 'Creating…'
                  : rangeGroups.length > 1
                    ? `Create ${rangeGroups.length} Invoices ($${rangeTotal.toFixed(2)})`
                    : `Create Invoice ($${rangeTotal.toFixed(2)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddTxModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddTxModalOpen(false)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Add {newTxForm.type}</h3>
              <button onClick={() => setIsAddTxModalOpen(false)}><X size={20}/></button>
            </div>
            
            <div className="tx-type-selector">
              {['Payment', 'Refund', 'Charge', 'Discount'].map(type => (
                <button 
                  key={type}
                  className={`tx-type-btn ${newTxForm.type === type ? 'active' : ''}`}
                  onClick={() => setNewTxForm({...newTxForm, type})}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="tx-form">
              <div className="form-group">
                <label htmlFor="tx-student-select">Student</label>
                <select
                  id="tx-student-select"
                  className="form-control"
                  value={newTxForm.studentId}
                  onChange={(e) => setNewTxForm({ ...newTxForm, studentId: e.target.value })}
                >
                  <option value="">— General (entire family) —</option>
                  {students
                    .filter(s => s.familyId === selectedFamily.id)
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" className="form-control" value={newTxForm.date} onChange={e => setNewTxForm({...newTxForm, date: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input type="number" className="form-control" placeholder="$0.00" value={newTxForm.amount} onChange={e => setNewTxForm({...newTxForm, amount: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" className="form-control" placeholder="e.g. EMA Check #1234" value={newTxForm.description} onChange={e => setNewTxForm({...newTxForm, description: e.target.value})} />
              </div>

              {isRepeatable && (
                <div className="repeat-box">
                  <label className="repeat-toggle">
                    <input
                      type="checkbox"
                      checked={newTxForm.repeatMonthly}
                      onChange={e => setNewTxForm({ ...newTxForm, repeatMonthly: e.target.checked })}
                    />
                    <span><History size={14} /> Repeat this charge every month</span>
                  </label>

                  {newTxForm.repeatMonthly && (
                    <div className="repeat-detail">
                      <p className="repeat-hint">
                        Charged on day {new Date(`${newTxForm.date}T00:00:00Z`).getUTCDate()} of every month,
                        starting next month. A month that is too short is charged on its last day.
                      </p>
                      <div className="form-group">
                        <label>Until (optional)</label>
                        <input
                          type="date"
                          className="form-control"
                          value={newTxForm.repeatUntil}
                          min={newTxForm.date}
                          onChange={e => setNewTxForm({ ...newTxForm, repeatUntil: e.target.value })}
                        />
                      </div>
                      <p className="repeat-hint">
                        {/* Said plainly because the manual charge above behaves the
                            opposite way, and the difference is money leaving. */}
                        Leave empty to run until you stop it. Repeats land on the family's
                        account as unbilled charges — they are never invoiced automatically.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {newTxForm.type === 'Payment' && (
                <>
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select
                      className="form-control"
                      value={newTxForm.paymentMethod}
                      onChange={(e) => setNewTxForm({ ...newTxForm, paymentMethod: e.target.value })}
                    >
                      <option value="">— Not specified —</option>
                      <option value="ZELLE">Zelle</option>
                      <option value="VENMO">Venmo</option>
                      <option value="PAYPAL">PayPal</option>
                      <option value="CASH">Cash</option>
                      <option value="CHECK">Check</option>
                      <option value="SCHOLARSHIP_EMA">EMA · Step Up (direct pay)</option>
                      <option value="SCHOLARSHIP_FES">FES scholarship</option>
                      <option value="OTHER">Other</option>
                    </select>
                    {newTxForm.paymentMethod === 'SCHOLARSHIP_EMA' && (
                      <p className="text-muted" style={{fontSize: '12px', marginTop: '6px'}}>
                        Only for scholarship money that arrived outside the remittance file — a
                        direct pay with no PO number. Anything on a remittance belongs in
                        Reconcile EMA, which matches it by PO so it cannot be paid twice.
                      </p>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Apply to Invoice (optional)</label>
                    <select
                      className="form-control"
                      value={newTxForm.invoiceId}
                      onChange={(e) => setNewTxForm({ ...newTxForm, invoiceId: e.target.value })}
                    >
                      <option value="">— General family balance —</option>
                      {familyInvoices
                        .filter(inv => inv.amountPaid < inv.amount)
                        .map(inv => (
                          <option key={inv.dbId} value={inv.dbId}>
                            {inv.id} — ${(inv.amount - inv.amountPaid).toFixed(2)} due
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="payment-allocation-mock">
                    <p className="text-muted" style={{fontSize: '13px', marginTop: '16px'}}>
                      <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                      Payments automatically reduce the Account Balance Owing. Any amount over what's due becomes credit for the next invoice.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setIsAddTxModalOpen(false)}>Cancel</button>
              <button className="btn-send" onClick={handleAddTransaction}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundModal && (
        <div className="modal-overlay" onClick={() => setRefundModal(null)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Refund {refundModal.invoice.id}</h3>
              <button onClick={() => setRefundModal(null)}><X size={20}/></button>
            </div>
            <div className="tx-form">
              <div className="form-group">
                <label>Original Payment Method</label>
                <p style={{ fontWeight: 600 }}>{refundModal.payment.method}</p>
              </div>
              <div className="form-group">
                <label>Refund Amount</label>
                <input
                  type="number"
                  className="form-control"
                  value={refundModal.amount}
                  max={refundModal.payment.amount}
                  onChange={e => setRefundModal({ ...refundModal, amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Reason (optional)</label>
                <input
                  type="text"
                  className="form-control"
                  value={refundModal.reason}
                  onChange={e => setRefundModal({ ...refundModal, reason: e.target.value })}
                />
              </div>
              {refundModal.payment.method === 'STRIPE_CARD' ? (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  This will reverse the charge on Stripe — the card will actually be refunded.
                </p>
              ) : (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  This only records the refund in the ledger — return the money to the family outside the app first.
                </p>
              )}
            </div>
            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setRefundModal(null)}>Cancel</button>
              <button className="btn-send" onClick={handleRefund}>Confirm Refund</button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice detail — the full specification of what the family owes */}
      {invoiceDetail && (
        <div className="modal-overlay" onClick={() => setInvoiceDetail(null)}>
          <div className="tx-modal invoice-detail-modal" onClick={e => e.stopPropagation()}>
            {invoiceDetail.loading ? (
              <div className="tx-form"><p className="text-muted">Loading invoice…</p></div>
            ) : (
              <>
                <div className="modal-head">
                  <div>
                    <h3>{invoiceDetail.invoice.invoiceNumber}</h3>
                    <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '13px' }}>
                      {invoiceDetail.invoice.familyName}
                      {invoiceDetail.invoice.student && ` · ${invoiceDetail.invoice.student.fullName}`}
                    </p>
                  </div>
                  <button onClick={() => setInvoiceDetail(null)}><X size={20}/></button>
                </div>

                <div className="tx-form">
                  <div className="inv-detail-meta">
                    <div><span>Issued</span><strong>{formatDateUS(invoiceDetail.invoice.date)}</strong></div>
                    <div><span>Due</span><strong>{invoiceDetail.invoice.dueDate ? formatDateUS(invoiceDetail.invoice.dueDate) : '—'}</strong></div>
                    <div>
                      <span>Status</span>
                      {(() => {
                        const key = invoiceDetail.invoice.status.toLowerCase();
                        const cfg = STATUS_CONFIG[key] || { icon: FileText, label: invoiceDetail.invoice.status };
                        const Icon = cfg.icon;
                        return <span className={`status-badge ${key}`}><Icon size={13} />{cfg.label}</span>;
                      })()}
                    </div>
                    <div>
                      <span>Sent</span>
                      {invoiceDetail.invoice.sentAt ? (
                        <span className="sent-indicator sent">
                          <Mail size={13} />
                          <span>{formatDateTimeUS(invoiceDetail.invoice.sentAt)}</span>
                        </span>
                      ) : (
                        <span className="sent-indicator not-sent">Not sent</span>
                      )}
                    </div>
                    {invoiceDetail.invoice.poNumbers.length > 0 && (
                      <div><span>PO #</span><strong>{invoiceDetail.invoice.poNumbers.join(', ')}</strong></div>
                    )}
                  </div>

                  <table className="inv-detail-lines">
                    <thead>
                      <tr><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
                    </thead>
                    <tbody>
                      {invoiceDetail.invoice.lines.map(l => (
                        <tr key={l.id}>
                          <td>{l.description}</td>
                          <td style={{ textAlign: 'right' }}>${l.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Subtotal</td>
                        <td style={{ textAlign: 'right' }}>${invoiceDetail.invoice.subtotal.toFixed(2)}</td>
                      </tr>
                      {invoiceDetail.invoice.amountPaid > 0 && (
                        <tr>
                          <td>Paid</td>
                          <td style={{ textAlign: 'right' }}>−${invoiceDetail.invoice.amountPaid.toFixed(2)}</td>
                        </tr>
                      )}
                      <tr className="inv-detail-total">
                        <td>{invoiceDetail.invoice.balance > 0 ? 'Balance due' : 'Paid in full'}</td>
                        <td style={{ textAlign: 'right' }}>${Math.max(0, invoiceDetail.invoice.balance).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>

                  {invoiceDetail.invoice.payments.length > 0 && (
                    <div style={{ marginTop: '18px' }}>
                      <label>Payments received</label>
                      <ul className="inv-detail-payments">
                        {invoiceDetail.invoice.payments.map(pmt => (
                          <li key={pmt.id}>
                            <span>{formatDateUS(pmt.date)} · {pmt.method}</span>
                            <strong>${pmt.amount.toFixed(2)}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-muted" style={{ fontSize: '13px', marginTop: '16px' }}>
                    <Mail size={14} style={{ display: 'inline', marginRight: '4px' }} />
                    {invoiceDetail.recipient
                      ? <>Would be emailed to <strong>{invoiceDetail.recipient.fullName}</strong> ({invoiceDetail.recipient.email}).</>
                      : 'No email address on file for this family — this invoice cannot be sent.'}
                  </p>
                </div>

                <div className="modal-actions" style={{ marginTop: '20px' }}>
                  <button className="btn-cancel" onClick={() => handleDownloadPdf(invoiceDetail.invoice)}>
                    <Download size={15} /> Download PDF
                  </button>
                  <button
                    className="btn-send"
                    disabled={!invoiceDetail.recipient}
                    onClick={() => {
                      setSendInvoiceModal({ invoice: invoiceDetail.invoice, recipient: invoiceDetail.recipient });
                      setInvoiceDetail(null);
                    }}
                  >
                    <Mail size={15} /> Email invoice
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Review-before-sending, same modal every family email passes through */}
      {sendInvoiceModal && (
        <EmailPreviewModal
          recipients={[{
            id: sendInvoiceModal.recipient.id,
            fullName: sendInvoiceModal.recipient.fullName,
            email: sendInvoiceModal.recipient.email,
          }]}
          defaultSubject={defaultInvoiceSubject(sendInvoiceModal.invoice.invoiceNumber)}
          defaultMessage={defaultInvoiceMessage(sendInvoiceModal.invoice.invoiceNumber)}
          note={INVOICE_FIXED_NOTE}
          previewType="invoice"
          previewContext={{ invoiceId: sendInvoiceModal.invoice.dbId }}
          onClose={() => setSendInvoiceModal(null)}
          onConfirm={handleSendInvoice}
          sending={sendingInvoice}
        />
      )}

      {/* Edit Transaction slide-over */}
      {editTxPanel && (
        <div className="slideover-overlay" onClick={() => setEditTxPanel(null)}>
          <div className="slideover" onClick={e => e.stopPropagation()}>
            <div className="slideover-head">
              <h3>Edit {editTxPanel.tx.type}</h3>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="tx-delete-btn"
                  title="Delete this transaction"
                  onClick={handleDeleteFromPanel}
                  disabled={savingTxEdit}
                >
                  <Trash2 size={18} />
                </button>
                <button className="tx-delete-btn" onClick={() => setEditTxPanel(null)}><X size={18}/></button>
              </div>
            </div>

            <div className="slideover-body">
              <div className="form-group">
                <label>Student</label>
                <select
                  className="form-control"
                  value={editTxPanel.studentId}
                  onChange={e => setEditTxPanel({ ...editTxPanel, studentId: e.target.value })}
                >
                  <option value="">(Not Specified)</option>
                  {familyStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={editTxPanel.date}
                    onChange={e => setEditTxPanel({ ...editTxPanel, date: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Amount</label>
                  <input
                    type="number"
                    className="form-control"
                    min="0"
                    step="0.01"
                    value={editTxPanel.amount}
                    onChange={e => setEditTxPanel({ ...editTxPanel, amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-control"
                  rows="3"
                  value={editTxPanel.description}
                  onChange={e => setEditTxPanel({ ...editTxPanel, description: e.target.value })}
                />
              </div>

              {editTxPanel.tx.origin && editTxPanel.tx.origin.kind !== 'MANUAL' && (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  Raised by: <strong>{editTxPanel.tx.origin.label}</strong>. Editing here changes
                  this ledger line only — correct it at the source if it should stay changed.
                </p>
              )}
              {editTxPanel.tx.invoiceId && (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  On invoice {editTxPanel.tx.invoiceId} — saving updates that invoice's total too.
                </p>
              )}
            </div>

            <div className="slideover-actions">
              <button className="btn-cancel" onClick={() => setEditTxPanel(null)}>Cancel</button>
              <button className="btn-send" onClick={handleSaveTxEdit} disabled={savingTxEdit}>
                {savingTxEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {editInvoiceModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            // A double-click on the row's Edit button opens this modal on the
            // first click; the second click then lands on this overlay (it
            // now covers the same screen spot) and would close it right back
            // off — so ignore an overlay click that arrives right on the
            // heels of opening.
            if (Date.now() - editInvoiceModal.openedAt < 400) return;
            setEditInvoiceModal(null);
          }}
        >
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Edit {editInvoiceModal.invoice.id}</h3>
              <button onClick={() => setEditInvoiceModal(null)}><X size={20}/></button>
            </div>
            <div className="tx-form">
              {editInvoiceModal.lines.map((line, i) => (
                <div key={line.id || `new-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '10px' }}>
                  <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                    {i === 0 && <label>Description</label>}
                    <input
                      type="text"
                      className="form-control"
                      value={line.description}
                      onChange={e => updateEditLine(i, 'description', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    {i === 0 && <label>Amount</label>}
                    <input
                      type="number"
                      className="form-control"
                      value={line.amount}
                      min="0"
                      step="0.01"
                      onChange={e => updateEditLine(i, 'amount', e.target.value)}
                    />
                  </div>
                  <button
                    className="tx-delete-btn"
                    title="Take this line off the invoice — its charge stays on the ledger as unbilled"
                    onClick={() => removeEditLine(i)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <button className="action-btn" style={{ marginBottom: '12px' }} onClick={addEditLine}>
                <Plus size={14} /> Add line
              </button>

              <p className="text-muted" style={{fontSize: '13px'}}>
                <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                New total: ${editInvoiceModal.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0).toFixed(2)}.
                {' '}Removing a line takes it off this invoice; its charge stays on the ledger as unbilled.
                {editInvoiceModal.lines.length === 0 && ' Saving with no lines voids this invoice.'}
              </p>
            </div>
            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setEditInvoiceModal(null)}>Cancel</button>
              <button className="btn-send" onClick={handleSaveInvoiceEdit} disabled={savingInvoiceEdit}>
                {savingInvoiceEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default BillingPanel;
