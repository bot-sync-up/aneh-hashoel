import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { FullPageSpinner } from './components/ui/Spinner';
import Layout from './components/layout/Layout';

// Lazy-loaded pages
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const QuestionsPage = React.lazy(() => import('./pages/QuestionsPage'));
const QuestionDetailPage = React.lazy(() => import('./pages/QuestionDetailPage'));
const MyQuestionsPage = React.lazy(() => import('./pages/MyQuestionsPage'));
const DiscussionsPage = React.lazy(() => import('./pages/DiscussionsPage'));
const DiscussionDetailPage = React.lazy(() => import('./pages/DiscussionDetailPage'));
const TemplatesPage = React.lazy(() => import('./pages/TemplatesPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = React.lazy(() => import('./pages/NotificationsPage'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const TwoFactorPage = React.lazy(() => import('./pages/TwoFactorPage'));
const LinkExpiredPage = React.lazy(() => import('./pages/LinkExpiredPage'));
// Additional spec pages
const ForgotPasswordPage = React.lazy(() => import('./pages/auth/ForgotPasswordPage'));
const AuthCallbackPage = React.lazy(() => import('./pages/auth/AuthCallbackPage'));
const SetupPasswordPage = React.lazy(() => import('./pages/SetupPasswordPage'));
const StatsPage = React.lazy(() => import('./pages/StatsPage'));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage'));
const AdminLayout = React.lazy(() => import('./pages/admin/AdminLayout'));
const AnswersPage = React.lazy(() => import('./pages/AnswersPage'));
const LeadsPage   = React.lazy(() => import('./pages/admin/LeadsPage'));

function PrivateRoute({ children }) {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return <FullPageSpinner label="טוען..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, initializing } = useAuth();
  if (initializing) return <FullPageSpinner label="טוען..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function CSRoute({ children }) {
  const { isAuthenticated, isCS, initializing } = useAuth();
  if (initializing) return <FullPageSpinner label="טוען..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isCS) return <Navigate to="/" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return <FullPageSpinner label="טוען..." />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <React.Suspense fallback={<FullPageSpinner label="טוען..." />}>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <PublicRoute>
              <ResetPasswordPage />
            </PublicRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicRoute>
              <ForgotPasswordPage />
            </PublicRoute>
          }
        />
        <Route
          path="/auth/callback"
          element={<AuthCallbackPage />}
        />
        <Route
          path="/2fa"
          element={<TwoFactorPage />}
        />
        <Route
          path="/link-expired"
          element={<LinkExpiredPage />}
        />

        {/* Protected routes wrapped in Layout */}
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <Layout>
                <React.Suspense fallback={<FullPageSpinner label="טוען..." />}>
                  <Routes>
                    <Route index element={<DashboardPage />} />
                    <Route path="questions" element={<QuestionsPage />} />
                    <Route path="questions/:id" element={<QuestionDetailPage />} />
                    <Route path="my-questions" element={<MyQuestionsPage />} />
                    <Route path="answers" element={<AnswersPage />} />
                    <Route path="discussions" element={<DiscussionsPage />} />
                    <Route path="discussions/:id" element={<DiscussionDetailPage />} />
                    <Route path="templates" element={<TemplatesPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="stats" element={<StatsPage />} />
                    <Route path="setup-password" element={<SetupPasswordPage />} />
                    <Route
                      path="admin/*"
                      element={
                        <AdminRoute>
                          <AdminLayout />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="leads"
                      element={
                        <CSRoute>
                          <LeadsPage />
                        </CSRoute>
                      }
                    />
                    {/* Catch-all 404 */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </React.Suspense>
              </Layout>
            </PrivateRoute>
          }
        />
      </Routes>
    </React.Suspense>
  );
}
