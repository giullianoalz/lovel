import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Filter, Calendar as CalendarIcon, MapPin, Video } from 'lucide-react';
import './CalendarView.css';

const MOCK_EVENTS = [
  { id: 1, title: 'Advanced Math', subject: 'math', time: '10:00 AM - 11:30 AM', dayOffset: 0, type: 'Virtual' },
  { id: 2, title: 'English Conversation', subject: 'languages', time: '4:00 PM - 5:00 PM', dayOffset: 0, type: 'In-person' },
  { id: 3, title: 'Physics Labs', subject: 'science', time: '1:00 PM - 3:00 PM', dayOffset: 1, type: 'In-person' },
  { id: 4, title: 'History of Arts', subject: 'arts', time: '2:30 PM - 4:00 PM', dayOffset: 2, type: 'Virtual' },
  { id: 5, title: 'Geometry', subject: 'math', time: '9:00 AM - 10:30 AM', dayOffset: 3, type: 'Virtual' },
];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CalendarView = () => {
  const [view, setView] = useState('week'); // 'day', 'week', 'month'
  const [filter, setFilter] = useState('all');
  const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 20)); // Fake current date

  // Responsive default view detection
  useEffect(() => {
    const checkMobile = () => {
      if (window.innerWidth <= 768) {
        setView('day');
      } else {
        // Desktop default is week
        setView('week');
      }
    };
    checkMobile(); // initial
  }, []);

  const getFilteredEvents = () => {
    if (filter === 'all') return MOCK_EVENTS;
    return MOCK_EVENTS.filter(e => e.subject === filter);
  };

  const events = getFilteredEvents();

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
          <div className="filter-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} color="var(--text-muted)" />
            <select 
              className="filter-dropdown" 
              value={filter} 
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All Subjects</option>
              <option value="math">Mathematics</option>
              <option value="science">Sciences</option>
              <option value="languages">Languages</option>
              <option value="arts">Arts & Humanities</option>
            </select>
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
                          <div key={e.id} className={`event-pill ${e.subject}`}>
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
          <div className="day-view-container">
            <div className="day-view-header">
              Today, April 20, 2026
            </div>
            
            <div className="time-slot" style={{ minHeight: '300px', padding: '16px' }}>
              {events.filter(e => e.dayOffset === 0).length > 0 ? (
                events.filter(e => e.dayOffset === 0).map(e => (
                  <div key={e.id} className={`event-pill ${e.subject}`} style={{ padding: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span className="event-title" style={{ fontSize: '16px' }}>{e.title}</span>
                      <span className="event-time" style={{ fontWeight: 600 }}>{e.time}</span>
                    </div>
                    <p style={{ marginTop: '8px', fontSize: '14px', opacity: 0.9 }}>Prof. Instructor</p>
                    <button className="join-btn" style={{ marginTop: '16px', background: 'rgba(255,255,255,0.7)', padding:'8px 16px', fontSize:'12px'}}>
                      {e.type === 'Virtual' ? 'Join Zoom Call' : 'View Classroom Location'}
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-slot">No classes scheduled for today. Take a break!</div>
              )}
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
    </div>
  );
};

export default CalendarView;
