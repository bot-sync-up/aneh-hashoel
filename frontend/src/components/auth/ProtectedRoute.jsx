import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { FullPageSpinner } from '../ui/Spinner';

/**
 * ProtectedRoute
 *
 * Wraps any route that requires authentication.
 *
 * Behaviour:
 *  1. While AuthContext is still initializing (verifying token on mount) → full-page spinner.
 *  2. Not authenticated → redirect to /login (preserves intended URL in location.state.from).
 *  3. Authenticated but must_change_password / mustChangePassword is true → redirect to /setup-password.
 *  4. adminOnly prop is true and the rabbi is not an admin → redirect to /.
 *  5. Otherwise → render children.
 *
 * Usage:
 *   <ProtectedRoute>
 *     <DashboardPage />
 *   </ProtectedRoute>
 *
 *   <ProtectedRoute adminOnly>
 *     <AdminPage />
 *   </ProtectedRoute>
 */
export default function ProtectedRoute({ children, adminOnly = false }) {
  const { rabbi, isAuthenticated, isAdmin, initializing } = useAuth();
  const location = useLocation();

  // 1. Still bootstrapping — prevent a flash redirect before token verification
  if (initializing) {
    return <FullPageSpinner label="טוען..." />;
  }

  // 2. Not authenticated → send to login, preserve intended destination
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // 3. First-login: rabbi must set a personal password before accessing anything
  if (rabbi?.must_change_password || rabbi?.mustChangePassword) {
    return <Navigate to="/setup-password" replace />;
  }

  // 4. Admin-only guard — non-admins get redirected to home
  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  // 5. Access granted
  return children;
}
