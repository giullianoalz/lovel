import React, { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/Layout/Sidebar'
import Login from './components/Auth/Login'
import { ToastProvider } from './components/Layout/ToastProvider'
import './index.css'

// Route components are lazy-loaded so each lands in its own chunk — the initial
// bundle only ships the shell (Sidebar, Login, providers), not every screen.
const ChatHub = lazy(() => import('./components/Chat/ChatHub'))
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'))
const StudentsList = lazy(() => import('./components/Students/StudentsList'))
const CalendarView = lazy(() => import('./components/Schedule/CalendarView'))
const BillingPanel = lazy(() => import('./components/Billing/BillingPanel'))
const SupervisionPanel = lazy(() => import('./components/Supervision/SupervisionPanel'))
const RegistrationAdmin = lazy(() => import('./components/Registration/RegistrationAdmin'))
const StudentPortal = lazy(() => import('./components/Portal/StudentPortal'))
const ParentPortal = lazy(() => import('./components/Portal/ParentPortal'))
const BehaviorTracker = lazy(() => import('./components/Behavior/BehaviorTracker'))
const FrontDeskAlerts = lazy(() => import('./components/Alerts/FrontDeskAlerts'))
const MarketingHub = lazy(() => import('./components/Marketing/MarketingHub'))
const TeacherPortal = lazy(() => import('./components/Portal/TeacherPortal'))
const MyPayroll = lazy(() => import('./components/Payroll/MyPayroll'))
const MedicalIncidents = lazy(() => import('./components/Medical/MedicalIncidents'))
const LessonPlanReview = lazy(() => import('./components/LessonPlans/LessonPlanReview'))
const AcademyFeed = lazy(() => import('./components/Feed/AcademyFeed'))

const RouteFallback = () => (
  <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
    Loading…
  </div>
)

// Root redirect: teachers/admins → Teacher Portal, others → Dashboard
const SmartRoot = () => {
  const { role } = useAuth();
  if (role === 'ADMIN' || role === 'TEACHER') return <Navigate to="/portal/teacher" replace />;
  if (role === 'STUDENT') return <Navigate to="/portal/student" replace />;
  if (role === 'PARENT')  return <Navigate to="/portal/parent"  replace />;
  return <Navigate to="/dashboard" replace />;
};

// ADMIN/TEACHER land on Teacher Portal; STUDENT/PARENT use Dashboard
const SmartDashboard = () => {
  const { role } = useAuth();
  if (role === 'ADMIN' || role === 'TEACHER') return <Navigate to="/portal/teacher" replace />;
  return <Dashboard />;
};

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
            Loading your academy experience...
          </p>
          <span style={{ fontSize: '13px', color: '#166534', opacity: 0.8 }}>Connecting to Neon database</span>
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
        <ToastProvider>
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
                    <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<SmartRoot />} />
                      <Route path="/dashboard" element={<SmartDashboard />} />
                      <Route path="/feed" element={<AcademyFeed />} />
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
                        path="/my-payroll"
                        element={
                          <ProtectedRoute allowedRoles={['TEACHER']}>
                            <MyPayroll />
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
                      <Route
                        path="/medical"
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <MedicalIncidents />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/lesson-plans"
                        element={
                          <ProtectedRoute allowedRoles={['ADMIN']}>
                            <LessonPlanReview />
                          </ProtectedRoute>
                        }
                      />

                      {/* Catch-all redirect */}
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                    </Suspense>
                  </main>
                </div>
              </ProtectedRoute>
            } 
          />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </Router>
  )
}

export default App
