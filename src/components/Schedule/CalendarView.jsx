import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Filter, Calendar as CalendarIcon, MapPin, Video, FileText, Star, Edit2, Save, X, Image as ImageIcon, Paperclip, User, Clock, Plus, Settings, CalendarPlus, CalendarCheck, Trash2, Link2, Pencil, UserPlus, UserMinus, CheckCircle2, ClipboardCheck, DollarSign, UserX, Receipt } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { database } from '../../lib/database';
import api from '../../lib/api';
import { resolveMeetingUrl } from '../../lib/meetingLink';
import { formatTimeOfDay } from '../../lib/time';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import AddSelfAsTeacher from '../Common/AddSelfAsTeacher';
import ShiftScheduler from './ShiftScheduler';
import './CalendarView.css';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// How many events a Month cell shows before folding the rest behind "+N more".
// Three is what fits the cell's min-height without the row growing.
const MONTH_CELL_EVENT_CAP = 3;
const SUBJECT_KEYS = ['math', 'science', 'languages', 'arts'];
const DAY_NAME_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// formatTimeOfDay lives in lib/time.js — the calendar was the only screen
// reading these bare TIME values correctly, so the helper moved there and the
// portals now share it instead of each rolling their own.

const to24h = (tStr) => {
  const [t, p] = tStr.trim().split(' ');
  let [h, m] = t.split(':').map(Number);
  if (p === 'PM' && h !== 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const timeRangeToStartEnd = (rangeStr) => {
  const [startStr, endStr] = rangeStr.split(' - ');
  return { startTime: to24h(startStr), endTime: to24h(endStr) };
};

const hhmmToMins = (hhmm) => {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};

// Folds accents away before matching, so typing "Pena" at the desk still finds
// "Brandon Peña". The roster is typed in from a keyboard nobody switches
// layouts on, and a name that can't be searched is a student who can't be
// enrolled.
const foldName = (str) => (str || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

// Every whitespace-separated piece of the query has to appear somewhere in the
// name, in any order — "julian cora" finds "Cora Julian", and a stray double
// space doesn't zero out the list. An empty query matches everything; the
// callers decide whether an empty box should show anything at all.
const nameMatches = (name, query) => {
  const folded = foldName(name);
  return foldName(query).split(/\s+/).filter(Boolean).every(term => folded.includes(term));
};

// "2026-08-19" → "Wednesday". Parsed as UTC to match how session dates are
// stored, so the weekday never slips a day in a timezone behind UTC.
const weekdayNameOf = (isoDate) =>
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  ];

const addMinutesToTime = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const subjectClass = (subject) => {
  const s = (subject || '').toLowerCase();
  return SUBJECT_KEYS.find(k => s.includes(k)) || 'math';
};

const formatDateUS = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return `${m}/${d}/${y}`;
};

// Shown in place of the roster when its fetch failed. It says the roster is
// unknown rather than empty: "no students" and "we couldn't ask" look identical
// on screen but mean opposite things to whoever is about to enroll someone.
const RosterLoadError = ({ onRetry }) => (
  <div className="roster-load-error">
    <p>Couldn’t load this class roster.</p>
    <button type="button" className="text-action" onClick={onRetry}>Try again</button>
  </div>
);

// The only distinction a session actually carries is where it meets: the class
// is IN_PERSON or VIRTUAL (a one-off Zoom link on an in-person class counts as
// virtual for that meeting). Everything this list used to offer — COVE,
// Elective, Tutoring, Event, Meeting, morning vs afternoon — has no field
// behind it, so those options either silently emptied the calendar or quietly
// returned every in-person class instead of the subset they named. Filtering
// honestly on what exists beats offering eight options where two are real.
//
// Telling a COVE from an elective from tutoring needs a category field on
// Class; there isn't one today (groupType is REGULAR/ANCHORED, and that drives
// pricing, not what kind of session this is).
const AVAILABLE_CATEGORIES = [
  'All',
  'In-Person',
  'Online',
];

const CATEGORY_GROUPS = [
  {
    category: 'Class format',
    options: ['In-Person', 'Online'],
  },
];

const MultiDatePicker = ({ selectedDates, onChange }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const handlePrev = (e) => { e.preventDefault(); setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)); };
  const handleNext = (e) => { e.preventDefault(); setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)); };

  const handleDayClick = (e, day) => {
    e.preventDefault();
    const dStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (selectedDates.includes(dStr)) {
      onChange(selectedDates.filter(d => d !== dStr));
    } else {
      onChange([...selectedDates, dStr].sort());
    }
  };

  return (
    <div className="multi-date-picker" style={{ border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', background: 'white', marginTop: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button onClick={handlePrev} className="icon-btn" style={{ padding: '4px' }}><ChevronLeft size={18} /></button>
        <span style={{ fontWeight: '600', fontSize: '14px', color: 'var(--primary)' }}>
          {currentMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={handleNext} className="icon-btn" style={{ padding: '4px' }}><ChevronRight size={18} /></button>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>{d}</div>
        ))}
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = selectedDates.includes(dStr);
          
          return (
            <button
              key={day}
              onClick={(e) => handleDayClick(e, day)}
              style={{
                height: '32px',
                borderRadius: '8px',
                border: isSelected ? 'none' : '1px solid transparent',
                background: isSelected ? 'var(--primary)' : 'transparent',
                color: isSelected ? 'white' : 'var(--text-main)',
                fontSize: '13px',
                fontWeight: isSelected ? '600' : '400',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.target.style.background = '#f1f5f9';
                  e.target.style.borderColor = 'var(--border-light)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.target.style.background = 'transparent';
                  e.target.style.borderColor = 'transparent';
                }
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Jump straight to a week or a day instead of walking there with the arrows.
// Highlights whatever the current view covers — the whole week in Week view, the
// single day in Day view — so it's obvious what clicking a date will land on.
const JumpToDatePicker = ({ currentDate, view, onPick, onClose }) => {
  const [month, setMonth] = useState(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();

  const rangeStart = view === 'week'
    ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - currentDate.getDay())
    : new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + (view === 'week' ? 6 : 0));

  return (
    <div className="cal-jump-popover">
      <div className="cal-jump-head">
        <button type="button" className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span>{month.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="cal-jump-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="cal-jump-dayname">{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const d = new Date(month.getFullYear(), month.getMonth(), day);
          const inRange = toISODate(d) >= toISODate(rangeStart) && toISODate(d) <= toISODate(rangeEnd);
          const isToday = toISODate(d) === toISODate(new Date());
          return (
            <button
              key={day}
              type="button"
              className={`cal-jump-day ${inRange ? 'in-range' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => { onPick(d); onClose(); }}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="cal-jump-foot">
        <button type="button" className="btn-text" onClick={() => { onPick(new Date()); onClose(); }}>
          Today
        </button>
      </div>
    </div>
  );
};

const CalendarView = () => {
  const { user, role, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const canAddEvents = hasRole('ADMIN');
  // What an hour pays is admin-only, here and on the server: the routes reject
  // the pay fields from anyone else, so a teacher must never see a control that
  // is going to bounce.
  const canSetPay = hasRole('ADMIN');
  const [view, setView] = useState('week'); // 'day', 'week', 'month'
  const [currentDate, setCurrentDate] = useState(new Date());
  // Drives the live "now" line — ticks once a minute, which is as often as the
  // line's position could visibly change. Only the three views that actually
  // draw the line subscribe; on Month/List/Shifts the timer would re-render
  // this whole component every minute to change nothing.
  const [now, setNow] = useState(new Date());
  const viewHasNowLine = view === 'day' || view === 'week' || view === 'timeline';
  useEffect(() => {
    if (!viewHasNowLine) return;
    setNow(new Date()); // resync on arrival — the clock may have moved while away
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, [viewHasNowLine]);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [classesList, setClassesList] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [editLink, setEditLink] = useState('');
  // Marking "the teacher didn't turn up" on the open session. Open, because the
  // reason is typed before it is saved and there is no point storing one for a
  // session nobody is currently marking.
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceReason, setAbsenceReason] = useState('');
  // Which student on the open session is having their price rewritten, and to
  // what. One at a time: this is a per-person decision and editing a column of
  // them at once is how the wrong child gets somebody else's number.
  const [priceEdit, setPriceEdit] = useState(null); // { studentId, value, reason }
  const [linkAppliesToSeries, setLinkAppliesToSeries] = useState(false);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [editEventForm, setEditEventForm] = useState({});
  const [rosterSearch, setRosterSearch] = useState('');
  // Set when the per-event detail fetch fails. Without it the roster sat on its
  // "Loading roster…" spinner forever, which reads as "this class has nobody in
  // it" rather than "we never found out" — and the edit form below would then
  // offer to enroll a student who is already on the roster.
  const [rosterError, setRosterError] = useState(false);
  // Which event the modal is actually showing, readable from inside an async
  // load without making it a dependency of one.
  const openEventIdRef = useRef(null);
  const [appAlert, setAppAlert] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });
  // Jump-to-date popover on the header, so getting to a week doesn't mean
  // clicking the arrow once per week from today.
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const jumpRef = useRef(null);
  // Set when a session is dropped on a day that has no time axis (Week agenda,
  // Month grid). Dropping there can only say *which day* — the dialog is where
  // the time gets picked, which is also the only way to move a class to a
  // different hour of the same day by dragging.
  const [rescheduleDraft, setRescheduleDraft] = useState(null);
  const [rescheduling, setRescheduling] = useState(false);
  
  // Only staff can edit/delete scheduled classes or manage the Zoom link —
  // parents/students only get to view the calendar.
  const isAdmin = hasRole('ADMIN', 'TEACHER');
  // Editing a whole series at once (PATCH /sessions/bulk) is admin-only on the
  // server, so a teacher is never offered the checkbox that would 403.
  const canEditSeries = hasRole('ADMIN');

  // Advanced Search States
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const weekGridRef = useRef(null);
  const [weekAxisHeaderH, setWeekAxisHeaderH] = useState(null);
  // Month cells had no cap: one busy day stretched its whole week row (546px
  // against 74px for a quiet day in August), because the cells share a grid
  // row. Showing the first few and folding the rest behind "+N more" keeps the
  // rows even, and the day can still be opened in place.
  const [expandedMonthDays, setExpandedMonthDays] = useState({});
  const isMonthDayExpanded = (d) => !!expandedMonthDays[toISODate(d)];
  const toggleMonthDay = (d) => {
    const key = toISODate(d);
    setExpandedMonthDays(prev => ({ ...prev, [key]: !prev[key] }));
  };
  // Timeline view groups tutors by subject, collapsed by default — same as
  // TutorBird's Timeline, which is why a subject group starts closed rather
  // than open.
  const [expandedTimelineGroups, setExpandedTimelineGroups] = useState({});
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState(null); // { top, label } for hover indicator
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isStudentDropdownOpen, setIsStudentDropdownOpen] = useState(false);
  const [isTutorDropdownOpen, setIsTutorDropdownOpen] = useState(false);
  
  // Add Event States
  const [isAddEventDropdownOpen, setIsAddEventDropdownOpen] = useState(false);
  const [gridClickMenu, setGridClickMenu] = useState(null);

  const handleGridClick = (e, date, teacherName = null) => {
    if (!canAddEvents) return;
    if (e.target.closest('.agenda-event, .positioned-event, .mini-event')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    let y = e.clientY - rect.top;
    if (y < 0) y = 0;
    const totalMins = y / PIXELS_PER_MINUTE;
    const snapped = Math.round(totalMins / 30) * 30;
    const h = Math.floor(snapped / 60) + START_HOUR;
    const m = snapped % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    
    let left = e.clientX + 10;
    if (window.innerWidth - left < 250) left = e.clientX - 260;

    setGridClickMenu({
      x: left,
      y: e.clientY + 10,
      date,
      time: timeStr,
      teacher: teacherName
    });
  };
  const [activeModal, setActiveModal] = useState(null); // 'quick', 'full'
  const [isShiftSchedulerOpen, setIsShiftSchedulerOpen] = useState(false);
  // The kinds of work an hour can be, for the picker on a session. Only the
  // active ones: a retired category shouldn't be offered on new work, though
  // sessions already booked to it keep it.
  const [payCategories, setPayCategories] = useState([]);

  /* ── PTO & Shared Spaces ── */
  const [calPanel, setCalPanel] = useState(null); // 'pto' | 'spaces' | null
  const [ptoRequests, setPtoRequests] = useState([]);
  const [ptoForm, setPtoForm] = useState({ type: 'PTO', startDate: '', endDate: '', reason: '' });
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [ptoCancellingId, setPtoCancellingId] = useState(null);
  const [sharedSpaces, setSharedSpaces] = useState([]);
  const [spaceReservations, setSpaceReservations] = useState([]);
  const [spaceForm, setSpaceForm] = useState({ spaceId: '', date: '', startTime: '09:00', endTime: '10:00', purpose: '' });
  const [spaceSubmitting, setSpaceSubmitting] = useState(false);

  const loadPto = () => {
    api.get('/calendar?showPTO=true').then(r => setPtoRequests(r.data.ptoRequests || [])).catch(() => {});
  };

  useEffect(() => {
    if (calPanel === 'pto') {
      loadPto();
    } else if (calPanel === 'spaces') {
      api.get('/calendar/spaces').then(r => setSharedSpaces(r.data.spaces || [])).catch(() => {});
      api.get('/calendar?showSharedSpaces=true').then(r => setSpaceReservations(r.data.spaceReservations || [])).catch(() => {});
    }
  }, [calPanel]);

  const handlePtoSubmit = async () => {
    setPtoSubmitting(true);
    try {
      await api.post('/calendar/pto', ptoForm);
      setPtoForm({ type: 'PTO', startDate: '', endDate: '', reason: '' });
      loadPto();
    } catch { /* silent */ }
    setPtoSubmitting(false);
  };

  const handlePtoCancel = async (id) => {
    setPtoCancellingId(id);
    try {
      await api.delete(`/calendar/pto/${id}`);
      loadPto();
    } catch { /* silent */ }
    setPtoCancellingId(null);
  };

  /* Group consecutive same-day requests sharing a groupId into one card */
  const ptoGroups = (() => {
    const map = new Map();
    ptoRequests.forEach(r => {
      const key = r.groupId || r.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.values()).map(rows => {
      const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
      return { rows: sorted, first: sorted[0], last: sorted[sorted.length - 1] };
    }).sort((a, b) => new Date(b.first.date) - new Date(a.first.date));
  })();

  const handleSpaceReserve = async () => {
    setSpaceSubmitting(true);
    try {
      const res = await api.post('/calendar/spaces/reserve', spaceForm);
      setSpaceReservations(prev => [...prev, res.data.reservation]);
      setSpaceForm(p => ({ ...p, purpose: '' }));
    } catch (err) {
      const msg = err.response?.data?.message || 'Error reserving space';
      alert(msg);
    }
    setSpaceSubmitting(false);
  };
  const [allStudents, setAllStudents] = useState([]);
  const [isAttendeeDropdownOpen, setIsAttendeeDropdownOpen] = useState(false);
  const [attendeeDropdownMode, setAttendeeDropdownMode] = useState('search'); // 'search' or 'quick'
  const [attendeeSearchText, setAttendeeSearchText] = useState('');
  const attendeeSectionRef = useRef(null);
  const addEventRef = useRef(null);
  const viewMenuRef = useRef(null);
  
  const [newEventForm, setNewEventForm] = useState({
    // New Top-Level Fields
    title: '',
    topLevelType: 'Tutoring', // 'Tutoring' or 'Class'
    category: 'Online Tutoring',
    
    // Tutoring Recurrence
    tutoringRecurrence: '1 time', // '1 time' or 'Repeating'
    noEndDate: true,
    repeatUntil: '',
    
    // Schedule Builder (Repeating Tutoring)
    scheduleDays: [
      { id: Date.now(), day: 'Monday', time: '10:00', duration: 60, price: '' }
    ],
    
    // Class Recurrence
    classRecurrence: 'Forever',
    classDays: ['Monday'],
    classDates: [],
    
    // Standard Date/Time (for Class or 1-time Tutoring)
    date: toISODate(new Date()),
    time: '14:30',
    duration: 60,
    // What each enrolled family is charged for one meeting. Sent through as
    // `chargeAmount` on every session this form creates; approving it in
    // Billing is what turns it into money.
    price: '',
    chargeAllSessions: false,

    // Legacy / Shared
    tutor: '',
    hasSubstitute: false,
    substituteTutor: '',
    students: [],
    description: ''
  });

  const addScheduleDay = () => {
    setNewEventForm(prev => ({
      ...prev,
      scheduleDays: [
        ...prev.scheduleDays,
        { id: Date.now(), day: 'Monday', time: '10:00', duration: 60, price: '' }
      ]
    }));
  };

  const updateScheduleDay = (id, field, value) => {
    setNewEventForm(prev => ({
      ...prev,
      scheduleDays: prev.scheduleDays.map(day => 
        day.id === id ? { ...day, [field]: value } : day
      )
    }));
  };

  const removeScheduleDay = (id) => {
    setNewEventForm(prev => ({
      ...prev,
      scheduleDays: prev.scheduleDays.filter(day => day.id !== id)
    }));
  };

  const toggleClassDay = (day) => {
    setNewEventForm(prev => {
      const currentDays = prev.classDays || [];
      if (currentDays.includes(day)) {
        // Prevent deselecting the last day
        if (currentDays.length === 1) return prev;
        return { ...prev, classDays: currentDays.filter(d => d !== day) };
      } else {
        return { ...prev, classDays: [...currentDays, day] };
      }
    });
  };

  const handleGenerateClassDates = (e) => {
    e.preventDefault();
    const { classRecurrence, classDays } = newEventForm;
    if (!classDays || classDays.length === 0) return;
    
    let weeks = 1;
    if (classRecurrence.includes('week')) {
      weeks = parseInt(classRecurrence.split(' ')[0]);
    } else if (classRecurrence === 'Forever') {
      weeks = 52; // Generate 1 year worth
    }
    
    let start = new Date();
    let generated = [];
    
    classDays.forEach(dayStr => {
      const dayMap = { 'Sunday':0, 'Monday':1, 'Tuesday':2, 'Wednesday':3, 'Thursday':4, 'Friday':5, 'Saturday':6 };
      const targetDay = dayMap[dayStr];
      
      let d = new Date(start);
      // find first occurrence
      while (d.getDay() !== targetDay) {
        d.setDate(d.getDate() + 1);
      }
      
      for (let i = 0; i < weeks; i++) {
        let wd = new Date(d);
        wd.setDate(wd.getDate() + (i * 7));
        const dStr = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
        generated.push(dStr);
      }
    });
    
    setNewEventForm(prev => ({
      ...prev,
      classDates: [...new Set([...(prev.classDates || []), ...generated])].sort()
    }));
  };
  
  const [studentDropdownMode, setStudentDropdownMode] = useState('quick');
  const [tutorDropdownMode, setTutorDropdownMode] = useState('quick');
  const [categoryDropdownMode, setCategoryDropdownMode] = useState('quick');

  const searchRef = useRef(null);
  const studentSectionRef = useRef(null);
  const tutorSectionRef = useRef(null);
  const categorySectionRef = useRef(null);
  
  const [searchForm, setSearchForm] = useState({
    students: [],
    studentSearchText: '',
    tutors: [],
    tutorSearchText: '',
    includeInactiveTutors: false,
    categories: [],
    categorySearchText: '',
    hideFullEvents: false,
    hideEmptyEvents: false,
    hideUnscheduled: false
  });

  // Responsive default view detection
  useEffect(() => {
    const checkMobile = () => {
      if (window.innerWidth <= 768) {
        setView('day');
      } else {
        setView('week');
      }
    };
    checkMobile(); // initial

    // Fetch students
    const loadStudents = async () => {
      const data = await database.fetchStudents();
      setAllStudents(data);
    };
    loadStudents();

    database.fetchTeachers().then(setTeachers);
    api.get('/classes?limit=1000&includeRoster=true').then(r => setClassesList(r.data.classes || [])).catch(() => setClassesList([]));
  }, []);

  // The visible date range for the current view — this is what actually gets
  // fetched from the server. Month view fetches the full 42-cell grid (including
  // the leading/trailing days from adjacent months that are shown) so nothing
  // in the visible grid silently comes up empty.
  const getVisibleRange = (viewMode, date) => {
    if (viewMode === 'day' || viewMode === 'timeline') {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      return { start: d, end: d };
    }
    if (viewMode === 'week' || viewMode === 'shifts') {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      return { start, end };
    }
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const start = new Date(year, month, 1 - firstDay);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
    return { start, end };
  };

  // Guards against out-of-order responses when the user clicks the nav arrows
  // quickly: only the latest request is allowed to write its result.
  const sessionsSeqRef = useRef(0);
  const loadSessions = async (viewMode, date) => {
    const seq = ++sessionsSeqRef.current;
    setSessionsLoading(true);
    try {
      const { start, end } = getVisibleRange(viewMode, date);
      const res = await api.get(`/sessions?startDate=${toISODate(start)}&endDate=${toISODate(end)}`);
      if (seq !== sessionsSeqRef.current) return;
      setSessions(res.data.sessions || []);
    } catch (error) {
      if (seq !== sessionsSeqRef.current) return;
      console.error('Error loading sessions:', error);
      setSessions([]);
    } finally {
      if (seq === sessionsSeqRef.current) setSessionsLoading(false);
    }
  };

  // Real sessions for the visible range — refetched whenever the view or the
  // navigated-to date changes (this is what makes the nav arrows/Day view
  // actually show different classes instead of the same fixed mock data).
  useEffect(() => {
    loadSessions(view, currentDate);
  }, [view, currentDate]);

  // Time off + shared-space bookings, merged read-only into the Month/Week grids
  // so front desk sees "who's out" alongside actual classes instead of digging
  // through the separate PTO/Spaces side panels. Staff-only — students/parents
  // don't get teacher absence info on their calendar.
  //
  // Only admins and front desk get the org-wide view; a teacher sees their own
  // time off and nobody else's, matching what the server will hand back either
  // way (asking for orgWide as a teacher is simply ignored there).
  const [staffEvents, setStaffEvents] = useState([]);
  const canSeeOrgWide = hasRole('ADMIN') || (hasRole('RECEPTIONIST') && !hasRole('TEACHER'));
  // Front desk is included so she sees her own hours on the grid. Note this is
  // not the same reach as the shift chips below: the server hands work shifts to
  // admins and to their owner only, so asking for orgWide here widens the PTO
  // and room bookings, never somebody else's paid hours.
  const canSeeStaffEvents = hasRole('ADMIN', 'TEACHER') || canSeeOrgWide;

  const staffEventsSeqRef = useRef(0);
  const loadStaffEvents = async (viewMode, date) => {
    if (!canSeeStaffEvents) { setStaffEvents([]); return; }
    const seq = ++staffEventsSeqRef.current;
    try {
      const { start, end } = getVisibleRange(viewMode, date);
      const res = await api.get(
        `/calendar?showPTO=true&showSharedSpaces=true${canSeeOrgWide ? '&orgWide=true' : ''}&from=${toISODate(start)}&to=${toISODate(end)}`
      );
      if (seq !== staffEventsSeqRef.current) return;
      // `teacher` only comes back on the org-wide view; without it the rows are
      // the caller's own time off, so they're labelled as such.
      const pto = (res.data.ptoRequests || []).map(r => ({
        id: `pto-${r.id}`,
        kind: 'pto',
        dateStr: new Date(r.date).toISOString().split('T')[0],
        time: 'All day',
        teacherName: r.teacher?.fullName || '',
        title: `${r.type === 'SICK' ? 'Out Sick' : 'Vacation'} — ${r.teacher?.fullName || 'You'}`,
      }));
      const spaces = (res.data.spaceReservations || []).map(r => {
        // Written with a forced "Z" suffix (see reserveSpace on the server) —
        // same UTC-pinned-wall-clock convention as Session times, so it's read
        // back the same way: via formatTimeOfDay's UTC getters, not local ones.
        const startDt = new Date(r.startTime);
        return {
          id: `space-${r.id}`,
          kind: 'meeting',
          dateStr: startDt.toISOString().split('T')[0],
          time: `${formatTimeOfDay(r.startTime)} - ${formatTimeOfDay(r.endTime)}`,
          title: `${r.purpose || r.space?.name || 'Meeting'}${r.user?.fullName ? ` — ${r.user.fullName}` : ''}`,
        };
      });
      // Paid hours that aren't a class — reception, planning, a staff meeting.
      // They belong on the calendar for the same reason classes do: it's the
      // schedule, and here it is also the thing that decides what the hour
      // costs. The rate rides on the chip for whoever is allowed to see it,
      // so an admin building next week's rota can read the money as they go.
      const shifts = (res.data.workShifts || []).map(s => {
        const label = s.categoryLabel || 'Shift';
        const who = s.staff?.fullName || '';
        return {
          id: `shift-${s.id}`,
          shiftId: s.id,
          kind: 'shift',
          dateStr: new Date(s.date).toISOString().split('T')[0],
          time: `${formatTimeOfDay(s.startTime)} - ${formatTimeOfDay(s.endTime)}`,
          teacherName: who,
          categoryColor: s.categoryColor || null,
          status: s.status,
          title: `${s.title || label}${who ? ` — ${who}` : ''}`,
        };
      });
      setStaffEvents([...pto, ...spaces, ...shifts]);
    } catch {
      if (seq === staffEventsSeqRef.current) setStaffEvents([]);
    }
  };

  useEffect(() => {
    loadStaffEvents(view, currentDate);
  }, [view, currentDate, role]);

  // A half-typed absence reason must never follow the admin to the next session
  // they open — that is how the wrong person's hour gets a stranger's excuse.
  useEffect(() => {
    setAbsenceOpen(false);
    setAbsenceReason('');
    // Same reason: a half-typed price must never follow the admin to the next
    // session, where it would be sitting on a different child's row.
    setPriceEdit(null);
  }, [selectedEvent?.id]);

  // Loaded once: the list is short, changes rarely, and every session opened
  // needs it to name the kind of work this hour is.
  useEffect(() => {
    if (!canSetPay) return;
    database.fetchPayCategories({ activeOnly: true })
      .then(setPayCategories)
      .catch(() => setPayCategories([]));
  }, [canSetPay]);

  const reloadTeachers = () => database.fetchTeachers().then(setTeachers);

  const reloadClasses = async () => {
    try {
      const res = await api.get('/classes?limit=1000&includeRoster=true');
      setClassesList(res.data.classes || []);
    } catch { /* keep previous list on failure */ }
  };

  const classesById = React.useMemo(() => {
    const map = {};
    classesList.forEach(c => { map[c.id] = c; });
    return map;
  }, [classesList]);

  // Maps a real Session (+ its Class) into the flat "event" shape the rest of
  // this component's render/drag/edit logic already expects.
  const mappedEvents = React.useMemo(() => {
    return sessions
      .filter(s => s.status !== 'CANCELLED')
      .map(s => {
        const classInfo = classesById[s.classId] || {};
        // The session's own payload carries this now (sessions.controller.js),
        // so it resolves even when GET /classes 403s — front desk and any other
        // non-staff viewer never populates classesById at all.
        const primaryTeacher = s.class?.teacher?.fullName || classInfo.teacher?.fullName;
        const coTeachers = s.class?.coTeachers || classInfo.coTeachers || [];
        const allTeacherNames = [primaryTeacher, ...coTeachers.map(c => c.fullName)].filter(Boolean);
        const teacherNameStr = allTeacherNames.length > 1 
          ? `${primaryTeacher || coTeachers[0].fullName} (+${allTeacherNames.length - 1})`
          : (primaryTeacher || 'Unassigned');

        const cls = {
          type: s.class?.type || classInfo.type,
          meetingUrl: s.class?.meetingUrl ?? classInfo.meetingUrl,
        };
        const meetingUrl = resolveMeetingUrl(s, cls) || '';
        // Same fallback as the teacher name above: the session's own payload
        // carries the roster for staff now (sessions.controller.js), so "By
        // Students" resolves without GET /classes — which front desk can't
        // reach — ever populating classesById. `??`, not `||`: a class with
        // zero active enrollments is a real, staff-visible `[]`, not a signal
        // to fall back to the (possibly stale) classesById roster.
        const roster = s.class?.enrollments ?? classInfo.enrollments ?? [];
        return {
          id: s.id,
          classId: s.classId,
          title: s.class?.name || classInfo.name || 'Class',
          subject: subjectClass(s.class?.subject || classInfo.subject),
          // The class's own free-text subject, if staff ever set one — powers
          // the Timeline view's subject grouping. Most classes here never get
          // one, which is deliberately fine: they fall into "Unspecified
          // Subject", the same bucket TutorBird groups untagged classes into.
          rawSubject: (s.class?.subject || classInfo.subject || '').trim(),
          time: `${formatTimeOfDay(s.startTime)} - ${formatTimeOfDay(s.endTime)}`,
          dateStr: new Date(s.date).toISOString().split('T')[0],
          type: cls.type === 'VIRTUAL' || s.meetingUrl ? 'Virtual' : 'In-Person',
          classType: cls.type || 'IN_PERSON',
          teacher: teacherNameStr,
          allTeacherNames, // Pass all names so Day View can create separate columns
          teacherId: s.class?.teacherId || classInfo.teacherId || classInfo.teacher?.id || null,
          coTeacherIds: coTeachers.map(c => c.id),
          students: roster.length || classInfo._count?.enrollments || 0,
          // How many seats the class holds — what "full" actually means. Null
          // when we couldn't find out, which the filter treats as "don't
          // judge" rather than assuming a number.
          maxStudents: s.class?.maxStudents ?? classInfo.maxStudents ?? null,
          studentList: null, // lazily loaded when the event is opened
          studentIds: [],
          // Enrolled student names (lowercased) — powers the "By Students"
          // search filter without waiting for the lazy per-event roster fetch.
          rosterNames: roster.map(en => (en.student?.fullName || '').toLowerCase()),
          notes: s.notes?.[0]?.notes || '',
          materials: (s.materials || []).map(m => ({ name: m.name, url: m.fileUrl })),
          meetingUrl,
          // Only ever a default to prefill when someone marks *this* meeting
          // virtual — never shown as this session's link.
          classMeetingUrl: cls.meetingUrl || '',
          // What kind of work this hour is, for pay. Null means it still falls
          // back to the old guess (online if there's a link, else in person).
          payCategoryKey: s.payCategoryKey || '',
          payRateOverride: s.payRateOverride == null ? '' : String(s.payRateOverride),
          // Somebody covered this one meeting. Empty on nearly every session:
          // the hour is the class teacher's unless it says otherwise, and this
          // is the only place that can say otherwise — a substitution is true
          // of one Wednesday, not of the timetable.
          substituteTeacherId: s.teacherId || '',
          // Whose class it is regardless, so the picker can name the person
          // being covered for. `teacher` above is already the effective one.
          classTeacherId: s.class?.ownTeacher?.id || '',
          classTeacherName: s.class?.ownTeacher?.fullName || '',
          // What this meeting charges each enrolled family. The other side of
          // payRateOverride: that is what the hour pays the teacher, this is
          // what it bills the client. Empty means it raises nothing, which is
          // most sessions — the term's tuition is billed by the quarterly run.
          // Admin-only; the API nulls it for everybody else.
          chargeAmount: s.chargeAmount == null ? '' : String(s.chargeAmount),
          chargeNote: s.chargeNote || '',
          // Students who don't pay this meeting's price — an 8th grader whose
          // full-day fee already bought this room, a sibling on a concession.
          // Keyed by student id so the roster below can show each real number.
          chargeOverrides: Object.fromEntries(
            (s.chargeOverrides || []).map(o => [o.studentId, { amount: Number(o.amount), reason: o.reason }])
          ),
          // The roster as ids+names, so the price panel can list who is actually
          // being charged without waiting for the lazy per-event fetch.
          rosterStudents: roster.map(en => ({ id: en.student?.id, name: en.student?.fullName })).filter(x => x.id),
          // Once the hour is confirmed its rate is written down and no longer
          // follows the category, so the picker says so instead of implying an
          // edit here would change what was paid.
          paidRate: s.paidRate == null ? null : Number(s.paidRate),
          status: s.status,
          // The teacher didn't turn up, so this hour isn't paid. The calendar
          // is where that gets decided now — pay accrues from the schedule the
          // moment an hour ends, and this is the only thing that takes it back
          // off. Null on the calendars families see; see listSessions.
          absentAt: s.absentAt || null,
          absentReason: s.absentReason || '',
          absentBy: s.absentBy?.fullName || '',
        };
      });
  }, [sessions, classesById]);

  const quickSelectGroups = React.useMemo(() => ([
    {
      category: 'Students',
      options: [
        `Active Students (${allStudents.filter(s => s.status === 'Active').length})`,
        `Trial Students (${allStudents.filter(s => s.status === 'Trial').length})`,
      ],
    },
  ]), [allStudents]);

  const tutorGroups = React.useMemo(() => ([
    {
      category: 'Status',
      options: [
        `Active Tutors (${teachers.filter(t => t.status === 'Active').length})`,
        `Inactive Tutors (${teachers.filter(t => t.status !== 'Active').length})`,
      ],
    },
  ]), [teachers]);

  // Click away listener for search popover and inner dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      // 1. If we click outside the entire search popover wrapper
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsSearchOpen(false);
        setIsStudentDropdownOpen(false);
        setIsTutorDropdownOpen(false);
        setIsCategoryDropdownOpen(false);
      }

      // Close Add Event dropdown if click is outside
      if (addEventRef.current && !addEventRef.current.contains(event.target)) {
        setIsAddEventDropdownOpen(false);
      }

      // Close View menu if click is outside
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target)) {
        setIsViewMenuOpen(false);
      }
      
      if (searchRef.current && !searchRef.current.contains(event.target)) {
         return;
      }

      // 2. If we are inside the popover, but click outside a specific section that has an open dropdown
      if (isStudentDropdownOpen && studentSectionRef.current && !studentSectionRef.current.contains(event.target)) {
        setIsStudentDropdownOpen(false);
      }
      if (isTutorDropdownOpen && tutorSectionRef.current && !tutorSectionRef.current.contains(event.target)) {
        setIsTutorDropdownOpen(false);
      }
      if (isCategoryDropdownOpen && categorySectionRef.current && !categorySectionRef.current.contains(event.target)) {
        setIsCategoryDropdownOpen(false);
      }

      if (isAttendeeDropdownOpen && attendeeSectionRef.current && !attendeeSectionRef.current.contains(event.target)) {
        setIsAttendeeDropdownOpen(false);
      }
    };

    if (isSearchOpen || isAddEventDropdownOpen || isAttendeeDropdownOpen || isViewMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSearchOpen, isStudentDropdownOpen, isTutorDropdownOpen, isCategoryDropdownOpen, isAddEventDropdownOpen, isAttendeeDropdownOpen, isViewMenuOpen]);

  // The jump-to-date popover lives outside the search wrapper, so it closes on
  // its own click-away (and on Escape, like the rest of the overlays).
  useEffect(() => {
    if (!isJumpOpen) return;
    const onDown = (e) => {
      if (jumpRef.current && !jumpRef.current.contains(e.target)) setIsJumpOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsJumpOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isJumpOpen]);

  // Ensure inner dropdowns reset when the main search popover is closed
  useEffect(() => {
    if (!isSearchOpen) {
      setIsStudentDropdownOpen(false);
      setIsTutorDropdownOpen(false);
      setIsCategoryDropdownOpen(false);
    }
  }, [isSearchOpen]);

  // The previous auto-generate logic was removed because we are replacing the mini-calendar 
  // with the custom schedule days builder.

  const removeCategory = (cat) => {
    setSearchForm(prev => ({
      ...prev,
      categories: prev.categories.filter(c => c !== cat)
    }));
  };

  const addCategory = (catRaw) => {
    const cleanCat = catRaw.replace(/\s*\(\d+\)$/, '');
    if (cleanCat === 'All') {
      setSearchForm(prev => ({
        ...prev,
        categories: AVAILABLE_CATEGORIES.filter(c => c !== 'All')
      }));
    } else if (!searchForm.categories.includes(cleanCat)) {
      setSearchForm(prev => ({
        ...prev,
        categories: [...prev.categories, cleanCat]
      }));
    }
    setIsCategoryDropdownOpen(false);
    setSearchForm(prev => ({...prev, categorySearchText: ''}));
  };

  const removeStudent = (student) => {
    setSearchForm(prev => ({
      ...prev,
      students: prev.students.filter(s => s !== student)
    }));
  };

  // Arriving from a Directory card's "Schedule" link (?student=Full+Name):
  // pre-apply the same "By Students" filter the popover offers, and open it so
  // it's obvious the calendar is narrowed rather than just empty-looking on a
  // slow week. Runs once — this is a one-time entry filter, not something that
  // should re-fire and fight the user's own later edits to the search.
  useEffect(() => {
    const studentParam = new URLSearchParams(location.search).get('student');
    if (studentParam) {
      setSearchForm(prev =>
        prev.students.includes(studentParam) ? prev : { ...prev, students: [...prev.students, studentParam] }
      );
      setIsSearchOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addStudent = (studentRaw) => {
    // If it's a group like "Active Students (383)", clean the number off for the visual tag
    const cleanStudent = studentRaw.replace(/\s*\(\d+\)$/, '');
    
    if (!searchForm.students.includes(cleanStudent)) {
      setSearchForm(prev => ({
        ...prev,
        students: [...prev.students, cleanStudent]
      }));
    }
    setIsStudentDropdownOpen(false);
    setSearchForm(prev => ({...prev, studentSearchText: ''}));
  };

  const addAttendee = (student) => {
    if (!newEventForm.students.find(s => s.id === student.id)) {
      setNewEventForm(prev => ({
        ...prev,
        students: [...prev.students, student]
      }));
    }
    setAttendeeSearchText('');
    setIsAttendeeDropdownOpen(false);
  };

  const removeAttendee = (studentId) => {
    setNewEventForm(prev => ({
      ...prev,
      students: prev.students.filter(s => s.id !== studentId)
    }));
  };

  const removeTutor = (tutor) => {
    setSearchForm(prev => ({
      ...prev,
      tutors: prev.tutors.filter(t => t !== tutor)
    }));
  };

  const addTutor = (tutorRaw) => {
    // Clean counts if it's a group
    let cleanTutor = tutorRaw.replace(/\s*\(\d+\)$/, '');
    cleanTutor = cleanTutor.replace('Prof. ', '');
    if (!searchForm.tutors.includes(cleanTutor)) {
      setSearchForm(prev => ({
        ...prev,
        tutors: [...prev.tutors, cleanTutor]
      }));
    }
    setIsTutorDropdownOpen(false);
    setSearchForm(prev => ({...prev, tutorSearchText: ''}));
  };

  const clearSearch = () => {
    setSearchForm({
      students: [],
      studentSearchText: '',
      tutors: [],
      tutorSearchText: '',
      includeInactiveTutors: false,
      categories: [],
      categorySearchText: '',
      hideFullEvents: false,
      hideEmptyEvents: false,
      hideUnscheduled: false
    });
  };

  const handleSearchSubmit = () => {
    // In a real app, this would trigger an API call.
    // For now, we just close the window.
    setIsSearchOpen(false);
  };

  const getFilteredEvents = () => {
    let filtered = mappedEvents;

    // Matches on the same Virtual/In-Person value the tile displays, so the
    // filter and the chip can never disagree about what a meeting is. Anything
    // unrecognised matches nothing rather than silently matching everything —
    // but AVAILABLE_CATEGORIES is now the only source of these strings, so an
    // unrecognised one means a genuine bug rather than a dead menu entry.
    if (searchForm.categories.length > 0) {
      filtered = filtered.filter(e =>
        searchForm.categories.some(c => {
          if (c === 'All') return true;
          if (c === 'Online') return e.type === 'Virtual';
          if (c === 'In-Person') return e.type === 'In-Person';
          return false;
        })
      );
    }
    
    // Filter by Students — an event matches if any selected student is on its
    // class roster. The quick-select group tags expand to every student name
    // currently in that group.
    if (searchForm.students.length > 0) {
      const selectedNames = searchForm.students.flatMap(tag => {
        if (tag === 'Active Students') return allStudents.filter(s => s.status === 'Active').map(s => s.name);
        if (tag === 'Trial Students') return allStudents.filter(s => s.status === 'Trial').map(s => s.name);
        return [tag];
      }).map(n => n.toLowerCase());
      filtered = filtered.filter(e =>
        (e.rosterNames || []).some(rn => selectedNames.includes(rn))
      );
    }

    // Filter by Tutors
    if (searchForm.tutors.length > 0) {
      filtered = filtered.filter(e =>
        searchForm.tutors.some(t => e.teacher.toLowerCase().includes(t.toLowerCase()))
      );
    }

    // Filter by Capacity States
    if (searchForm.hideEmptyEvents) {
      filtered = filtered.filter(e => e.students > 0);
    }

    // "Full" is the class's own capacity, the same number the server enforces
    // when it refuses an enrolment. It used to compare against a flat 15, which
    // was wrong in both directions: a class of 10 sitting at 10 was full and
    // stayed on the calendar, while a class of 20 with 16 in it had room and
    // got hidden. A class whose capacity we couldn't read is left visible —
    // better to show something we can't judge than to hide it on a guess.
    if (searchForm.hideFullEvents) {
      filtered = filtered.filter(e => e.maxStudents == null || e.students < e.maxStudents);
    }
    
    return filtered;
  };

  // Memoised because this re-filters the whole session list, and plain hover
  // over the week grid re-renders this component. It only actually changes when
  // the sessions or the search do.
  const events = React.useMemo(
    () => getFilteredEvents(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mappedEvents, searchForm, allStudents]
  );

  // The hour axis has to start exactly where the day columns' grid starts, or
  // every hour label sits off its own line. It can't assume a height: a day
  // column stacks a header *and* a 10px column gap above its body, and the
  // header itself grows when the week has all-day chips (PTO, birthdays) — so
  // the error was 11px on a quiet week and would be larger on a busy one.
  // Mirror what the first column actually puts above its grid.
  useLayoutEffect(() => {
    if (view !== 'week') return;
    const measure = () => {
      const grid = weekGridRef.current;
      const col = grid?.querySelector('.week-day-col');
      const body = col?.querySelector('.week-day-body');
      if (!col || !body) return;
      const h = body.getBoundingClientRect().top - col.getBoundingClientRect().top;
      if (h > 0) setWeekAxisHeaderH(prev => (prev !== null && Math.abs(prev - h) < 0.5 ? prev : h));
    };
    // Re-measuring on these deps is what covers the all-day row growing: those
    // chips come from staffEvents, so the row can't change without a render.
    // Deliberately not a ResizeObserver — this needs to hold in every browser,
    // and the data path already tells us when the header can have moved.
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [view, currentDate, events, staffEvents]);

  // The tile only carries lightweight info — fetch the class roster and the
  // session's full notes/materials the moment it's actually opened. Split out
  // of handleEventClick so the roster's Retry can run exactly the same load.
  const loadEventDetail = async (event) => {
    setRosterError(false);
    try {
      const [classRes, sessionRes] = await Promise.all([
        api.get(`/classes/${event.classId}`),
        api.get(`/sessions/${event.id}`),
      ]);
      const cls = classRes.data.class;
      const sess = sessionRes.data.session;
      // The roster on GET /classes is the class's roster *today* -- right for
      // enrolling into the live class, wrong for a session that already
      // happened. GET /sessions/:id windows its enrolments to the session's
      // own date (see rosterOn() on the server), so that is what the panel
      // shows; falling back to the class's list only if the session came back
      // without one (a parent/student view, where the roster is stripped).
      const rosterSource = sess.class?.enrollments ?? cls.enrollments;
      const studentIds = (rosterSource || []).map(en => ({ id: en.student.id, name: en.student.fullName }));
      setSelectedEvent(prev => (prev && prev.id === event.id) ? {
        ...prev,
        studentList: studentIds.map(s => s.name),
        studentIds,
        notes: sess.notes?.[0]?.notes || '',
        materials: (sess.materials || []).map(m => ({ name: m.name, url: m.fileUrl })),
        meetingUrl: resolveMeetingUrl(sess, cls) || '',
        classMeetingUrl: cls.meetingUrl || '',
        classType: cls.type || prev.classType,
      } : prev);
    } catch (error) {
      console.error('Error loading session detail:', error);
      // Only complain about the event still on screen: a slow request for an
      // event the user already clicked away from isn't their problem.
      if (openEventIdRef.current === event.id) setRosterError(true);
    }
  };

  const handleEventClick = async (event) => {
    openEventIdRef.current = event.id;
    setSelectedEvent(event);
    setEditNotes(event.notes || '');
    setIsEditing(false);
    setIsEditingEvent(false);
    setIsEditingLink(false);
    setRosterSearch('');
    await loadEventDetail(event);
  };

  const handleStartEditEvent = () => {
    // Real date/time fields rather than one free-text "10:00 AM - 12:50 PM"
    // string: the string had to be typed in exactly the shape the parser wanted,
    // and it's the field people reach for when a class is on the wrong hour.
    const { startTime, endTime } = timeRangeToStartEnd(selectedEvent.time);
    setEditEventForm({
      title: selectedEvent.title,
      subject: selectedEvent.subject,
      teacherId: selectedEvent.teacherId || '',
      coTeacherIds: selectedEvent.coTeacherIds || [],
      date: selectedEvent.dateStr,
      startTime,
      endTime,
      origDate: selectedEvent.dateStr,
      origStartTime: startTime,
      applyToSeries: false,
      payCategoryKey: selectedEvent.payCategoryKey || '',
      payRateOverride: selectedEvent.payRateOverride || '',
      substituteTeacherId: selectedEvent.substituteTeacherId || '',
      chargeAmount: selectedEvent.chargeAmount || '',
      chargeNote: selectedEvent.chargeNote || '',
      // Separate from applyToSeries on purpose: retiming one session is usually
      // a one-off, but "this class is private tutoring" is nearly always true of
      // the whole term, and mixing the two would make each fix the other.
      applyCategoryToSeries: false,
      studentList: [...(selectedEvent.studentIds || [])],
    });
    setIsEditingEvent(true);
    setRosterSearch('');
  };

  const handleSaveEventEdit = async () => {
    if (editEventForm.endTime <= editEventForm.startTime) {
      toast.error('The end time has to be after the start time.');
      return;
    }
    try {
      await api.put(`/classes/${selectedEvent.classId}`, {
        name: editEventForm.title,
        subject: editEventForm.subject,
        teacherId: editEventForm.teacherId || undefined,
        coTeacherIds: editEventForm.coTeacherIds || [],
      });
      const { date, startTime, endTime } = editEventForm;
      // The pay fields only ride along for an admin — the route rejects them
      // from anyone else, so sending them would turn a teacher's ordinary
      // retiming into a 400.
      const payFields = canSetPay
        ? {
            payCategoryKey: editEventForm.payCategoryKey || null,
            payRateOverride: editEventForm.payRateOverride ?? '',
            // Who taught this one meeting. Sent as `teacherId` because that is
            // the session's own column — not to be confused with the class
            // teacher above, which goes to a different endpoint and moves the
            // whole timetable.
            teacherId: editEventForm.substituteTeacherId ?? '',
            // Typing a price charges nobody — it records what the meeting costs,
            // and an admin approves the pending ones into the ledger later.
            chargeAmount: editEventForm.chargeAmount ?? '',
            chargeNote: editEventForm.chargeNote ?? '',
          }
        : {};
      await api.put(`/sessions/${selectedEvent.id}`, { date, startTime, endTime, ...payFields });

      // Same time, every following week: the fix for a whole semester booked an
      // hour off, without opening each session in turn.
      if (editEventForm.applyToSeries) {
        const weekday = new Date(`${editEventForm.origDate}T00:00:00Z`).getUTCDay();
        const res = await api.patch('/sessions/bulk', {
          classId: selectedEvent.classId,
          weekday,
          matchStartTime: editEventForm.origStartTime,
          from: editEventForm.origDate,
          startTime,
          endTime,
        });
        toast.success(res.data.message);
      }

      // "This class is private tutoring" is a statement about the term, not
      // about Tuesday. Applied from this session onward, never to earlier ones:
      // opening a session in March must not reach back and reprice January.
      // Any of those later sessions already confirmed are re-priced at the new
      // rate, which is the point — this is how a miscategorised class is fixed.
      if (canSetPay && editEventForm.applyCategoryToSeries) {
        const weekday = new Date(`${editEventForm.origDate}T00:00:00Z`).getUTCDay();
        const res = await api.patch('/sessions/bulk', {
          classId: selectedEvent.classId,
          weekday,
          matchStartTime: editEventForm.origStartTime,
          from: editEventForm.origDate,
          payCategoryKey: editEventForm.payCategoryKey || null,
          payRateOverride: editEventForm.payRateOverride ?? '',
        });
        toast.success(res.data.message);
      }

      const newTeacher = teachers.find(t => t.id === editEventForm.teacherId);
      // A substitute is who taught this meeting, so it is their name on it —
      // the class teacher's is the answer for every other week.
      const cover = teachers.find(t => t.id === editEventForm.substituteTeacherId);
      const updated = {
        ...selectedEvent,
        title: editEventForm.title,
        subject: editEventForm.subject,
        teacher: cover ? cover.name : (newTeacher ? newTeacher.name : selectedEvent.teacher),
        teacherId: editEventForm.substituteTeacherId || editEventForm.teacherId,
        dateStr: date,
        time: `${formatTimeStr(hhmmToMins(startTime))} - ${formatTimeStr(hhmmToMins(endTime))}`,
        studentList: editEventForm.studentList.map(s => s.name),
        studentIds: editEventForm.studentList,
        students: editEventForm.studentList.length,
        payCategoryKey: editEventForm.payCategoryKey || '',
        payRateOverride: editEventForm.payRateOverride || '',
        substituteTeacherId: editEventForm.substituteTeacherId || '',
        chargeAmount: editEventForm.chargeAmount || '',
        chargeNote: editEventForm.chargeNote || '',
      };
      setSelectedEvent(updated);
      setIsEditingEvent(false);
      reloadClasses();
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not save these changes.');
    }
  };

  // Enrolling writes to the server the moment the name is clicked — there is no
  // pending state to Save. So the rest of the calendar has to be brought up to
  // date right here: closing the modal with the X used to leave the tiles, the
  // headcounts and every other meeting of the class showing the old roster
  // until the page was reloaded, which read as "the student wasn't added".
  const refreshAfterRosterChange = (studentList) => {
    setSelectedEvent(prev => prev ? {
      ...prev,
      studentIds: studentList,
      studentList: studentList.map(s => s.name),
      students: studentList.length,
    } : prev);
    reloadClasses();
    loadSessions(view, currentDate);
  };

  const handleAddStudentToRoster = async (student) => {
    if (editEventForm.studentList.some(s => s.id === student.id)) { setRosterSearch(''); return; }
    try {
      await api.post(`/classes/${selectedEvent.classId}/enrollments`, { studentId: student.id });
      const next = [...editEventForm.studentList, student];
      setEditEventForm(prev => ({ ...prev, studentList: next }));
      refreshAfterRosterChange(next);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not add this student to the class.');
    }
    setRosterSearch('');
  };

  const handleRemoveStudentFromRoster = async (student) => {
    try {
      await api.delete(`/classes/${selectedEvent.classId}/enrollments/${student.id}`);
      const next = editEventForm.studentList.filter(s => s.id !== student.id);
      setEditEventForm(prev => ({ ...prev, studentList: next }));
      refreshAfterRosterChange(next);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove this student from the class.');
    }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    await database.saveClassNotes(selectedEvent.id, editNotes, selectedEvent.materials);
    setSelectedEvent(prev => ({ ...prev, notes: editNotes }));
    loadSessions(view, currentDate);
    setSaving(false);
    setIsEditing(false);
  };

  // "Delete" cancels the session server-side (status: CANCELLED) rather than
  // erasing it — there's no hard-delete endpoint, and a cancelled session still
  // needs to exist for payroll/attendance history to make sense.
  const confirmDeleteEvent = (event) => {
    setAppAlert({
      isOpen: true,
      title: 'Cancel this session?',
      message: `This marks "${event.title}" on ${event.dateStr} as cancelled. It disappears from the calendar but stays in the system's records — it won't be paid out or counted.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.put(`/sessions/${event.id}`, { status: 'CANCELLED' });
          setSelectedEvent(null);
          setAppAlert({ isOpen: false });
          loadSessions(view, currentDate);
        } catch (error) {
          setAppAlert({ isOpen: false });
          toast.error(error.response?.data?.message || 'Could not cancel this session.');
        }
      }
    });
  };

  /**
   * The teacher didn't turn up — take this hour off payroll (or put it back).
   *
   * Pay accrues from the calendar: an hour that has passed is an hour that is
   * owed, with nobody asked to confirm it class by class. So this is the one
   * correction there is, and it lives here because the calendar is where
   * whoever knows about the absence already is.
   *
   * The session itself is untouched — it stays on the timetable, keeps its
   * register and its notes, and the families' view doesn't change. This says
   * something about pay, not about whether the class was ever scheduled.
   */
  const handleSetAbsence = async (absent) => {
    if (!selectedEvent) return;
    setSaving(true);
    try {
      const res = await database.setSessionAbsence([selectedEvent.id], absent, absenceReason);
      toast.success(res.message);
      setSelectedEvent(prev => ({
        ...prev,
        absentAt: absent ? new Date().toISOString() : null,
        absentReason: absent ? absenceReason : '',
        absentBy: absent ? (user?.fullName || 'You') : '',
      }));
      setAbsenceOpen(false);
      setAbsenceReason('');
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not change this session's pay.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Price one student differently for this meeting — usually to nothing.
   *
   * The price on a calendar entry is one number for the whole roster, which
   * stops being right the moment somebody's fee already covers the room they
   * are sitting in: an 8th grader on the full-day programme is inside the same
   * cove everyone else pays $400 for, and charging them again is billing twice
   * for one seat. This is where that gets fixed, on the entry, with the roster
   * in front of you — which is the reason pricing lives on the calendar at all.
   *
   * `amount: null` drops the exception and puts them back on the full price.
   */
  const handleStudentPrice = async (studentId, amount, reason) => {
    if (!selectedEvent) return;
    setSaving(true);
    try {
      const res = await database.setStudentChargePrice({
        sessionId: selectedEvent.id,
        studentIds: [studentId],
        amount,
        reason,
      });
      toast.success(res.message);
      setSelectedEvent(prev => {
        const next = { ...(prev.chargeOverrides || {}) };
        if (amount === null) delete next[studentId];
        else next[studentId] = { amount: Number(amount), reason: reason || null };
        return { ...prev, chargeOverrides: next };
      });
      setPriceEdit(null);
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not change what this student pays.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleZoom = () => {
    if (!selectedEvent) return;
    if (isEditingLink) {
      setIsEditingLink(false);
      return;
    }
    // Nothing on this meeting yet: offer the class's link as a starting point
    // rather than making someone dig the same URL out again. It's only a
    // suggestion in the box — it isn't live until it's saved onto the session.
    setEditLink(selectedEvent.meetingUrl || selectedEvent.classMeetingUrl || '');
    setLinkAppliesToSeries(false);
    setIsEditingLink(true);
  };

  // Optimistic local update after saving a link on the open session. Clearing it
  // doesn't necessarily make the meeting in-person: a fully VIRTUAL class still
  // falls back to its class-level link.
  const applyLinkToEvent = (event, url) => {
    if (!event) return event;
    const effective = resolveMeetingUrl(
      { meetingUrl: url },
      { type: event.classType, meetingUrl: event.classMeetingUrl }
    ) || '';
    return { ...event, meetingUrl: effective, type: effective ? 'Virtual' : 'In-Person' };
  };

  // The link is saved onto the session, never onto the class: Algebra 1 meets in
  // person on Monday and Wednesday, so a class-wide link would put a "Join Zoom"
  // button on days when the room is expecting the student in person. The series
  // option repeats it across one weekday only — every later Tuesday, say — which
  // is how a recurring virtual day gets set up without touching the other days.
  const handleSaveLink = async () => {
    if (!selectedEvent) return;
    const url = editLink.trim();
    try {
      await api.put(`/sessions/${selectedEvent.id}`, { meetingUrl: url });

      if (linkAppliesToSeries) {
        const weekday = new Date(`${selectedEvent.dateStr}T00:00:00Z`).getUTCDay();
        const res = await api.patch('/sessions/bulk', {
          classId: selectedEvent.classId,
          weekday,
          from: selectedEvent.dateStr,
          meetingUrl: url,
        });
        toast.success(res.data.message);
      }

      setSelectedEvent(prev => applyLinkToEvent(prev, url));
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not save the meeting link.');
    }
    setIsEditingLink(false);
  };

  const handleRemoveLink = async () => {
    setEditLink('');
    if (!selectedEvent) return;
    try {
      await api.put(`/sessions/${selectedEvent.id}`, { meetingUrl: '' });
      if (linkAppliesToSeries) {
        const weekday = new Date(`${selectedEvent.dateStr}T00:00:00Z`).getUTCDay();
        await api.patch('/sessions/bulk', {
          classId: selectedEvent.classId,
          weekday,
          from: selectedEvent.dateStr,
          meetingUrl: '',
        });
      }
      setSelectedEvent(prev => applyLinkToEvent(prev, ''));
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove the meeting link.');
    }
    setIsEditingLink(false);
  };

  // Creates a real Class (if needed) plus its Session(s) — a Session can't
  // exist without a Class behind it, so "adding an event" always creates one.
  const handleSaveNewEvent = async () => {
    try {
      const tutor = teachers.find(t => t.id === newEventForm.tutor);
      const isVirtual = (newEventForm.category || '').toLowerCase().includes('online') || (newEventForm.category || '').toLowerCase().includes('virtual');
      const attendeeIds = newEventForm.students.filter(s => allStudents.some(as => as.id === s.id));

      const classRes = await api.post('/classes', {
        name: newEventForm.title || newEventForm.category || 'New Class',
        subject: subjectClass(newEventForm.title),
        teacherId: tutor?.id,
        coTeacherIds: newEventForm.coTeacherIds || [],
        type: isVirtual ? 'VIRTUAL' : 'IN_PERSON',
        maxStudents: Math.max(attendeeIds.length, 10),
      });
      const classId = classRes.data.class.id;

      for (const student of attendeeIds) {
        await api.post(`/classes/${classId}/enrollments`, { studentId: student.id }).catch(() => {});
      }

      const duration = parseInt(newEventForm.duration) || 60;

      // The price typed on this form is what each enrolled family is charged
      // for one meeting. It used to be collected and silently dropped — the box
      // was there, nothing read it — so an admin who priced an event on the way
      // in had no way of knowing it never landed. Admin-only, like the pay
      // fields: the route rejects it from anyone else.
      const priceFields = (price) =>
        canSetPay && price !== '' && price != null ? { chargeAmount: price } : {};

      if (newEventForm.topLevelType === 'Tutoring' && newEventForm.tutoringRecurrence === '1 time') {
        await api.post('/sessions', {
          classId,
          date: newEventForm.date,
          startTime: newEventForm.time,
          endTime: addMinutesToTime(newEventForm.time, duration),
          ...priceFields(newEventForm.price),
        });
      } else if (newEventForm.topLevelType === 'Tutoring') {
        const endDate = newEventForm.noEndDate
          ? toISODate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))
          : newEventForm.repeatUntil;
        for (const row of newEventForm.scheduleDays) {
          const rowDuration = parseInt(row.duration) || 60;
          await api.post('/sessions/bulk', {
            classId,
            startDate: toISODate(new Date()),
            endDate,
            weekdays: [DAY_NAME_TO_NUM[row.day]],
            startTime: row.time,
            endTime: addMinutesToTime(row.time, rowDuration),
            // Each row carries its own price — a Monday hour and a Thursday
            // hour can cost different amounts — falling back to the form's
            // single price when the row leaves it blank.
            ...priceFields(row.price !== '' && row.price != null ? row.price : newEventForm.price),
            chargeAllSessions: newEventForm.chargeAllSessions,
          });
        }
      } else {
        const dates = newEventForm.classDates.length ? newEventForm.classDates : [newEventForm.date];
        for (let i = 0; i < dates.length; i++) {
          const dateStr = dates[i];
          const shouldCharge = newEventForm.chargeAllSessions || i === 0;
          await api.post('/sessions', {
            classId,
            date: dateStr,
            startTime: newEventForm.time,
            endTime: addMinutesToTime(newEventForm.time, duration),
            ...(shouldCharge ? priceFields(newEventForm.price) : {}),
          });
        }
      }

      setActiveModal(null);
      reloadClasses();
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not create this event.');
    }
  };

  const getDurationMins = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 60;
    const parts = timeStr.split(' - ');
    if (parts.length < 2) return 60;
    const startStr = parts[0];
    const endStr = parts[1];
    
    if (endStr.endsWith('m')) return parseInt(endStr);
    
    const parse = (tStr) => {
      const [t, p] = tStr.trim().split(' ');
      let [h, m] = (t || '0:0').split(':').map(Number);
      if (p === 'PM' && h !== 12) h += 12;
      if (p === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };
    
    return parse(endStr) - parse(startStr);
  };

  const formatTimeStr = (totalMins) => {
    let h = Math.floor(totalMins / 60);
    let m = Math.floor(totalMins % 60);
    const p = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')} ${p}`;
  };

  const calculateNewTimeRange = (originalTime, dropY, offsetY) => {
    const duration = getDurationMins(originalTime);
    const adjustedY = Math.max(0, dropY - offsetY);
    const minutesFromStart = adjustedY / PIXELS_PER_MINUTE;
    
    const snappedMinutes = Math.round(minutesFromStart / 15) * 15;
    
    const startTotalMins = (START_HOUR * 60) + snappedMinutes;
    const endTotalMins = startTotalMins + duration;
    
    const parts = originalTime.split(' - ');
    if (parts.length === 2 && parts[1].endsWith('m')) {
       return `${formatTimeStr(startTotalMins)} - ${parts[1]}`;
    }
    
    return `${formatTimeStr(startTotalMins)} - ${formatTimeStr(endTotalMins)}`;
  };

  const handleDragStart = (e, eventItem) => {
    if (!hasRole('ADMIN')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('eventId', eventItem.id.toString());
    const rect = e.currentTarget.getBoundingClientRect();
    e.dataTransfer.setData('offsetY', (e.clientY - rect.top).toString());
  };

  // Dropping a session onto a different day/time updates its real date and/or
  // time via PUT /sessions/:id — targetDate is an actual Date, not a mock offset.
  //
  // The Week agenda and the Month grid have no time axis: where you let go says
  // nothing about the hour, so dropping there opens the reschedule dialog with
  // the target day filled in rather than silently keeping the old time. That's
  // also what makes dragging a class onto *the same day* meaningful — it's the
  // way to move it to a different hour without a time grid to aim at.
  const handleDropOnWeekDay = async (e, targetDate) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('eventId');
    const offsetY = parseFloat(e.dataTransfer.getData('offsetY') || '0');
    if (!eventId) return;

    const eventItem = events.find(ev => ev.id.toString() === eventId);
    if (!eventItem) return;

    const container = e.currentTarget.querySelector('.timeline-container') || e.currentTarget;
    if (!container || !container.classList.contains('timeline-container')) {
      openRescheduleDialog(eventItem, targetDate);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const dropY = e.clientY - containerRect.top;
    const newTimeRange = calculateNewTimeRange(eventItem.time, dropY, offsetY);
    const payload = { date: toISODate(targetDate), ...timeRangeToStartEnd(newTimeRange) };

    try {
      await api.put(`/sessions/${eventItem.id}`, payload);
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not reschedule this session.');
    }
  };

  // Prefills the dialog from the session being moved. `origDate`/`origStartTime`
  // are kept because they're what identifies the rest of the series server-side
  // when the admin chooses to retime every following week too.
  const openRescheduleDialog = (eventItem, targetDate) => {
    const { startTime, endTime } = timeRangeToStartEnd(eventItem.time);
    setRescheduleDraft({
      eventId: eventItem.id,
      classId: eventItem.classId,
      title: eventItem.title,
      origDate: eventItem.dateStr,
      origStartTime: startTime,
      date: toISODate(targetDate || new Date(`${eventItem.dateStr}T00:00:00`)),
      startTime,
      endTime,
      applyToSeries: false,
    });
  };

  // Saves the dialog. The single session always moves; ticking "every following
  // week" additionally retimes the rest of the series through PATCH
  // /sessions/bulk, which is the whole point — a class repeated for a semester
  // at the wrong hour shouldn't need fixing one week at a time.
  const handleConfirmReschedule = async () => {
    if (!rescheduleDraft) return;
    const draft = rescheduleDraft;
    if (draft.endTime <= draft.startTime) {
      toast.error('The end time has to be after the start time.');
      return;
    }
    setRescheduling(true);
    try {
      await api.put(`/sessions/${draft.eventId}`, {
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
      });

      if (draft.applyToSeries) {
        const weekday = new Date(`${draft.origDate}T00:00:00Z`).getUTCDay();
        const res = await api.patch('/sessions/bulk', {
          classId: draft.classId,
          weekday,
          matchStartTime: draft.origStartTime,
          from: draft.origDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
        });
        toast.success(res.data.message);
      }

      setRescheduleDraft(null);
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not reschedule this session.');
    }
    setRescheduling(false);
  };

  // Dropping onto a different teacher's column reassigns the whole class to
  // that teacher (there's no per-session substitute field) — a real, if
  // broader, effect worth knowing about before dragging one across columns.
  const handleDropOnTeacher = async (e, newTeacherLabel) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('eventId');
    const offsetY = parseFloat(e.dataTransfer.getData('offsetY') || '0');
    if (!eventId) return;

    const eventItem = events.find(ev => ev.id.toString() === eventId);
    const newTeacher = teachers.find(t => t.name === newTeacherLabel);
    if (!eventItem || !newTeacher) return;

    const sessionPayload = {};
    const container = e.currentTarget.querySelector('.timeline-container') || e.currentTarget;
    if (container && container.classList.contains('timeline-container')) {
      const containerRect = container.getBoundingClientRect();
      const dropY = e.clientY - containerRect.top;
      const newTimeRange = calculateNewTimeRange(eventItem.time, dropY, offsetY);
      Object.assign(sessionPayload, timeRangeToStartEnd(newTimeRange));
    }

    try {
      await api.put(`/classes/${eventItem.classId}`, { teacherId: newTeacher.id });
      if (Object.keys(sessionPayload).length > 0) {
        await api.put(`/sessions/${eventItem.id}`, sessionPayload);
      }
      reloadClasses();
      loadSessions(view, currentDate);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not reassign this session.');
    }
  };

  // Helper to get day numbers for the week
  const getWeekDates = () => {
    const dates = [];
    const baseDay = currentDate.getDate() - currentDate.getDay(); // Start of week (Sun)
    for (let i = 0; i < 7; i++) {
        dates.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), baseDay + i));
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Helper for Month View Grid (42 cells to cover all weekday offsets)
  const getMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
    const startOffset = firstDay; // Align to Sunday Start
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return { startOffset, daysInMonth };
  };

  const { startOffset, daysInMonth } = getMonthDays();
  const monthCells = Array.from({ length: 42 });

  // Time parsing for Day View Timeline (9 AM to midnight)
  const START_HOUR = 9;
  const PIXELS_PER_MINUTE = 2.0; // ~120px per hour — taller blocks for readability
  const TIMELINE_EVENT_ROW_HEIGHT = 42; // Timeline view: stacked-row height for overlapping events within one tutor's lane

  // The live "now" line — only meaningful on the actual current date, and
  // only within the grid's visible hour range (a 2 AM class the grid clips
  // wouldn't get a line either).
  const isRealToday = toISODate(currentDate) === toISODate(now);
  const nowOffsetMins = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const showNowLine = isRealToday && nowOffsetMins >= 0 && nowOffsetMins <= (24 - START_HOUR) * 60;
  const nowOffsetPix = nowOffsetMins * PIXELS_PER_MINUTE;

  const parseTimeToPix = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const startStr = timeStr.split(' - ')[0];
    const parts = startStr.trim().split(' ');
    if (parts.length < 2) return 0;
    const [time, period] = parts;
    let [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours)) return 0;
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    const minutesFromStart = (hours - START_HOUR) * 60 + (minutes || 0);
    // A session earlier than START_HOUR (the odd 8 AM class against a 9 AM
    // grid) would otherwise get a negative top — rendered above the visible
    // grid, clipped under the sticky time-axis header where it's unclickable
    // even though a sliver of it still shows. Pin it to the top edge instead:
    // still visible, still openable, just not positioned at its true time.
    return Math.max(0, minutesFromStart * PIXELS_PER_MINUTE);
  };

  const getPositionStyles = (timeRange) => {
    if (!timeRange) return { top: '0px', height: '60px' };
    const topPix = parseTimeToPix(timeRange);
    const durationMins = getDurationMins(timeRange);
    const heightPix = durationMins * PIXELS_PER_MINUTE;
    return { top: `${topPix}px`, height: `${heightPix}px` };
  };

  // Two sessions at the same time in the same column used to render on top of
  // each other pixel-for-pixel (only the last one in the DOM was visible or
  // clickable). This groups overlapping events and gives each one a side-by-side
  // slot, like Google Calendar, instead of stacking them.
  const layoutOverlaps = (columnEvents) => {
    const withRange = columnEvents.map(e => {
      const start = parseTimeToPix(e.time) / PIXELS_PER_MINUTE;
      return { e, start, end: start + getDurationMins(e.time) };
    }).sort((a, b) => a.start - b.start);

    const layout = new Map();
    let cluster = [];
    let clusterEnd = -Infinity;

    const flushCluster = () => {
      if (cluster.length === 0) return;
      const columnEnds = []; // end time of the last event placed in each column
      cluster.forEach(item => {
        let col = columnEnds.findIndex(end => item.start >= end);
        if (col === -1) { col = columnEnds.length; columnEnds.push(item.end); }
        else { columnEnds[col] = item.end; }
        item.col = col;
      });
      const totalCols = columnEnds.length;
      cluster.forEach(item => layout.set(item.e.id, { col: item.col, cols: totalCols }));
      cluster = [];
      clusterEnd = -Infinity;
    };

    withRange.forEach(item => {
      if (cluster.length > 0 && item.start >= clusterEnd) flushCluster();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    });
    flushCluster();

    return layout;
  };

  const getOverlapStyles = (event, layout) => {
    const { col, cols } = layout.get(event.id) || { col: 0, cols: 1 };
    if (cols <= 1) return { left: '3px', width: 'calc(100% - 6px)' };
    return {
      left: `calc(${(col * 100) / cols}% + 3px)`,
      width: `calc(${100 / cols}% - 6px)`,
      right: 'auto',
    };
  };

  // Everything below derives the Day/Timeline row set from the fetched
  // sessions. It's all memoised on the same handful of inputs: without that it
  // re-ran on every hover over the week grid and on every minute tick of the
  // "now" line, neither of which can change any of it.
  const currentDateIso = toISODate(currentDate);

  const dayEventsList = React.useMemo(
    () => events.filter(e => e.dateStr === currentDateIso),
    [events, currentDateIso]
  );

  // Union with teachers who are on PTO today but have no session — otherwise
  // a teacher taking the whole day off (no classes to show) never gets a
  // column, and the "Out" badge below would have nowhere to render.
  // "Hide unscheduled tutors" drops the columns that only exist because of a
  // PTO badge — a tutor who's out AND has no sessions today is unscheduled.
  const todaysPtoTeachers = React.useMemo(
    () => searchForm.hideUnscheduled ? [] : staffEvents
      .filter(se => se.kind === 'pto' && se.dateStr === currentDateIso)
      .map(se => se.teacherName)
      // Own-PTO rows carry no name (the server only names people on the
      // org-wide view), and a nameless column would render as a blank lane.
      .filter(Boolean),
    [searchForm.hideUnscheduled, staffEvents, currentDateIso]
  );

  const uniqueTeachers = React.useMemo(() => {
    const all = [...new Set([
      ...dayEventsList.flatMap(e => e.allTeacherNames && e.allTeacherNames.length > 0 ? e.allTeacherNames : [e.teacher]),
      ...todaysPtoTeachers
    ].filter(Boolean))].sort();
    if (searchForm.tutors.length === 0) return all;
    return all.filter(t => searchForm.tutors.some(st => t.toLowerCase().includes(st.toLowerCase())));
  }, [dayEventsList, todaysPtoTeachers, searchForm.tutors]);

  // Timeline view groups tutor rows by subject — TutorBird's own Timeline
  // does the same, collapsing every subject (including the untagged bucket)
  // behind a disclosure arrow. A tutor who's out with nothing scheduled still
  // needs a row to show the "Out" badge on, so PTO-only tutors land in the
  // untagged bucket too, same as an untagged session would.
  const UNSPECIFIED_SUBJECT = 'Unspecified Subject';
  const timelineSubjectGroups = React.useMemo(() => {
    const groups = new Map(); // label -> Set<teacherName>
    dayEventsList.forEach(e => {
      const primary = e.allTeacherNames && e.allTeacherNames.length > 0 ? e.allTeacherNames[0] : e.teacher;
      if (!primary) return;
      const label = e.rawSubject || UNSPECIFIED_SUBJECT;
      if (!groups.has(label)) groups.set(label, new Set());
      groups.get(label).add(primary);
    });
    const scheduledTeachers = new Set([...groups.values()].flatMap(s => [...s]));
    const ptoOnly = todaysPtoTeachers.filter(t => !scheduledTeachers.has(t));
    if (ptoOnly.length > 0) {
      if (!groups.has(UNSPECIFIED_SUBJECT)) groups.set(UNSPECIFIED_SUBJECT, new Set());
      ptoOnly.forEach(t => groups.get(UNSPECIFIED_SUBJECT).add(t));
    }
    return [...groups.entries()]
      .map(([label, teacherSet]) => {
        let teacherNames = [...teacherSet].sort();
        if (searchForm.tutors.length > 0) {
          teacherNames = teacherNames.filter(t => searchForm.tutors.some(st => t.toLowerCase().includes(st.toLowerCase())));
        }
        return { label, teacherNames };
      })
      .filter(g => g.teacherNames.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [dayEventsList, todaysPtoTeachers, searchForm.tutors]);
  const timelineWidth = (24 - START_HOUR) * 60 * PIXELS_PER_MINUTE;
  const timelineHalfHourTicks = Array.from({ length: (24 - START_HOUR) * 2 });
  // The half-hour rules used to be one <div> per tick per row — 30 nodes a row,
  // ~330 across an expanded day, all of them re-created on every render. They're
  // evenly spaced, so a repeating gradient paints the same thing with no nodes
  // at all. The spacing still comes from PIXELS_PER_MINUTE (via this custom
  // property) so JS stays the single source of truth for the scale.
  const timelineTickPx = 30 * PIXELS_PER_MINUTE;
  const timelineGridVars = { '--tl-tick': `${timelineTickPx}px` };
  // Only the "now" marker is still a real element: it's one node, and its
  // position doesn't follow the tick rhythm.
  const timelineHourLines = showNowLine
    ? <div className="now-line-v" style={{ left: `${nowOffsetPix}px` }} />
    : null;

  // Moves currentDate by one unit of whatever's currently in view — this is
  // what the header's ◀ ▶ arrows call; each change re-fetches sessions via
  // the [view, currentDate] effect above.
  const goToPrevPeriod = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (view === 'day' || view === 'timeline') d.setDate(d.getDate() - 1);
      else if (view === 'week' || view === 'shifts') d.setDate(d.getDate() - 7);
      else d.setMonth(d.getMonth() - 1);
      return d;
    });
  };
  const goToNextPeriod = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (view === 'day' || view === 'timeline') d.setDate(d.getDate() + 1);
      else if (view === 'week' || view === 'shifts') d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
      return d;
    });
  };
  const headerLabel = (view === 'day' || view === 'timeline')
    ? currentDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <div className="calendar-header-top">
          <div className="cal-jump-wrapper" ref={jumpRef}>
            <h1 className="calendar-title-text" onClick={() => setIsJumpOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
              {headerLabel} <span style={{ fontSize: '14px' }}>▼</span>
            </h1>
            {isJumpOpen && (
              <JumpToDatePicker
                currentDate={currentDate}
                view={view}
                onPick={setCurrentDate}
                onClose={() => setIsJumpOpen(false)}
              />
            )}
          </div>

          <div className="nav-arrows-group">
            <button className="nav-arrow-btn" onClick={goToPrevPeriod} aria-label="Previous"><ChevronLeft size={16} /></button>
            <button className="nav-today-btn" onClick={() => setCurrentDate(new Date())}>Today</button>
            <button className="nav-arrow-btn" onClick={goToNextPeriod} aria-label="Next"><ChevronRight size={16} /></button>
            {sessionsLoading && <span className="app-inline-loader" style={{ fontSize: 12, marginLeft: 12 }}><span className="app-spinner-sm" style={{ width: 13, height: 13 }} /></span>}
          </div>
        </div>

        <div className="calendar-header-bottom">
          <div className="calendar-actions-left">
            {canAddEvents && (
              <div className="add-event-wrapper" style={{ position: 'relative' }} ref={addEventRef}>
                <button
                  className="add-event-btn"
                  onClick={() => setIsAddEventDropdownOpen(!isAddEventDropdownOpen)}
                >
                  <Plus size={16} />
                  <span>Add Event</span>
                  <span style={{ fontSize: '10px', marginLeft: '4px' }}>▼</span>
                </button>
  
                {isAddEventDropdownOpen && (
                  <div className="add-event-dropdown">
                    <div className="dropdown-item" onClick={() => { setActiveModal('full'); setIsAddEventDropdownOpen(false); }}>
                      <CalendarPlus size={16} />
                      <span>Add New Event</span>
                    </div>
                    <div className="dropdown-item" onClick={() => { setActiveModal('full'); setIsAddEventDropdownOpen(false); }}>
                      <CalendarIcon size={16} />
                      <span>Add Non-Tutoring Event</span>
                    </div>
                    {/* Paid hours that aren't a class. Only admins: scheduling
                        one is deciding what it costs. */}
                    {hasRole('ADMIN') && (
                      <div className="dropdown-item" onClick={() => { setIsShiftSchedulerOpen(true); setIsAddEventDropdownOpen(false); }}>
                        <Clock size={16} />
                        <span>Work Shift (front desk, planning…)</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {hasRole('TEACHER') && (
              <div className="options-wrapper" style={{ display: 'flex', gap: '8px' }}>
                <button className={`options-btn ${calPanel === 'pto' ? 'active' : ''}`} onClick={() => setCalPanel(calPanel === 'pto' ? null : 'pto')}>
                  <Settings size={14} /> PTO
                </button>
                <button className={`options-btn ${calPanel === 'spaces' ? 'active' : ''}`} onClick={() => setCalPanel(calPanel === 'spaces' ? null : 'spaces')}>
                  <Settings size={14} /> Spaces
                </button>
              </div>
            )}
            
            <button className="print-btn" onClick={() => window.print()}>
               <FileText size={14} /> Print
            </button>
          </div>

          <div className="calendar-actions-right">
            <div className="view-toggle-new" ref={viewMenuRef} style={{ position: 'relative' }}>
              <button 
                className="view-select-btn"
                onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
              >
                <CalendarIcon size={14} className="view-icon-only" />
                <span>
                  {view === 'month' ? 'Month' : view === 'list' ? 'Week (List)' : view === 'week' ? 'Week (Agenda)' : view === 'shifts' ? 'Shifts' : view === 'timeline' ? 'Timeline' : 'Day'}
                </span>
                <span style={{ fontSize: '10px' }}>▼</span>
              </button>
              
              {isViewMenuOpen && (
                <div className="view-dropdown-menu">
                  <div className={`view-dropdown-item ${view === 'month' ? 'active' : ''}`} onClick={() => { setView('month'); setIsViewMenuOpen(false); }}>
                    <div className="check-space">{view === 'month' && <CheckCircle2 size={12} className="check-icon" />}</div> Month
                  </div>
                  
                  <div className={`view-dropdown-group ${view.startsWith('week') ? 'active' : ''}`}>
                    <div className="view-dropdown-group-title">
                      <div className="check-space">{view.startsWith('week') && <CheckCircle2 size={12} className="check-icon" />}</div>
                      Week <span className="arrow">▶</span>
                    </div>
                    <div className="view-dropdown-submenu">
                       <div className={`view-dropdown-item ${view === 'week' ? 'active' : ''}`} onClick={() => { setView('week'); setIsViewMenuOpen(false); }}>
                         <div className="check-space">{view === 'week' && <CheckCircle2 size={12} className="check-icon" />}</div> Agenda
                       </div>
                       <div className={`view-dropdown-item ${view === 'list' ? 'active' : ''}`} onClick={() => { setView('list'); setIsViewMenuOpen(false); }}>
                         <div className="check-space">{view === 'list' && <CheckCircle2 size={12} className="check-icon" />}</div> List
                       </div>
                    </div>
                  </div>

                  <div className={`view-dropdown-item ${view === 'day' ? 'active' : ''}`} onClick={() => { setView('day'); setIsViewMenuOpen(false); }}>
                    <div className="check-space">{view === 'day' && <CheckCircle2 size={12} className="check-icon" />}</div> Day
                  </div>

                  <div className={`view-dropdown-item ${view === 'timeline' ? 'active' : ''}`} onClick={() => { setView('timeline'); setIsViewMenuOpen(false); }}>
                    <div className="check-space">{view === 'timeline' && <CheckCircle2 size={12} className="check-icon" />}</div> Timeline
                  </div>

                  {/* Paid non-class hours. Gated the same way the data is: the
                      server only hands work shifts to admins and to their own
                      owner, so anyone else would land on an empty view. */}
                  {canSeeStaffEvents && (
                    <div className={`view-dropdown-item ${view === 'shifts' ? 'active' : ''}`} onClick={() => { setView('shifts'); setIsViewMenuOpen(false); }}>
                      <div className="check-space">{view === 'shifts' && <CheckCircle2 size={12} className="check-icon" />}</div> Shifts
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="filter-wrapper" style={{ position: 'relative' }} ref={searchRef}>
              <button 
                 className="advanced-search-btn-new" 
                 onClick={() => setIsSearchOpen(!isSearchOpen)}
              >
                <Filter size={14} />
                <span>Search</span>
                <span style={{ fontSize: '10px', marginLeft: '4px' }}>▼</span>
              </button>

            {isSearchOpen && (
              <div className="advanced-search-popover">
                <div className="search-section" style={{ position: 'relative' }} ref={studentSectionRef}>
                  <div className="section-header">
                    <label>By Students</label>
                    <button 
                      className="text-action"
                      onClick={() => {
                        setStudentDropdownMode('quick');
                        setIsStudentDropdownOpen(!isStudentDropdownOpen);
                      }}
                    >
                      Quick Select ▼
                    </button>
                  </div>
                  
                  {searchForm.students.length > 0 && (
                    <div className="categories-box" style={{ marginBottom: '8px', minHeight: 'auto' }}>
                      {searchForm.students.map((student, idx) => (
                        <span key={idx} className="category-tag" onClick={(e) => e.stopPropagation()}>
                          {student}
                          <button onClick={(e) => { e.stopPropagation(); removeStudent(student); }}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ position: 'relative' }}>
                    <input 
                      type="text" 
                      value={searchForm.studentSearchText}
                      onChange={(e) => {
                        setSearchForm({...searchForm, studentSearchText: e.target.value});
                        setStudentDropdownMode('search');
                      }}
                      onClick={() => {
                        setStudentDropdownMode('search');
                        setIsStudentDropdownOpen(true);
                      }}
                      placeholder="Search students..." 
                    />
                    {isStudentDropdownOpen && (
                      <div className="category-dropdown-menu" style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                        {studentDropdownMode === 'quick' && searchForm.studentSearchText === '' ? (
                          // Render Grouped Quick Select when not typing
                          quickSelectGroups.map(group => (
                            <div key={group.category}>
                              <div style={{ padding: '8px 16px', fontWeight: 'bold', fontSize: '13px', color: '#334155', pointerEvents: 'none' }}>
                                {group.category}
                              </div>
                              {group.options.map(opt => (
                                <div 
                                  key={opt}
                                  className="category-option"
                                  style={{ paddingLeft: '24px' }}
                                  onClick={() => addStudent(opt)}
                                >
                                  {opt}
                                </div>
                              ))}
                            </div>
                          ))
                        ) : (
                          // Render standard individual text search otherwise
                          allStudents
                            .map(s => s.name)
                            .filter(s => !searchForm.students.includes(s))
                            .filter(s => nameMatches(s, searchForm.studentSearchText))
                            .map(student => (
                            <div
                              key={student}
                              className="category-option"
                              onClick={() => addStudent(student)}
                            >
                              {student}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button className="text-action text-left" onClick={() => setSearchForm({...searchForm, students: [], studentSearchText: ''})}>Clear Selection</button>
                </div>

                <div className="search-section" style={{ position: 'relative' }} ref={tutorSectionRef}>
                  <div className="section-header">
                    <label>By Tutors</label>
                    <button 
                      className="text-action"
                      onClick={() => {
                        setTutorDropdownMode('quick');
                        setIsTutorDropdownOpen(!isTutorDropdownOpen);
                      }}
                    >
                      Quick Select ▼
                    </button>
                  </div>
                  
                  {searchForm.tutors.length > 0 && (
                    <div className="categories-box" style={{ marginBottom: '8px', minHeight: 'auto' }}>
                      {searchForm.tutors.map((tutor, idx) => (
                        <span key={idx} className="category-tag" onClick={(e) => e.stopPropagation()}>
                          {tutor}
                          <button onClick={(e) => { e.stopPropagation(); removeTutor(tutor); }}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ position: 'relative' }}>
                    <input 
                       type="text" 
                       value={searchForm.tutorSearchText}
                       onChange={(e) => {
                         setSearchForm({...searchForm, tutorSearchText: e.target.value});
                         setTutorDropdownMode('search');
                       }}
                       onClick={() => {
                         setTutorDropdownMode('search');
                         setIsTutorDropdownOpen(true);
                       }}
                       placeholder="Search tutors..." 
                    />
                    {isTutorDropdownOpen && (
                      <div className="category-dropdown-menu" style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                        {tutorDropdownMode === 'quick' && searchForm.tutorSearchText === '' ? (
                          // Render Grouped Quick Select when not typing
                          tutorGroups.map(group => (
                            <div key={group.category}>
                              <div style={{ padding: '8px 16px', fontWeight: 'bold', fontSize: '13px', color: '#334155', pointerEvents: 'none' }}>
                                {group.category}
                              </div>
                              {group.options.map(opt => (
                                <div 
                                  key={opt}
                                  className="category-option"
                                  style={{ paddingLeft: '24px' }}
                                  onClick={() => addTutor(opt)}
                                >
                                  {opt}
                                </div>
                              ))}
                            </div>
                          ))
                        ) : (
                          teachers
                            .filter(t => searchForm.includeInactiveTutors || t.status === 'Active')
                            .map(t => ({ raw: t.name, clean: t.name.replace('Prof. ', '') }))
                            .filter(t => !searchForm.tutors.includes(t.clean))
                            .filter(t => t.raw.toLowerCase().includes(searchForm.tutorSearchText.toLowerCase()))
                            .map(tutorObj => (
                            <div 
                              key={tutorObj.raw} 
                              className="category-option"
                              onClick={() => addTutor(tutorObj.raw)}
                            >
                              {tutorObj.raw}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button className="text-action text-left" onClick={() => setSearchForm({...searchForm, tutors: [], tutorSearchText: ''})}>Clear Selection</button>
                  <label className="checkbox-label mt-8">
                    <input 
                       type="checkbox" 
                       checked={searchForm.includeInactiveTutors}
                       onChange={(e) => setSearchForm({...searchForm, includeInactiveTutors: e.target.checked})}
                    />
                    Include inactive tutors in list
                  </label>
                </div>

                <div className="search-section" style={{ position: 'relative' }} ref={categorySectionRef}>
                  <div className="section-header">
                    <label>By Categories</label>
                    <button 
                      className="text-action"
                      onClick={() => {
                        setCategoryDropdownMode('quick');
                        setIsCategoryDropdownOpen(!isCategoryDropdownOpen);
                      }}
                    >
                      Quick Select ▼
                    </button>
                  </div>
                  
                  {searchForm.categories.length > 0 && (
                    <div className="categories-box" style={{ marginBottom: '8px', minHeight: 'auto' }}>
                      {searchForm.categories.map((cat, idx) => (
                        <span key={idx} className="category-tag" onClick={(e) => e.stopPropagation()}>
                          {cat}
                          <button onClick={(e) => { e.stopPropagation(); removeCategory(cat); }}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ position: 'relative' }}>
                    <input 
                       type="text" 
                       value={searchForm.categorySearchText || ''}
                       onChange={(e) => {
                         setSearchForm({...searchForm, categorySearchText: e.target.value});
                         setCategoryDropdownMode('search');
                       }}
                       onClick={() => {
                         setCategoryDropdownMode('search');
                         setIsCategoryDropdownOpen(true);
                       }}
                       placeholder="Search categories..." 
                    />
                    {isCategoryDropdownOpen && (
                      <div className="category-dropdown-menu" style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                        {categoryDropdownMode === 'quick' && (searchForm.categorySearchText || '') === '' ? (
                          // Render Grouped Quick Select when not typing
                          CATEGORY_GROUPS.map(group => (
                            <div key={group.category}>
                              <div style={{ padding: '8px 16px', fontWeight: 'bold', fontSize: '13px', color: '#334155', pointerEvents: 'none' }}>
                                {group.category}
                              </div>
                              {group.options.map(opt => (
                                <div 
                                  key={opt}
                                  className="category-option"
                                  style={{ paddingLeft: '24px' }}
                                  onClick={() => addCategory(opt)}
                                >
                                  {opt}
                                </div>
                              ))}
                            </div>
                          ))
                        ) : (
                          AVAILABLE_CATEGORIES
                            .filter(c => !searchForm.categories.includes(c))
                            .filter(c => c.toLowerCase().includes((searchForm.categorySearchText || '').toLowerCase()))
                            .map(cat => (
                            <div 
                              key={cat} 
                              className="category-option"
                              onClick={() => addCategory(cat)}
                            >
                              {cat}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button className="text-action text-left" onClick={() => setSearchForm({...searchForm, categories: [], categorySearchText: ''})}>Clear Selection</button>
                </div>

                <div className="search-section checkboxes-list">
                   {[
                     { id: 'hideFullEvents', label: 'Hide full events' },
                     { id: 'hideEmptyEvents', label: 'Hide empty events' },
                     { id: 'hideUnscheduled', label: 'Hide unscheduled tutors (Day view)' }
                   ].map(cb => (
                     <label key={cb.id} className="checkbox-label">
                       <input 
                         type="checkbox" 
                         checked={searchForm[cb.id]}
                         onChange={(e) => setSearchForm({...searchForm, [cb.id]: e.target.checked})}
                       />
                       {cb.label}
                     </label>
                   ))}
                </div>

                <div className="search-footer">
                   <button className="clear-btn" onClick={clearSearch}>Clear</button>
                   <button className="search-submit-btn" onClick={handleSearchSubmit}>Search</button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* PTO Panel */}
      {calPanel === 'pto' && (
        <div className="cal-panel">
          <h3>Time Off Requests</h3>
          <div className="cal-panel-form">
            <select value={ptoForm.type} onChange={e => setPtoForm(p => ({...p, type: e.target.value}))}>
              <option value="PTO">PTO</option>
              <option value="SICK">Sick Day</option>
            </select>
            <input
              type="date"
              title="Start date"
              value={ptoForm.startDate}
              onChange={e => setPtoForm(p => ({...p, startDate: e.target.value, endDate: p.endDate && p.endDate < e.target.value ? e.target.value : p.endDate}))}
            />
            <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 13 }}>to</span>
            <input
              type="date"
              title="End date"
              min={ptoForm.startDate || undefined}
              value={ptoForm.endDate}
              onChange={e => setPtoForm(p => ({...p, endDate: e.target.value}))}
            />
            <input type="text" placeholder="Reason (optional)" value={ptoForm.reason} onChange={e => setPtoForm(p => ({...p, reason: e.target.value}))} />
            <button className="cal-panel-submit" onClick={handlePtoSubmit} disabled={ptoSubmitting || !ptoForm.startDate || !ptoForm.endDate}>
              {ptoSubmitting ? 'Submitting...' : 'Request'}
            </button>
          </div>
          <div className="cal-panel-list">
            {ptoGroups.length > 0 ? ptoGroups.map(({ rows, first, last }) => {
              const sameDay = first.date === last.date;
              const label = sameDay
                ? formatDateUS(first.date)
                : `${formatDateUS(first.date)} – ${formatDateUS(last.date)} (${rows.length} days)`;
              const allPending = rows.every(r => r.status === 'PENDING');
              return (
                <div key={first.groupId || first.id} className={`cal-panel-item ${first.status?.toLowerCase()}`}>
                  <span>{first.type}: {label}{first.reason ? ` — ${first.reason}` : ''}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`cal-status ${first.status?.toLowerCase()}`}>{first.status}</span>
                    {allPending && (
                      <button
                        onClick={() => handlePtoCancel(first.id)}
                        disabled={ptoCancellingId === first.id}
                        style={{ background: 'none', border: '1px solid var(--border-light)', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)' }}
                      >
                        {ptoCancellingId === first.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    )}
                  </span>
                </div>
              );
            }) : <p className="text-muted" style={{fontSize: 13}}>No time off requests.</p>}
          </div>
        </div>
      )}

      {/* Shared Spaces Panel */}
      {calPanel === 'spaces' && (
        <div className="cal-panel">
          <h3>Reserve a Shared Space</h3>
          <div className="cal-panel-form">
            <select value={spaceForm.spaceId} onChange={e => setSpaceForm(p => ({...p, spaceId: e.target.value}))}>
              <option value="">Select space...</option>
              {sharedSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={spaceForm.date} onChange={e => setSpaceForm(p => ({...p, date: e.target.value}))} />
            <input type="time" value={spaceForm.startTime} onChange={e => setSpaceForm(p => ({...p, startTime: e.target.value}))} />
            <input type="time" value={spaceForm.endTime} onChange={e => setSpaceForm(p => ({...p, endTime: e.target.value}))} />
            <input type="text" placeholder="Purpose" value={spaceForm.purpose} onChange={e => setSpaceForm(p => ({...p, purpose: e.target.value}))} />
            <button className="cal-panel-submit" onClick={handleSpaceReserve} disabled={spaceSubmitting || !spaceForm.spaceId || !spaceForm.date}>
              {spaceSubmitting ? 'Reserving...' : 'Reserve'}
            </button>
          </div>
          <div className="cal-panel-list">
            {spaceReservations.length > 0 ? spaceReservations.map(r => (
              <div key={r.id} className="cal-panel-item">
                {/* The owner's name only comes back on your own bookings unless
                    you're admin/front desk — everyone else's read as "Reserved". */}
                <span><strong>{r.space?.name}</strong> — {r.user?.fullName || 'Reserved'}</span>
                <span className="text-muted" style={{fontSize: 12}}>{new Date(r.startTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} – {new Date(r.endTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            )) : <p className="text-muted" style={{fontSize: 13}}>No reservations yet.</p>}
          </div>
        </div>
      )}

      <div className="calendar-glass-box">
        {view === 'list' && (
          <div className="calendar-scroll-wrapper">
             <div className="week-schedule-grid">
                {/* 7 Days Columns */}
                <div className="week-days-container" style={{ borderLeft: 'none' }}>
                  {weekDates.map((date, idx) => {
                    const isToday = toISODate(date) === toISODate(new Date());
                    const dayEvents = [
                      ...events.filter(e => e.dateStr === toISODate(date)),
                      // Shifts are excluded here for the same reason as in the
                      // agenda grid — they live in the Shifts view.
                      ...staffEvents.filter(e => e.dateStr === toISODate(date) && e.kind !== 'shift'),
                    ].sort((a, b) => {
                      const pa = a.kind === 'pto' ? -1 : parseTimeToPix(a.time);
                      const pb = b.kind === 'pto' ? -1 : parseTimeToPix(b.time);
                      return pa - pb;
                    });
                    
                    const allDayEvents = dayEvents.filter(e => e.kind === 'pto' || e.kind === 'holiday' || (e.time && e.time.toLowerCase().includes('all-day')));
                    const normalEvents = dayEvents.filter(e => e.kind !== 'pto' && e.kind !== 'holiday' && !(e.time && e.time.toLowerCase().includes('all-day')));
                    
                    return (
                      <div key={idx} className={`week-day-col ${isToday ? 'today' : ''}`}>
                         <div className="week-day-header">
                           <div className="week-day-name">{WEEK_DAYS[idx]}</div>
                           <div className="week-day-num">{date.getDate()}</div>
                           <div className="week-day-allday">
                             {allDayEvents.map(item => (
                               <div key={item.id} className={`mini-event ${item.kind || item.subject}`} title={item.title}>
                                 <span className="mini-event-title">{item.title}</span>
                               </div>
                             ))}
                           </div>
                         </div>
                         <div className="week-day-body" style={{ minHeight: 'auto', padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                           {normalEvents.map(item => {
                              const isStaff = !!item.kind;
                              // Match the color themes based on subject
                              let themeClass = isStaff ? item.kind : item.subject;
                              return (
                                <div
                                  key={item.id}
                                  className={`tb-list-event ${themeClass}`}
                                  onClick={!isStaff ? () => handleEventClick(item) : undefined}
                                >
                                  <div className="tb-list-ev-time">
                                    {item.time}
                                  </div>
                                  <div className="tb-list-ev-title">
                                    {!isStaff && <CheckCircle2 size={11} className="tb-list-ev-check" />}
                                    <strong>{item.title}</strong>
                                  </div>
                                  {!isStaff && (
                                    <div className="tb-list-ev-desc">
                                      Zoom Lesson with {item.teacher.replace('Prof. ', '')}
                                    </div>
                                  )}
                                </div>
                              );
                           })}
                         </div>
                      </div>
                    );
                  })}
                </div>
             </div>
          </div>
        )}

        {view === 'week' && (
          <div className="calendar-scroll-wrapper">
             <div className="week-schedule-grid" ref={weekGridRef}>
                {/* Time Axis — shows hover time label in blue when user moves over the grid */}
                <div className="time-axis" style={{ position: 'relative' }}>
                  {/* Deliberately empty: it aligns the hour axis with the
                      header row above and carries no label. It used to read
                      "GMT-5", which claimed a conversion that never happens —
                      session times are the academy's wall clock, stored and
                      read as-is (see lib/time.js) — and was wrong outright
                      from March to November, when the academy is GMT-4.
                      Its height mirrors the day column's header + gap so the
                      hour labels line up with the hour lines. */}
                  <div
                    className="time-axis-header"
                    style={weekAxisHeaderH ? { height: `${weekAxisHeaderH}px` } : undefined}
                  />
                  {Array.from({ length: 24 - START_HOUR }).map((_, i) => {
                    const hour = START_HOUR + i;
                    const label = hour === 0 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;
                    return (
                      <div key={i} className="time-label" style={{ height: `${60 * PIXELS_PER_MINUTE}px` }}>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                  {/* Hover time label floats in the axis */}
                  {hoverTime && (
                    <div className="hover-time-axis-label" style={{ top: `${hoverTime.top + 60}px` }}>
                      {hoverTime.label}
                    </div>
                  )}
                </div>
                
                {/* 7 Days Columns */}
                <div className="week-days-container">
                  {weekDates.map((date, idx) => {
                    const isToday = toISODate(date) === toISODate(new Date());
                    const dayEvents = events.filter(e => e.dateStr === toISODate(date));
                    const staffDayEvents = staffEvents.filter(e => e.dateStr === toISODate(date));
                    
                    // Staff events like PTO / Holidays / All Day go in the header
                    const allDayEvents = staffDayEvents.filter(e => e.kind === 'pto' || e.kind === 'holiday' || (e.time && e.time.toLowerCase().includes('all-day')));
                    
                    // Regular events + meetings go in the grid. Work shifts do
                    // not: a rota that runs alongside the teaching day competes
                    // with the classes for column width and reads as if it were
                    // one of them (a front-desk shift titled like a class is
                    // indistinguishable from it). They get their own view.
                    const gridEvents = [
                       ...dayEvents,
                       ...staffDayEvents.filter(e => e.kind !== 'pto' && e.kind !== 'holiday' && e.kind !== 'shift' && !(e.time && e.time.toLowerCase().includes('all-day')))
                    ];
                    
                    const layout = layoutOverlaps(gridEvents);
                    
                    return (
                      <div key={idx} className={`week-day-col ${isToday ? 'today' : ''}`}>
                         <div className="week-day-header">
                           <div className="week-day-name">{WEEK_DAYS[idx]}</div>
                           <div className="week-day-num">{date.getDate()}</div>
                           <div className="week-day-allday">
                             {allDayEvents.map(item => (
                               <div key={item.id} className={`mini-event ${item.kind || item.subject}`} title={item.title}>
                                 <span className="mini-event-title">{item.title}</span>
                               </div>
                             ))}
                           </div>
                         </div>
                         <div 
                           className="week-day-body"
                           style={{ minHeight: `${(24 - START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
                           onDragOver={e => e.preventDefault()}
                           onDrop={e => handleDropOnWeekDay(e, date)}
                           onMouseMove={e => {
                             const rect = e.currentTarget.getBoundingClientRect();
                             let y = e.clientY - rect.top;
                             if (y < 0) y = 0;
                             const totalMins = y / PIXELS_PER_MINUTE;
                             const snapped = Math.round(totalMins / 5) * 5;
                             const h = Math.floor(snapped / 60) + START_HOUR;
                             const m = snapped % 60;
                             const displayH = h % 12 === 0 ? 12 : h % 12;
                             const period = (h % 24) < 12 ? 'AM' : 'PM';
                             const label = `${displayH}:${String(m).padStart(2, '0')} ${period}`;
                             setHoverTime({ top: snapped * PIXELS_PER_MINUTE, label });
                           }}
                           onMouseLeave={() => setHoverTime(null)}
                           onClick={e => handleGridClick(e, date)}
                         >

                           {/* Horizontal lines */}
                           {Array.from({ length: 24 - START_HOUR }).map((_, i) => (
                             <React.Fragment key={i}>
                               <div className="grid-hour-line" style={{ top: `${i * 60 * PIXELS_PER_MINUTE}px` }} />
                               <div className="grid-halfhour-line" style={{ top: `${(i * 60 + 30) * PIXELS_PER_MINUTE}px` }} />
                             </React.Fragment>
                           ))}
                           {/* Unlike Day view, `currentDate` here is just the
                               anchor for the visible week — any of its 7
                               columns could be the real "today", so each
                               column checks for itself instead of reusing
                               showNowLine. */}
                           {isToday && nowOffsetMins >= 0 && nowOffsetMins <= (24 - START_HOUR) * 60 && (
                             <div className="now-line" style={{ top: `${nowOffsetPix}px` }} />
                           )}

                           {/* Events */}
                           {gridEvents.map(item => {
                              const isStaff = !!item.kind;
                              const { top, height } = getPositionStyles(item.time);
                              const pxHeight = parseFloat(height.replace('px',''));
                              const overlapStyles = getOverlapStyles(item, layout);
                              
                              return (
                                <div
                                  key={item.id}
                                  className={`agenda-event ${isStaff ? item.kind : item.subject}`}
                                  style={{
                                    position: 'absolute',
                                    top,
                                    height,
                                    zIndex: 10,
                                    cursor: isStaff ? 'default' : (hasRole('ADMIN') ? 'grab' : 'pointer'),
                                    ...overlapStyles
                                  }}
                                  title={isStaff ? `${item.title} · ${item.time}` : `${item.title} · ${item.time} · ${item.teacher}`}
                                  draggable={!isStaff && hasRole('ADMIN')}
                                  onDragStart={!isStaff ? (evt) => handleDragStart(evt, item) : undefined}
                                  onClick={!isStaff ? () => handleEventClick(item) : undefined}
                                >
                                  <span className="agenda-ev-time">{item.time}</span>
                                  <div className="agenda-ev-title">
                                    {!isStaff && <CheckCircle2 size={13} className="agenda-ev-check" />}
                                    <strong>{item.title}</strong>
                                  </div>
                                  {!isStaff && pxHeight > 40 && ( // hide desc if very small block
                                    <span className="agenda-ev-desc" style={{ marginTop: 2 }}>
                                      <span>{item.teacher.replace('Prof. ', '')}</span>
                                    </span>
                                  )}
                                </div>
                              );
                           })}
                         </div>
                      </div>
                    );
                  })}
                </div>
             </div>
          </div>
        )}

        {view === 'day' && uniqueTeachers.length === 0 && (
          <div className="calendar-empty-day">
            <CalendarIcon size={40} />
            <h3>No classes scheduled</h3>
            <p>
              {sessionsLoading
                ? 'Loading the day…'
                : `Nothing on the books for ${currentDate.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
            </p>
            {canAddEvents && !sessionsLoading && (
              <button className="calendar-empty-cta" onClick={() => setActiveModal('full')}>
                <Plus size={15} /> Add an event
              </button>
            )}
          </div>
        )}

        {view === 'day' && uniqueTeachers.length > 0 && (
          <div className="calendar-scroll-wrapper">
             <div className="instructor-schedule-grid">
                {/* Time Axis */}
                <div className="time-axis">
                  {/* Deliberately empty: it aligns the hour axis with the
                      header row above and carries no label. It used to read
                      "GMT-5", which claimed a conversion that never happens —
                      session times are the academy's wall clock, stored and
                      read as-is (see lib/time.js) — and was wrong outright
                      from March to November, when the academy is GMT-4. */}
                  <div className="time-axis-header" />
                  {Array.from({ length: 24 - START_HOUR }).map((_, i) => {
                    const hour = START_HOUR + i;
                    const label = hour === 0 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;
                    return (
                      <div key={i} className="time-label" style={{ height: `${60 * PIXELS_PER_MINUTE}px` }}>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Instructors Columns */}
                {uniqueTeachers.map(teacher => {
                  const teacherEvents = dayEventsList.filter(e => {
                    // Only render the class in the primary teacher's column to avoid visual duplication
                    const primary = e.allTeacherNames && e.allTeacherNames.length > 0 ? e.allTeacherNames[0] : e.teacher;
                    return primary === teacher;
                  });
                  const teacherLayout = layoutOverlaps(teacherEvents);
                  // PTO has no time-of-day, so it can't be positioned on the
                  // timeline like a real session — it shows as a badge on the
                  // column header instead.
                  const teacherName = teacher.replace('Prof. ', '');
                  const isOutToday = staffEvents.some(se =>
                    se.kind === 'pto' && se.dateStr === toISODate(currentDate) &&
                    se.teacherName.replace('Prof. ', '') === teacherName
                  );
                  return (
                    <div
                      key={teacher}
                      className="instructor-col"
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDropOnTeacher(e, teacher)}
                    >
                      <div className="instructor-header">
                         <div className="avatar">{teacherName.charAt(0).toUpperCase()}</div>
                         <div className="name">{teacherName}</div>
                         {isOutToday && <span className="instructor-pto-badge">Out</span>}
                      </div>

                      <div 
                         className="timeline-container" 
                         style={{ height: `${(24 - START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
                         onClick={e => handleGridClick(e, currentDate, teacher)}
                      >
                         {/* Background Hour Lines */}
                         {Array.from({ length: 24 - START_HOUR }).map((_, i) => (
                           <React.Fragment key={i}>
                             <div className="hourLine" style={{ top: `${i * 60 * PIXELS_PER_MINUTE}px` }}></div>
                             <div className="grid-halfhour-line" style={{ top: `${(i * 60 + 30) * PIXELS_PER_MINUTE}px` }}></div>
                           </React.Fragment>
                         ))}
                         {showNowLine && <div className="now-line" style={{ top: `${nowOffsetPix}px` }} />}

                         {/* Events */}
                         {teacherEvents.map(e => (
                           <div
                             key={e.id}
                             className={`positioned-event ${e.subject}`}
                             style={{...getPositionStyles(e.time), ...getOverlapStyles(e, teacherLayout), cursor: hasRole('ADMIN') ? 'grab' : 'pointer'}}
                             draggable={hasRole('ADMIN')}
                             onDragStart={(evt) => handleDragStart(evt, e)}
                             onClick={() => handleEventClick(e)}
                           >
                             <div className="event-inner">
                               <strong>{e.title}</strong>
                               <span className="ev-time">{e.time}</span>
                               <span className="ev-meta">
                                 {e.type === 'Virtual' ? <Video size={10} /> : <MapPin size={10} />}
                                 {e.students} students
                               </span>
                             </div>
                           </div>
                         ))}
                      </div>
                    </div>
                  );
                })}
             </div>
          </div>
        )}

        {view === 'timeline' && timelineSubjectGroups.length === 0 && (
          <div className="calendar-empty-day">
            <CalendarIcon size={40} />
            <h3>No classes scheduled</h3>
            <p>
              {sessionsLoading
                ? 'Loading the day…'
                : `Nothing on the books for ${currentDate.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
            </p>
            {canAddEvents && !sessionsLoading && (
              <button className="calendar-empty-cta" onClick={() => setActiveModal('full')}>
                <Plus size={15} /> Add an event
              </button>
            )}
          </div>
        )}

        {view === 'timeline' && timelineSubjectGroups.length > 0 && (
          <div className="calendar-scroll-wrapper">
            <div className="timeline-view-grid" style={timelineGridVars}>
              <div className="timeline-hours-header">
                <div className="timeline-row-label-spacer" />
                <div className="timeline-hours-track" style={{ width: `${timelineWidth}px` }}>
                  {timelineHalfHourTicks.map((_, i) => {
                    const totalMin = i * 30;
                    const hour = START_HOUR + Math.floor(totalMin / 60);
                    const min = totalMin % 60;
                    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                    const label = `${h12}:${String(min).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
                    return (
                      <div key={i} className="timeline-hour-label" style={{ width: `${30 * PIXELS_PER_MINUTE}px` }}>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* TutorBird's Timeline always opens on a school-wide row before
                  the subject groups — we have no org-wide all-day banner to put
                  in it yet, so it renders as chrome, matching the empty state
                  TutorBird itself shows on a day with no birthdays. */}
              <div className="timeline-row timeline-entire-school-row">
                <div className="timeline-row-label"><div className="name">Entire School</div></div>
                <div className="timeline-h-track" style={{ width: `${timelineWidth}px`, height: `${TIMELINE_EVENT_ROW_HEIGHT + 8}px` }}>
                  {timelineHourLines}
                </div>
              </div>

              {timelineSubjectGroups.map(group => {
                const isOpen = !!expandedTimelineGroups[group.label];
                return (
                  <React.Fragment key={group.label}>
                    <div
                      className="timeline-row timeline-group-header-row"
                      onClick={() => setExpandedTimelineGroups(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                    >
                      <div className="timeline-row-label timeline-group-label">
                        <ChevronRight size={14} className={`timeline-group-arrow ${isOpen ? 'open' : ''}`} />
                        <span className="name">{group.label}</span>
                      </div>
                      <div className="timeline-h-track" style={{ width: `${timelineWidth}px`, height: `${TIMELINE_EVENT_ROW_HEIGHT + 8}px` }}>
                        {timelineHourLines}
                      </div>
                    </div>

                    {isOpen && (
                      <>
                        <div className="timeline-row timeline-nested-entire-school-row">
                          <div className="timeline-row-label"><div className="name">Entire School</div></div>
                          <div className="timeline-h-track" style={{ width: `${timelineWidth}px`, height: `${TIMELINE_EVENT_ROW_HEIGHT + 8}px` }}>
                            {timelineHourLines}
                          </div>
                        </div>

                        {group.teacherNames.map(teacher => {
                          const teacherEvents = dayEventsList.filter(e => {
                            const primary = e.allTeacherNames && e.allTeacherNames.length > 0 ? e.allTeacherNames[0] : e.teacher;
                            return primary === teacher && (e.rawSubject || UNSPECIFIED_SUBJECT) === group.label;
                          });
                          const teacherLayout = layoutOverlaps(teacherEvents);
                          const maxCols = teacherEvents.reduce((max, e) => Math.max(max, (teacherLayout.get(e.id) || { cols: 1 }).cols), 1);
                          const rowHeight = maxCols * TIMELINE_EVENT_ROW_HEIGHT + 8;
                          const teacherName = teacher.replace('Prof. ', '');
                          const isOutToday = staffEvents.some(se =>
                            se.kind === 'pto' && se.dateStr === toISODate(currentDate) &&
                            se.teacherName.replace('Prof. ', '') === teacherName
                          );
                          return (
                            <div key={teacher} className="timeline-row">
                              <div className="timeline-row-label">
                                <div className="avatar">{teacherName.charAt(0).toUpperCase()}</div>
                                <div className="name">{teacherName}</div>
                                {isOutToday && <span className="instructor-pto-badge">Out</span>}
                              </div>
                              <div
                                className="timeline-h-track"
                                style={{ width: `${timelineWidth}px`, height: `${rowHeight}px` }}
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => handleDropOnTeacher(e, teacher)}
                              >
                                {timelineHourLines}
                                {teacherEvents.map(e => {
                                  const { col } = teacherLayout.get(e.id) || { col: 0 };
                                  const left = parseTimeToPix(e.time);
                                  const width = Math.max(getDurationMins(e.time) * PIXELS_PER_MINUTE - 6, 50);
                                  return (
                                    <div
                                      key={e.id}
                                      className={`timeline-event ${e.subject}`}
                                      style={{
                                        left: `${left + 3}px`,
                                        width: `${width}px`,
                                        top: `${col * TIMELINE_EVENT_ROW_HEIGHT + 4}px`,
                                        height: `${TIMELINE_EVENT_ROW_HEIGHT - 6}px`,
                                        cursor: hasRole('ADMIN') ? 'grab' : 'pointer',
                                      }}
                                      draggable={hasRole('ADMIN')}
                                      onDragStart={(evt) => handleDragStart(evt, e)}
                                      onClick={() => handleEventClick(e)}
                                    >
                                      <strong>{e.title}</strong>
                                      <span className="ev-time">{e.time}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {view === 'month' && (
          <div className="calendar-scroll-wrapper">
            <div className="month-grid">
              {WEEK_DAYS.map(day => (
                <div key={day} className="month-day-name">{day}</div>
              ))}
              
              {monthCells.map((_, idx) => {
                const dayNum = idx - startOffset + 1;
                const isCurrentMonth = dayNum > 0 && dayNum <= daysInMonth;
                const cellDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNum);
                const isToday = isCurrentMonth && toISODate(cellDate) === toISODate(new Date());
                // Vacation/sick chips (no real time) float to the top of the day;
                // everything else — classes and shared-space meetings — is
                // chronological underneath.
                const dayEvents = isCurrentMonth
                  ? [
                      ...events.filter(e => e.dateStr === toISODate(cellDate)),
                      // Shifts live in the Shifts view, not among the classes.
                      ...staffEvents.filter(e => e.dateStr === toISODate(cellDate) && e.kind !== 'shift'),
                    ].sort((a, b) => {
                      const pa = a.kind === 'pto' ? -1 : parseTimeToPix(a.time);
                      const pb = b.kind === 'pto' ? -1 : parseTimeToPix(b.time);
                      return pa - pb;
                    })
                  : [];

                // On the 1st of the month, label the cell "Jul 1" instead of a
                // bare "1" so a week spanning two months doesn't read as ambiguous.
                const cellDateLabel = dayNum === 1
                  ? `${cellDate.toLocaleString('en-US', { month: 'short' })} ${dayNum}`
                  : dayNum;

                return (
                  <div
                    key={idx}
                    className={`month-cell ${!isCurrentMonth ? 'inactive' : ''} ${isToday ? 'today' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropOnWeekDay(e, cellDate)}
                  >
                    {isCurrentMonth && (
                      <>
                        <div className="month-cell-top">
                          <span className="cell-date">{cellDateLabel}</span>
                        </div>
                        <div className="cell-events-area">
                          {(isMonthDayExpanded(cellDate) ? dayEvents : dayEvents.slice(0, MONTH_CELL_EVENT_CAP)).map(item => {
                            const isStaff = !!item.kind;
                            return (
                              <div
                                key={item.id}
                                className={`mini-event ${isStaff ? item.kind : item.subject}`}
                                title={`${item.time} — ${item.title}`}
                                draggable={!isStaff && hasRole('ADMIN')}
                                onDragStart={!isStaff ? (evt) => handleDragStart(evt, item) : undefined}
                                onClick={!isStaff ? () => handleEventClick(item) : undefined}
                                style={{ cursor: isStaff ? 'default' : (hasRole('ADMIN') ? 'grab' : 'pointer') }}
                              >
                                <span className="mini-event-time">{item.time}</span>
                                <span className="mini-event-title">
                                  {!isStaff && <CheckCircle2 size={11} style={{ flexShrink: 0, opacity: 0.8 }} />}
                                  {item.title}
                                </span>
                                {!isStaff && item.teacher && (
                                  <span className="mini-event-subtitle">
                                    {item.type} with {item.teacher.replace('Prof. ', '')}
                                  </span>
                                )}
                              </div>
                            );
                          })}

                          {dayEvents.length > MONTH_CELL_EVENT_CAP && (
                            <button
                              type="button"
                              className="month-more-btn"
                              onClick={() => toggleMonthDay(cellDate)}
                            >
                              {isMonthDayExpanded(cellDate)
                                ? 'Show less'
                                : `+${dayEvents.length - MONTH_CELL_EVENT_CAP} more`}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shifts — the paid hours that aren't classes (front desk, planning,
            a staff meeting). Kept out of the class grids on purpose: side by
            side they compete for column width and a shift titled like a class
            is indistinguishable from one. Grouped by person rather than laid
            on a timeline, because what this view answers is "who is covering
            what this week", not "what happens at 2pm". */}
        {view === 'shifts' && (
          <div className="calendar-scroll-wrapper">
            <div className="week-schedule-grid">
              <div className="week-days-container" style={{ borderLeft: 'none' }}>
                {weekDates.map((date, idx) => {
                  const isToday = toISODate(date) === toISODate(new Date());
                  const dayShifts = staffEvents
                    .filter(e => e.kind === 'shift' && e.dateStr === toISODate(date))
                    .sort((a, b) => parseTimeToPix(a.time) - parseTimeToPix(b.time));

                  return (
                    <div key={idx} className={`week-day-col ${isToday ? 'today' : ''}`}>
                      <div className="week-day-header">
                        <div className="week-day-name">{WEEK_DAYS[idx]}</div>
                        <div className="week-day-num">{date.getDate()}</div>
                      </div>
                      <div className="week-day-list">
                        {dayShifts.length === 0 ? (
                          <div className="shift-day-empty">—</div>
                        ) : dayShifts.map(item => (
                          <div
                            key={item.id}
                            className="agenda-event shift"
                            style={{ position: 'relative', cursor: 'default', borderLeftColor: item.categoryColor || undefined }}
                            title={`${item.title} · ${item.time}`}
                          >
                            <span className="agenda-ev-time">{item.time}</span>
                            <div className="agenda-ev-title"><strong>{item.title}</strong></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Session Details Modal */}
      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: isEditingEvent ? '700px' : undefined }}>
            <div className="modal-header">
              <div className="modal-title-area">
                {isEditingEvent ? (
                  <>
                    <select 
                      className="form-control" 
                      value={editEventForm.subject} 
                      onChange={e => setEditEventForm(prev => ({ ...prev, subject: e.target.value }))}
                      style={{ width: 'auto', padding: '4px 8px', fontSize: '12px', borderRadius: '12px', fontWeight: 700 }}
                    >
                      <option value="math">math</option>
                      <option value="science">science</option>
                      <option value="languages">languages</option>
                      <option value="arts">arts</option>
                    </select>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={editEventForm.title} 
                      onChange={e => setEditEventForm(prev => ({ ...prev, title: e.target.value }))}
                      style={{ fontSize: '18px', fontWeight: 700, border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', width: '100%' }}
                    />
                  </>
                ) : (
                  <>
                    <div className={`subject-tag ${selectedEvent.subject}`}>{selectedEvent.subject}</div>
                    <h2>{selectedEvent.title}</h2>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {hasRole('ADMIN') && !isEditingEvent && selectedEvent.teacherId && (
                  <button
                    className="icon-btn-text"
                    onClick={() => navigate(`/portal/teacher?teacherId=${selectedEvent.teacherId}&sessionId=${selectedEvent.id}&date=${selectedEvent.dateStr}`)}
                    title="Take Attendance"
                    style={{ color: 'var(--primary)' }}
                  >
                    <ClipboardCheck size={18} />
                  </button>
                )}
                {isAdmin && !isEditingEvent && (
                  <>
                    <button
                      className="icon-btn-text"
                      onClick={handleStartEditEvent}
                      title="Edit Class"
                      style={{ color: 'var(--primary)' }}
                    >
                      <Pencil size={18} />
                    </button>
                    <button 
                      className="icon-btn-text" 
                      onClick={() => confirmDeleteEvent(selectedEvent)}
                      title="Delete Event"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash2 size={18} />
                    </button>
                    <button 
                      className={`icon-btn-text ${selectedEvent.meetingUrl || isEditingLink ? 'active' : ''}`} 
                      onClick={handleToggleZoom}
                      title={selectedEvent.meetingUrl ? "Edit this meeting's Zoom link" : "Add a Zoom link to this meeting"}
                      style={{ color: selectedEvent.meetingUrl || isEditingLink ? 'var(--primary)' : '#64748b' }}
                    >
                      <Video size={18} />
                    </button>
                  </>
                )}
                {isEditingEvent && (
                  <>
                    <button className="cancel-btn" onClick={() => setIsEditingEvent(false)} style={{ padding: '6px 14px', fontSize: '13px' }}>Cancel</button>
                    <button className="save-btn" onClick={handleSaveEventEdit} style={{ padding: '6px 14px', fontSize: '13px' }}>
                      <Save size={14} /> Save
                    </button>
                  </>
                )}
                <button className="close-modal" onClick={() => setSelectedEvent(null)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="modal-body">
              {/* ── Meta / Edit Fields ── */}
              <div className="session-meta-grid">
                {isEditingEvent ? (
                  <>
                    <div className="meta-item" style={{ flexWrap: 'wrap' }}>
                      <User size={16} />
                      <select
                        className="form-control"
                        value={editEventForm.teacherId}
                        onChange={e => setEditEventForm(prev => ({ ...prev, teacherId: e.target.value }))}
                        style={{ flex: 1, height: '34px', fontSize: '13px' }}
                      >
                        <option value="">Unassigned (Primary)</option>
                        {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <AddSelfAsTeacher
                        teacherIds={teachers.map(t => t.id)}
                        onAdded={async (userId) => {
                          await reloadTeachers();
                          setEditEventForm(prev => ({ ...prev, teacherId: userId }));
                        }}
                        onError={toast.error}
                      />
                    </div>
                    <div className="meta-item" style={{ flexWrap: 'wrap', marginTop: '-8px' }}>
                      <User size={16} style={{ visibility: 'hidden' }} />
                      <select
                        className="form-control"
                        multiple
                        value={editEventForm.coTeacherIds || []}
                        onChange={e => {
                          const options = [...e.target.selectedOptions];
                          const values = options.map(o => o.value);
                          setEditEventForm(prev => ({ ...prev, coTeacherIds: values }));
                        }}
                        style={{ flex: 1, minHeight: '60px', fontSize: '13px', marginTop: '4px' }}
                      >
                        {teachers.filter(t => t.id !== editEventForm.teacherId).map(t => (
                          <option key={t.id} value={t.id}>{t.name} (Co-teacher)</option>
                        ))}
                      </select>
                    </div>
                    <div className="meta-item cal-edit-when">
                      <Clock size={16} />
                      <input
                        type="date"
                        className="form-control"
                        value={editEventForm.date}
                        onChange={e => setEditEventForm(prev => ({ ...prev, date: e.target.value }))}
                        title="Date"
                      />
                      <input
                        type="time"
                        className="form-control"
                        value={editEventForm.startTime}
                        onChange={e => setEditEventForm(prev => ({ ...prev, startTime: e.target.value }))}
                        title="Start time"
                      />
                      <span className="text-muted">to</span>
                      <input
                        type="time"
                        className="form-control"
                        value={editEventForm.endTime}
                        onChange={e => setEditEventForm(prev => ({ ...prev, endTime: e.target.value }))}
                        title="End time"
                      />
                    </div>
                    <label className="cal-series-toggle">
                      <input
                        type="checkbox"
                        checked={editEventForm.applyToSeries}
                        onChange={e => setEditEventForm(prev => ({ ...prev, applyToSeries: e.target.checked }))}
                      />
                      <span>
                        Apply this time to every later {weekdayNameOf(editEventForm.origDate)} session of this class
                        {editEventForm.date !== editEventForm.origDate && ' (the date change stays on this one session)'}
                      </span>
                    </label>
                    <div className="meta-item">
                      <Settings size={16} />
                      <select
                        className="form-control"
                        value={editEventForm.subject}
                        onChange={e => setEditEventForm(prev => ({ ...prev, subject: e.target.value }))}
                        style={{ flex: 1, height: '34px', fontSize: '13px' }}
                      >
                        <option value="math">Math</option>
                        <option value="science">Science</option>
                        <option value="languages">Languages</option>
                        <option value="arts">Arts</option>
                      </select>
                    </div>

                    {/* What kind of work this hour is, for pay. A private
                        tutoring hour and an in-person class are the same shape
                        of row, so nothing but this can tell them apart — and
                        without it they'd pay the same rate. */}
                    {canSetPay && (
                      <div className="cal-pay-block">
                        <div className="meta-item">
                          <DollarSign size={16} />
                          <select
                            className="form-control"
                            value={editEventForm.payCategoryKey}
                            onChange={e => setEditEventForm(prev => ({ ...prev, payCategoryKey: e.target.value }))}
                            style={{ flex: 1, height: '34px', fontSize: '13px' }}
                            title="What this hour pays as"
                          >
                            <option value="">
                              Work it out automatically ({selectedEvent.type === 'Virtual' ? 'online session' : 'in-person class'})
                            </option>
                            {payCategories.map(c => (
                              <option key={c.key} value={c.key}>
                                {c.label}{c.defaultRate != null ? ` — $${Number(c.defaultRate).toFixed(2)}/hr` : ''}
                              </option>
                            ))}
                          </select>
                          <div className="cal-pay-rate">
                            <span>$</span>
                            <input
                              type="number" min="0" step="0.01" inputMode="decimal"
                              className="form-control"
                              value={editEventForm.payRateOverride}
                              onChange={e => setEditEventForm(prev => ({ ...prev, payRateOverride: e.target.value }))}
                              placeholder="rate"
                              title="A rate for this one session, overriding everything else"
                            />
                            <span>/hr</span>
                          </div>
                        </div>

                        {/* Somebody else covered this one meeting. Sits in the
                            pay block because that is what it decides: the hour
                            comes off the class teacher's payslip and lands on
                            the cover's, priced from their contract. Scoped to
                            this session alone — the teacher picker at the top
                            of the modal is the one that moves the timetable. */}
                        <label className="cal-series-toggle cal-sub-toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(editEventForm.substituteTeacherId)}
                            onChange={e => setEditEventForm(prev => ({
                              ...prev,
                              // Unticking hands the hour back to the class.
                              substituteTeacherId: e.target.checked
                                ? (prev.substituteTeacherId || selectedEvent.classTeacherId || '')
                                : '',
                            }))}
                          />
                          <span>
                            Someone covered this session
                            {selectedEvent.classTeacherName ? ` for ${selectedEvent.classTeacherName}` : ''}
                          </span>
                        </label>

                        {Boolean(editEventForm.substituteTeacherId) && (
                          <div className="meta-item">
                            <User size={16} />
                            <select
                              className="form-control"
                              value={editEventForm.substituteTeacherId}
                              onChange={e => setEditEventForm(prev => ({ ...prev, substituteTeacherId: e.target.value }))}
                              style={{ flex: 1, height: '34px', fontSize: '13px' }}
                              title="Who actually taught this session"
                            >
                              {teachers.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name}{t.id === selectedEvent.classTeacherId ? ' (whose class this is)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <label className="cal-series-toggle">
                          <input
                            type="checkbox"
                            checked={editEventForm.applyCategoryToSeries}
                            onChange={e => setEditEventForm(prev => ({ ...prev, applyCategoryToSeries: e.target.checked }))}
                          />
                          <span>
                            Pay every {weekdayNameOf(editEventForm.origDate)} session of this class from here on the same way
                          </span>
                        </label>

                        {/* An hour that has passed carries the rate it was
                            worked at, so changing the category now cannot move
                            what was already paid — better said here than
                            discovered on the payslip. */}
                        <p className="cal-pay-hint">
                          {selectedEvent.paidRate != null
                            ? `This hour has already been priced at $${selectedEvent.paidRate.toFixed(2)}/hr. Changing the category re-prices it at the new rate.`
                            : 'Leave the rate empty to use the category’s rate, or the teacher’s own rate for that work.'}
                        </p>
                      </div>
                    )}

                    {/* What this meeting costs the family — the other side of
                        the block above. Most sessions leave it empty: the term
                        is billed by the quarterly run, and pricing every
                        session too would charge twice. This is for the one-off
                        — a workshop, a make-up lesson, a week that costs
                        something on its own. */}
                    {canSetPay && (
                      <div className="cal-charge-block">
                        <div className="meta-item">
                          <Receipt size={16} />
                          <div className="cal-charge-amount">
                            <span>$</span>
                            <input
                              type="number" min="0" step="0.01" inputMode="decimal"
                              className="form-control"
                              value={editEventForm.chargeAmount}
                              onChange={e => setEditEventForm(prev => ({ ...prev, chargeAmount: e.target.value }))}
                              placeholder="price"
                              title="What each enrolled family is charged for this meeting"
                            />
                          </div>
                          <input
                            type="text"
                            className="form-control cal-charge-note"
                            value={editEventForm.chargeNote}
                            onChange={e => setEditEventForm(prev => ({ ...prev, chargeNote: e.target.value }))}
                            placeholder={`What the family sees (default: “${selectedEvent.title}”)`}
                            title="The description that lands on the invoice line"
                          />
                        </div>

                        <p className="cal-pay-hint">
                          {editEventForm.chargeAmount === '' || editEventForm.chargeAmount == null
                            ? 'Leave this empty and the meeting charges nothing — the term’s tuition is billed separately.'
                            : `Charges each of the ${selectedEvent.students} enrolled ${selectedEvent.students === 1 ? 'family' : 'families'} $${Number(editEventForm.chargeAmount || 0).toFixed(2)} as soon as you save. To correct it, change the price here — clearing it takes the charge back off their balance, unless it has already gone onto an invoice.`}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="meta-item">
                      <User size={16} />
                      <span>{selectedEvent.teacher}</span>
                      {/* `teacher` above is already whoever taught it, so
                          without this the card reads as an ordinary week and
                          the cover is invisible — which is exactly the thing
                          somebody opens this modal in October to check. */}
                      {selectedEvent.substituteTeacherId
                        && selectedEvent.substituteTeacherId !== selectedEvent.classTeacherId && (
                        <span className="cal-sub-badge">
                          Covered{selectedEvent.classTeacherName ? ` for ${selectedEvent.classTeacherName}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="meta-item">
                      <Clock size={16} />
                      <span>{selectedEvent.time}</span>
                    </div>
                    {/* Only worth a row once somebody has actually said what
                        this hour is: an unset one pays the same as it always
                        did, and a line saying "automatic" is noise. */}
                    {canSetPay && selectedEvent.payCategoryKey && (
                      <div className="meta-item">
                        <DollarSign size={16} />
                        <span>
                          {payCategories.find(c => c.key === selectedEvent.payCategoryKey)?.label
                            || selectedEvent.payCategoryKey}
                          {selectedEvent.payRateOverride && (
                            <strong className="cal-pay-tag">${Number(selectedEvent.payRateOverride).toFixed(2)}/hr</strong>
                          )}
                        </span>
                      </div>
                    )}
                    {/* What the family pays for this meeting.
                        Shown even when nothing is set, unlike the pay row above
                        — an admin looking for "what do I charge for this?" has
                        to find the answer here, and a row that only appears
                        once the answer exists is invisible precisely when it is
                        being looked for. */}
                    {canSetPay && (
                      <div className="meta-item">
                        <Receipt size={16} />
                        {selectedEvent.chargeAmount !== '' && selectedEvent.chargeAmount != null ? (
                          <span>
                            <strong>${Number(selectedEvent.chargeAmount).toFixed(2)}</strong> per family
                            {selectedEvent.chargeNote ? ` — ${selectedEvent.chargeNote}` : ''}
                            <small className="cal-charge-pending">approve in Billing to charge and invoice it</small>
                          </span>
                        ) : (
                          <span className="cal-charge-unset">
                            No charge on this meeting
                            <button className="cal-charge-set" onClick={handleStartEditEvent}>
                              set a price
                            </button>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Who is actually being charged, and how much each.
                        The price above is one number for the roster; this is
                        where it stops being one number — a student whose fee
                        already covers this room is set to $0 here, on the entry,
                        with the roster in front of you. */}
                    {canSetPay && (selectedEvent.rosterStudents?.length > 0) && (
                      <div className="cal-charge-roster">
                        {/* Shown on every session, not only priced ones: "what
                            does this child pay" is a question you ask of the
                            meeting in front of you, and a list that only
                            appeared once a room-wide price existed was missing
                            on the majority of the calendar. */}
                        <div className="cal-roster-head">
                          What each student pays
                          <small>click an amount to change it</small>
                        </div>
                        {selectedEvent.rosterStudents.map(st => {
                          const ov = selectedEvent.chargeOverrides?.[st.id];
                          // No price on the meeting is not the same as $0 for a
                          // student: the room charges nothing, but this one
                          // person can still be given a price of their own.
                          const hasListPrice = selectedEvent.chargeAmount !== '' && selectedEvent.chargeAmount != null;
                          const listed = hasListPrice ? Number(selectedEvent.chargeAmount) : null;
                          const pays = ov ? ov.amount : listed;
                          const editing = priceEdit?.studentId === st.id;

                          // Editing this one: the amount becomes a box, with a
                          // reason next to it — a number nobody can explain is
                          // one nobody can defend when the family asks.
                          if (editing) {
                            return (
                              <div className="cal-roster-row cal-roster-row-editing" key={`edit-${st.id}`}>
                                <span className="cal-roster-name">{st.name}</span>
                                <div className="cal-roster-edit">
                                  <span>$</span>
                                  <input
                                    type="number" min="0" step="0.01" inputMode="decimal"
                                    className="form-control"
                                    value={priceEdit.value}
                                    autoFocus
                                    onChange={e => setPriceEdit(p => ({ ...p, value: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleStudentPrice(st.id, priceEdit.value, priceEdit.reason);
                                      if (e.key === 'Escape') setPriceEdit(null);
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="form-control cal-roster-reason"
                                    placeholder="Why? (sibling, scholarship…)"
                                    value={priceEdit.reason}
                                    onChange={e => setPriceEdit(p => ({ ...p, reason: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleStudentPrice(st.id, priceEdit.value, priceEdit.reason);
                                      if (e.key === 'Escape') setPriceEdit(null);
                                    }}
                                  />
                                  <button
                                    className="cal-roster-save"
                                    disabled={saving}
                                    onClick={() => handleStudentPrice(st.id, priceEdit.value, priceEdit.reason)}
                                  >
                                    Save
                                  </button>
                                  <button className="cal-roster-btn" onClick={() => setPriceEdit(null)}>cancel</button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className={`cal-roster-row${ov?.amount === 0 ? ' cal-roster-row-exempt' : ''}`} key={st.id}>
                              <span className="cal-roster-name">{st.name}</span>
                              {/* The amount is the control: click it to price
                                  this student at anything. The links beside it
                                  are only shortcuts for the two commonest
                                  answers, nothing and the full price. */}
                              <button
                                className="cal-roster-amount cal-roster-amount-btn"
                                title={ov?.reason ? `${ov.reason} — click to change` : 'Click to price this student'}
                                onClick={() => setPriceEdit({ studentId: st.id, value: pays == null ? '' : String(pays), reason: ov?.reason || '' })}
                              >
                                {pays == null ? <em>set price</em> : `$${pays.toFixed(2)}`}
                                {ov && hasListPrice && <s>${listed.toFixed(2)}</s>}
                              </button>
                              {ov ? (
                                <button
                                  className="cal-roster-btn"
                                  disabled={saving}
                                  title={hasListPrice
                                    ? "Put this student back on the meeting's own price"
                                    : 'Remove this price — the meeting charges nothing'}
                                  onClick={() => handleStudentPrice(st.id, null)}
                                >
                                  {hasListPrice ? 'charge full price' : 'remove'}
                                </button>
                              ) : hasListPrice ? (
                                <button
                                  className="cal-roster-btn"
                                  disabled={saving}
                                  title="Their fee already covers this — don't charge it again"
                                  onClick={() => handleStudentPrice(st.id, 0, 'Already covered by another fee')}
                                >
                                  don't charge
                                </button>
                              ) : <span />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Pay comes off the calendar now: this hour is paid once
                        it has passed, and this is the only way to stop that.
                        Admins only — it takes money off somebody's payslip. */}
                    {canSetPay && (
                      selectedEvent.absentAt ? (
                        <div className="meta-item cal-absent-row">
                          <UserX size={16} />
                          <span>
                            <strong>Not paid</strong> — the teacher didn't attend
                            {selectedEvent.absentReason ? ` (${selectedEvent.absentReason})` : ''}
                            {selectedEvent.absentBy ? `, marked by ${selectedEvent.absentBy}` : ''}
                          </span>
                          <button
                            className="cancel-btn cal-absent-undo"
                            disabled={saving}
                            onClick={() => handleSetAbsence(false)}
                          >
                            Pay it after all
                          </button>
                        </div>
                      ) : absenceOpen ? (
                        <div className="meta-item cal-absent-row">
                          <UserX size={16} />
                          <input
                            type="text"
                            className="form-control cal-absent-reason"
                            value={absenceReason}
                            onChange={e => setAbsenceReason(e.target.value)}
                            placeholder="Why? (optional — called in sick, no-show…)"
                            autoFocus
                          />
                          <button className="save-btn cal-absent-confirm" disabled={saving} onClick={() => handleSetAbsence(true)}>
                            Don't pay this hour
                          </button>
                          <button className="cancel-btn" onClick={() => { setAbsenceOpen(false); setAbsenceReason(''); }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="meta-item cal-absent-row">
                          <UserX size={16} />
                          <button className="cal-absent-trigger" onClick={() => setAbsenceOpen(true)}>
                            Teacher didn't attend — don't pay this hour
                          </button>
                        </div>
                      )
                    )}
                    <div className={`meta-item${isEditingLink ? ' cal-link-cell' : ''}`} style={{ flexWrap: 'wrap', gap: '8px' }}>
                      {isEditingLink ? (
                        <div className="cal-link-editor">
                          <div className="cal-link-editor-row">
                            <Video size={16} />
                            <input
                              type="text"
                              className="form-control"
                              style={{ height: '32px', fontSize: '13px' }}
                              value={editLink}
                              onChange={e => setEditLink(e.target.value)}
                              placeholder="Paste Zoom Link here..."
                              autoFocus
                            />
                            <button className="save-btn" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={handleSaveLink}>Save</button>
                            {selectedEvent.meetingUrl && (
                              <button className="cancel-btn" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={handleRemoveLink}>Remove</button>
                            )}
                            <button className="cancel-btn" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => setIsEditingLink(false)}>Cancel</button>
                          </div>
                          {canEditSeries && (
                            <label className="cal-series-toggle">
                              <input
                                type="checkbox"
                                checked={linkAppliesToSeries}
                                onChange={e => setLinkAppliesToSeries(e.target.checked)}
                              />
                              <span>
                                Apply this link to every later {weekdayNameOf(selectedEvent.dateStr)} session of this class
                                — the other weekdays stay in person
                              </span>
                            </label>
                          )}
                        </div>
                      ) : (
                        <>
                          {selectedEvent.meetingUrl ? (
                            <>
                              <Video size={16} />
                              <a href={selectedEvent.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: '600', textDecoration: 'underline' }}>
                                Join Zoom Session
                              </a>
                            </>
                          ) : selectedEvent.classType === 'VIRTUAL' ? (
                            <>
                              <Video size={16} />
                              <span>Virtual Session (No Link)</span>
                            </>
                          ) : (
                            <>
                              <MapPin size={16} />
                              <span>In-Person</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── Student Roster ── */}
              <div className="roster-section">
                <div className="notes-header">
                  {/* The headcount is a lie while the roster is unknown — the
                      tile's own number counts enrollments the failed request
                      was meant to list. Show it only once we have the names. */}
                  <h3><User size={18} /> Student Roster{rosterError ? '' : ` (${isEditingEvent ? editEventForm.studentList.length : (selectedEvent.studentList?.length || selectedEvent.students)})`}</h3>
                </div>
                {isEditingEvent && rosterError ? (
                  // Editing on top of a roster we failed to load would offer to
                  // enroll students who are already in the class, so the add bar
                  // stays out of reach until the real roster is in hand.
                  <RosterLoadError onRetry={() => loadEventDetail(selectedEvent)} />
                ) : isEditingEvent ? (
                  <div className="roster-edit-area">
                    <div className="roster-add-bar">
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input 
                          type="text" 
                          className="form-control" 
                          placeholder="Search student to add..." 
                          value={rosterSearch} 
                          onChange={e => setRosterSearch(e.target.value)}
                          style={{ width: '100%', height: '36px', fontSize: '13px' }}
                        />
                        {rosterSearch && (
                          <div className="roster-search-dropdown">
                            {allStudents
                              .filter(s => nameMatches(s.name, rosterSearch) && !editEventForm.studentList.some(x => x.id === s.id))
                              .map(s => (
                                <button key={s.id} className="roster-search-option" onClick={() => handleAddStudentToRoster(s)}>
                                  <UserPlus size={14} /> {s.name}
                                </button>
                              ))
                            }
                            {allStudents.filter(s => nameMatches(s.name, rosterSearch) && !editEventForm.studentList.some(x => x.id === s.id)).length === 0 && (
                              <div className="roster-search-option" style={{ color: '#94a3b8', cursor: 'default' }}>No students found</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="roster-student-list">
                      {editEventForm.studentList.map((student) => (
                        <div key={student.id} className="roster-student-item">
                          <div className="roster-student-avatar">{student.name[0]}</div>
                          <span>{student.name}</span>
                          <button className="roster-remove-btn" onClick={() => handleRemoveStudentFromRoster(student)} title="Remove student">
                            <UserMinus size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="roster-student-list roster-view">
                    {(selectedEvent.studentList || []).length > 0 ? (
                      (selectedEvent.studentList || []).map((name, i) => (
                        <div key={i} className="roster-student-item">
                          <div className="roster-student-avatar">{name[0]}</div>
                          <span>{name}</span>
                        </div>
                      ))
                    ) : rosterError ? (
                      <RosterLoadError onRetry={() => loadEventDetail(selectedEvent)} />
                    ) : selectedEvent.studentList === null ? (
                      <p className="app-inline-loader" style={{ padding: '8px 0' }}><span className="app-spinner-sm" />Loading roster…</p>
                    ) : (
                      <p className="text-muted" style={{ padding: '8px 0' }}>No students enrolled in this class.</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Session Notes (unchanged) ── */}
              <div className="notes-section">
                <div className="notes-header">
                  <h3><FileText size={18} /> Session Notes</h3>
                  {!isEditing ? (
                    <button className="edit-btn-text" onClick={() => setIsEditing(true)}>
                      <Edit2 size={14} /> Edit Notes
                    </button>
                  ) : (
                    <div className="edit-actions">
                      <button className="cancel-btn" onClick={() => setIsEditing(false)}>Cancel</button>
                      <button className="save-btn" onClick={handleSaveNotes} disabled={saving}>
                        <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <textarea 
                    className="modal-notes-area"
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="Write session notes here..."
                  />
                ) : (
                  <div className="notes-display">
                    {selectedEvent.notes || 'No notes published for this session.'}
                  </div>
                )}
              </div>

              <div className="materials-section">
                <h3><Paperclip size={18} /> Materials & Resources</h3>
                <div className="modal-materials-grid">
                  {selectedEvent.materials && selectedEvent.materials.length > 0 ? (
                    selectedEvent.materials.map((m, i) => (
                      <div key={i} className="material-item">
                        <ImageIcon size={18} color="#64748b" />
                        <span>{m.name}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted">No materials uploaded.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Event Drawer */}
      {activeModal === 'full' && (
        <div className="drawer-overlay" onClick={() => setActiveModal(null)}>
          <div className="drawer-content" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>New Calendar Event</h2>
              <div className="drawer-actions">
                <button className="close-modal" onClick={() => setActiveModal(null)}><X size={20} /></button>
              </div>
            </div>
            
            <div className="drawer-body form-body">
              
              {/* Title and Top Level Toggle */}
              <div className="drawer-section" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label>Event Title</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. 1-on-1 Math Tutoring" 
                    value={newEventForm.title} 
                    onChange={e => setNewEventForm({...newEventForm, title: e.target.value})} 
                  />
                </div>
                
                <div className="radio-group grid-2" style={{ marginBottom: '16px' }}>
                  <label className={`radio-item ${newEventForm.topLevelType === 'Tutoring' ? 'checked' : ''}`} style={{ textAlign: 'center', padding: '12px', fontWeight: 'bold' }}>
                    <input 
                      type="radio" 
                      name="topLevelType" 
                      value="Tutoring" 
                      checked={newEventForm.topLevelType === 'Tutoring'} 
                      onChange={e => setNewEventForm({
                        ...newEventForm, 
                        topLevelType: e.target.value,
                        category: 'Online Tutoring'
                      })} 
                    /> 
                    Tutoring
                  </label>
                  <label className={`radio-item ${newEventForm.topLevelType === 'Class' ? 'checked' : ''}`} style={{ textAlign: 'center', padding: '12px', fontWeight: 'bold' }}>
                    <input 
                      type="radio" 
                      name="topLevelType" 
                      value="Class" 
                      checked={newEventForm.topLevelType === 'Class'} 
                      onChange={e => setNewEventForm({
                        ...newEventForm, 
                        topLevelType: e.target.value,
                        category: 'COVE'
                      })} 
                    /> 
                    Class
                  </label>
                </div>
              </div>

              {/* Dynamic Flow based on Type */}
              {newEventForm.topLevelType === 'Tutoring' ? (
                <>
                  <div className="drawer-section">
                    <div className="form-group">
                      <label htmlFor="event-category-select">Category</label>
                      <select
                        id="event-category-select"
                        className="form-control"
                        value={newEventForm.category || ''}
                        onChange={(e) => setNewEventForm({ ...newEventForm, category: e.target.value })}
                      >
                        <option value="">Select category</option>
                        {['Online Tutoring', 'In Person Tutoring'].map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <h3><CalendarCheck size={18} /> Recurrence</h3>
                    <div className="radio-group grid-2" style={{ marginBottom: '16px' }}>
                      <label className={`radio-item ${newEventForm.tutoringRecurrence === '1 time' ? 'checked' : ''}`}>
                        <input type="radio" name="tutoringRecurrence" value="1 time" checked={newEventForm.tutoringRecurrence === '1 time'} onChange={e => setNewEventForm({...newEventForm, tutoringRecurrence: e.target.value})} /> 
                        1 time
                      </label>
                      <label className={`radio-item ${newEventForm.tutoringRecurrence === 'Repeating' ? 'checked' : ''}`}>
                        <input type="radio" name="tutoringRecurrence" value="Repeating" checked={newEventForm.tutoringRecurrence === 'Repeating'} onChange={e => setNewEventForm({...newEventForm, tutoringRecurrence: e.target.value})} /> 
                        Repeating
                      </label>
                    </div>

                    {newEventForm.tutoringRecurrence === '1 time' ? (
                      // 1 Time Flow
                      <div className="recurring-options" style={{ padding: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        <div className="form-row">
                          <div className="form-group half">
                            <label>Date</label>
                            <input className="form-control" type="date" value={newEventForm.date} onChange={e => setNewEventForm({...newEventForm, date: e.target.value})} />
                          </div>
                          <div className="form-group half">
                            <label>Time</label>
                            <input className="form-control" type="time" value={newEventForm.time} onChange={e => setNewEventForm({...newEventForm, time: e.target.value})} />
                          </div>
                          <div className="form-group half">
                            <label>Duration</label>
                            <div className="input-with-suffix">
                              <input className="form-control" type="number" value={newEventForm.duration} onChange={e => setNewEventForm({...newEventForm, duration: e.target.value})} />
                              <span className="suffix">min</span>
                            </div>
                          </div>
                          <div className="form-group half">
                            <label>Price per family ($)</label>
                            <input className="form-control" type="number" placeholder="0.00" value={newEventForm.price} onChange={e => setNewEventForm({...newEventForm, price: e.target.value})} />
                            <small className="cal-price-hint">
                              Charged to each enrolled family. Approve it in Billing to bill it.
                            </small>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Repeating Flow (Schedule Builder)
                      <div className="recurring-options" style={{ padding: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        <div className="form-group" style={{ marginBottom: '16px' }}>
                          <label className="checkbox-label" style={{ fontWeight: 'normal' }}>
                            <input type="checkbox" checked={newEventForm.noEndDate} onChange={e => setNewEventForm({...newEventForm, noEndDate: e.target.checked})} /> No end date
                          </label>
                          {!newEventForm.noEndDate && (
                            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>Repeat until</span>
                              <input className="form-control" type="date" style={{ width: 'auto' }} value={newEventForm.repeatUntil} onChange={e => setNewEventForm({...newEventForm, repeatUntil: e.target.value})} />
                            </div>
                          )}
                        </div>

                        <label style={{ fontSize: '13px', fontWeight: 600 }}>Schedule</label>
                        {newEventForm.scheduleDays.map((dayObj) => (
                          <div key={dayObj.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select className="form-control" style={{ flex: 1, minWidth: '100px' }} value={dayObj.day} onChange={e => updateScheduleDay(dayObj.id, 'day', e.target.value)}>
                              <option value="Monday">Monday</option>
                              <option value="Tuesday">Tuesday</option>
                              <option value="Wednesday">Wednesday</option>
                              <option value="Thursday">Thursday</option>
                              <option value="Friday">Friday</option>
                              <option value="Saturday">Saturday</option>
                              <option value="Sunday">Sunday</option>
                            </select>
                            <span style={{ color: 'var(--text-muted)' }}>@</span>
                            <input className="form-control" type="time" style={{ width: '100px' }} value={dayObj.time} onChange={e => updateScheduleDay(dayObj.id, 'time', e.target.value)} />
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input className="form-control" type="number" placeholder="min" style={{ width: '70px', paddingLeft: '8px', paddingRight: '4px' }} title="Duration in minutes" value={dayObj.duration} onChange={e => updateScheduleDay(dayObj.id, 'duration', e.target.value)} />
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: '500' }}>min</span>
                            </div>
                            <input className="form-control" type="number" placeholder="$ Price" style={{ width: '100px' }} title="Price" value={dayObj.price} onChange={e => updateScheduleDay(dayObj.id, 'price', e.target.value)} />
                            
                            {newEventForm.scheduleDays.length > 1 && (
                              <button className="icon-btn" style={{ color: '#dc2626' }} onClick={() => removeScheduleDay(dayObj.id)}><X size={16}/></button>
                            )}
                          </div>
                        ))}
                        <button className="btn-text" style={{ padding: '4px 0', fontSize: '13px' }} onClick={addScheduleDay}>+ Add another day</button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // Class Flow
                <>
                  <div className="drawer-section">
                    <div className="form-group">
                      <label>Category</label>
                      <select className="form-control" value={newEventForm.category} onChange={e => setNewEventForm({...newEventForm, category: e.target.value})}>
                        <option value="COVE">COVE</option>
                        <option value="In-Person Class">In-Person Class</option>
                        <option value="Online Class">Online Class</option>
                        <option value="Event">Event</option>
                        <option value="Meeting">Meeting</option>
                      </select>
                    </div>

                    <h3><CalendarCheck size={18} /> Recurrence</h3>
                    <div className="form-group" style={{ marginBottom: '16px' }}>
                      <select 
                        className="form-control" 
                        value={newEventForm.classRecurrence} 
                        onChange={e => setNewEventForm({...newEventForm, classRecurrence: e.target.value})}
                      >
                        <option value="1 week">1 week</option>
                        <option value="2 weeks">2 weeks</option>
                        <option value="3 weeks">3 weeks</option>
                        <option value="4 weeks">4 weeks</option>
                        <option value="5 weeks">5 weeks</option>
                        <option value="6 weeks">6 weeks</option>
                        <option value="7 weeks">7 weeks</option>
                        <option value="8 weeks">8 weeks</option>
                        <option value="Forever">Forever</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: '20px' }}>
                      <label>Repeat on</label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                          // Map short day to full day for state
                          const fullDayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday' };
                          const fullDay = fullDayMap[day];
                          const isSelected = (newEventForm.classDays || []).includes(fullDay);
                          
                          return (
                            <button
                              key={day}
                              onClick={(e) => { e.preventDefault(); toggleClassDay(fullDay); }}
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                border: isSelected ? 'none' : '1px solid var(--border-light)',
                                background: isSelected ? 'var(--primary)' : 'white',
                                color: isSelected ? 'white' : 'var(--text-main)',
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s',
                                boxShadow: isSelected ? '0 4px 10px rgba(21, 128, 61, 0.2)' : 'none'
                              }}
                            >
                              {day[0]}
                            </button>
                          );
                        })}
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {(newEventForm.classDates || []).length} dates selected
                        </span>
                        <button className="btn-text" style={{ fontSize: '13px', fontWeight: '600' }} onClick={handleGenerateClassDates}>
                          Auto-Generate Dates
                        </button>
                      </div>

                      <MultiDatePicker 
                        selectedDates={newEventForm.classDates || []} 
                        onChange={(dates) => setNewEventForm({...newEventForm, classDates: dates})} 
                      />
                    </div>

                    <div className="form-row">
                        <div className="form-group half">
                          <label>Time</label>
                          <input className="form-control" type="time" value={newEventForm.time} onChange={e => setNewEventForm({...newEventForm, time: e.target.value})} />
                        </div>
                        <div className="form-group half">
                          <label>Duration</label>
                          <div className="input-with-suffix">
                            <input className="form-control" type="number" value={newEventForm.duration} onChange={e => setNewEventForm({...newEventForm, duration: e.target.value})} />
                            <span className="suffix">min</span>
                          </div>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group half">
                          <label>Price per family ($)</label>
                          <input className="form-control" type="number" placeholder="0.00" value={newEventForm.price} onChange={e => setNewEventForm({...newEventForm, price: e.target.value})} />
                        </div>
                        <div className="form-group half">
                          <label>How it's billed</label>
                          <p className="cal-price-note">
                            Once per meeting, to each enrolled family, <strong>as soon as you
                            save</strong>. Correct it by changing the price; clearing it takes
                            the charge back off.
                          </p>
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '-8px' }}>
                      <label className="checkbox-label" style={{ fontWeight: 'normal' }}>
                        <input 
                          type="checkbox" 
                          checked={newEventForm.chargeAllSessions} 
                          onChange={e => setNewEventForm({...newEventForm, chargeAllSessions: e.target.checked})} 
                        /> 
                        Charge this amount for EVERY session in the series (Default is only the first session)
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* Shared Participants Section */}
              <div className="drawer-section">
                <h3><User size={18} /> Participants</h3>
                <div className="form-group">
                  <label>Tutor</label>
                  <select className="form-control" value={newEventForm.tutor} onChange={e => setNewEventForm({...newEventForm, tutor: e.target.value})}>
                    <option value="">Select tutor (Primary)...</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <AddSelfAsTeacher
                    teacherIds={teachers.map(t => t.id)}
                    onAdded={async (userId) => {
                      await reloadTeachers();
                      setNewEventForm(prev => ({ ...prev, tutor: userId }));
                    }}
                    onError={toast.error}
                  />
                </div>

                <div className="form-group mt-8">
                  <label>Co-Tutors</label>
                  <select 
                    className="form-control" 
                    multiple 
                    value={newEventForm.coTeacherIds || []} 
                    onChange={e => {
                      const options = [...e.target.selectedOptions];
                      const values = options.map(o => o.value);
                      setNewEventForm({...newEventForm, coTeacherIds: values});
                    }}
                    style={{ minHeight: '60px' }}
                  >
                    {teachers.filter(t => t.id !== newEventForm.tutor).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div className="form-group mt-8" ref={attendeeSectionRef} style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ marginBottom: 0 }}>Attendees</label>
                    <span 
                      style={{ color: 'var(--primary)', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => {
                        setAttendeeDropdownMode('quick');
                        setAttendeeSearchText('');
                        setIsAttendeeDropdownOpen(true);
                      }}
                    >
                      Group Select ▼
                    </span>
                  </div>
                  
                  {newEventForm.students.length > 0 && (
                    <div className="categories-box" style={{ marginBottom: '8px', minHeight: 'auto', border: 'none', background: 'transparent', padding: 0 }}>
                      {newEventForm.students.map((student) => (
                        <span key={student.id} className="category-tag">
                          {student.name}
                          <button onClick={() => removeAttendee(student.id)}><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <input 
                    className="form-control" 
                    type="text" 
                    placeholder="Search students..." 
                    value={attendeeSearchText}
                    onChange={(e) => {
                      setAttendeeSearchText(e.target.value);
                      setAttendeeDropdownMode('search');
                      setIsAttendeeDropdownOpen(true);
                    }}
                    onFocus={() => {
                      if (attendeeDropdownMode === 'quick') setAttendeeDropdownMode('search');
                      setIsAttendeeDropdownOpen(true);
                    }}
                  />
                  
                  {isAttendeeDropdownOpen && (
                    <div className="category-dropdown-menu" style={{ top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', zIndex: 100 }}>
                      {attendeeDropdownMode === 'quick' && !attendeeSearchText ? (
                        quickSelectGroups.map(group => (
                          <div key={group.category}>
                            <div style={{ padding: '8px 16px', fontWeight: 'bold', fontSize: '13px', color: '#334155', pointerEvents: 'none' }}>
                              {group.category}
                            </div>
                            {group.options.map(opt => (
                              <div
                                key={opt}
                                className="category-option"
                                style={{ paddingLeft: '24px' }}
                                onClick={() => {
                                  const wantsActive = opt.startsWith('Active');
                                  const statusWanted = wantsActive ? 'Active' : 'Trial';
                                  allStudents.filter(s => s.status === statusWanted).forEach(addAttendee);
                                  setIsAttendeeDropdownOpen(false);
                                }}
                              >
                                {opt}
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <>
                          {allStudents
                            .filter(s => nameMatches(s.name, attendeeSearchText))
                            .filter(s => !newEventForm.students.find(existing => existing.id === s.id))
                            .map(student => (
                              <div 
                                key={student.id} 
                                className="category-option"
                                onClick={() => addAttendee(student)}
                              >
                                {student.name}
                              </div>
                            ))
                          }
                          {allStudents.filter(s => nameMatches(s.name, attendeeSearchText)).length === 0 && (
                            <div style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: '13px' }}>No students found</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Info */}
              <div className="drawer-section">
                <h3><FileText size={18} /> Additional Information</h3>
                <div className="form-group">
                  <label>Public Description</label>
                  <textarea className="form-control" rows="3" value={newEventForm.description} onChange={e => setNewEventForm({...newEventForm, description: e.target.value})}></textarea>
                </div>
              </div>
              
            </div>
            <div className="drawer-footer modal-footer">
              <button className="cancel-btn" onClick={() => setActiveModal(null)}>Cancel</button>
              <button className="save-btn" onClick={handleSaveNewEvent}>Save</button>
            </div>
          </div>
        </div>
      )}
      {/* Reschedule dialog — opened by dropping a session on a day in Week/Month */}
      {rescheduleDraft && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => !rescheduling && setRescheduleDraft(null)}>
          <div className="modal-content glass-card cal-reschedule" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-area">
                <h2>Reschedule {rescheduleDraft.title}</h2>
              </div>
              <button className="close-modal" onClick={() => setRescheduleDraft(null)}><X size={20} /></button>
            </div>

            <div className="modal-body">
              <div className="cal-edit-when">
                <CalendarIcon size={16} />
                <input
                  type="date"
                  className="form-control"
                  value={rescheduleDraft.date}
                  onChange={e => setRescheduleDraft(p => ({ ...p, date: e.target.value }))}
                  title="Date"
                />
              </div>
              <div className="cal-edit-when" style={{ marginTop: 12 }}>
                <Clock size={16} />
                <input
                  type="time"
                  className="form-control"
                  value={rescheduleDraft.startTime}
                  onChange={e => setRescheduleDraft(p => ({ ...p, startTime: e.target.value }))}
                  title="Start time"
                  autoFocus
                />
                <span className="text-muted">to</span>
                <input
                  type="time"
                  className="form-control"
                  value={rescheduleDraft.endTime}
                  onChange={e => setRescheduleDraft(p => ({ ...p, endTime: e.target.value }))}
                  title="End time"
                />
              </div>

              <label className="cal-series-toggle">
                <input
                  type="checkbox"
                  checked={rescheduleDraft.applyToSeries}
                  onChange={e => setRescheduleDraft(p => ({ ...p, applyToSeries: e.target.checked }))}
                />
                <span>
                  Apply this time to every later {weekdayNameOf(rescheduleDraft.origDate)} session of this class
                  {rescheduleDraft.date !== rescheduleDraft.origDate && ' (the date change stays on this one session)'}
                </span>
              </label>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '0 24px 20px' }}>
              <button className="cancel-btn" onClick={() => setRescheduleDraft(null)} disabled={rescheduling}>Cancel</button>
              <button className="save-btn" onClick={handleConfirmReschedule} disabled={rescheduling}>
                <Save size={14} /> {rescheduling ? 'Saving…' : 'Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {appAlert.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-card" style={{ maxWidth: '400px', textAlign: 'center', padding: '30px' }}>
            <div style={{ 
              width: '60px', 
              height: '60px', 
              borderRadius: '50%', 
              background: appAlert.type === 'danger' ? '#fee2e2' : '#e0f2fe', 
              color: appAlert.type === 'danger' ? '#ef4444' : '#0369a1', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              margin: '0 auto 20px' 
            }}>
              {appAlert.type === 'danger' ? <Trash2 size={30} /> : <Settings size={30} />}
            </div>
            <h2 style={{ marginBottom: '10px' }}>{appAlert.title}</h2>
            <p className="text-muted" style={{ marginBottom: '25px' }}>{appAlert.message}</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="cancel-btn" onClick={() => setAppAlert({ isOpen: false })}>Cancel</button>
              <button 
                className={appAlert.type === 'danger' ? "save-btn danger" : "save-btn"} 
                onClick={appAlert.onConfirm}
                style={appAlert.type === 'danger' ? { background: '#ef4444' } : {}}
              >
                {appAlert.type === 'danger' ? 'Delete' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isShiftSchedulerOpen && (
        <ShiftScheduler
          defaultDate={toISODate(currentDate)}
          onClose={() => setIsShiftSchedulerOpen(false)}
          // Shifts ride on the calendar the same way PTO does, so a new one has
          // to come back through that fetch to appear on the grid.
          onSaved={() => loadStaffEvents(view, currentDate)}
        />
      )}

      {/* ── GRID CLICK MENU ────────────────────────────────────────── */}
      {gridClickMenu && (
        <>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} onClick={() => setGridClickMenu(null)} />
          <div 
            className="add-event-dropdown"
            style={{ position: 'fixed', top: gridClickMenu.y, left: gridClickMenu.x, zIndex: 1001, display: 'flex' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', marginBottom: '4px', background: '#f8fafc', borderTopLeftRadius: '8px', borderTopRightRadius: '8px' }}>
              <strong style={{ fontSize: '15px', color: 'var(--text-main)', display: 'block' }}>
                {gridClickMenu.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </strong>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 4 }}>
                {gridClickMenu.time} {gridClickMenu.teacher ? `· ${gridClickMenu.teacher.replace('Prof. ', '')}` : ''}
              </div>
            </div>
            
            <div className="dropdown-item" onClick={() => {
              const [h, m] = gridClickMenu.time.split(':').map(Number);
              const endH = h + 1;
              const endStr = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              setNewEventForm(prev => ({
                ...prev,
                date: toISODate(gridClickMenu.date),
                startTime: gridClickMenu.time,
                endTime: endStr,
                teacher: gridClickMenu.teacher || ''
              }));
              setActiveModal('full');
              setGridClickMenu(null);
            }}>
              <CalendarPlus size={16} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>Quick-Add Lesson</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Create a new lesson at this time</span>
              </div>
            </div>

            <div className="dropdown-item" onClick={() => {
              setNewEventForm(prev => ({ ...prev, date: toISODate(gridClickMenu.date), startTime: gridClickMenu.time }));
              setActiveModal('full');
              setGridClickMenu(null);
            }}>
              <CalendarIcon size={16} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>New Non-Tutoring Event</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Create a new event without students</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CalendarView;
