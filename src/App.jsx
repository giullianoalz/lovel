import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/Layout/Sidebar'
import Login from './components/Auth/Login'
import ChatHub from './components/Chat/ChatHub'
import Dashboard from './components/Dashboard/Dashboard'
import StudentsList from './components/Students/StudentsList'
import CalendarView from './components/Schedule/CalendarView'
import ClassSession from './components/Schedule/ClassSession'
import BillingPanel from './components/Billing/BillingPanel'
import SupervisionPanel from './components/Supervision/SupervisionPanel'
import RegistrationAdmin from './components/Registration/RegistrationAdmin'
import StudentPortal from './components/Portal/StudentPortal'
import ParentPortal from './components/Portal/ParentPortal'
import BehaviorTracker from './components/Behavior/BehaviorTracker'
import ClassFitReport from './components/ClassFit/ClassFitReport'
import FrontDeskAlerts from './components/Alerts/FrontDeskAlerts'
import MarketingHub from './components/Marketing/MarketingHub'
import TeacherPortal from './components/Portal/TeacherPortal'
import './index.css'

// Helper component to restrict access based on authentication status and roles
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        minHeight: '100vh', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: '#f0fdf4',
        fontFamily: 'Inter, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#064e3b', fontWeight: '600', fontSize: '16px', marginBottom: '8px' }}>
            Cargando tu experiencia académica...
          </p>
          <span style={{ fontSize: '13px', color: '#166534', opacity: 0.8 }}>Conectando con la base de datos Neon</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Public Login Route */}
          <Route path="/login" element={<Login />} />

          {/* Protected Sub-routes inside Main Layout */}
          <Route 
            path="/*" 
            element={
              <ProtectedRoute>
                <div className="app-container">
                  <Sidebar />
                  <main className="content">
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/chat" element={<ChatHub />} />
                      <Route path="/calendar" element={<CalendarView />} />
                      
                      {/* Portals */}
                      <Route 
                        path="/portal/student" 
                        element={
                          <ProtectedRoute allowedRoles={['STUDENT']}>
                            <StudentPortal />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/portal/parent" 
                        element={
                          <ProtectedRoute allowedRoles={['PARENT']}>
                            <ParentPortal />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/portal/teacher" 
                        element={
                          <ProtectedRoute allowedRoles={['TEACHER', 'ADMIN']}>
                            <TeacherPortal />
                          </ProtectedRoute>
                        } 
                      />

                      {/* Admin & Teacher access */}
                      <Route 
                        path="/students" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN', 'TEACHER']}>
                            <StudentsList />
                          </ProtectedRoute>
                        } 
                      />
                      <Route path="/session" element={<Navigate to="/portal/teacher" replace />} />
                      <Route 
                        path="/behavior" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN', 'TEACHER']}>
                            <BehaviorTracker />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/class-fit" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN', 'TEACHER']}>
                            <ClassFitReport />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/marketing" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN', 'TEACHER']}>
                            <MarketingHub />
                          </ProtectedRoute>
                        } 
                      />

                      {/* Admin only access */}
                      <Route 
                        path="/billing" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <BillingPanel />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/registration" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <RegistrationAdmin />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/supervision" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <SupervisionPanel />
                          </ProtectedRoute>
                        } 
                      />
                      <Route 
                        path="/alerts" 
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <FrontDeskAlerts />
                          </ProtectedRoute>
                        } 
                      />

                      {/* Catch-all redirect */}
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </main>
                </div>
              </ProtectedRoute>
            } 
          />
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App
