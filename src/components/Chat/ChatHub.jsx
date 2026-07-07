import React, { useState, useEffect, useRef } from 'react';
import { Search, MoreVertical, Send, Paperclip, Shield, MessageSquare, Bot, ArrowLeft } from 'lucide-react';
import io from 'socket.io-client';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import './ChatHub.css';

const configuredApiUrl = import.meta.env.VITE_API_URL;
const SOCKET_URL = (!configuredApiUrl || configuredApiUrl === 'http://localhost:4000/api')
  ? `http://${window.location.hostname}:4000`
  : configuredApiUrl.replace(/\/api\/?$/, '');

const ChatHub = () => {
  const { role, user } = useAuth();
  const [activeChat, setActiveChat] = useState(null);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatThreads, setChatThreads] = useState([]);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  const [messages, setMessages] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [typingThreads, setTypingThreads] = useState({});
  const [threadFilter, setThreadFilter] = useState('active'); // 'active' | 'resolved'
  const [showNewMsgMenu, setShowNewMsgMenu] = useState(false);
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);
  const [myTeachers, setMyTeachers] = useState([]);
  const [sendError, setSendError] = useState(null);
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  const loadThreads = async () => {
    try {
      const response = await api.get('/chat');
      setChatThreads(response.data.threads);
    } catch (error) {
      console.error("Error loading chat threads:", error);
    }
  };

  useEffect(() => {
    loadThreads();
    
    // Initialize socket connection
    socketRef.current = io(SOCKET_URL);
    
    socketRef.current.on('assistant_typing', (data) => {
      setTypingThreads(prev => ({ ...prev, [data.threadId]: true }));
    });

    socketRef.current.on('receive_message', (data) => {
      const { threadId, message } = data;
      // A bot message (no sender) clears the typing indicator for that thread.
      if (message.senderId === null) {
        setTypingThreads(prev => ({ ...prev, [threadId]: false }));
      }
      setMessages(prev => {
        const threadMessages = prev[threadId] || [];
        // Prevent duplicate if we already have it (optimistic check by text and time roughly, or id)
        // Since optimistic uses timestamp as ID, we can just check if a message with same text exists very recently
        const isDuplicate = threadMessages.some(m => m.id === message.id || (m.text === message.text && m.type === 'sent'));
        if (isDuplicate) return prev;
        
        return {
          ...prev,
          [threadId]: [...threadMessages, message]
        };
      });
      
      setChatThreads(prevThreads => 
        prevThreads.map(t => 
          t.id === threadId 
            ? { ...t, lastMsg: message.text, time: message.time, unread: (activeChat === threadId ? 0 : (t.unread || 0) + 1) } 
            : t
        )
      );
      if (activeChat === threadId) {
        scrollToBottom();
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeChat]);

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeChat) return;
      try {
        const response = await api.get(`/chat/${activeChat}/messages`);
        setMessages(prev => ({
          ...prev,
          [activeChat]: response.data.messages
        }));
        
        if (socketRef.current) {
          socketRef.current.emit('join_room', activeChat);
        }
      } catch (error) {
        console.error("Error loading messages:", error);
      }
    };

    if (activeChat) {
      loadMessages();
    }

    return () => {
      if (socketRef.current && activeChat) {
        socketRef.current.emit('leave_room', activeChat);
      }
    };
  }, [activeChat]);

  const handleSelectChat = (id) => {
    setActiveChat(id);
    setIsMobileChatOpen(true);
    setIsTyping(false);
    setIsHeaderMenuOpen(false);
  };

  const handleBackToList = () => {
    setIsMobileChatOpen(false);
  };

  const handleBlockToggle = async () => {
    const currentChat = chatThreads.find(t => t.id === activeChat);
    if (!currentChat) return;

    try {
      await api.post(`/chat/${activeChat}/block`);
      setIsHeaderMenuOpen(false);
      await loadThreads();
    } catch (error) {
      console.error("Error toggling block status:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeChat) return;

    const sentText = inputText;
    setInputText('');
    setSendError(null);

    const optimisticMessage = {
      id: Date.now(),
      sender: "Me",
      text: sentText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: "sent"
    };

    setMessages(prev => ({
      ...prev,
      [activeChat]: [...(prev[activeChat] || []), optimisticMessage]
    }));

    setChatThreads(prevThreads =>
      prevThreads.map(t =>
        t.id === activeChat
          ? { ...t, lastMsg: sentText, time: optimisticMessage.time }
          : t
      )
    );

    try {
      const response = await api.post(`/chat/${activeChat}/messages`, { text: sentText });
      // Update optimistic message with real ID
      setMessages(prev => {
        const updated = prev[activeChat].map(m => m.id === optimisticMessage.id ? { ...m, id: response.data.message.id } : m);
        return { ...prev, [activeChat]: updated };
      });
    } catch (error) {
      console.error("Error sending message:", error);
      // Roll back the optimistic message (e.g. blocked contact-info) and restore the draft.
      setMessages(prev => ({
        ...prev,
        [activeChat]: (prev[activeChat] || []).filter(m => m.id !== optimisticMessage.id)
      }));
      setInputText(sentText);
      setSendError(error.response?.data?.message || 'Could not send the message. Please try again.');
    }
  };

  const handleResolveThread = async (threadId) => {
    try {
      await api.put(`/chat/${threadId}/resolve`);
      setChatThreads(prev => prev.map(t => t.id === threadId ? { ...t, status: 'RESOLVED' } : t));
    } catch (err) { console.error('Error resolving thread:', err); }
  };

  const handleNewMessage = async (type) => {
    setShowNewMsgMenu(false);
    if (type === 'teacher') {
      try {
        const res = await api.get('/chat/my-teachers');
        setMyTeachers(res.data.teachers || []);
        setShowTeacherPicker(true);
      } catch (err) { console.error('Error loading teachers:', err); }
      return;
    }
    if (type === 'people') {
      setPeopleQuery('');
      setShowPeoplePicker(true);
      searchPeople('');
      return;
    }
    try {
      let res;
      if (type === 'management') {
        res = await api.post('/chat/group', { groupType: 'MANAGEMENT' });
      } else if (type === 'ocean-navigators') {
        res = await api.post('/chat/group', { groupType: 'OCEAN_NAVIGATORS' });
      }
      if (res?.data?.thread) {
        await loadThreads();
        setActiveChat(res.data.thread.id);
      }
    } catch (err) { console.error('Error creating thread:', err); }
  };

  const handlePickTeacher = async (teacherId) => {
    setShowTeacherPicker(false);
    try {
      const res = await api.post('/chat', { participantIds: [teacherId] });
      if (res?.data?.thread) {
        await loadThreads();
        setActiveChat(res.data.thread.id);
      }
    } catch (err) { console.error('Error starting thread with teacher:', err); }
  };

  // Admin/teacher "start a new conversation with anyone" picker.
  const searchPeople = async (query) => {
    setPeopleLoading(true);
    try {
      const res = await api.get('/users', { params: { search: query, limit: 20 } });
      setPeople((res.data.users || []).filter(u => u.id !== user?.id));
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setPeopleLoading(false);
    }
  };

  const handlePickPerson = async (personId) => {
    setShowPeoplePicker(false);
    try {
      const res = await api.post('/chat', { participantIds: [personId] });
      if (res?.data?.thread) {
        await loadThreads();
        setActiveChat(res.data.thread.id);
      }
    } catch (err) { console.error('Error starting thread:', err); }
  };

  const currentChatData = chatThreads.find(t => t.id === activeChat);
  const filteredThreads = chatThreads
    .filter(t => threadFilter === 'active' ? t.status !== 'RESOLVED' : t.status === 'RESOLVED')
    .filter(t =>
      t.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.roles && t.roles.some(r => r.toLowerCase().includes(searchQuery.toLowerCase())))
    );

  return (
    <div className={`chat-hub-container ${isMobileChatOpen ? 'mobile-chat-active' : ''}`}>
      {/* Sidebar: Chat List */}
      <div className="chat-list-panel">
        <div className="panel-header">
          <div className="hub-title-row">
            <h1>Communication Hub</h1>
            <Shield size={18} className="supervision-icon" title="Supervised environment" />
          </div>
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search students, parents, teachers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="chat-filter-row">
            <div className="chat-filter-tabs">
              <button className={`chat-filter-btn ${threadFilter === 'active' ? 'active' : ''}`} onClick={() => setThreadFilter('active')}>Active</button>
              <button className={`chat-filter-btn ${threadFilter === 'resolved' ? 'active' : ''}`} onClick={() => setThreadFilter('resolved')}>Resolved</button>
            </div>
            <div style={{position: 'relative'}}>
              <button className="chat-new-msg-btn" onClick={() => setShowNewMsgMenu(!showNewMsgMenu)}>+ New</button>
              {showNewMsgMenu && (
                <div className="chat-new-msg-menu">
                  {role === 'PARENT' && (
                    <button onClick={() => handleNewMessage('teacher')}>Message Teacher</button>
                  )}
                  {role !== 'ADMIN' && (
                    <button onClick={() => handleNewMessage('management')}>Message Management</button>
                  )}
                  {(role === 'TEACHER' || role === 'ADMIN') && (
                    <button onClick={() => handleNewMessage('ocean-navigators')}>Ocean Navigators</button>
                  )}
                  {(role === 'ADMIN' || role === 'TEACHER') && (
                    <button onClick={() => handleNewMessage('people')}>New Conversation</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="threads-list">
          {filteredThreads.map(thread => (
            <div 
              key={thread.id} 
              className={`thread-item ${activeChat === thread.id ? 'active' : ''} ${thread.isBot ? 'bot-thread' : ''}`}
              onClick={() => handleSelectChat(thread.id)}
            >
              <div className={`thread-avatar ${thread.isBot ? 'bot-avatar' : ''}`}>
                {thread.isBot ? <Bot size={22} /> : (thread.name ? thread.name[0] : 'U')}
              </div>
              <div className="thread-info">
                <div className="thread-top">
                  <span className="thread-name">{thread.name}</span>
                  <span className="thread-time">{thread.time}</span>
                </div>
                <div className="thread-bottom">
                  <p className="thread-last-msg">{thread.lastMsg}</p>
                  {thread.unread > 0 && <span className="unread-badge">{thread.unread}</span>}
                </div>
                <div className="thread-roles">
                  {(thread.roles || []).map(role => (
                    <span key={role} className={`role-tag ${role.replace(' ','').toLowerCase()}`}>{role}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {filteredThreads.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No conversations found.
            </div>
          )}
        </div>
      </div>

      {/* Main: Chat Window */}
      <div className="chat-window-panel">
        {currentChatData ? (
          <>
            <div className="chat-header">
              <div className="header-info">
                <button className="icon-btn mobile-back-btn" onClick={handleBackToList}>
                  <ArrowLeft size={24} />
                </button>
                <div className={`header-avatar ${currentChatData.isBot ? 'bot-avatar' : ''}`}>
                  {currentChatData.isBot ? <Bot size={20} /> : (currentChatData.name ? currentChatData.name[0] : 'U')}
                </div>
                <div>
                  <h3>{currentChatData.name}</h3>
                  <div className="supervision-badge">
                    {currentChatData.isBot ? <Shield size={14} className="ai-check" /> : <Shield size={14} />}
                    <span>{currentChatData.isBot ? "AI Supervision Active" : "Moderated Conversation"}</span>
                  </div>
                </div>
              </div>
              
              <div style={{ position: 'relative' }}>
                <button className="icon-btn" onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}>
                  <MoreVertical size={20} />
                </button>
                {isHeaderMenuOpen && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', background: 'white', border: '1px solid var(--border-light)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', zIndex: 100, minWidth: '150px', padding: '8px 0' }}>
                    <button
                      onClick={handleBlockToggle}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: currentChatData.isBlocked ? 'var(--text-main)' : '#dc2626', fontSize: '14px', fontWeight: '500' }}
                      onMouseEnter={(e) => e.target.style.background = '#f1f5f9'}
                      onMouseLeave={(e) => e.target.style.background = 'none'}
                    >
                      {currentChatData.isBlocked ? "Unblock Contact" : "Block Contact"}
                    </button>
                    {currentChatData.status !== 'RESOLVED' && (
                      <button
                        onClick={() => { handleResolveThread(activeChat); setIsHeaderMenuOpen(false); }}
                        style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: '14px', fontWeight: '500' }}
                        onMouseEnter={(e) => e.target.style.background = '#f1f5f9'}
                        onMouseLeave={(e) => e.target.style.background = 'none'}
                      >
                        Mark as Resolved
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className="messages-area">
              <div className="message-date-divider"><span>Today</span></div>
              
              {(messages[activeChat] || []).map(msg => (
                <div key={msg.id} className={`message ${msg.type}`}>
                  <div className="msg-bubble">
                    {msg.text}
                    <span className="msg-time">{msg.time}</span>
                  </div>
                </div>
              ))}
              
              {(isTyping || typingThreads[activeChat]) && (
                <div className="message received">
                  <div className="msg-bubble typing-bubble">
                    <div className="typing-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {currentChatData.isBlocked ? (
              <div style={{ padding: '20px', textAlign: 'center', background: '#f8fafc', borderTop: '1px solid var(--border-light)', color: '#64748b', fontSize: '14px' }}>
                You have blocked this contact. You cannot send or receive messages.
                <br />
                <button onClick={handleBlockToggle} className="btn-text" style={{ marginTop: '8px', fontWeight: '600' }}>Unblock Contact</button>
              </div>
            ) : (
              <>
                {sendError && (
                  <div className="chat-send-error">
                    {sendError}
                    <button onClick={() => setSendError(null)}>&times;</button>
                  </div>
                )}
                <div className="chat-input-area">
                  <button className="icon-btn"><Paperclip size={20} /></button>
                  <input
                    type="text"
                    placeholder="Type your message..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  />
                  <button className="send-btn" onClick={handleSendMessage}>
                    <Send size={20} />
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="no-chat-selected">
            <MessageSquare size={48} />
            <h2>Select a conversation to start communicating</h2>
            <p>Admin supervision is active for all academy communication.</p>
          </div>
        )}
      </div>

      {showTeacherPicker && (
        <div className="teacher-picker-overlay" onClick={() => setShowTeacherPicker(false)}>
          <div className="teacher-picker-modal" onClick={e => e.stopPropagation()}>
            <h3>Message a Teacher</h3>
            {myTeachers.length === 0 ? (
              <p className="text-muted">No teachers found for your children's classes.</p>
            ) : (
              <div className="teacher-picker-list">
                {myTeachers.map(t => (
                  <button key={t.id} className="teacher-picker-item" onClick={() => handlePickTeacher(t.id)}>
                    <strong>{t.fullName}</strong>
                    <span className="text-muted">{t.students.join(', ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showPeoplePicker && (
        <div className="teacher-picker-overlay" onClick={() => setShowPeoplePicker(false)}>
          <div className="teacher-picker-modal" onClick={e => e.stopPropagation()}>
            <h3>New Conversation</h3>
            <input
              type="text"
              className="form-control"
              placeholder="Search by name or email..."
              value={peopleQuery}
              onChange={(e) => {
                setPeopleQuery(e.target.value);
                searchPeople(e.target.value);
              }}
              style={{ width: '100%', marginBottom: '12px', boxSizing: 'border-box' }}
              autoFocus
            />
            {peopleLoading ? (
              <p className="text-muted">Searching...</p>
            ) : people.length === 0 ? (
              <p className="text-muted">No matching users found.</p>
            ) : (
              <div className="teacher-picker-list">
                {people.map(p => (
                  <button key={p.id} className="teacher-picker-item" onClick={() => handlePickPerson(p.id)}>
                    <strong>{p.fullName}</strong>
                    <span className="text-muted">{p.role.charAt(0) + p.role.slice(1).toLowerCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHub;
