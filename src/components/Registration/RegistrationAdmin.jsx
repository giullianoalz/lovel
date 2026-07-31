import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Users, Settings, Plus, Play, ChevronDown, CheckCircle, Check, Clock, Copy, User, X, Mail, Trash2, RefreshCw, AlertCircle, Inbox, UserPlus, Ban, Phone, Pencil } from 'lucide-react';
import api from '../../lib/api';
import { interestLabel } from '../../lib/enrollmentInterests';
import AddSelfAsTeacher from '../Common/AddSelfAsTeacher';
import './RegistrationAdmin.css';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Session date/time columns are UTC-pinned wall clock (a bare TIME on a
// 1970-01-01 placeholder for the time, UTC midnight for the date), so both are
// read back with the UTC getters — local ones slide a class an hour or a day.
const sessionHHMM = (value) => {
  const d = new Date(value);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const prettyTime = (hhmm) => {
  let [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
};

const sessionISODate = (value) => new Date(value).toISOString().slice(0, 10);

const todayISO = () => new Date().toISOString().slice(0, 10);

const RegistrationAdmin = () => {
  const [activeTab, setActiveTab] = useState('terms');
  const [terms, setTerms] = useState([]);
  const [selectedTermForRoster, setSelectedTermForRoster] = useState('');
  
  const [coves, setCoves] = useState([]);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [selectedCove, setSelectedCove] = useState(null);
  const [rosterDetails, setRosterDetails] = useState({ active: [], holds: [], waitlist: [] });
  
  const [showNewTermModal, setShowNewTermModal] = useState(false);
  const [editTermModal, setEditTermModal] = useState(false);
  const [editTermForm, setEditTermForm] = useState(null);
  const [seedModal, setSeedModal] = useState({ isOpen: false, targetTermId: null, sourceTermId: '' });
  
  const [newTermForm, setNewTermForm] = useState({
    name: '',
    earlySameDayStart: '', earlySameDayEnd: '',
    publicStart: '', publicEnd: '',
    regularRate: '', anchoredRate: '', depositDueDate: ''
  });
  
  const [showCoveModal, setShowCoveModal] = useState(false);
  const [editingCove, setEditingCove] = useState(null);
  // Electives for the term currently selected on the Rosters tab.
  const [termElectives, setTermElectives] = useState([]);
  const [electiveForm, setElectiveForm] = useState({ id: null, name: '', price: '' });
  const [electiveSaving, setElectiveSaving] = useState(false);
  const [coveForm, setCoveForm] = useState({
    name: '',
    capacity: 15,
    meetingUrl: '',
    // The two pricing controls. groupType picks which of the term's two rates
    // applies (regular = Lighthouse / Deep Sea, anchored = Anchored Learning
    // Group); priceOverride replaces both, for the programmes that carry their
    // own price. Empty means "use the term rate".
    groupType: 'REGULAR',
    priceOverride: '',
    // '' means unassigned — a class with no teacher shows on nobody's portal.
    teacherId: ''
  });
  
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [addingStudents, setAddingStudents] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [allStudents, setAllStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);

  /* Quarterly tuition — preview first, then commit. */
  const [quarterToBill, setQuarterToBill] = useState(1);
  const [creditDeposit, setCreditDeposit] = useState(false);
  const [quarterPreview, setQuarterPreview] = useState(null);
  const [quarterLoading, setQuarterLoading] = useState(false);

  /* What's actually on the timetable for the class being looked at, grouped
     into the recurring series it was created as. Without this the only view of
     a repeating class was the calendar, one week at a time. */
  const [classSessions, setClassSessions] = useState([]);
  const [classSessionsLoading, setClassSessionsLoading] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState(null);
  const [seriesEdit, setSeriesEdit] = useState(null);
  const [seriesSaving, setSeriesSaving] = useState(false);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleMode, setScheduleMode] = useState('recurring'); // 'recurring' | 'single'
  const [scheduleForm, setScheduleForm] = useState({ startDate: '', endDate: '', weekdays: [], startTime: '10:00', endTime: '11:00' });
  const [scheduling, setScheduling] = useState(false);
  const WEEKDAY_OPTIONS = [
    { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  ];
  
  const [appAlert, setAppAlert] = useState({
    isOpen: false, title: '', message: '', type: 'info', onConfirm: null
  });

  const [billingRequests, setBillingRequests] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  // ── Applications state (self-signup review queue) ──────────────────────────
  const [applications, setApplications] = useState([]);
  const [applicationCounts, setApplicationCounts] = useState({});
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationFilter, setApplicationFilter] = useState('PENDING');
  const [declineModal, setDeclineModal] = useState({ isOpen: false, application: null, staffNotes: '', submitting: false });

  // ── Manual Registration state ──────────────────────────────────────────────
  const [manualTermElectives, setManualTermElectives] = useState([]);
  const [manualTermClasses, setManualTermClasses] = useState([]);
  const [manualForm, setManualForm] = useState({
    termId: '',
    studentId: '',
    firstChoiceClassId: '',
    secondChoiceClassId: '',
    electiveIds: [],
    ixlPlan: 'NONE',
    skipEmail: false,
    // Set only when this registration is placing a self-signup application; the
    // server approves that application in the same transaction.
    applicationId: null,
  });
  const [manualStudentSearch, setManualStudentSearch] = useState('');
  // The student picker only knows the students /students returned (first page).
  // A child who just self-registered may not be among them, so the name is kept
  // here rather than looked up in that list.
  const [manualStudentName, setManualStudentName] = useState('');
  const [manualApplication, setManualApplication] = useState(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualPreview, setManualPreview] = useState(null); // billing preview
  const [manualResult, setManualResult] = useState(null);  // success result

  const showAlert = (message, title = 'Notification', type = 'info', onConfirm = null) => {
    setAppAlert({ isOpen: true, title, message, type, onConfirm });
  };

  // Recalculate billing preview client-side whenever the manual form changes.
  // Mirrors registrationPricing.service.js so the admin sees the exact totals
  // before submitting — no extra round-trip needed.
  const recalcManualPreview = (form, classes, electives) => {
    const cls = classes.find(c => c.id === form.firstChoiceClassId);
    const term = terms.find(t => t.id === form.termId);
    if (!cls || !term) { setManualPreview(null); return; }

    const IXL_PRICES = { NONE: 0, CORE: 5, CORE_SPANISH: 10 };
    // A class may carry its own price, which wins over the term's two rates.
    // Same null-vs-0 rule as the server: 0 is a free class, null defers.
    const termRate = cls.groupType === 'ANCHORED' ? Number(term.anchoredRate || 0) : Number(term.regularRate || 0);
    const baseRate = cls.priceOverride === null || cls.priceOverride === undefined
      ? termRate
      : Number(cls.priceOverride);
    const selectedElectives = electives.filter(e => form.electiveIds.includes(e.id));
    const electivesTotal = selectedElectives.reduce((s, e) => s + Number(e.price || 130), 0);
    const ixlTotal = IXL_PRICES[form.ixlPlan] ?? 0;
    const totalQuarterly = baseRate + electivesTotal + ixlTotal;
    const depositAmount = Math.round(totalQuarterly * 0.15 * 100) / 100;
    setManualPreview({ baseRate, electivesTotal, ixlTotal, totalQuarterly, depositAmount });
  };

  const updateManualForm = (patch) => {
    setManualForm(prev => {
      const next = { ...prev, ...patch };
      recalcManualPreview(next, manualTermClasses, manualTermElectives);
      return next;
    });
  };

  // Picking a different student invalidates the application the form was
  // preloaded from — approving it would credit the wrong child (the server
  // rejects the mismatch too, but not before the admin filled in a whole form).
  const selectManualStudent = (student) => {
    updateManualForm({ studentId: student?.id || '', applicationId: null });
    setManualStudentName(student?.fullName || '');
    setManualStudentSearch(student?.fullName || '');
    setManualApplication(null);
  };

  // When term changes, load its classes and electives
  const handleManualTermChange = async (termId) => {
    updateManualForm({ termId, firstChoiceClassId: '', secondChoiceClassId: '', electiveIds: [] });
    setManualPreview(null);
    if (!termId) { setManualTermClasses([]); setManualTermElectives([]); return; }
    try {
      const [classRes, electiveRes] = await Promise.all([
        api.get(`/registration/classes?termId=${termId}`),
        api.get(`/registration/terms/${termId}/electives`).catch(() => ({ data: { electives: [] } })),
      ]);
      setManualTermClasses(classRes.data.classes || []);
      setManualTermElectives(electiveRes.data.electives || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleManualElectiveToggle = (id) => {
    updateManualForm({
      electiveIds: manualForm.electiveIds.includes(id)
        ? manualForm.electiveIds.filter(x => x !== id)
        : [...manualForm.electiveIds, id],
    });
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.termId || !manualForm.studentId || !manualForm.firstChoiceClassId) return;
    setManualSubmitting(true);
    try {
      const res = await api.post('/registration/admin-register', manualForm);
      setManualResult({ ...res.data, applicationApproved: Boolean(manualForm.applicationId) });
      // Reset form
      setManualForm({ termId: '', studentId: '', firstChoiceClassId: '', secondChoiceClassId: '', electiveIds: [], ixlPlan: 'NONE', skipEmail: false, applicationId: null });
      setManualPreview(null);
      setManualStudentSearch('');
      setManualStudentName('');
      setManualApplication(null);
      // Reload billing summary to reflect the new registration
      if (activeTab === 'billing') loadBillingSummary();
      // The placed child is no longer pending — refresh the queue and its badge.
      if (manualForm.applicationId) loadApplications();
    } catch (err) {
      showAlert(err.response?.data?.message || 'Error procesando el registro.', 'Error', 'warning');
    } finally {
      setManualSubmitting(false);
    }
  };

  // ── Applications ───────────────────────────────────────────────────────────

  const loadApplications = async (filter = applicationFilter) => {
    setApplicationsLoading(true);
    try {
      const res = await api.get(`/registration/applications?status=${filter}`);
      setApplications(res.data.applications || []);
      setApplicationCounts(res.data.counts || {});
    } catch (err) {
      console.error(err);
    } finally {
      setApplicationsLoading(false);
    }
  };

  // The term a placement should default to: the nearest one still accepting
  // registrations. Terms arrive newest-first, so the last one that has not
  // closed yet is the one about to start.
  const defaultTermIdForPlacement = () => {
    const now = Date.now();
    const stillOpen = terms.filter(t => new Date(t.registrationCloses).getTime() >= now);
    return (stillOpen.length ? stillOpen[stillOpen.length - 1] : terms[0])?.id || '';
  };

  // Hands the application over to the Manual Registration tab with everything
  // the parent already told us filled in, so staff only choose the class.
  const handlePlaceApplication = async (application) => {
    setManualResult(null);
    setManualApplication(application);
    setManualStudentName(application.student.fullName);
    setManualStudentSearch(application.student.fullName);
    setManualForm({
      termId: '',
      studentId: application.student.id,
      firstChoiceClassId: '',
      secondChoiceClassId: '',
      electiveIds: [],
      ixlPlan: application.ixlPlan || 'NONE',
      skipEmail: false,
      applicationId: application.id,
    });
    setManualPreview(null);
    setActiveTab('manual');

    const termId = defaultTermIdForPlacement();
    if (termId) await handleManualTermChange(termId);
  };

  const handleConfirmDecline = async () => {
    const application = declineModal.application;
    if (!application) return;
    setDeclineModal(prev => ({ ...prev, submitting: true }));
    try {
      await api.post(`/registration/applications/${application.id}/decline`, {
        staffNotes: declineModal.staffNotes,
      });
      setDeclineModal({ isOpen: false, application: null, staffNotes: '', submitting: false });
      loadApplications();
    } catch (error) {
      setDeclineModal(prev => ({ ...prev, submitting: false }));
      showAlert(error.response?.data?.message || 'Error declining the application', 'Error', 'warning');
    }
  };

  const loadTerms = async () => {
    try {
      const res = await api.get('/registration/terms');
      setTerms(res.data.terms);
      if (res.data.terms.length > 0 && !selectedTermForRoster) {
        setSelectedTermForRoster(res.data.terms[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadClasses = async () => {
    if (!selectedTermForRoster) return;
    try {
      const res = await api.get(`/registration/classes?termId=${selectedTermForRoster}`);
      setCoves(res.data.classes);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTermElectives = async () => {
    if (!selectedTermForRoster) return setTermElectives([]);
    try {
      const res = await api.get(`/registration/terms/${selectedTermForRoster}/electives`);
      setTermElectives(res.data.electives || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveElective = async (e) => {
    e.preventDefault();
    if (!electiveForm.name.trim()) return;
    setElectiveSaving(true);
    try {
      const payload = { name: electiveForm.name.trim(), price: String(electiveForm.price).trim() };
      if (electiveForm.id) {
        await api.put(`/registration/electives/${electiveForm.id}`, payload);
      } else {
        await api.post(`/registration/terms/${selectedTermForRoster}/electives`, payload);
      }
      setElectiveForm({ id: null, name: '', price: '' });
      loadTermElectives();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error saving the elective', 'Error', 'warning');
    } finally {
      setElectiveSaving(false);
    }
  };

  const handleDeleteElective = async (elective) => {
    try {
      await api.delete(`/registration/electives/${elective.id}`);
      // Deleting the row being edited would otherwise leave the form pointing at
      // an id that no longer exists.
      if (electiveForm.id === elective.id) setElectiveForm({ id: null, name: '', price: '' });
      loadTermElectives();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error deleting the elective', 'Error', 'warning');
    }
  };

  const loadRoster = async (coveId) => {
    try {
      const res = await api.get(`/registration/classes/${coveId}/roster`);
      setRosterDetails(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAllStudents = async () => {
    try {
      const res = await api.get('/students');
      setAllStudents(res.data.students);
    } catch (error) {
      console.error(error);
    }
  };

  // Anyone who can run a class — the endpoint matches secondary roles, so an
  // admin who also teaches shows up here too.
  const loadTeachers = async () => {
    try {
      const res = await api.get('/users?role=TEACHER');
      setTeachers(res.data.users || []);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadTerms();
    loadAllStudents();
    loadTeachers();
    // On mount too, not just on the tab: the pending count rides on the tab
    // label, and a family waiting to be placed shouldn't need a click to notice.
    loadApplications();
  }, []);

  const loadQuarterPreview = async () => {
    if (!selectedTermForRoster) return;
    setQuarterLoading(true);
    try {
      const res = await api.get('/registration/quarter-charges', {
        params: { termId: selectedTermForRoster, quarter: quarterToBill, creditDeposit },
      });
      setQuarterPreview(res.data);
    } catch (error) {
      showAlert(error.response?.data?.message || 'Could not work out this quarter’s charges.', 'Error', 'warning');
    }
    setQuarterLoading(false);
  };

  // Money leaves a preview and lands on real ledgers here, so it asks first.
  const handleGenerateQuarterCharges = () => {
    if (!quarterPreview) return;
    const { billable, total } = quarterPreview.summary;
    showAlert(
      `Raise ${billable} charge${billable === 1 ? '' : 's'} totalling $${total.toFixed(2)} for Quarter ${quarterToBill}? They'll appear on each family's account.`,
      'Raise quarterly charges',
      'confirm',
      async () => {
        setQuarterLoading(true);
        try {
          const res = await api.post('/registration/quarter-charges', {
            termId: selectedTermForRoster,
            quarter: quarterToBill,
            creditDeposit,
          });
          showAlert(res.data.message, 'Done', 'info');
          await loadQuarterPreview();
        } catch (error) {
          showAlert(error.response?.data?.message || 'Could not raise the charges.', 'Error', 'warning');
        }
        setQuarterLoading(false);
      }
    );
  };

  const loadBillingSummary = async () => {
    if (!selectedTermForRoster) return;
    setBillingLoading(true);
    try {
      const res = await api.get(`/registration/billing-summary?termId=${selectedTermForRoster}`);
      setBillingRequests(res.data.requests);
    } catch (err) {
      console.error(err);
    } finally {
      setBillingLoading(false);
    }
  };

  const handleResendEmail = async (requestId) => {
    setResendingId(requestId);
    try {
      await api.post(`/registration/requests/${requestId}/resend-email`);
      showAlert('Email resent successfully.', 'Success', 'info');
      loadBillingSummary();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error resending the email', 'Error', 'warning');
    } finally {
      setResendingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'rosters') {
      loadClasses();
      loadTermElectives();
      // Switching term abandons whatever elective was mid-edit; keeping it would
      // save into the term the admin just navigated away from.
      setElectiveForm({ id: null, name: '', price: '' });
    }
    if (activeTab === 'billing') {
      loadBillingSummary();
    }
  }, [activeTab, selectedTermForRoster]);

  // Its own effect: the queue has nothing to do with the roster term selector.
  useEffect(() => {
    if (activeTab === 'applications') loadApplications();
  }, [activeTab]);

  useEffect(() => {
    if (selectedCove) {
      loadRoster(selectedCove);
      loadClassSessions(selectedCove);
    } else {
      setClassSessions([]);
    }
    setSeriesEdit(null);
    setExpandedSeries(null);
  }, [selectedCove]);

  const formatDateForInput = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toISOString().split('T')[0];
  };

  const formatDateForDisplay = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString();
  };

  // For date-only values: Prisma's @db.Date columns and the bare YYYY-MM-DD a
  // <input type="date"> produces. Both mean a calendar day, but both parse as
  // UTC midnight — so toLocaleDateString renders the day *before* anywhere west
  // of UTC, which is every US timezone. Read the parts in UTC instead.
  // Use formatDateForDisplay for real timestamps; this one for plain dates.
  const formatDateOnlyForDisplay = (value) => {
    if (!value) return '';
    const iso = typeof value === 'string' ? value : new Date(value).toISOString();
    const [year, month, day] = iso.slice(0, 10).split('-');
    return `${Number(month)}/${Number(day)}/${year}`;
  };

  // Windows must run in chronological order: Early opens -> Early ends/Public
  // opens -> Public opens -> Registration closes. Returns an error string, or
  // null if the order is valid.
  const validateWindowOrder = (form) => {
    const [d1, d2, d3, d4] = [form.earlySameDayStart, form.earlySameDayEnd, form.publicStart, form.publicEnd].map(d => new Date(d));
    if (d1 >= d2) return 'The Early window must open before it ends.';
    if (d2 >= d3) return 'The Public window must open after the Early window ends.';
    if (d3 >= d4) return 'Registration must close after the Public window opens.';
    return null;
  };

  const handleCreateTerm = async (e) => {
    e.preventDefault();
    const orderError = validateWindowOrder(newTermForm);
    if (orderError) return showAlert(orderError, 'Invalid Dates', 'warning');
    if (!newTermForm.regularRate || !newTermForm.anchoredRate) {
      return showAlert('Regular Rate and Anchored Rate are required — without them every registration in this term bills at $0.', 'Missing Rates', 'warning');
    }
    try {
      await api.post('/registration/terms', {
        name: newTermForm.name,
        startDate: newTermForm.earlySameDayStart,
        endDate: newTermForm.publicEnd,
        window1OpensAt: new Date(newTermForm.earlySameDayStart).toISOString(),
        window2OpensAt: new Date(newTermForm.earlySameDayEnd).toISOString(),
        window3OpensAt: new Date(newTermForm.publicStart).toISOString(),
        registrationCloses: new Date(newTermForm.publicEnd).toISOString(),
        regularRate: newTermForm.regularRate,
        anchoredRate: newTermForm.anchoredRate,
        depositDueDate: newTermForm.depositDueDate || null,
      });
      setShowNewTermModal(false);
      setNewTermForm({ name: '', earlySameDayStart: '', earlySameDayEnd: '', publicStart: '', publicEnd: '', regularRate: '', anchoredRate: '', depositDueDate: '' });
      loadTerms();
      showAlert('Term created successfully.', 'Success', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error creating term', 'Error', 'warning');
    }
  };

  const handleViewConfig = (term) => {
    setEditTermForm({
      id: term.id,
      name: term.name,
      earlySameDayStart: formatDateForInput(term.window1OpensAt),
      earlySameDayEnd: formatDateForInput(term.window2OpensAt),
      publicStart: formatDateForInput(term.window3OpensAt),
      publicEnd: formatDateForInput(term.registrationCloses),
      regularRate: term.regularRate ?? '',
      anchoredRate: term.anchoredRate ?? '',
      depositDueDate: term.depositDueDate ? formatDateForInput(term.depositDueDate) : '',
      quarter2StartsAt: term.quarter2StartsAt ? formatDateForInput(term.quarter2StartsAt) : '',
    });
    setEditTermModal(true);
  };

  const handleUpdateTerm = async (e) => {
    e.preventDefault();
    const orderError = validateWindowOrder(editTermForm);
    if (orderError) return showAlert(orderError, 'Invalid Dates', 'warning');
    try {
      await api.put(`/registration/terms/${editTermForm.id}`, {
        name: editTermForm.name,
        window1OpensAt: new Date(editTermForm.earlySameDayStart).toISOString(),
        window2OpensAt: new Date(editTermForm.earlySameDayEnd).toISOString(),
        window3OpensAt: new Date(editTermForm.publicStart).toISOString(),
        registrationCloses: new Date(editTermForm.publicEnd).toISOString(),
        regularRate: editTermForm.regularRate,
        anchoredRate: editTermForm.anchoredRate,
        depositDueDate: editTermForm.depositDueDate || null,
        quarter2StartsAt: editTermForm.quarter2StartsAt ? new Date(editTermForm.quarter2StartsAt).toISOString() : null,
      });
      setEditTermModal(false);
      loadTerms();
      showAlert('Term updated successfully.', 'Success', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error updating term', 'Error', 'warning');
    }
  };

  const handleOpenSeedModal = (termId) => {
    const availableSources = terms.filter(t => t.id !== termId);
    setSeedModal({ isOpen: true, targetTermId: termId, sourceTermId: availableSources.length > 0 ? availableSources[0].id : '' });
  };

  const handleConfirmSeed = async () => {
    try {
      const res = await api.post(`/registration/terms/${seedModal.targetTermId}/seed-priority`, {
        sourceTermId: seedModal.sourceTermId || undefined,
      });
      setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' });
      loadTerms();
      showAlert(res.data.message || 'Term Seeded', 'Term Seeded', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error seeding term', 'Error', 'warning');
    }
  };

  const handleRevokeHold = async (studentId) => {
    try {
      await api.delete(`/registration/holds/${studentId}?classId=${selectedCove}`);
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      console.error(error);
    }
  };

  const handleMoveRosterStudent = async (studentId, destination) => {
    try {
      await api.post(`/registration/classes/${selectedCove}/roster/${studentId}/move`, { destination });
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error moving student', 'Error', 'warning');
    }
  };

  const handleRemoveFromWaitlist = (studentId, studentName) => {
    showAlert(`Remove ${studentName} from the waitlist? This can't be undone.`, 'Remove from Waitlist', 'confirm', async () => {
      try {
        await api.delete(`/registration/waitlist/${studentId}?classId=${selectedCove}`);
        loadRoster(selectedCove);
        loadClasses();
      } catch (error) {
        console.error(error);
      }
    });
  };

  const handleRemoveFromRoster = (studentId, studentName) => {
    showAlert(`Remove ${studentName} from this class? Use this only if they were added by mistake — it does not queue them for a hold or waitlist spot.`, 'Remove Student', 'confirm', async () => {
      try {
        await api.delete(`/classes/${selectedCove}/enrollments/${studentId}`);
        loadRoster(selectedCove);
        loadClasses();
      } catch (error) {
        console.error(error);
      }
    });
  };

  const handleSweepHolds = (coveId) => {
    const holdsCount = rosterDetails.holds?.length || 0;
    if (holdsCount === 0) return showAlert('No expired holds to sweep.', 'Notice', 'warning');
    
    showAlert(`Are you sure you want to sweep (revoke) ${holdsCount} holds? This will release their spots.`, 'Sweep Holds', 'confirm', async () => {
      try {
        await api.post(`/registration/classes/${coveId}/holds/sweep`);
        loadRoster(coveId);
        loadClasses();
      } catch (error) {
        console.error(error);
      }
    });
  };

  const handleRemindAllHolds = async (coveId) => {
    try {
      const res = await api.post(`/registration/classes/${coveId}/holds/remind`);
      showAlert(res.data.message, 'Reminders Sent', 'info');
    } catch (error) {
      console.error(error);
    }
  };

  const handleForcePromote = async () => {
    if (!selectedCove) return;
    try {
      const res = await api.post(`/registration/promote/${selectedCove}`);
      showAlert(res.data.message || 'Promoted successfully.', 'Success', 'info');
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error promoting from waitlist', 'Error', 'warning');
    }
  };

  const loadClassSessions = async (coveId) => {
    if (!coveId) return setClassSessions([]);
    setClassSessionsLoading(true);
    try {
      const res = await api.get(`/sessions?classId=${coveId}`);
      setClassSessions(res.data.sessions || []);
    } catch (error) {
      console.error(error);
      setClassSessions([]);
    }
    setClassSessionsLoading(false);
  };

  /**
   * The sessions of this class, folded back into the series they were created
   * as: same weekday, same start, same end. That grouping is what makes "the
   * Wednesday 3pm slot should have been 4pm" a single edit instead of one per
   * week — the recurrence itself isn't stored, only the sessions it produced.
   */
  const sessionSeries = useMemo(() => {
    const groups = new Map();
    classSessions.forEach(s => {
      const date = sessionISODate(s.date);
      const startTime = sessionHHMM(s.startTime);
      const endTime = sessionHHMM(s.endTime);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const key = `${weekday}|${startTime}|${endTime}`;
      if (!groups.has(key)) {
        groups.set(key, { key, weekday, startTime, endTime, sessions: [] });
      }
      groups.get(key).sessions.push({ ...s, date, startTime, endTime });
    });

    const today = todayISO();
    return Array.from(groups.values())
      .map(g => {
        const sessions = g.sessions.sort((a, b) => a.date.localeCompare(b.date));
        const live = sessions.filter(s => s.status !== 'CANCELLED');
        return {
          ...g,
          sessions,
          first: sessions[0]?.date,
          last: sessions[sessions.length - 1]?.date,
          upcoming: live.filter(s => s.date >= today).length,
          cancelled: sessions.length - live.length,
        };
      })
      .sort((a, b) => (a.weekday - b.weekday) || a.startTime.localeCompare(b.startTime));
  }, [classSessions]);

  const startSeriesEdit = (series) => {
    setSeriesEdit({
      key: series.key,
      weekday: series.weekday,
      matchStartTime: series.startTime,
      startTime: series.startTime,
      endTime: series.endTime,
      // Upcoming only by default: sessions that already happened are a record of
      // what happened, and retiming them rewrites attendance history.
      scope: 'upcoming',
    });
  };

  const handleSaveSeriesTime = async (series) => {
    if (!seriesEdit) return;
    if (seriesEdit.endTime <= seriesEdit.startTime) {
      showAlert('The end time has to be after the start time.', 'Check the times', 'warning');
      return;
    }
    setSeriesSaving(true);
    try {
      const res = await api.patch('/sessions/bulk', {
        classId: selectedCove,
        weekday: series.weekday,
        matchStartTime: seriesEdit.matchStartTime,
        from: seriesEdit.scope === 'all' ? series.first : todayISO(),
        startTime: seriesEdit.startTime,
        endTime: seriesEdit.endTime,
      });
      setSeriesEdit(null);
      await loadClassSessions(selectedCove);
      showAlert(res.data.message, 'Series Updated', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error updating these sessions', 'Error', 'warning');
    }
    setSeriesSaving(false);
  };

  // Cancels rather than deletes, like the calendar does: a cancelled session
  // still has to exist for attendance and payroll history to make sense.
  const handleCancelSeries = (series) => {
    showAlert(
      `Cancel the ${series.upcoming} upcoming ${WEEKDAY_NAMES[series.weekday]} session${series.upcoming === 1 ? '' : 's'} at ${prettyTime(series.startTime)}? Past sessions stay as they are.`,
      'Cancel these sessions',
      'confirm',
      async () => {
        try {
          const res = await api.patch('/sessions/bulk', {
            classId: selectedCove,
            weekday: series.weekday,
            matchStartTime: series.startTime,
            from: todayISO(),
            status: 'CANCELLED',
          });
          await loadClassSessions(selectedCove);
          showAlert(res.data.message, 'Sessions Cancelled', 'info');
        } catch (error) {
          showAlert(error.response?.data?.message || 'Error cancelling these sessions', 'Error', 'warning');
        }
      }
    );
  };

  const handleCancelOneSession = async (session) => {
    try {
      await api.put(`/sessions/${session.id}`, { status: 'CANCELLED' });
      loadClassSessions(selectedCove);
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error cancelling this session', 'Error', 'warning');
    }
  };

  const toggleScheduleWeekday = (value) => {
    setScheduleForm(p => ({
      ...p,
      weekdays: p.weekdays.includes(value) ? p.weekdays.filter(w => w !== value) : [...p.weekdays, value],
    }));
  };

  const handleScheduleSessions = async (e) => {
    e.preventDefault();
    setScheduling(true);
    try {
      if (scheduleMode === 'single') {
        await api.post('/sessions', {
          classId: selectedCove,
          date: scheduleForm.startDate,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
        });
        showAlert('Session scheduled.', 'Session Scheduled', 'info');
      } else {
        const res = await api.post('/sessions/bulk', { classId: selectedCove, ...scheduleForm });
        showAlert(res.data.message, 'Sessions Scheduled', 'info');
      }
      setShowScheduleModal(false);
      setScheduleForm({ startDate: '', endDate: '', weekdays: [], startTime: '10:00', endTime: '11:00' });
      loadClassSessions(selectedCove);
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error scheduling sessions', 'Error', 'warning');
    } finally {
      setScheduling(false);
    }
  };

  const handleOpenCoveModal = (cove = null) => {
    if (cove) {
      setEditingCove(cove.id);
      setCoveForm({
        name: cove.name,
        capacity: cove.capacity,
        meetingUrl: cove.meetingUrl || '',
        groupType: cove.groupType || 'REGULAR',
        // null (no own price) has to come back as '' so the input renders empty
        // and saving an untouched form doesn't write 0.
        priceOverride: cove.priceOverride === null || cove.priceOverride === undefined ? '' : String(cove.priceOverride),
        teacherId: cove.teacherId || '',
      });
    } else {
      setEditingCove(null);
      setCoveForm({ name: '', capacity: 15, meetingUrl: '', groupType: 'REGULAR', priceOverride: '' });
    }
    setShowCoveModal(true);
  };

  const handleSaveCove = async (e) => {
    e.preventDefault();
    try {
      // Sent trimmed, so a blank field reaches the API as '' — which it reads as
      // "no own price": cleared on update, never set on create.
      const pricing = {
        groupType: coveForm.groupType,
        priceOverride: String(coveForm.priceOverride).trim(),
      };
      if (editingCove) {
        await api.put(`/classes/${editingCove}`, {
          name: coveForm.name,
          maxStudents: parseInt(coveForm.capacity),
          meetingUrl: coveForm.meetingUrl,
          teacherId: coveForm.teacherId,
          ...pricing
        });
      } else {
        await api.post(`/classes`, {
          name: coveForm.name,
          maxStudents: parseInt(coveForm.capacity),
          meetingUrl: coveForm.meetingUrl,
          teacherId: coveForm.teacherId,
          termId: selectedTermForRoster,
          ...pricing
        });
      }
      setShowCoveModal(false);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error saving class', 'Error', 'warning');
    }
  };

  const handleDeleteCove = (coveId, coveName) => {
    showAlert(`Are you sure you want to delete "${coveName}"? This cannot be undone.`, 'Delete Class', 'confirm', async () => {
      try {
        await api.delete(`/classes/${coveId}`);
        setShowCoveModal(false);
        loadClasses();
      } catch (error) {
        showAlert(error.response?.data?.message || 'Error deleting class', 'Error', 'warning');
      }
    });
  };

  const toggleStudentSelection = (studentId) => {
    setSelectedStudentIds(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };

  // Enrolls one at a time (not Promise.all) so the class-full check inside the
  // endpoint sees each prior enrollment before the next call — batching in
  // parallel would let every request read the same "N seats left" and overbook.
  const handleAddSelectedStudents = async () => {
    if (!selectedCove || selectedStudentIds.length === 0 || addingStudents) return;
    setAddingStudents(true);
    const failures = [];
    for (const studentId of selectedStudentIds) {
      try {
        await api.post(`/classes/${selectedCove}/enrollments`, { studentId });
      } catch (error) {
        const name = allStudents.find(s => s.id === studentId)?.fullName || studentId;
        failures.push(`${name}: ${error.response?.data?.message || 'Error adding student'}`);
      }
    }
    setAddingStudents(false);
    setShowAddStudentModal(false);
    setStudentSearch('');
    setSelectedStudentIds([]);
    loadRoster(selectedCove);
    loadClasses();
    if (failures.length > 0) {
      showAlert(failures.join('\n'), 'Some students could not be added', 'warning');
    }
  };

  return (
    <div className="registration-admin">
      <div className="page-header">
        <div>
          <p className="text-muted">Manage academic terms, registration windows, and priority holds.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNewTermModal(true)}>
          <Plus size={16} /> New Term
        </button>
      </div>

      <div className="admin-tabs">
        <button className={`tab ${activeTab === 'terms' ? 'active' : ''}`} onClick={() => setActiveTab('terms')}>
          Terms Management
        </button>
        <button className={`tab ${activeTab === 'rosters' ? 'active' : ''}`} onClick={() => setActiveTab('rosters')}>
          Live Rosters & Waitlists
        </button>
        <button className={`tab ${activeTab === 'applications' ? 'active' : ''}`} onClick={() => setActiveTab('applications')}>
          Applications
          {applicationCounts.PENDING > 0 && (
            <span className="tab-count">{applicationCounts.PENDING}</span>
          )}
        </button>
        <button className={`tab ${activeTab === 'billing' ? 'active' : ''}`} onClick={() => setActiveTab('billing')}>
          Billing
        </button>
        <button className={`tab ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
          ✍️ Manual Registration
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'terms' && (
          <div className="terms-grid">
            {terms.map(term => (
              <div key={term.id} className="term-card glass-card">
                <div className="term-card-header">
                  <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '18px' }}>
                      {term.name}
                      <span className={`status-badge ${term.status.toLowerCase()}`}>{term.status}</span>
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: (!term.regularRate && !term.anchoredRate) ? '#dc2626' : 'var(--text-muted)' }}>
                      {(!term.regularRate && !term.anchoredRate)
                        ? '⚠ No rate set — registrations in this term will bill at $0'
                        : `Regular: $${Number(term.regularRate).toFixed(2)} · Anchored: $${Number(term.anchoredRate).toFixed(2)}`}
                    </p>
                  </div>
                  <button className="icon-btn" onClick={() => handleViewConfig(term)}><Settings size={18} /></button>
                </div>

                <div className="windows-timeline">
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">1</span></div>
                    <div className="step-details">
                      <h4>Early — Same Day</h4>
                      <p>Guaranteed spots for returning students</p>
                      <span className="date-range">{formatDateForDisplay(term.window1OpensAt)} to {formatDateForDisplay(term.window2OpensAt)}</span>
                    </div>
                  </div>
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">2</span></div>
                    <div className="step-details">
                      <h4>Public</h4>
                      <p>Open to everyone (Waitlists active)</p>
                      <span className="date-range">{formatDateForDisplay(term.window3OpensAt)} to {formatDateForDisplay(term.registrationCloses)}</span>
                    </div>
                  </div>
                </div>

                <div className="term-actions">
                  {!term.seeded ? (
                    <button className="btn-outline seed-btn" onClick={() => handleOpenSeedModal(term.id)}>
                      <Copy size={16} /> Seed Term (Create Holds)
                    </button>
                  ) : (
                    <div className="seeded-status">
                      <CheckCircle size={16} color="var(--primary)" /> Term Seeded
                    </div>
                  )}
                </div>
              </div>
            ))}
            {terms.length === 0 && (
              <div style={{ padding: '20px', color: 'var(--text-muted)' }}>No terms created yet. Create one to get started!</div>
            )}
          </div>
        )}

        {/* ── APPLICATIONS TAB ────────────────────────────────────────────── */}
        {activeTab === 'applications' && (
          <div className="applications-view">
            <div className="filters-bar glass-card">
              <select
                className="form-control"
                style={{ width: '200px' }}
                value={applicationFilter}
                onChange={(e) => { setApplicationFilter(e.target.value); loadApplications(e.target.value); }}
              >
                <option value="PENDING">Pending review</option>
                <option value="APPROVED">Approved</option>
                <option value="DECLINED">Declined</option>
                <option value="ALL">All</option>
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-outline" onClick={() => loadApplications()} disabled={applicationsLoading}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {!applicationsLoading && applications.length === 0 && (
              <div className="glass-card applications-empty">
                <Inbox size={36} style={{ opacity: 0.35 }} />
                <h3>Nothing waiting</h3>
                <p className="text-muted">
                  {applicationFilter === 'PENDING'
                    ? 'Every family that registered itself has been placed or declined.'
                    : 'No applications with this status.'}
                </p>
              </div>
            )}

            <div className="applications-list">
              {applications.map(app => (
                <div key={app.id} className="glass-card application-card">
                  <div className="application-head">
                    <div>
                      <h3 className="application-student">
                        {app.student.fullName}
                        {app.student.age != null && <span className="application-age">{app.student.age} yrs</span>}
                        {app.status !== 'PENDING' && (
                          <span className={`badge ${app.status === 'APPROVED' ? 'active' : 'danger'}`}>{app.status}</span>
                        )}
                      </h3>
                      <p className="text-muted application-family">
                        {app.family?.name} · applied {formatDateForDisplay(app.createdAt)}
                      </p>
                    </div>
                    {app.scholarship && <span className="badge pending application-scholarship">Step Up scholarship</span>}
                  </div>

                  <div className="application-parent">
                    <User size={14} className="text-muted" />
                    <span>{app.parent?.fullName}</span>
                    {app.parent?.email && (
                      <a className="application-contact" href={`mailto:${app.parent.email}`}>
                        <Mail size={13} /> {app.parent.email}
                      </a>
                    )}
                    {app.parent?.phone && (
                      <a className="application-contact" href={`tel:${app.parent.phone}`}>
                        <Phone size={13} /> {app.parent.phone}
                      </a>
                    )}
                  </div>

                  <div className="application-asks">
                    {app.interests.length > 0
                      ? app.interests.map(interest => (
                          <span key={interest} className="badge application-interest">{interestLabel(interest)}</span>
                        ))
                      : <span className="text-muted text-sm">No modality chosen</span>}
                    {app.ixlPlan !== 'NONE' && (
                      <span className="badge application-interest">
                        IXL {app.ixlPlan === 'CORE_SPANISH' ? 'Core + Spanish' : 'Core'}
                      </span>
                    )}
                  </div>

                  {/* Allergies and medical notes travel with the child from the
                      signup form; front desk needs them before the placement,
                      not after the first snack. */}
                  {(app.student.allergies || app.student.medicalNotes) && (
                    <div className="application-medical">
                      <AlertCircle size={14} />
                      <div>
                        {app.student.allergies && <p><strong>Allergies:</strong> {app.student.allergies}</p>}
                        {app.student.medicalNotes && <p><strong>Medical:</strong> {app.student.medicalNotes}</p>}
                      </div>
                    </div>
                  )}

                  {app.parentNotes && <p className="application-notes">“{app.parentNotes}”</p>}

                  {app.student.enrolledClassNames.length > 0 && app.status === 'PENDING' && (
                    <p className="manual-reg-warn">
                      ⚠️ Already on a roster ({app.student.enrolledClassNames.join(', ')}) — this application may have been handled without it.
                    </p>
                  )}

                  {app.status === 'PENDING' ? (
                    <div className="application-actions">
                      <button className="btn-primary" onClick={() => handlePlaceApplication(app)}>
                        <UserPlus size={15} /> Place in a class
                      </button>
                      <button
                        className="btn-outline reg-btn-danger"
                        onClick={() => setDeclineModal({ isOpen: true, application: app, staffNotes: '', submitting: false })}
                      >
                        <Ban size={15} /> Decline
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted application-reviewed">
                      {app.status === 'APPROVED' ? 'Placed' : 'Declined'}
                      {app.reviewedByName && ` by ${app.reviewedByName}`}
                      {app.reviewedAt && ` on ${formatDateForDisplay(app.reviewedAt)}`}
                      {app.staffNotes && ` — ${app.staffNotes}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MANUAL REGISTRATION TAB ─────────────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="manual-reg-view">
            {manualResult && (
              <div className="manual-reg-success glass-card">
                <CheckCircle size={28} color="var(--primary)" />
                <div>
                  <h3>Registration Complete</h3>
                  <p className="text-muted">
                    Status: <strong>{manualResult.result?.status?.replace(/_/g, ' ')}</strong>
                    {' · '}Class: <strong>{manualResult.result?.className}</strong>
                    {' · '}Email: <strong>{manualResult.emailSent ? '✅ Sent' : '⚠️ Not sent'}</strong>
                  </p>
                  {manualResult.applicationApproved && (
                    <p className="text-xs text-muted" style={{ margin: '4px 0 0' }}>
                      The application is approved and the student is now active.
                    </p>
                  )}
                </div>
                <button className="btn-outline" onClick={() => setManualResult(null)}>Register Another</button>
              </div>
            )}

            <div className="manual-reg-grid">
              {/* ── FORM ── */}
              <div className="glass-card manual-reg-form-card">
                <h2 className="manual-reg-title">Register on Behalf of a Parent</h2>
                <p className="text-muted manual-reg-subtitle">
                  Bypasses registration windows. Runs the full pricing engine and can send the billing confirmation email automatically.
                </p>

                {/* Preloaded from the Applications tab. Everything the parent
                    already told us is in the form; what stays visible here is
                    what the form has nowhere to put but staff still need while
                    choosing a class. */}
                {manualApplication && (
                  <div className="manual-reg-from-application">
                    <div className="manual-reg-from-application-head">
                      <Inbox size={16} />
                      <strong>Placing {manualApplication.student.fullName}</strong>
                      <span className="text-muted">from {manualApplication.family?.name}</span>
                      <button
                        type="button"
                        className="btn-text"
                        style={{ marginLeft: 'auto', fontSize: '12px' }}
                        onClick={() => { setActiveTab('applications'); }}
                      >
                        Back to queue
                      </button>
                    </div>
                    <p className="text-xs">
                      Asked for: <strong>{manualApplication.interests.length ? manualApplication.interests.map(interestLabel).join(', ') : 'no modality chosen'}</strong>
                      {manualApplication.scholarship && ' · Step Up scholarship'}
                    </p>
                    {manualApplication.parentNotes && (
                      <p className="text-xs application-notes" style={{ margin: 0 }}>“{manualApplication.parentNotes}”</p>
                    )}
                    <p className="text-xs text-muted" style={{ margin: 0 }}>
                      Completing this registration approves the application and activates the student.
                    </p>
                  </div>
                )}

                <form onSubmit={handleManualSubmit} className="reg-form">

                  {/* STUDENT SEARCH */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">1. Select Student</label>
                    <input
                      type="text"
                      className="form-control reg-input-full"
                      placeholder="Search by name..."
                      value={manualStudentSearch}
                      onChange={e => setManualStudentSearch(e.target.value)}
                    />
                    {/* Once a student is chosen the search box holds their name,
                        so an unguarded dropdown would sit there listing the
                        person already selected right below it. */}
                    {manualStudentSearch.length > 1 && !manualForm.studentId && (
                      <div className="manual-reg-student-list">
                        {allStudents
                          .filter(s => s.fullName.toLowerCase().includes(manualStudentSearch.toLowerCase()))
                          .map(s => (
                            <button
                              key={s.id}
                              type="button"
                              className={`manual-reg-student-item ${manualForm.studentId === s.id ? 'selected' : ''}`}
                              onClick={() => selectManualStudent(s)}
                            >
                              <div className="reg-search-avatar">{s.fullName.split(' ').map(n => n[0]).join('').substring(0,2)}</div>
                              <span>{s.fullName}</span>
                              {manualForm.studentId === s.id && <CheckCircle size={16} color="var(--primary)" />}
                            </button>
                          ))
                        }
                      </div>
                    )}
                    {manualForm.studentId && (
                      <div className="manual-reg-selected-badge">
                        <CheckCircle size={14} color="var(--primary)" />
                        {manualStudentName || allStudents.find(s => s.id === manualForm.studentId)?.fullName}
                        <button type="button" className="btn-text" style={{ marginLeft: 'auto', fontSize: '12px' }}
                          onClick={() => selectManualStudent(null)}>
                          Change
                        </button>
                      </div>
                    )}
                  </div>

                  {/* TERM */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">2. Term</label>
                    <select
                      className="form-control reg-input-full"
                      value={manualForm.termId}
                      onChange={e => handleManualTermChange(e.target.value)}
                      required
                    >
                      <option value="">— Select a term —</option>
                      {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>

                  {/* FIRST CHOICE CLASS */}
                  {manualForm.termId && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">3. First Choice Class</label>
                      <select
                        className="form-control reg-input-full"
                        value={manualForm.firstChoiceClassId}
                        onChange={e => updateManualForm({ firstChoiceClassId: e.target.value, secondChoiceClassId: '' })}
                        required
                      >
                        <option value="">— Select a class —</option>
                        {manualTermClasses.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.enrolled}/{c.capacity} enrolled{c.enrolled >= c.capacity ? ' · FULL' : ''})
                          </option>
                        ))}
                      </select>
                      {manualForm.firstChoiceClassId && (() => {
                        const cls = manualTermClasses.find(c => c.id === manualForm.firstChoiceClassId);
                        const isFull = cls && cls.enrolled >= cls.capacity;
                        return isFull ? (
                          <p className="manual-reg-warn">⚠️ This class is full. The student will be added to the waitlist.</p>
                        ) : null;
                      })()}
                    </div>
                  )}

                  {/* SECOND CHOICE CLASS */}
                  {manualForm.firstChoiceClassId && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">4. Second Choice Class <span className="text-muted">(optional — backup if first is full)</span></label>
                      <select
                        className="form-control reg-input-full"
                        value={manualForm.secondChoiceClassId}
                        onChange={e => updateManualForm({ secondChoiceClassId: e.target.value })}
                      >
                        <option value="">— None —</option>
                        {manualTermClasses
                          .filter(c => c.id !== manualForm.firstChoiceClassId)
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.enrolled}/{c.capacity})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {/* ELECTIVES */}
                  {manualTermElectives.length > 0 && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">5. Electives <span className="text-muted">(each $130)</span></label>
                      <div className="manual-reg-electives">
                        {manualTermElectives.map(e => (
                          <button
                            key={e.id}
                            type="button"
                            className={`badge manual-reg-elective-btn ${manualForm.electiveIds.includes(e.id) ? 'active' : ''}`}
                            onClick={() => handleManualElectiveToggle(e.id)}
                          >
                            {e.name} — ${Number(e.price || 130).toFixed(0)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* IXL PLAN */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">{manualTermElectives.length > 0 ? '6.' : '5.'} IXL Plan</label>
                    <div className="manual-reg-ixl-options">
                      {[{ value: 'NONE', label: 'None', price: '$0' }, { value: 'CORE', label: 'Core', price: '+$5/mo' }, { value: 'CORE_SPANISH', label: 'Core + Spanish', price: '+$10/mo' }].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`manual-reg-ixl-btn ${manualForm.ixlPlan === opt.value ? 'selected' : ''}`}
                          onClick={() => updateManualForm({ ixlPlan: opt.value })}
                        >
                          <span>{opt.label}</span>
                          <span className="manual-reg-ixl-price">{opt.price}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* EMAIL TOGGLE */}
                  <div className="manual-reg-section">
                    <label className="manual-reg-email-toggle">
                      <input
                        type="checkbox"
                        checked={!manualForm.skipEmail}
                        onChange={e => updateManualForm({ skipEmail: !e.target.checked })}
                      />
                      <span>Send billing confirmation email to parent</span>
                    </label>
                  </div>

                  <div className="reg-form-actions" style={{ marginTop: '8px' }}>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={manualSubmitting || !manualForm.termId || !manualForm.studentId || !manualForm.firstChoiceClassId}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      {manualSubmitting ? 'Processing...' : '✍️ Complete Manual Registration'}
                    </button>
                  </div>
                </form>
              </div>

              {/* ── BILLING PREVIEW ── */}
              <div className="glass-card manual-reg-preview-card">
                <h3 className="manual-reg-preview-title">Billing Preview</h3>
                {manualPreview ? (
                  <div className="manual-reg-preview-content">
                    <div className="manual-reg-preview-row">
                      <span>Base Rate</span>
                      <span>${manualPreview.baseRate.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row">
                      <span>Electives</span>
                      <span>${manualPreview.electivesTotal.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row">
                      <span>IXL ({manualForm.ixlPlan})</span>
                      <span>${manualPreview.ixlTotal.toFixed(2)}/mo</span>
                    </div>
                    <div className="manual-reg-preview-divider" />
                    <div className="manual-reg-preview-row total">
                      <span>Total Quarterly</span>
                      <span>${manualPreview.totalQuarterly.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row deposit">
                      <span>15% Deposit</span>
                      <span>${manualPreview.depositAmount.toFixed(2)}</span>
                    </div>
                    <p className="manual-reg-preview-note">These amounts will be saved to the student's registration record and included in the billing email.</p>
                  </div>
                ) : (
                  <div className="manual-reg-preview-empty">
                    <Users size={32} style={{ opacity: 0.3 }} />
                    <p>Select a student, term, and class to see the billing breakdown.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && !selectedCove && (
          <div className="rosters-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }} value={selectedTermForRoster} onChange={(e) => setSelectedTermForRoster(e.target.value)}>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-primary" style={{ marginRight: '12px' }} onClick={() => handleOpenCoveModal()}>
                <Plus size={14} /> New Class
              </button>
              <input
                type="text"
                placeholder="Search by class name..."
                className="form-control"
                style={{ width: '250px' }}
                value={rosterSearchQuery}
                onChange={(e) => setRosterSearchQuery(e.target.value)}
              />
            </div>

            <div className="rosters-table-container glass-card">
              <table className="rosters-table">
                <thead>
                  <tr>
                    <th>Class / Cove Day</th>
                    <th>Teacher</th>
                    <th>Enrolled</th>
                    <th>Priority Holds</th>
                    <th>Waitlist</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterSearchQuery && coves.length > 0 && coves.filter(cove => cove.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())).length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No classes match "{rosterSearchQuery}".</td></tr>
                  )}
                  {coves.filter(cove => cove.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())).map(cove => {
                    const totalOccupied = cove.enrolled + cove.holds;
                    const isFull = totalOccupied >= cove.capacity;
                    const canPromoteWaitlist = !isFull && cove.waitlist > 0;
                    const enrolledPercent = (cove.enrolled / cove.capacity) * 100;
                    const holdsPercent = (cove.holds / cove.capacity) * 100;

                    return (
                      <tr key={cove.id}>
                        <td className="font-semibold">{cove.name}</td>
                        <td>
                          {cove.teacherName
                            ? <span className="text-sm">{cove.teacherName}</span>
                            : <span className="badge pending">Unassigned</span>}
                        </td>
                        <td>
                          <div className="progress-bar-container">
                            <div className="progress-fill active" style={{ width: `${enrolledPercent}%` }}></div>
                            <div className="progress-fill holds" style={{ width: `${holdsPercent}%` }}></div>
                          </div>
                          <div className="capacity-labels">
                            <span className="text-sm mt-1 block">{totalOccupied} / {cove.capacity} Reserved</span>
                            {isFull && <span className="text-xs text-muted block">(At Capacity)</span>}
                          </div>
                        </td>
                        <td>
                          {cove.holds > 0 ? (
                            <span className="badge pending">{cove.holds} unclaimed</span>
                          ) : (
                            <span className="text-muted text-sm">0</span>
                          )}
                        </td>
                        <td>
                          {cove.waitlist > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <span className="badge danger">{cove.waitlist} waiting</span>
                              {canPromoteWaitlist && (
                                <span className="action-required-alert">Promote Waitlist!</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted text-sm">Empty</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn-text" onClick={() => setSelectedCove(cove.id)}>Manage Class</button>
                            <button className="icon-btn" style={{ padding: '4px' }} onClick={() => handleOpenCoveModal(cove)} title="Edit Class Details"><Settings size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {coves.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No classes found for this term.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="electives-panel glass-card">
              <div className="electives-panel-head">
                <h3>Electives</h3>
                <span className="reg-form-hint">
                  Add-ons a family can pick on top of their class. Each one is charged on
                  the registration total for this term.
                </span>
              </div>

              {termElectives.length > 0 ? (
                <ul className="electives-list">
                  {termElectives.map(el => (
                    <li key={el.id} className={electiveForm.id === el.id ? 'editing' : ''}>
                      <span className="elective-name">{el.name}</span>
                      <span className="elective-price">${Number(el.price).toFixed(2)}</span>
                      <button type="button" className="btn-text"
                        onClick={() => setElectiveForm({ id: el.id, name: el.name, price: String(el.price) })}>
                        Edit
                      </button>
                      <button type="button" className="btn-text elective-delete"
                        onClick={() => handleDeleteElective(el)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted text-sm electives-empty">
                  {selectedTermForRoster ? 'No electives for this term yet.' : 'Pick a term first.'}
                </p>
              )}

              <form className="electives-form" onSubmit={handleSaveElective}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Elective name — e.g. Art, Chess, Spanish"
                  value={electiveForm.name}
                  onChange={(e) => setElectiveForm({ ...electiveForm, name: e.target.value })}
                  disabled={!selectedTermForRoster}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="form-control electives-price-input"
                  placeholder="130.00"
                  value={electiveForm.price}
                  onChange={(e) => setElectiveForm({ ...electiveForm, price: e.target.value })}
                  disabled={!selectedTermForRoster}
                />
                <button type="submit" className="btn-primary"
                  disabled={!selectedTermForRoster || electiveSaving || !electiveForm.name.trim()}>
                  {electiveForm.id ? 'Save' : <><Plus size={14} /> Add</>}
                </button>
                {electiveForm.id && (
                  <button type="button" className="btn-text"
                    onClick={() => setElectiveForm({ id: null, name: '', price: '' })}>
                    Cancel
                  </button>
                )}
              </form>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && selectedCove && (
          <div className="roster-detail-view">
            <div className="detail-header">
              <button className="btn-text reg-back-btn" onClick={() => setSelectedCove(null)}>← Back to All Rosters</button>
              <div className="detail-title-row">
                <div>
                  <h2>{coves.find(p => p.id === selectedCove)?.name}</h2>
                  <p className="text-muted">Term: {terms.find(t => t.id === selectedTermForRoster)?.name}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-primary" onClick={() => { setScheduleMode('recurring'); setShowScheduleModal(true); }}>
                    <Calendar size={16} /> Schedule Sessions
                  </button>
                  <button className="btn-outline" onClick={() => handleOpenCoveModal(coves.find(p => p.id === selectedCove))}>
                    <Settings size={16} /> Class Settings
                  </button>
                </div>
              </div>
            </div>

            {/* What's on the timetable for this class, folded into its repeating
                series — so a class booked at the wrong hour for a whole
                semester is one edit, not one per week on the calendar. */}
            <div className="roster-card glass-card reg-series-card">
              <div className="reg-roster-card-head">
                <h3>Scheduled Sessions ({classSessions.filter(s => s.status !== 'CANCELLED').length})</h3>
                <button className="btn-outline reg-btn-sm" onClick={() => loadClassSessions(selectedCove)} disabled={classSessionsLoading}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {classSessionsLoading ? (
                <p className="text-muted" style={{ fontSize: 13 }}>Loading sessions…</p>
              ) : sessionSeries.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>
                  Nothing scheduled yet. Use <strong>Schedule Sessions</strong> above to put this class on the calendar.
                </p>
              ) : (
                <ul className="reg-series-list">
                  {sessionSeries.map(series => {
                    const editing = seriesEdit?.key === series.key;
                    const expanded = expandedSeries === series.key;
                    return (
                      <li key={series.key} className="reg-series-item">
                        <div className="reg-series-row">
                          <div className="reg-series-when">
                            <Clock size={15} className="text-muted" />
                            <div>
                              <strong>{WEEKDAY_NAMES[series.weekday]}s · {prettyTime(series.startTime)} – {prettyTime(series.endTime)}</strong>
                              <p className="text-xs text-muted" style={{ margin: 0 }}>
                                {series.sessions.length} date{series.sessions.length === 1 ? '' : 's'} ({formatDateOnlyForDisplay(series.first)} – {formatDateOnlyForDisplay(series.last)})
                                {' · '}{series.upcoming} upcoming
                                {series.cancelled > 0 && ` · ${series.cancelled} cancelled`}
                              </p>
                            </div>
                          </div>

                          {!editing && (
                            <div className="reg-row-actions">
                              <button className="btn-text reg-btn-sm" onClick={() => startSeriesEdit(series)}>
                                <Pencil size={13} /> Change time
                              </button>
                              <button className="btn-text reg-btn-sm" onClick={() => setExpandedSeries(expanded ? null : series.key)}>
                                <Calendar size={13} /> {expanded ? 'Hide dates' : 'View dates'}
                              </button>
                              {series.upcoming > 0 && (
                                <button className="btn-text reg-btn-sm reg-btn-danger" onClick={() => handleCancelSeries(series)}>
                                  <Ban size={13} /> Cancel series
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {editing && (
                          <div className="reg-series-edit">
                            <div className="reg-series-times">
                              <input
                                type="time"
                                className="form-control"
                                value={seriesEdit.startTime}
                                onChange={(e) => setSeriesEdit({ ...seriesEdit, startTime: e.target.value })}
                                title="New start time"
                              />
                              <span className="text-muted">to</span>
                              <input
                                type="time"
                                className="form-control"
                                value={seriesEdit.endTime}
                                onChange={(e) => setSeriesEdit({ ...seriesEdit, endTime: e.target.value })}
                                title="New end time"
                              />
                            </div>
                            <div className="reg-series-scope">
                              <label>
                                <input
                                  type="radio"
                                  name="series-scope"
                                  checked={seriesEdit.scope === 'upcoming'}
                                  onChange={() => setSeriesEdit({ ...seriesEdit, scope: 'upcoming' })}
                                />
                                Upcoming dates only
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name="series-scope"
                                  checked={seriesEdit.scope === 'all'}
                                  onChange={() => setSeriesEdit({ ...seriesEdit, scope: 'all' })}
                                />
                                Every date in the series, past ones included
                              </label>
                            </div>
                            <div className="reg-series-edit-actions">
                              <button className="btn-text" onClick={() => setSeriesEdit(null)} disabled={seriesSaving}>Cancel</button>
                              <button className="btn-primary reg-btn-sm" onClick={() => handleSaveSeriesTime(series)} disabled={seriesSaving}>
                                {seriesSaving ? 'Saving…' : 'Apply new time'}
                              </button>
                            </div>
                          </div>
                        )}

                        {expanded && (
                          <ul className="reg-series-dates">
                            {series.sessions.map(s => (
                              <li key={s.id} className={s.status === 'CANCELLED' ? 'is-cancelled' : ''}>
                                <span>{formatDateOnlyForDisplay(s.date)}</span>
                                <span className="text-muted">{prettyTime(s.startTime)} – {prettyTime(s.endTime)}</span>
                                {s.status === 'CANCELLED' ? (
                                  <span className="badge">Cancelled</span>
                                ) : (
                                  <button className="btn-text reg-btn-sm reg-btn-danger" onClick={() => handleCancelOneSession(s)}>
                                    <Ban size={12} /> Cancel
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="roster-sections-grid">
              <div className="roster-card glass-card">
                <div className="reg-roster-card-head">
                  <h3>Active Roster ({rosterDetails.active?.length || 0})</h3>
                  <button className="btn-outline reg-btn-sm" onClick={() => setShowAddStudentModal(true)}>
                    <Plus size={14} /> Add Student
                  </button>
                </div>
                <ul className="student-list">
                  {(rosterDetails.active || []).map(student => (
                    <li key={student.id}>
                      <div className="student-info">
                        <User size={16} className="text-muted" />
                        <span>{student.name}</span>
                      </div>
                      <div className="reg-row-actions">
                        <button className="btn-text reg-btn-sm" title="Move to priority holds" onClick={() => handleMoveRosterStudent(student.id, 'hold')}>
                          <Clock size={13} /> Hold
                        </button>
                        <button className="btn-text reg-btn-sm" title="Move to waitlist" onClick={() => handleMoveRosterStudent(student.id, 'waitlist')}>
                          <Users size={13} /> Waitlist
                        </button>
                        <button className="btn-text reg-btn-sm reg-btn-danger" title="Unenroll from this class" onClick={() => handleRemoveFromRoster(student.id, student.name)}>
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card">
                <div className="reg-roster-card-head">
                  <h3>Unclaimed Priority Holds ({rosterDetails.holds?.length || 0})</h3>
                </div>
                {(rosterDetails.holds?.length || 0) > 0 && (
                  <div className="reg-roster-actions">
                    <button className="btn-outline reg-btn-sm" onClick={() => handleRemindAllHolds(selectedCove)}>
                      <Mail size={14} /> Remind All
                    </button>
                    <button className="btn-outline reg-btn-sm reg-btn-danger" onClick={() => handleSweepHolds(selectedCove)}>
                      <Trash2 size={14} /> Sweep Expired
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted mb-4">These spots are reserved until the end of the Early window.</p>
                <ul className="student-list">
                  {(rosterDetails.holds || []).map(student => (
                    <li key={student.id}>
                      <div className="student-info">
                        <Clock size={16} className="text-warning" />
                        <span>{student.name}</span>
                      </div>
                      <div className="reg-row-actions">
                        <button className="btn-text reg-btn-sm" title="Move to waitlist" onClick={() => handleMoveRosterStudent(student.id, 'waitlist')}>
                          <Users size={13} /> Waitlist
                        </button>
                        <button className="btn-text reg-btn-sm" onClick={() => handleRevokeHold(student.id)}>Revoke Hold</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card waitlist-card">
                <div className="reg-roster-card-head">
                  <h3>Waitlist Queue ({rosterDetails.waitlist?.length || 0})</h3>
                  {(rosterDetails.waitlist?.length || 0) > 0 && (
                    <button className="btn-outline reg-btn-sm" onClick={handleForcePromote}>
                      Promote Next
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted mb-4">Promotions happen automatically when seats open.</p>
                <ul className="student-list ordered">
                  {(rosterDetails.waitlist || []).map((student, idx) => (
                    <li key={student.id}>
                      <div className="student-info">
                        <span className="queue-num">{idx + 1}</span>
                        <div>
                          <span>{student.name}</span>
                          <p className="text-xs text-muted" style={{ margin: 0 }}>Requested: {formatDateForDisplay(student.requestedAt)}</p>
                        </div>
                      </div>
                      <div className="reg-row-actions">
                        <button className="btn-text reg-btn-sm" title="Move to priority holds" onClick={() => handleMoveRosterStudent(student.id, 'hold')}>
                          <Clock size={13} /> Hold
                        </button>
                        <button className="btn-text reg-btn-sm reg-btn-danger" title="Remove (added by mistake)" onClick={() => handleRemoveFromWaitlist(student.id, student.name)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="billing-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }} value={selectedTermForRoster} onChange={(e) => setSelectedTermForRoster(e.target.value)}>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-outline" onClick={loadBillingSummary} disabled={billingLoading}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {/* Quarterly tuition. A term is billed twice at the same rate, and
                the amounts come off the roster as it stands right now — which
                is what makes a drop or a class switch come out right. */}
            <div className="glass-card quarter-charge-panel">
              <div className="qc-head">
                <div>
                  <h3>Quarterly tuition</h3>
                  <p className="text-muted text-xs" style={{ margin: '4px 0 0' }}>
                    Charges are worked out from who is enrolled <strong>today</strong>. Make sure drops and
                    class changes are recorded before you raise them.
                  </p>
                </div>
                <div className="qc-controls">
                  <select className="form-control" value={quarterToBill} onChange={(e) => { setQuarterToBill(Number(e.target.value)); setQuarterPreview(null); }}>
                    <option value={1}>Quarter 1</option>
                    <option value={2}>Quarter 2</option>
                  </select>
                  <label className="qc-check">
                    <input
                      type="checkbox"
                      checked={creditDeposit}
                      onChange={(e) => { setCreditDeposit(e.target.checked); setQuarterPreview(null); }}
                      disabled={quarterToBill !== 1}
                    />
                    <span>Deduct the deposit already paid</span>
                  </label>
                  <button className="btn-outline" onClick={loadQuarterPreview} disabled={quarterLoading || !selectedTermForRoster}>
                    {quarterLoading ? 'Working…' : 'Preview charges'}
                  </button>
                </div>
              </div>

              {quarterPreview && (
                <>
                  <div className="qc-summary">
                    <span><strong>{quarterPreview.summary.billable}</strong> to charge</span>
                    <span className="qc-total">${quarterPreview.summary.total.toFixed(2)}</span>
                    {quarterPreview.summary.alreadyCharged > 0 && (
                      <span className="badge active">{quarterPreview.summary.alreadyCharged} already charged</span>
                    )}
                    {quarterPreview.summary.missingFamily > 0 && (
                      <span className="badge danger">{quarterPreview.summary.missingFamily} without a family</span>
                    )}
                  </div>

                  {quarterPreview.lines.length === 0 ? (
                    <p className="text-muted reg-search-empty">No active enrolments in this term yet.</p>
                  ) : (
                    <table className="data-table qc-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Enrolled in</th>
                          <th>Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quarterPreview.lines.map(l => (
                          <tr key={l.studentId} className={l.alreadyCharged || l.missingFamily ? 'qc-row-muted' : ''}>
                            <td className="font-semibold">{l.studentName}</td>
                            <td className="text-sm">
                              {l.classes.map(c => c.name).join(', ')}
                              {l.electivesTotal > 0 && ` · electives $${l.electivesTotal.toFixed(2)}`}
                              {l.ixlTotal > 0 && ` · IXL $${l.ixlTotal.toFixed(2)}`}
                            </td>
                            <td>
                              ${l.amount.toFixed(2)}
                              {l.depositCredit > 0 && (
                                <span className="text-xs text-muted"> (−${l.depositCredit.toFixed(2)} deposit)</span>
                              )}
                            </td>
                            <td>
                              {l.alreadyCharged
                                ? <span className="badge active">Charged ${Number(l.chargedAmount).toFixed(2)}</span>
                                : l.missingFamily
                                  ? <span className="badge danger">No family on file</span>
                                  : <span className="badge pending">To charge</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="qc-actions">
                    <button
                      className="btn-primary"
                      disabled={quarterLoading || quarterPreview.summary.billable === 0}
                      onClick={handleGenerateQuarterCharges}
                    >
                      Raise {quarterPreview.summary.billable} charge{quarterPreview.summary.billable === 1 ? '' : 's'} (${quarterPreview.summary.total.toFixed(2)})
                    </button>
                    <span className="text-xs text-muted">
                      Adds them to each family&apos;s ledger. Already-charged students are skipped, so this is safe to repeat.
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="rosters-table-container glass-card">
              <table className="rosters-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class / Group</th>
                    <th>Electives</th>
                    <th>IXL</th>
                    <th>Total / Deposit</th>
                    <th>Deposit Due</th>
                    <th>Email Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {billingRequests.map(r => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.studentName}</td>
                      <td>{r.className} <span className="text-xs text-muted">({r.groupType})</span></td>
                      <td>{r.electiveNames.length ? r.electiveNames.join(', ') : '—'}</td>
                      <td>{r.ixlPlan === 'NONE' ? '—' : r.ixlPlan}</td>
                      <td>
                        <div>${r.totalQuarterly.toFixed(2)}</div>
                        <div className="text-xs text-muted">Deposit: ${r.depositAmount.toFixed(2)}</div>
                      </td>
                      <td>{r.depositDueDate ? formatDateOnlyForDisplay(r.depositDueDate) : '—'}</td>
                      <td>
                        {r.emailStatus === 'SENT' && <span className="badge active"><CheckCircle size={12} /> Sent</span>}
                        {r.emailStatus === 'FAILED' && <span className="badge danger"><AlertCircle size={12} /> Failed</span>}
                        {r.emailStatus === 'PENDING' && <span className="badge pending"><Clock size={12} /> Pending</span>}
                      </td>
                      <td>
                        <button
                          className="btn-text"
                          disabled={resendingId === r.id}
                          onClick={() => handleResendEmail(r.id)}
                        >
                          <Mail size={14} /> {resendingId === r.id ? 'Sending...' : 'Resend'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!billingLoading && billingRequests.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No registration requests for this term yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Edit Term Modal */}
      {editTermModal && editTermForm && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Edit Term Configuration</h2>
              <button className="icon-btn" onClick={() => setEditTermModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUpdateTerm} className="new-term-form reg-form">
              <div>
                <label className="reg-form-label">Term Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  value={editTermForm.name}
                  onChange={(e) => setEditTermForm({...editTermForm, name: e.target.value})}
                />
              </div>

              <div className="reg-window-box">
                <h4>Window 1: Early (Same Day)</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayStart} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayStart: e.target.value})} />
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayEnd} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Window 2: Public</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={editTermForm.publicStart} onChange={(e) => setEditTermForm({...editTermForm, publicStart: e.target.value})} />
                  <input type="date" required className="form-control" value={editTermForm.publicEnd} onChange={(e) => setEditTermForm({...editTermForm, publicEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Pricing</h4>
                <div className="reg-date-row">
                  <div>
                    <label className="reg-form-label">Regular Rate ($/quarter)</label>
                    <input type="number" min="0" step="0.01" required className="form-control" value={editTermForm.regularRate} onChange={(e) => setEditTermForm({...editTermForm, regularRate: e.target.value})} />
                  </div>
                  <div>
                    <label className="reg-form-label">Anchored Rate ($/quarter)</label>
                    <input type="number" min="0" step="0.01" required className="form-control" value={editTermForm.anchoredRate} onChange={(e) => setEditTermForm({...editTermForm, anchoredRate: e.target.value})} />
                  </div>
                </div>
                <div className="reg-date-row">
                  <div>
                    <label className="reg-form-label">Deposit Due Date (optional)</label>
                    <input type="date" className="form-control" value={editTermForm.depositDueDate} onChange={(e) => setEditTermForm({...editTermForm, depositDueDate: e.target.value})} />
                  </div>
                  <div>
                    <label className="reg-form-label">Second Quarter Starts</label>
                    <input type="date" className="form-control" value={editTermForm.quarter2StartsAt} onChange={(e) => setEditTermForm({...editTermForm, quarter2StartsAt: e.target.value})} />
                  </div>
                </div>
                <span className="reg-form-hint">
                  The rates above are per quarter, and a term is billed twice. The second date is when
                  that second round is due — raise it from Billing → Quarterly tuition.
                </span>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setEditTermModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Term Modal */}
      {showNewTermModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Create New Term</h2>
              <button className="icon-btn" onClick={() => setShowNewTermModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateTerm} className="new-term-form reg-form">
              <div>
                <label className="reg-form-label">Term Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  placeholder="e.g. Fall 2026"
                  value={newTermForm.name}
                  onChange={(e) => setNewTermForm({...newTermForm, name: e.target.value})}
                />
              </div>

              {/* Window 1 admits only students holding a priority spot, and those
                  are seeded from an earlier term's rosters. With no earlier term
                  there is nothing to seed, so Window 1 stays shut for everyone —
                  worth saying out loud, because the dates alone suggest otherwise. */}
              {terms.length === 0 && (
                <div className="reg-first-term-warn">
                  <AlertCircle size={18} />
                  <div>
                    <strong>First term: Window 1 will be closed to everyone.</strong>
                    <p>
                      Window 1 only lets in students who already hold a priority spot, and those are
                      carried over from a previous term's rosters. There is no previous term yet, so
                      nobody qualifies and families will see registration locked until Window 1 ends
                      {newTermForm.earlySameDayEnd && <> on <strong>{formatDateOnlyForDisplay(newTermForm.earlySameDayEnd)}</strong></>}.
                      Set that end date to the day you actually want families to be able to register,
                      or register them yourself from the Manual Registration tab, which skips the
                      windows entirely.
                    </p>
                  </div>
                </div>
              )}

              <div className="reg-window-box">
                <h4>Window 1: Early (Same Day)</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayStart} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayStart: e.target.value})} />
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayEnd} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Window 2: Public</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={newTermForm.publicStart} onChange={(e) => setNewTermForm({...newTermForm, publicStart: e.target.value})} />
                  <input type="date" required className="form-control" value={newTermForm.publicEnd} onChange={(e) => setNewTermForm({...newTermForm, publicEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Pricing</h4>
                <div className="reg-date-row">
                  <div>
                    <label className="reg-form-label">Regular Rate ($/quarter)</label>
                    <input type="number" min="0" step="0.01" required className="form-control" placeholder="e.g. 900" value={newTermForm.regularRate} onChange={(e) => setNewTermForm({...newTermForm, regularRate: e.target.value})} />
                  </div>
                  <div>
                    <label className="reg-form-label">Anchored Rate ($/quarter)</label>
                    <input type="number" min="0" step="0.01" required className="form-control" placeholder="e.g. 750" value={newTermForm.anchoredRate} onChange={(e) => setNewTermForm({...newTermForm, anchoredRate: e.target.value})} />
                  </div>
                </div>
                <div>
                  <label className="reg-form-label">Deposit Due Date (optional)</label>
                  <input type="date" className="form-control" value={newTermForm.depositDueDate} onChange={(e) => setNewTermForm({...newTermForm, depositDueDate: e.target.value})} />
                </div>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setShowNewTermModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Term</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Seed Term Modal */}
      {seedModal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-md">
            <div className="registration-modal-header">
              <h2>Seed Term Data</h2>
              <button className="icon-btn" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body reg-modal-body">
              <p className="text-muted reg-modal-text">
                This action will analyze the rosters of a past/current term and automatically generate <strong>Priority Holds (Guaranteed Spots)</strong> for all active students in the new term.
              </p>

              {terms.filter(t => t.id !== seedModal.targetTermId).length > 0 ? (
                <div className="form-group">
                  <label className="reg-label-strong">Source Term to Copy From:</label>
                  <select
                    className="form-control reg-input-full"
                    value={seedModal.sourceTermId}
                    onChange={(e) => setSeedModal({...seedModal, sourceTermId: e.target.value})}
                    style={{ marginBottom: '24px' }}
                  >
                    {terms.filter(t => t.id !== seedModal.targetTermId).map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="form-group" style={{ marginBottom: '24px', color: '#b91c1c' }}>
                  No past terms available to copy from.
                </div>
              )}

              <div className="reg-form-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn-text" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })}>Cancel</button>
                <button type="button" className="btn-primary" onClick={handleConfirmSeed} disabled={terms.filter(t => t.id !== seedModal.targetTermId).length === 0}>
                  <Copy size={16} /> Generate Priority Holds
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Sessions Modal */}
      {showScheduleModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Schedule Sessions</h2>
              <button type="button" className="icon-btn" onClick={() => setShowScheduleModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleScheduleSessions} className="reg-form">
              <div className="reg-schedule-mode-toggle">
                <button
                  type="button"
                  className={`badge ${scheduleMode === 'recurring' ? 'active' : ''}`}
                  style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                  onClick={() => setScheduleMode('recurring')}
                >
                  Recurring (weekdays)
                </button>
                <button
                  type="button"
                  className={`badge ${scheduleMode === 'single' ? 'active' : ''}`}
                  style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                  onClick={() => setScheduleMode('single')}
                >
                  Single date
                </button>
              </div>

              {scheduleMode === 'single' ? (
                <p className="text-muted" style={{ marginTop: 0 }}>
                  Creates one real session for <strong>{coves.find(p => p.id === selectedCove)?.name}</strong> on a specific date.
                </p>
              ) : (
                <p className="text-muted" style={{ marginTop: 0 }}>
                  Creates real sessions for <strong>{coves.find(p => p.id === selectedCove)?.name}</strong> on the chosen weekdays, within the date range. Re-running this for the same dates won't create duplicates.
                </p>
              )}

              {scheduleMode === 'single' ? (
                <div>
                  <label className="reg-form-label">Date</label>
                  <input type="date" required className="form-control" value={scheduleForm.startDate}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })} />
                </div>
              ) : (
                <div className="reg-date-row">
                  <div>
                    <label className="reg-form-label">Start Date</label>
                    <input type="date" required className="form-control" value={scheduleForm.startDate}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="reg-form-label">End Date</label>
                    <input type="date" required className="form-control" value={scheduleForm.endDate}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })} />
                  </div>
                </div>
              )}

              {scheduleMode === 'recurring' && (
                <div>
                  <label className="reg-form-label">Repeat on</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {WEEKDAY_OPTIONS.map(w => (
                      <button
                        key={w.value}
                        type="button"
                        className={`badge ${scheduleForm.weekdays.includes(w.value) ? 'active' : ''}`}
                        style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                        onClick={() => toggleScheduleWeekday(w.value)}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="reg-date-row">
                <div>
                  <label className="reg-form-label">Start Time</label>
                  <input type="time" required className="form-control" value={scheduleForm.startTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} />
                </div>
                <div>
                  <label className="reg-form-label">End Time</label>
                  <input type="time" required className="form-control" value={scheduleForm.endTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} />
                </div>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setShowScheduleModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={scheduling || !scheduleForm.startDate || (scheduleMode === 'recurring' && (scheduleForm.weekdays.length === 0 || !scheduleForm.endDate))}
                >
                  {scheduling ? 'Scheduling...' : scheduleMode === 'single' ? 'Schedule Session' : 'Schedule Sessions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New/Edit Cove Modal */}
      {showCoveModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>{editingCove ? 'Edit Class Details' : 'Create New Class'}</h2>
              <button type="button" className="icon-btn" onClick={() => setShowCoveModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveCove} className="reg-form">
              <div>
                <label className="reg-form-label">Class / Cove Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  placeholder="e.g. Maker Studio Monday"
                  value={coveForm.name}
                  onChange={(e) => setCoveForm({...coveForm, name: e.target.value})}
                />
              </div>

              <div>
                <label className="reg-form-label">Capacity</label>
                <input
                  type="number"
                  className="form-control reg-input-full"
                  required
                  value={coveForm.capacity}
                  onChange={(e) => setCoveForm({...coveForm, capacity: e.target.value})}
                />
              </div>

              <div>
                <label className="reg-form-label">Teacher</label>
                <select
                  className="form-control reg-input-full"
                  value={coveForm.teacherId}
                  onChange={(e) => setCoveForm({...coveForm, teacherId: e.target.value})}
                >
                  <option value="">Unassigned</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.fullName}</option>
                  ))}
                </select>
                <AddSelfAsTeacher
                  teacherIds={teachers.map(t => t.id)}
                  onAdded={async (userId) => {
                    await loadTeachers();
                    setCoveForm(prev => ({ ...prev, teacherId: userId }));
                  }}
                  onError={(message) => showAlert(message, 'Error', 'warning')}
                />
                <p className="reg-form-hint">
                  The class only appears on this teacher&apos;s portal and calendar. Left
                  unassigned, it shows on nobody&apos;s.
                </p>
              </div>

              <div>
                <label className="reg-form-label">Pricing group</label>
                <select
                  className="form-control reg-input-full"
                  value={coveForm.groupType}
                  onChange={(e) => setCoveForm({...coveForm, groupType: e.target.value})}
                >
                  <option value="REGULAR">Regular — uses the term&apos;s regular rate</option>
                  <option value="ANCHORED">Anchored — uses the term&apos;s anchored rate</option>
                </select>
              </div>

              <div>
                <label className="reg-form-label">Own price (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="form-control reg-input-full"
                  placeholder="Leave empty to use the term rate"
                  value={coveForm.priceOverride}
                  onChange={(e) => setCoveForm({...coveForm, priceOverride: e.target.value})}
                />
                <span className="reg-form-hint">
                  For classes priced on their own rather than by the term — Biology, Algebra&nbsp;1,
                  the 8th grade programme. When set it replaces the pricing group above.
                </span>
              </div>

              <div>
                <label className="reg-form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Play size={14} color="#0ea5e9" /> Zoom / Meeting Link
                </label>
                <input
                  type="url"
                  className="form-control reg-input-full"
                  placeholder="https://zoom.us/j/..."
                  value={coveForm.meetingUrl}
                  onChange={(e) => setCoveForm({...coveForm, meetingUrl: e.target.value})}
                />
                <p className="text-xs text-muted" style={{ marginTop: '4px' }}>This link will be visible to students in their dashboard.</p>
              </div>

              <div className="reg-form-actions">
                {editingCove && (
                  <button type="button" className="btn-text elective-delete" style={{ marginRight: 'auto' }}
                    onClick={() => handleDeleteCove(editingCove, coveForm.name)}>
                    Delete Class
                  </button>
                )}
                <button type="button" className="btn-text" onClick={() => setShowCoveModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editingCove ? 'Save Changes' : 'Create Class'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-md">
            <div className="registration-modal-header">
              <h2>Add Students to Roster</h2>
              <button className="icon-btn" onClick={() => { setShowAddStudentModal(false); setStudentSearch(''); setSelectedStudentIds([]); }} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="reg-modal-body">
              <input
                type="text"
                className="form-control reg-search-input"
                placeholder="Search student by name..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                autoFocus
              />

              <div className="student-search-results reg-search-results">
                {allStudents
                  .filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase()))
                  .map(student => {
                    const checked = selectedStudentIds.includes(student.id);
                    return (
                      <button
                        key={student.id}
                        className={`search-result-item ${checked ? 'selected' : ''}`}
                        onClick={() => toggleStudentSelection(student.id)}
                      >
                        <input type="checkbox" checked={checked} readOnly className="reg-search-checkbox" />
                        <div className="reg-search-avatar">
                          {student.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                        </div>
                        <span className="reg-search-name">{student.fullName}</span>
                        <div className="reg-search-spacer"></div>
                        {checked ? <Check size={16} className="text-primary" /> : <Plus size={16} className="text-muted" />}
                      </button>
                    );
                  })
                }
                {allStudents.filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase())).length === 0 && (
                  <p className="text-muted reg-search-empty">No students found matching "{studentSearch}"</p>
                )}
              </div>
            </div>
            <div className="registration-modal-footer">
              <span className="text-muted text-xs">{selectedStudentIds.length} selected</span>
              <button
                className="btn-primary"
                disabled={selectedStudentIds.length === 0 || addingStudents}
                onClick={handleAddSelectedStudents}
              >
                {addingStudents ? 'Adding...' : `Add ${selectedStudentIds.length || ''} Student${selectedStudentIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Application Modal */}
      {declineModal.isOpen && declineModal.application && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-md">
            <div className="registration-modal-header">
              <h2>Decline Application</h2>
              <button
                className="icon-btn"
                onClick={() => setDeclineModal({ isOpen: false, application: null, staffNotes: '', submitting: false })}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="reg-modal-body">
              <p className="text-muted reg-modal-text">
                <strong>{declineModal.application.student.fullName}</strong> stays off every roster and invoice, and the
                family keeps its login. Nothing is deleted — you can still place the student later from the directory.
                The family is not emailed automatically.
              </p>
              <label className="reg-form-label">Reason (internal note, optional)</label>
              <textarea
                className="form-control reg-input-full"
                rows={3}
                placeholder="e.g. No spots for this age group this term — call back in Fall"
                value={declineModal.staffNotes}
                onChange={(e) => setDeclineModal({ ...declineModal, staffNotes: e.target.value })}
              />
              <div className="reg-form-actions">
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setDeclineModal({ isOpen: false, application: null, staffNotes: '', submitting: false })}
                >
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleConfirmDecline} disabled={declineModal.submitting}>
                  {declineModal.submitting ? 'Declining...' : 'Decline Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {appAlert.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-card reg-alert-modal">
            <div className={`reg-alert-icon ${appAlert.type}`}>
              {appAlert.type === 'confirm' ? <Settings size={30} /> : (appAlert.type === 'warning' ? <Clock size={30} /> : <CheckCircle size={30} />)}
            </div>

            <h2>{appAlert.title}</h2>
            <p className="text-muted reg-modal-text">{appAlert.message}</p>

            <div className="reg-alert-actions">
              {appAlert.type === 'confirm' && (
                <button className="btn-text" onClick={() => setAppAlert({ ...appAlert, isOpen: false })}>Cancel</button>
              )}
              <button
                className="btn-primary reg-alert-confirm-btn"
                onClick={() => {
                  if (appAlert.onConfirm) appAlert.onConfirm();
                  setAppAlert({ ...appAlert, isOpen: false });
                }}
              >
                {appAlert.type === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegistrationAdmin;
