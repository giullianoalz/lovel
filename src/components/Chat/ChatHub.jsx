import React, { useState, useEffect, useRef } from 'react';
import { Search, MoreVertical, Send, Paperclip, Shield, MessageSquare, Bot, ArrowLeft } from 'lucide-react';
import { database } from '../../lib/database';
import './ChatHub.css';

const ChatHub = () => {
  const [activeChat, setActiveChat] = useState(null);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatThreads, setChatThreads] = useState([]);
  
  // Dynamic message state
  const [messages, setMessages] = useState({
    '1': [
      { id: 1, sender: "Maria Garcia", text: "Hello! I'm ready for the group session today.", time: "10:15 AM", type: "received" },
      { id: 2, sender: "Me", text: "Great! See you at 4:00 PM.", time: "10:20 AM", type: "sent" }
    ],
    '0': [
      { id: 1, sender: "Assistant", text: "Hello! I am your Academy Assistant. I can help you schedule classes, check availability with teachers, or manage your enrollment. How can I help you today?", time: "9:00 AM", type: "received" }
    ]
  });

  useEffect(() => {
    const loadThreads = async () => {
      const threads = await database.fetchConversations();
      setChatThreads(threads);
    };
    loadThreads();
  }, []);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeChat]);

  const handleSelectChat = (id) => {
    setActiveChat(id);
    setIsMobileChatOpen(true);
  };

  const handleBackToList = () => {
    setIsMobileChatOpen(false);
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const newMessage = {
      id: Date.now(),
      sender: "Me",
      text: inputText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: "sent"
    };

    setMessages(prev => ({
      ...prev,
      [activeChat]: [...(prev[activeChat] || []), newMessage]
    }));

    const sentText = inputText;
    setInputText('');

    // Handle AI Logic if talking to the bot
    if (activeChat === '0') {
      simulateAIResponse(sentText);
    }
  };

  const simulateAIResponse = (userText) => {
    setIsTyping(true);
    
    setTimeout(() => {
      let responseText = "I'm processing your request. Give me a moment to check the teacher's schedule...";
      
      const lowerText = userText.toLowerCase();
      if (lowerText.includes("math") || lowerText.includes("class") || lowerText.includes("mate")) {
        responseText = "I see you're looking for a math class. I found Prof. David Brown is available tomorrow at 4:30 PM. Would you like me to book it for you?";
      } else if (lowerText.includes("yes") || lowerText.includes("si")) {
        responseText = "Perfect! The class has been scheduled. I've updated your Google Calendar and sent a notification to Prof. David. Anything else?";
      }

      const aiMessage = {
        id: Date.now() + 1,
        sender: "Assistant",
        text: responseText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: "received"
      };

      setMessages(prev => ({
        ...prev,
        '0': [...(prev['0'] || []), aiMessage]
      }));
      setIsTyping(false);
    }, 2000);
  };

  const currentChatData = chatThreads.find(t => t.id === activeChat);

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
            <input type="text" placeholder="Search students, parents, teachers..." />
          </div>
        </div>
        
        <div className="threads-list">
          {chatThreads.map(thread => (
            <div 
              key={thread.id} 
              className={`thread-item ${activeChat === thread.id ? 'active' : ''} ${thread.isBot ? 'bot-thread' : ''}`}
              onClick={() => handleSelectChat(thread.id)}
            >
              <div className={`thread-avatar ${thread.isBot ? 'bot-avatar' : ''}`}>
                {thread.isBot ? <Bot size={22} /> : thread.name[0]}
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
                  {currentChatData.isBot ? <Bot size={20} /> : currentChatData.name[0]}
                </div>
                <div>
                  <h3>{currentChatData.name}</h3>
                  <div className="supervision-badge">
                    {currentChatData.isBot ? <Shield size={14} className="ai-check" /> : <Shield size={14} />}
                    <span>{currentChatData.isBot ? "AI Supervision Active" : "Moderated Conversation"}</span>
                  </div>
                </div>
              </div>
              <button className="icon-btn"><MoreVertical size={20} /></button>
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
              
              {isTyping && (
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
        ) : (
          <div className="no-chat-selected">
            <MessageSquare size={48} />
            <h2>Select a conversation to start communicating</h2>
            <p>Admin supervision is active for all academy communication.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHub;
