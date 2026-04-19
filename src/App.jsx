import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Layout/Sidebar'
import ChatHub from './components/Chat/ChatHub'
import Dashboard from './components/Dashboard/Dashboard'
import StudentsList from './components/Students/StudentsList'
import CalendarView from './components/Schedule/CalendarView'
import ClassSession from './components/Schedule/ClassSession'
import BillingPanel from './components/Billing/BillingPanel'
import SupervisionPanel from './components/Supervision/SupervisionPanel'
import './index.css'

function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chat" element={<ChatHub />} />
            <Route path="/students" element={<StudentsList />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/session" element={<ClassSession />} />
            <Route path="/billing" element={<BillingPanel />} />
            <Route path="/supervision" element={<SupervisionPanel />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
