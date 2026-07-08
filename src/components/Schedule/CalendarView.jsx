import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Filter, Calendar as CalendarIcon, MapPin, Video, FileText, Star, Edit2, Save, X, Image as ImageIcon, Paperclip, User, Clock, Plus, Settings, CalendarPlus, CalendarCheck, Trash2, Link2, Pencil, UserPlus, UserMinus } from 'lucide-react';
import { database } from '../../lib/database';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import './CalendarView.css';

const MOCK_EVENTS = [
  { id: 1, title: 'Morning COVE: Math & Language Arts', subject: 'math', time: '10:00 AM - 12:50 PM', dayOffset: 0, type: 'Morning COVE', teacher: 'Prof. David Brown', students: 12, studentList: ['Maria Garcia', 'John Doe', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson', 'Mason Taylor'], notes: '1 hr math, 1 hr language arts, 50 min lunch/social.', materials: [] },
  { id: 2, title: 'Learn & Play (Ages 5-7)', subject: 'arts', time: '1:00 PM - 2:00 PM', dayOffset: 0, type: 'Elective Class', teacher: 'Prof. Sarah Jenkins', students: 8, studentList: ['Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson'], notes: 'Hands-on elective nurturing natural curiosity.', materials: [] },
  { id: 3, title: 'Minecraft IRL (Ages 8-12)', subject: 'science', time: '1:00 PM - 2:00 PM', dayOffset: 0, type: 'Elective Class', teacher: 'Prof. Mark Wilson', students: 10, studentList: ['Maria Garcia', 'John Doe', 'William Garcia', 'Mason Taylor', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'Lucas Davis'], notes: 'STEAM course without screens.', materials: [] },
  { id: 4, title: 'Afternoon COVE: Financial Literacy', subject: 'math', time: '2:10 PM - 5:00 PM', dayOffset: 0, type: 'Afternoon COVE', teacher: 'Prof. Elena Rodriguez', students: 15, studentList: ['Maria Garcia', 'John Doe', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson', 'Mason Taylor', 'Mia Anderson', 'Ethan Thomas', 'Charlotte Jackson'], notes: 'Budgeting, saving, investing.', materials: [] },
  { id: 5, title: 'Morning COVE: Math & Science', subject: 'science', time: '10:00 AM - 12:50 PM', dayOffset: 1, type: 'Morning COVE', teacher: 'Prof. David Brown', students: 14, studentList: ['Maria Garcia', 'John Doe', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson', 'Mason Taylor', 'Mia Anderson', 'Ethan Thomas'], notes: '1 hr math, 1 hr science, 50 min lunch/social.', materials: [] },
  { id: 6, title: 'Logic & Puzzles (Ages 8+)', subject: 'math', time: '1:00 PM - 2:00 PM', dayOffset: 1, type: 'Elective Class', teacher: 'Prof. Mark Wilson', students: 10, studentList: ['Maria Garcia', 'John Doe', 'William Garcia', 'Mason Taylor', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'Lucas Davis'], notes: 'Strategy games, riddles, team challenges.', materials: [] },
  { id: 7, title: 'Afternoon COVE: LA & Social Studies', subject: 'languages', time: '2:10 PM - 5:00 PM', dayOffset: 1, type: 'Afternoon COVE', teacher: 'Prof. Sarah Jenkins', students: 12, studentList: ['Maria Garcia', 'John Doe', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson', 'Mason Taylor'], notes: '1 hr LA, 1 hr social studies, 50 min snack/social.', materials: [] },
  { id: 8, title: '1-on-1 Tutoring', subject: 'languages', time: '12:00 PM - 1:00 PM', dayOffset: 0, type: 'Tutoring', teacher: 'Prof. Elena Rodriguez', students: 1, studentList: ['Sofia Ramirez'], notes: 'Private reading session.', materials: [] }
];

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const AVAILABLE_STUDENTS = [
  'Maria Garcia', 'John Doe', 'Sofia Ramirez', 'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia', 'Sophia Martinez', 'Lucas Davis', 'Isabella Wilson', 'Mason Taylor', 'Mia Anderson', 'Ethan Thomas', 'Charlotte Jackson', 'Amelia White', 'Harper Lee'
];

const formatDateUS = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return `${m}/${d}/${y}`;
};

const QUICK_SELECT_GROUPS = [
  {
    category: 'Students',
    options: ['Active Students (383)', 'Trial Students (37)']
  },
  {
    category: 'Tara Sanford',
    options: ['Active & Trial Students (209)']
  },
  {
    category: 'Erica Hoffman',
    options: ['Active & Trial Students (388)']
  },
  {
    category: 'Group Tags',
    options: [
      'Fall 2025 (105)',
      'Fall Online 2025 (28)',
      'Friday 12 pm online Minecraft Social (6)',
      'Homeschool Families (130)',
      'Love Camp (140)',
      'Love Learning FL LLC (227)'
    ]
  }
];

const TUTOR_GROUPS = [
  {
    category: 'Status',
    options: ['Active Tutors (4)', 'Inactive Tutors (1)']
  },
  {
    category: 'Departments',
    options: ['Math Department', 'Science Department', 'Language Department']
  }
];

const AVAILABLE_TUTORS = [
  'Prof. David Brown', 'Prof. Sarah Jenkins', 'Prof. Mark Wilson', 'Prof. Elena Rodriguez'
];

const CATEGORY_GROUPS = [
  {
    category: 'Learning COVEs',
    options: ['All Morning COVEs', 'All Afternoon COVEs']
  },
  {
    category: 'Other Services',
    options: ['All Electives', 'All Tutoring', 'All Events']
  }
];

const AVAILABLE_CATEGORIES = [
  'All',
  'COVE',
  'In-Person Class',
  'Online Class',
  'Event',
  'Meeting',
  'In Person Tutoring',
  'Online Tutoring'
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

const CalendarView = () => {
  const { role } = useAuth();
  const canAddEvents = role === 'ADMIN';
  const [view, setView] = useState('week'); // 'day', 'week', 'month'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [localEvents, setLocalEvents] = useState(MOCK_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [editLink, setEditLink] = useState('');
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [editEventForm, setEditEventForm] = useState({});
  const [rosterSearch, setRosterSearch] = useState('');
  const [appAlert, setAppAlert] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });
  
  // Only staff can edit/delete scheduled classes or manage the Zoom link —
  // parents/students only get to view the calendar.
  const isAdmin = role === 'ADMIN' || role === 'TEACHER';

  // Advanced Search States
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isStudentDropdownOpen, setIsStudentDropdownOpen] = useState(false);
  const [isTutorDropdownOpen, setIsTutorDropdownOpen] = useState(false);
  
  // Add Event States
  const [isAddEventDropdownOpen, setIsAddEventDropdownOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'quick', 'full'

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
  
  const [miniCalDate, setMiniCalDate] = useState(new Date());
  const handleMiniCalPrev = () => setMiniCalDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const handleMiniCalNext = () => setMiniCalDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

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
    date: '2026-04-28',
    time: '14:30',
    duration: 60,
    price: '',
    billingFrequency: 'Per Class', // 'Per Class', 'Weekly', 'Start of Cycle'
    
    // Legacy / Shared
    tutor: 'Prof. David Brown',
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
    hideUnscheduled: false,
    substitutesOnly: false
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
  }, []);

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

    if (isSearchOpen || isAddEventDropdownOpen || isAttendeeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSearchOpen, isStudentDropdownOpen, isTutorDropdownOpen, isCategoryDropdownOpen, isAddEventDropdownOpen, isAttendeeDropdownOpen]);

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
      hideUnscheduled: false,
      substitutesOnly: false
    });
  };

  const handleSearchSubmit = () => {
    // In a real app, this would trigger an API call.
    // For now, we just close the window.
    setIsSearchOpen(false);
  };

  const getFilteredEvents = () => {
    let filtered = localEvents;
    
    // Filter by Categories
    if (searchForm.categories.length > 0) {
      filtered = filtered.filter(e => 
        searchForm.categories.some(c => c === 'All' || e.type === c)
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

    if (searchForm.hideFullEvents) {
      // Assuming a generic capacity limit of 15 for mock purposes
      filtered = filtered.filter(e => e.students < 15);
    }
    
    return filtered;
  };

  const events = getFilteredEvents();

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setEditNotes(event.notes || '');
    setIsEditing(false);
    setIsEditingEvent(false);
    setRosterSearch('');
  };

  const handleStartEditEvent = () => {
    setEditEventForm({
      title: selectedEvent.title,
      type: selectedEvent.type,
      subject: selectedEvent.subject,
      teacher: selectedEvent.teacher,
      time: selectedEvent.time,
      studentList: [...(selectedEvent.studentList || [])]
    });
    setIsEditingEvent(true);
    setRosterSearch('');
  };

  const handleSaveEventEdit = () => {
    const updated = {
      ...selectedEvent,
      title: editEventForm.title,
      type: editEventForm.type,
      subject: editEventForm.subject,
      teacher: editEventForm.teacher,
      time: editEventForm.time,
      studentList: editEventForm.studentList,
      students: editEventForm.studentList.length
    };
    setLocalEvents(prev => prev.map(e => e.id === selectedEvent.id ? updated : e));
    setSelectedEvent(updated);
    setIsEditingEvent(false);
  };

  const handleAddStudentToRoster = (name) => {
    if (!editEventForm.studentList.includes(name)) {
      setEditEventForm(prev => ({ ...prev, studentList: [...prev.studentList, name] }));
    }
    setRosterSearch('');
  };

  const handleRemoveStudentFromRoster = (name) => {
    setEditEventForm(prev => ({ ...prev, studentList: prev.studentList.filter(s => s !== name) }));
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    await database.saveClassNotes(selectedEvent.id, editNotes, selectedEvent.materials);
    setLocalEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, notes: editNotes } : e));
    setSelectedEvent(prev => ({ ...prev, notes: editNotes }));
    setSaving(false);
    setIsEditing(false);
  };

  const confirmDeleteEvent = (event) => {
    setAppAlert({
      isOpen: true,
      title: 'Delete Event?',
      message: `Are you sure you want to delete "${event.title}"? This action cannot be undone.`,
      type: 'danger',
      onConfirm: () => {
        setLocalEvents(prev => prev.filter(e => e.id !== event.id));
        setSelectedEvent(null);
        setAppAlert({ isOpen: false });
      }
    });
  };

  const handleToggleZoom = () => {
    if (!selectedEvent) return;
    if (isEditingLink) {
      setIsEditingLink(false);
      return;
    }
    setEditLink(selectedEvent.meetingUrl || '');
    setIsEditingLink(true);
  };

  const handleSaveLink = () => {
    if (!selectedEvent) return;
    setLocalEvents(prev => prev.map(e => 
      e.id === selectedEvent.id 
        ? { ...e, meetingUrl: editLink, type: editLink ? 'Virtual' : 'In-Person' } 
        : e
    ));
    setSelectedEvent(prev => ({ 
      ...prev, 
      meetingUrl: editLink,
      type: editLink ? 'Virtual' : 'In-Person'
    }));
    setIsEditingLink(false);
  };

  const handleSaveNewEvent = () => {
    const attendeesNames = newEventForm.students.map(s => s.name).join(', ');
    const newEvent = {
      id: Date.now(),
      title: attendeesNames ? `${newEventForm.eventType} with ${attendeesNames}` : newEventForm.eventType,
      subject: newEventForm.category.toLowerCase().includes('math') ? 'math' : 'science', // simplified
      time: `${newEventForm.time} - ${newEventForm.duration}m`, // rough mock format
      dayOffset: 0, // mock adding to today
      type: newEventForm.category,
      teacher: newEventForm.tutor,
      students: newEventForm.students.length,
      notes: newEventForm.description,
      materials: []
    };
    
    setLocalEvents(prev => [...prev, newEvent]);
    setActiveModal(null);
  };

  const getDurationMins = (timeStr) => {
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
    if (role !== 'ADMIN') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('eventId', eventItem.id.toString());
    const rect = e.currentTarget.getBoundingClientRect();
    e.dataTransfer.setData('offsetY', (e.clientY - rect.top).toString());
  };

  const handleDropOnWeekDay = (e, newDayOffset) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('eventId');
    const offsetY = parseFloat(e.dataTransfer.getData('offsetY') || '0');
    
    if (eventId) {
      const container = e.currentTarget.querySelector('.timeline-container') || e.currentTarget;
      let newTimeRange = null;
      
      if (container && container.classList.contains('timeline-container')) {
         const containerRect = container.getBoundingClientRect();
         const dropY = e.clientY - containerRect.top;
         const eventItem = localEvents.find(ev => ev.id.toString() === eventId);
         if (eventItem) {
           newTimeRange = calculateNewTimeRange(eventItem.time, dropY, offsetY);
         }
      }

      setLocalEvents(prev => prev.map(ev => {
        if (ev.id.toString() === eventId) {
          return { 
            ...ev, 
            dayOffset: newDayOffset,
            ...(newTimeRange ? { time: newTimeRange } : {})
          };
        }
        return ev;
      }));
    }
  };

  const handleDropOnTeacher = (e, newTeacher) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('eventId');
    const offsetY = parseFloat(e.dataTransfer.getData('offsetY') || '0');
    
    if (eventId) {
      const container = e.currentTarget.querySelector('.timeline-container') || e.currentTarget;
      let newTimeRange = null;
      
      if (container && container.classList.contains('timeline-container')) {
         const containerRect = container.getBoundingClientRect();
         const dropY = e.clientY - containerRect.top;
         const eventItem = localEvents.find(ev => ev.id.toString() === eventId);
         if (eventItem) {
           newTimeRange = calculateNewTimeRange(eventItem.time, dropY, offsetY);
         }
      }

      setLocalEvents(prev => prev.map(ev => {
        if (ev.id.toString() === eventId) {
          return { 
            ...ev, 
            teacher: newTeacher,
            ...(newTimeRange ? { time: newTimeRange } : {})
          };
        }
        return ev;
      }));
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
  const todayNum = currentDate.getDate();

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

  // Time parsing for Day View Timeline (8 AM to 6 PM)
  const START_HOUR = 8;
  const PIXELS_PER_MINUTE = 1.6; // Approximates ~96px per hour (clear distinction)

  const parseTimeToPix = (timeStr) => {
    const startStr = timeStr.split(' - ')[0];
    const [time, period] = startStr.trim().split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    const minutesFromStart = (hours - START_HOUR) * 60 + (minutes || 0);
    return minutesFromStart * PIXELS_PER_MINUTE;
  };

  const getPositionStyles = (timeRange) => {
    const topPix = parseTimeToPix(timeRange);
    const durationMins = getDurationMins(timeRange);
    const heightPix = durationMins * PIXELS_PER_MINUTE;
    return { top: `${topPix}px`, height: `${heightPix}px` };
  };

  const dayEventsList = events.filter(e => e.dayOffset === 0);
  const uniqueTeachers = [...new Set(events.map(e => e.teacher))].sort();

  const miniCalYear = miniCalDate.getFullYear();
  const miniCalMonth = miniCalDate.getMonth();
  const miniCalFirstDay = new Date(miniCalYear, miniCalMonth, 1).getDay();
  const miniCalDaysInMonth = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <div className="calendar-title">
          <div className="nav-arrows">
            <button><ChevronLeft size={20} /></button>
            <button><ChevronRight size={20} /></button>
          </div>
          <h1>{currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h1>
        </div>

        <div className="calendar-actions">
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
                </div>
              )}
            </div>
          )}

          <div className="filter-wrapper" style={{ position: 'relative' }} ref={searchRef}>
            <button 
               className="advanced-search-btn" 
               onClick={() => setIsSearchOpen(!isSearchOpen)}
            >
              <Filter size={16} />
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
                          QUICK_SELECT_GROUPS.map(group => (
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
                          AVAILABLE_STUDENTS
                            .filter(s => !searchForm.students.includes(s))
                            .filter(s => s.toLowerCase().includes(searchForm.studentSearchText.toLowerCase()))
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
                          TUTOR_GROUPS.map(group => (
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
                          AVAILABLE_TUTORS
                            .map(t => ({ raw: t, clean: t.replace('Prof. ', '') }))
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
                     { id: 'hideUnscheduled', label: 'Hide unscheduled tutors & locations' },
                     { id: 'substitutesOnly', label: 'Show only events with substitutes' }
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

          <div className="view-toggle">
            <button className={`view-btn ${view === 'day' ? 'active' : ''}`} onClick={() => setView('day')}>Day</button>
            <button className={`view-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
            <button className={`view-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
          </div>
          {role === 'TEACHER' && (
            <div className="view-toggle" style={{marginLeft: 8}}>
              <button className={`view-btn ${calPanel === 'pto' ? 'active' : ''}`} onClick={() => setCalPanel(calPanel === 'pto' ? null : 'pto')}>PTO</button>
              <button className={`view-btn ${calPanel === 'spaces' ? 'active' : ''}`} onClick={() => setCalPanel(calPanel === 'spaces' ? null : 'spaces')}>Spaces</button>
            </div>
          )}
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
                <span><strong>{r.space?.name}</strong> — {r.reservedBy?.fullName || 'You'}</span>
                <span className="text-muted" style={{fontSize: 12}}>{new Date(r.startTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} – {new Date(r.endTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            )) : <p className="text-muted" style={{fontSize: 13}}>No reservations yet.</p>}
          </div>
        </div>
      )}

      <div className="calendar-glass-box">
        {view === 'week' && (
          <div className="calendar-scroll-wrapper">
            <div className="instructor-schedule-grid">
                {/* Time Axis */}
                <div className="time-axis">
                  <div className="time-axis-header" style={{ marginBottom: '0' }}>GMT-5</div>
                  {Array.from({ length: 11 }).map((_, i) => {
                    const hour = START_HOUR + i;
                    const label = hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;
                    return (
                      <div key={i} className="time-label" style={{ height: `${60 * PIXELS_PER_MINUTE}px` }}>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>

              {weekDates.map((date, idx) => {
                const isToday = date.getDate() === todayNum;
                // Simple mock mapping: offset 0 is Mon, 1 is Tue... 
                // Usually we'd map via actual date matching
                const dayEvents = events.filter(e => e.dayOffset === idx);

                return (
                  <div 
                    key={idx} 
                    className="instructor-col"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropOnWeekDay(e, idx)}
                  >
                    <div className={`instructor-header ${isToday ? 'today' : ''}`} style={{ flexDirection: 'column', gap: 0, justifyContent: 'center', padding: '8px' }}>
                      <span className="day-name" style={{ fontSize: '11px', textTransform: 'uppercase', color: isToday ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700 }}>{WEEK_DAYS[idx]}</span>
                      <span className="day-num" style={{ fontSize: '18px', fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--text-main)' }}>{date.getDate()}</span>
                    </div>
                    
                    <div className="timeline-container" style={{ height: `${10 * 60 * PIXELS_PER_MINUTE}px` }}>
                       {/* Background Hour Lines */}
                       {Array.from({ length: 10 }).map((_, i) => (
                         <div key={i} className="hourLine" style={{ top: `${i * 60 * PIXELS_PER_MINUTE}px` }}></div>
                       ))}
                       
                       {/* Events */}
                       {dayEvents.map(e => (
                         <div 
                           key={e.id} 
                           className={`positioned-event ${e.subject}`}
                           style={{...getPositionStyles(e.time), cursor: role === 'ADMIN' ? 'grab' : 'pointer'}}
                           title={`${e.title} · ${e.time} · ${e.teacher}`}
                           draggable={role === 'ADMIN'}
                           onDragStart={(evt) => handleDragStart(evt, e)}
                           onClick={() => handleEventClick(e)}
                         >
                           <div className="event-inner">
                             <strong>{e.title}</strong>
                             <span className="ev-time">{e.time}</span>
                             <span className="ev-meta">
                               {e.type === 'Virtual' ? <Video size={10} /> : <MapPin size={10} />}
                               {e.teacher.replace('Prof. ', '')}
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

        {view === 'day' && (
          <div className="calendar-scroll-wrapper">
             <div className="instructor-schedule-grid">
                {/* Time Axis */}
                <div className="time-axis">
                  <div className="time-axis-header">GMT-5</div>
                  {Array.from({ length: 11 }).map((_, i) => {
                    const hour = START_HOUR + i;
                    const label = hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;
                    return (
                      <div key={i} className="time-label" style={{ height: `${60 * PIXELS_PER_MINUTE}px` }}>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Instructors Columns */}
                {uniqueTeachers.map(teacher => {
                  const teacherEvents = dayEventsList.filter(e => e.teacher === teacher);
                  return (
                    <div 
                      key={teacher} 
                      className="instructor-col"
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDropOnTeacher(e, teacher)}
                    >
                      <div className="instructor-header">
                         <div className="avatar">{teacher.charAt(6)}</div>
                         <div className="name">{teacher.replace('Prof. ', '')}</div>
                      </div>
                      
                      <div className="timeline-container" style={{ height: `${10 * 60 * PIXELS_PER_MINUTE}px` }}>
                         {/* Background Hour Lines */}
                         {Array.from({ length: 10 }).map((_, i) => (
                           <div key={i} className="hourLine" style={{ top: `${i * 60 * PIXELS_PER_MINUTE}px` }}></div>
                         ))}
                         
                         {/* Events */}
                         {teacherEvents.map(e => (
                           <div 
                             key={e.id} 
                             className={`positioned-event ${e.subject}`}
                             style={{...getPositionStyles(e.time), cursor: role === 'ADMIN' ? 'grab' : 'pointer'}}
                             draggable={role === 'ADMIN'}
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

        {view === 'month' && (
          <div className="calendar-scroll-wrapper">
            <div className="month-grid">
              {WEEK_DAYS.map(day => (
                <div key={day} className="month-day-name">{day}</div>
              ))}
              
              {monthCells.map((_, idx) => {
                const dayNum = idx - startOffset + 1;
                const isCurrentMonth = dayNum > 0 && dayNum <= daysInMonth;
                const isToday = isCurrentMonth && dayNum === todayNum;
                
                // Spreading dummy events around the month for visual demonstration
                const dayEvents = isCurrentMonth ? events.filter(e => e.dayOffset === (dayNum % 7)) : [];

                return (
                  <div 
                    key={idx} 
                    className={`month-cell ${!isCurrentMonth ? 'inactive' : ''} ${isToday ? 'today' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropOnWeekDay(e, dayNum % 7)}
                  >
                    {isCurrentMonth && (
                      <>
                        <div className="month-cell-top">
                          <span className="cell-date">{dayNum}</span>
                        </div>
                        <div className="cell-events-area">
                          {dayEvents.map(e => (
                            <div 
                              key={e.id} 
                              className={`mini-event ${e.subject}`} 
                              title={`${e.time} - ${e.title}`}
                              draggable={role === 'ADMIN'}
                              onDragStart={(evt) => handleDragStart(evt, e)}
                              style={{ cursor: role === 'ADMIN' ? 'grab' : 'pointer' }}
                            >
                               <div className="dot"></div>
                               <span>{e.time.split(' ')[0]} {e.title}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
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
                      title={selectedEvent.meetingUrl ? "Edit Zoom Link" : "Add Zoom Link"}
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
                    <div className="meta-item">
                      <User size={16} />
                      <select 
                        className="form-control" 
                        value={editEventForm.teacher} 
                        onChange={e => setEditEventForm(prev => ({ ...prev, teacher: e.target.value }))}
                        style={{ flex: 1, height: '34px', fontSize: '13px' }}
                      >
                        {AVAILABLE_TUTORS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="meta-item">
                      <Clock size={16} />
                      <input 
                        type="text" 
                        className="form-control" 
                        value={editEventForm.time} 
                        onChange={e => setEditEventForm(prev => ({ ...prev, time: e.target.value }))}
                        style={{ flex: 1, height: '34px', fontSize: '13px' }}
                        placeholder="e.g. 10:00 AM - 12:50 PM"
                      />
                    </div>
                    <div className="meta-item">
                      <Settings size={16} />
                      <select 
                        className="form-control" 
                        value={editEventForm.type} 
                        onChange={e => setEditEventForm(prev => ({ ...prev, type: e.target.value }))}
                        style={{ flex: 1, height: '34px', fontSize: '13px' }}
                      >
                        <option value="Morning COVE">Morning COVE</option>
                        <option value="Afternoon COVE">Afternoon COVE</option>
                        <option value="Elective Class">Elective Class</option>
                        <option value="Tutoring">Tutoring</option>
                        <option value="Event">Event</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="meta-item">
                      <User size={16} />
                      <span>{selectedEvent.teacher}</span>
                    </div>
                    <div className="meta-item">
                      <Clock size={16} />
                      <span>{selectedEvent.time}</span>
                    </div>
                    <div className="meta-item" style={{ flexWrap: 'wrap', gap: '8px' }}>
                      {isEditingLink ? (
                        <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
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
                          <button className="cancel-btn" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => setIsEditingLink(false)}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          {selectedEvent.type === 'Virtual' || selectedEvent.meetingUrl ? (
                            <>
                              <Video size={16} />
                              {selectedEvent.meetingUrl ? (
                                <a href={selectedEvent.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: '600', textDecoration: 'underline' }}>
                                  Join Zoom Session
                                </a>
                              ) : (
                                <span>Virtual Session (No Link)</span>
                              )}
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
                  <h3><User size={18} /> Student Roster ({isEditingEvent ? editEventForm.studentList.length : (selectedEvent.studentList?.length || selectedEvent.students)})</h3>
                </div>
                {isEditingEvent ? (
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
                            {AVAILABLE_STUDENTS
                              .filter(s => s.toLowerCase().includes(rosterSearch.toLowerCase()) && !editEventForm.studentList.includes(s))
                              .map(s => (
                                <button key={s} className="roster-search-option" onClick={() => handleAddStudentToRoster(s)}>
                                  <UserPlus size={14} /> {s}
                                </button>
                              ))
                            }
                            {AVAILABLE_STUDENTS.filter(s => s.toLowerCase().includes(rosterSearch.toLowerCase()) && !editEventForm.studentList.includes(s)).length === 0 && (
                              <div className="roster-search-option" style={{ color: '#94a3b8', cursor: 'default' }}>No students found</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="roster-student-list">
                      {editEventForm.studentList.map((name, i) => (
                        <div key={i} className="roster-student-item">
                          <div className="roster-student-avatar">{name[0]}</div>
                          <span>{name}</span>
                          <button className="roster-remove-btn" onClick={() => handleRemoveStudentFromRoster(name)} title="Remove student">
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
                            <label>Price ($)</label>
                            <input className="form-control" type="number" placeholder="0.00" value={newEventForm.price} onChange={e => setNewEventForm({...newEventForm, price: e.target.value})} />
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
                        {newEventForm.scheduleDays.map((dayObj, index) => (
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
                          <label>Cost / Price ($)</label>
                          <input className="form-control" type="number" placeholder="0.00" value={newEventForm.price} onChange={e => setNewEventForm({...newEventForm, price: e.target.value})} />
                        </div>
                        <div className="form-group half">
                          <label>Billing Frequency</label>
                          <select className="form-control" value={newEventForm.billingFrequency} onChange={e => setNewEventForm({...newEventForm, billingFrequency: e.target.value})}>
                            <option value="Per Class">Per Class</option>
                            <option value="Weekly">Weekly</option>
                            <option value="Start of Cycle">Start of Cycle</option>
                          </select>
                        </div>
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
                    {AVAILABLE_TUTORS.map(t => <option key={t}>{t}</option>)}
                  </select>
                  
                  <label className="checkbox-label mt-8" style={{ marginTop: '8px' }}>
                    <input type="checkbox" checked={newEventForm.hasSubstitute} onChange={e => setNewEventForm({...newEventForm, hasSubstitute: e.target.checked})} /> Add substitute tutor
                  </label>
                  {newEventForm.hasSubstitute && (
                    <div style={{ marginTop: '8px' }}>
                      <select className="form-control" value={newEventForm.substituteTutor} onChange={e => setNewEventForm({...newEventForm, substituteTutor: e.target.value})}>
                        <option value="">Select Substitute...</option>
                        {AVAILABLE_TUTORS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
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
                        QUICK_SELECT_GROUPS.map(group => (
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
                                  // Simply add a mock student object for the group name
                                  addAttendee({ id: opt, name: opt });
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
                            .filter(s => s.name.toLowerCase().includes(attendeeSearchText.toLowerCase()))
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
                          {allStudents.filter(s => s.name.toLowerCase().includes(attendeeSearchText.toLowerCase())).length === 0 && (
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
    </div>
  );
};

export default CalendarView;
