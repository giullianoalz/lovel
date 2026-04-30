import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Filter, Calendar as CalendarIcon, MapPin, Video, FileText, Star, Edit2, Save, X, Image as ImageIcon, Paperclip, User, Clock, Plus, Settings, CalendarPlus, CalendarCheck } from 'lucide-react';
import { database } from '../../lib/database';
import './CalendarView.css';

const MOCK_EVENTS = [
  { id: 1, title: 'Morning POD: Math & Language Arts', subject: 'math', time: '10:00 AM - 12:50 PM', dayOffset: 0, type: 'Morning POD', teacher: 'Prof. David Brown', students: 12, notes: '1 hr math, 1 hr language arts, 50 min lunch/social.', materials: [] },
  { id: 2, title: 'Learn & Play (Ages 5-7)', subject: 'arts', time: '1:00 PM - 2:00 PM', dayOffset: 0, type: 'Elective Class', teacher: 'Prof. Sarah Jenkins', students: 8, notes: 'Hands-on elective nurturing natural curiosity.', materials: [] },
  { id: 3, title: 'Minecraft IRL (Ages 8-12)', subject: 'science', time: '1:00 PM - 2:00 PM', dayOffset: 0, type: 'Elective Class', teacher: 'Prof. Mark Wilson', students: 10, notes: 'STEAM course without screens.', materials: [] },
  { id: 4, title: 'Afternoon POD: Financial Literacy', subject: 'math', time: '2:10 PM - 5:00 PM', dayOffset: 0, type: 'Afternoon POD', teacher: 'Prof. Elena Rodriguez', students: 15, notes: 'Budgeting, saving, investing.', materials: [] },
  { id: 5, title: 'Morning POD: Math & Science', subject: 'science', time: '10:00 AM - 12:50 PM', dayOffset: 1, type: 'Morning POD', teacher: 'Prof. David Brown', students: 14, notes: '1 hr math, 1 hr science, 50 min lunch/social.', materials: [] },
  { id: 6, title: 'Logic & Puzzles (Ages 8+)', subject: 'math', time: '1:00 PM - 2:00 PM', dayOffset: 1, type: 'Elective Class', teacher: 'Prof. Mark Wilson', students: 10, notes: 'Strategy games, riddles, team challenges.', materials: [] },
  { id: 7, title: 'Afternoon POD: LA & Social Studies', subject: 'languages', time: '2:10 PM - 5:00 PM', dayOffset: 1, type: 'Afternoon POD', teacher: 'Prof. Sarah Jenkins', students: 12, notes: '1 hr LA, 1 hr social studies, 50 min snack/social.', materials: [] },
  { id: 8, title: '1-on-1 Tutoring', subject: 'languages', time: '12:00 PM - 1:00 PM', dayOffset: 0, type: 'Tutoring', teacher: 'Prof. Elena Rodriguez', students: 1, notes: 'Private reading session.', materials: [] }
];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const AVAILABLE_STUDENTS = [
  'Emma Smith', 'Liam Johnson', 'Olivia Williams', 'Noah Brown', 'Ava Jones', 'William Garcia'
];

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
    category: 'Learning PODs',
    options: ['All Morning PODs', 'All Afternoon PODs']
  },
  {
    category: 'Other Services',
    options: ['All Electives', 'All Tutoring', 'All Events']
  }
];

const AVAILABLE_CATEGORIES = [
  'All',
  'Morning POD',
  'Afternoon POD',
  'Elective Class',
  'Tutoring',
  'Pop-Up Event',
  'Field Trip',
  'Other Services'
];

const CalendarView = () => {
  const [view, setView] = useState('week'); // 'day', 'week', 'month'
  const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 20)); // Fake current date
  const [localEvents, setLocalEvents] = useState(MOCK_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Advanced Search States
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isStudentDropdownOpen, setIsStudentDropdownOpen] = useState(false);
  const [isTutorDropdownOpen, setIsTutorDropdownOpen] = useState(false);
  
  // Add Event States
  const [isAddEventDropdownOpen, setIsAddEventDropdownOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'quick', 'full'
  const addEventRef = useRef(null);
  const [newEventForm, setNewEventForm] = useState({
    tutor: 'Prof. David Brown',
    eventType: 'Lesson with a student',
    student: '',
    date: '2026-04-28',
    time: '14:30',
    recurrence: 'One-time event',
    visibility: 'Private',
    category: 'Zoom Lesson',
    duration: 60,
    allDay: false,
    pricing: 'Morning/Afternoon POD ($385.00 / 8-weeks)',
    description: ''
  });
  
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
    categories: ['In Person Class', 'Online Class', 'Pod', 'Small Group Pod'],
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
    };

    if (isSearchOpen || isAddEventDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSearchOpen, isStudentDropdownOpen, isTutorDropdownOpen, isCategoryDropdownOpen, isAddEventDropdownOpen]);

  // Ensure inner dropdowns reset when the main search popover is closed
  useEffect(() => {
    if (!isSearchOpen) {
      setIsStudentDropdownOpen(false);
      setIsTutorDropdownOpen(false);
      setIsCategoryDropdownOpen(false);
    }
  }, [isSearchOpen]);

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
    // Simple mock filter based on categories for now
    let filtered = localEvents;
    
    // We mock the filtering logic. If no categories are selected, maybe show none or all? 
    // Let's assume selecting categories acts as an inclusive OR filter.
    if (searchForm.categories.length > 0) {
      // Very naive mapping to our subject tags just to show it "working"
      const mapping = {
         'math': ['Pod', 'Small Group Pod'],
         'science': ['In Person Class'],
         'languages': ['Online Class'],
         'arts': ['In Person Class']
      };
      
      // Let's just return all for visual purposes since exact Tutorbird mapping isn't 1:1 with MOCK
    }
    
    // Naive text filter for array of tutors
    if (searchForm.tutors.length > 0) {
      filtered = filtered.filter(e => 
        searchForm.tutors.some(t => e.teacher.toLowerCase().includes(t.toLowerCase()))
      );
    }
    
    return filtered;
  };

  const events = getFilteredEvents();

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setEditNotes(event.notes || '');
    setIsEditing(false);
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    await database.saveClassNotes(selectedEvent.id, editNotes, selectedEvent.materials);
    setLocalEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, notes: editNotes } : e));
    setSelectedEvent(prev => ({ ...prev, notes: editNotes }));
    setSaving(false);
    setIsEditing(false);
  };

  const handleSaveNewEvent = () => {
    const newEvent = {
      id: Date.now(),
      title: newEventForm.student ? `${newEventForm.eventType} with ${newEventForm.student}` : newEventForm.eventType,
      subject: newEventForm.category.toLowerCase().includes('math') ? 'math' : 'science', // simplified
      time: `${newEventForm.time} - ${newEventForm.duration}m`, // rough mock format
      dayOffset: 0, // mock adding to today
      type: newEventForm.category,
      teacher: newEventForm.tutor,
      students: newEventForm.student ? 1 : 0,
      notes: newEventForm.description,
      materials: []
    };
    
    setLocalEvents(prev => [...prev, newEvent]);
    setActiveModal(null);
  };

  // Helper to get day numbers for the week
  const getWeekDates = () => {
    const dates = [];
    const baseDay = currentDate.getDate() - currentDate.getDay() + 1; // Start of week (Mon)
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
    const startOffset = firstDay === 0 ? 6 : firstDay - 1; // Align to Monday Start
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return { startOffset, daysInMonth };
  };

  const { startOffset, daysInMonth } = getMonthDays();
  const monthCells = Array.from({ length: 42 });

  // Time parsing for Day View Timeline (8 AM to 6 PM)
  const START_HOUR = 8;
  const PIXELS_PER_MINUTE = 1.6; // Approximates ~96px per hour (clear distinction)

  const parseTimeToPix = (timeStr) => {
    // Expects "10:00 AM" formatting
    const [time, period] = timeStr.trim().split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    const minutesFromStart = (hours - START_HOUR) * 60 + minutes;
    return minutesFromStart * PIXELS_PER_MINUTE;
  };

  const getPositionStyles = (timeRange) => {
    const [startStr, endStr] = timeRange.split(' - ');
    const top = parseTimeToPix(startStr);
    const bottom = parseTimeToPix(endStr);
    const height = bottom - top;
    return { top: `${top}px`, height: `${height}px` };
  };

  const dayEventsList = events.filter(e => e.dayOffset === 0);
  const uniqueTeachers = [...new Set(events.map(e => e.teacher))].sort();

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
                <div className="dropdown-item" onClick={() => { setActiveModal('quick'); setIsAddEventDropdownOpen(false); }}>
                  <CalendarCheck size={16} />
                  <span>Quick-Add Lesson</span>
                </div>
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
            {/* Day view only shows normally on mobile but we leave it accessible */}
            <button className={`view-btn ${view === 'day' ? 'active' : ''}`} onClick={() => setView('day')}>Day</button>
            <button className={`view-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
            <button className={`view-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
          </div>
        </div>
      </div>

      <div className="calendar-glass-box">
        {view === 'week' && (
          <div className="calendar-scroll-wrapper">
            <div className="week-grid">
              {weekDates.map((date, idx) => {
                const isToday = date.getDate() === todayNum;
                // Simple mock mapping: offset 0 is Mon, 1 is Tue... 
                // Usually we'd map via actual date matching
                const dayEvents = events.filter(e => e.dayOffset === idx);

                return (
                  <div key={idx} className="week-day-col">
                    <div className={`day-header ${isToday ? 'today' : ''}`}>
                      <span className="day-name">{WEEK_DAYS[idx]}</span>
                      <span className="day-num">{date.getDate()}</span>
                    </div>
                    
                    <div className="time-slot">
                      {dayEvents.length > 0 ? (
                        dayEvents.map(e => (
                          <div 
                            key={e.id} 
                            className={`event-pill ${e.subject}`}
                            onClick={() => handleEventClick(e)}
                            style={{ cursor: 'pointer' }}
                          >
                            <span className="event-title">{e.title}</span>
                            <span className="event-time">{e.time}</span>
                            <span className="event-time" style={{display:'block', marginTop:'4px'}}>
                              {e.type === 'Virtual' ? <Video size={10} style={{marginRight:'4px'}}/> : <MapPin size={10} style={{marginRight:'4px'}}/>}
                              {e.type}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="empty-slot">Free</div>
                      )}
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
                    <div key={teacher} className="instructor-col">
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
                             style={getPositionStyles(e.time)}
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
                  <div key={idx} className={`month-cell ${!isCurrentMonth ? 'inactive' : ''} ${isToday ? 'today' : ''}`}>
                    {isCurrentMonth && (
                      <>
                        <div className="month-cell-top">
                          <span className="cell-date">{dayNum}</span>
                        </div>
                        <div className="cell-events-area">
                          {dayEvents.map(e => (
                            <div key={e.id} className={`mini-event ${e.subject}`} title={`${e.time} - ${e.title}`}>
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
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-area">
                <div className={`subject-tag ${selectedEvent.subject}`}>{selectedEvent.subject}</div>
                <h2>{selectedEvent.title}</h2>
              </div>
              <button className="close-modal" onClick={() => setSelectedEvent(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="session-meta-grid">
                <div className="meta-item">
                  <User size={16} />
                  <span>{selectedEvent.teacher}</span>
                </div>
                <div className="meta-item">
                  <Clock size={16} />
                  <span>{selectedEvent.time}</span>
                </div>
                <div className="meta-item">
                  {selectedEvent.type === 'Virtual' ? <Video size={16} /> : <MapPin size={16} />}
                  <span>{selectedEvent.type}</span>
                </div>
              </div>

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
      {/* Quick-Add Lesson Modal */}
      {activeModal === 'quick' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content quick-add-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Quick-Add Lesson</h2>
              <button className="close-modal" onClick={() => setActiveModal(null)}><X size={20} /></button>
            </div>
            <div className="modal-body form-body">
              <div className="form-group">
                <label>Tutor</label>
                <select className="form-control" value={newEventForm.tutor} onChange={e => setNewEventForm({...newEventForm, tutor: e.target.value})}>
                  {AVAILABLE_TUTORS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Event Type</label>
                <div className="radio-group">
                  <label className="radio-item">
                    <input type="radio" name="eventType" value="Lesson with a student" checked={newEventForm.eventType === 'Lesson with a student'} onChange={e => setNewEventForm({...newEventForm, eventType: e.target.value})} />
                    <div>Lesson with a student</div>
                  </label>
                  <label className="radio-item">
                    <input type="radio" name="eventType" value="Open lesson slot" checked={newEventForm.eventType === 'Open lesson slot'} onChange={e => setNewEventForm({...newEventForm, eventType: e.target.value})} />
                    <div>
                      Open lesson slot
                      <span className="sub-label">No assigned student</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Student</label>
                <select className="form-control" value={newEventForm.student} onChange={e => setNewEventForm({...newEventForm, student: e.target.value})}>
                  <option value="">Type or Select Student</option>
                  {AVAILABLE_STUDENTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group half">
                  <label>Date</label>
                  <input className="form-control" type="date" value={newEventForm.date} onChange={e => setNewEventForm({...newEventForm, date: e.target.value})} />
                </div>
                <div className="form-group half">
                  <label>Time</label>
                  <input className="form-control" type="time" value={newEventForm.time} onChange={e => setNewEventForm({...newEventForm, time: e.target.value})} />
                </div>
              </div>

              <div className="form-group">
                <label>Recurrence</label>
                <div className="radio-group">
                  <label className="radio-item"><input type="radio" name="quickRecurrence" value="One-time event" checked={newEventForm.recurrence === 'One-time event'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> One-time event</label>
                  <label className="radio-item"><input type="radio" name="quickRecurrence" value="Hold this weekly timeslot" checked={newEventForm.recurrence === 'Hold this weekly timeslot'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> Hold this weekly timeslot</label>
                  <label className="radio-item"><input type="radio" name="quickRecurrence" value="Recurring event" checked={newEventForm.recurrence === 'Recurring event'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> Recurring event</label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setActiveModal(null)}>Cancel</button>
              <button className="save-btn" onClick={handleSaveNewEvent}>Save</button>
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
              <div className="drawer-section">
                <h3>General</h3>
                <div className="form-group">
                  <label>Tutor</label>
                  <select className="form-control" value={newEventForm.tutor} onChange={e => setNewEventForm({...newEventForm, tutor: e.target.value})}>
                    {AVAILABLE_TUTORS.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <label className="checkbox-label mt-8">
                    <input type="checkbox" /> Add substitute tutor
                  </label>
                </div>
              </div>

              <div className="drawer-section">
                <h3>Visibility</h3>
                <div className="radio-group">
                  <label className="radio-item">
                    <input type="radio" name="visibility" value="Public" checked={newEventForm.visibility === 'Public'} onChange={e => setNewEventForm({...newEventForm, visibility: e.target.value})} /> 
                    <div>
                      Public
                      <span className="sub-label">Visible on the Student Portal calendar to all students</span>
                    </div>
                  </label>
                  <label className="radio-item">
                    <input type="radio" name="visibility" value="Private" checked={newEventForm.visibility === 'Private'} onChange={e => setNewEventForm({...newEventForm, visibility: e.target.value})} /> 
                    <div>
                      Private
                      <span className="sub-label">Visible on the Student Portal calendar to current attendees only</span>
                    </div>
                  </label>
                </div>
                <h3 className="mt-8" style={{ marginTop: '24px' }}>General</h3>
                <label className="checkbox-label">
                  <input type="checkbox" /> This event requires a make-up credit
                </label>
              </div>

              <div className="drawer-section">
                <h3>Event Details</h3>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ marginBottom: 0 }}>Attendees</label>
                    <span style={{ color: 'var(--primary)', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>Group Select ▼</span>
                  </div>
                  <input className="form-control" type="text" placeholder="Students" />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="form-control" value={newEventForm.category} onChange={e => setNewEventForm({...newEventForm, category: e.target.value})}>
                    {AVAILABLE_CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="drawer-section">
                <div className="form-row">
                  <div className="form-group half" style={{flex: 2}}>
                    <label>Duration</label>
                    <div className="input-with-suffix">
                      <input className="form-control" type="number" value={newEventForm.duration} onChange={e => setNewEventForm({...newEventForm, duration: e.target.value})} />
                      <span className="suffix">Minutes</span>
                    </div>
                  </div>
                  <div className="form-group half" style={{flex: 1, display: 'flex', alignItems: 'center', paddingTop: '20px'}}>
                    <label className="checkbox-label mb-0" style={{ marginBottom: 0 }}>
                      <input type="checkbox" checked={newEventForm.allDay} onChange={e => setNewEventForm({...newEventForm, allDay: e.target.checked})} /> All day
                    </label>
                  </div>
                </div>
              </div>

              <div className="drawer-section">
                <h3>Recurrence</h3>
                <div className="radio-group">
                  <label className="radio-item"><input type="radio" name="fullRecurrence" value="One-time event" checked={newEventForm.recurrence === 'One-time event'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> One-time event</label>
                  <label className="radio-item"><input type="radio" name="fullRecurrence" value="Hold this weekly timeslot" checked={newEventForm.recurrence === 'Hold this weekly timeslot'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> Hold this weekly timeslot</label>
                  <label className="radio-item"><input type="radio" name="fullRecurrence" value="Recurring event" checked={newEventForm.recurrence === 'Recurring event'} onChange={e => setNewEventForm({...newEventForm, recurrence: e.target.value})} /> Recurring event</label>
                </div>
              </div>

              <div className="drawer-section">
                <h3>Student Pricing</h3>
                <div className="radio-group">
                  <label className="radio-item">
                    <input type="radio" name="pricing" value="Morning/Afternoon POD ($385.00 / 8-weeks)" checked={newEventForm.pricing === 'Morning/Afternoon POD ($385.00 / 8-weeks)'} onChange={e => setNewEventForm({...newEventForm, pricing: e.target.value})} />
                    <div>
                      Morning/Afternoon POD ($385.00 / 8-weeks)
                      <span className="sub-label">Includes 2 core classes and materials</span>
                    </div>
                  </label>
                  <label className="radio-item">
                    <input type="radio" name="pricing" value="Elective Class ($120.00 / 8-weeks)" checked={newEventForm.pricing === 'Elective Class ($120.00 / 8-weeks)'} onChange={e => setNewEventForm({...newEventForm, pricing: e.target.value})} />
                    <div>
                      Elective Class ($120.00 / 8-weeks)
                      <span className="sub-label">Standard elective rate. For Robotics/others use custom price.</span>
                    </div>
                  </label>
                  <label className="radio-item">
                    <input type="radio" name="pricing" value="Custom / Tutoring Price" checked={newEventForm.pricing === 'Custom / Tutoring Price'} onChange={e => setNewEventForm({...newEventForm, pricing: e.target.value})} />
                    <div>Custom / Tutoring Price (Specify per student)</div>
                  </label>
                  <label className="radio-item">
                    <input type="radio" name="pricing" value="No charge ($0.00)" checked={newEventForm.pricing === 'No charge ($0.00)'} onChange={e => setNewEventForm({...newEventForm, pricing: e.target.value})} />
                    <div>No charge ($0.00)</div>
                  </label>
                </div>
                
                <h3 className="mt-8" style={{ marginTop: '24px' }}>Scholarship Billing</h3>
                <label className="checkbox-label">
                  <input type="checkbox" /> Eligible for FES-UA or FES-PEP billing (Requires Student FES-ID)
                </label>
              </div>

              <div className="drawer-section">
                <h3>Additional Information</h3>
                <div className="form-group">
                  <label>Public Description</label>
                  <textarea className="form-control" rows="4" value={newEventForm.description} onChange={e => setNewEventForm({...newEventForm, description: e.target.value})}></textarea>
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
    </div>
  );
};

export default CalendarView;
