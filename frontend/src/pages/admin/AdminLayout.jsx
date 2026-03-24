import React, { Suspense } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '../../components/ui/Spinner';

const RabbisAdminPage      = React.lazy(() => import('./RabbisAdminPage'));
const AdminQuestionsPage   = React.lazy(() => import('./AdminQuestionsPage'));
const CategoriesAdminPage  = React.lazy(() => import('./CategoriesAdminPage'));
const SettingsPage         = React.lazy(() => import('./SettingsPage'));
const AuditLogPage         = React.lazy(() => import('./AuditLogPage'));
const SystemHealthPage     = React.lazy(() => import('./SystemHealthPage'));
const LeaderboardPage      = React.lazy(() => import('./LeaderboardPage'));
const AdminLeadsPage       = React.lazy(() => import('./LeadsPage'));
import { clsx } from 'clsx';
import {
  Users,
  HelpCircle,
  Tag,
  Settings,
  ScrollText,
  Activity,
  Trophy,
  UserCheck,
} from 'lucide-react';

const TABS = [
  { to: 'rabbis',      label: 'רבנים',           icon: Users },
  { to: 'questions',   label: 'שאלות',           icon: HelpCircle },
  { to: 'categories',  label: 'קטגוריות',        icon: Tag },
  { to: 'leads',       label: 'לידים',           icon: UserCheck },
  { to: 'settings',    label: 'הגדרות',          icon: Settings },
  { to: 'logs',        label: 'לוגים',           icon: ScrollText },
  { to: 'health',      label: 'בריאות המערכת',   icon: Activity },
  { to: 'leaderboard', label: 'לוח מצטיינים',   icon: Trophy },
];

export default function AdminLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[var(--bg-page)]" dir="rtl">
      {/* Admin header bar */}
      <div className="bg-[var(--bg-surface)] border-b border-[var(--border-default)] shadow-[var(--shadow-soft)]">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-4">
            <div>
              <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
                לוח ניהול
              </h1>
              <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
                ענה את השואל — ניהול מערכת
              </p>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium font-heebo"
              style={{ backgroundColor: 'rgba(27,43,94,0.08)', color: '#1B2B5E' }}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              מנהל מערכת
            </div>
          </div>

          {/* Nav tabs */}
          <nav
            className="flex gap-1 overflow-x-auto pb-0 scrollbar-hide"
            aria-label="ניווט לוח ניהול"
          >
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium font-heebo whitespace-nowrap',
                    'border-b-2 transition-all duration-150 flex-shrink-0',
                    isActive
                      ? 'border-[#B8973A] text-[#B8973A]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  )
                }
              >
                <Icon size={16} strokeWidth={1.8} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <Suspense fallback={<FullPageSpinner label="טוען..." />}>
          <Routes>
            <Route index element={<Navigate to="rabbis" replace />} />
            <Route path="rabbis"     element={<RabbisAdminPage />} />
            <Route path="questions"  element={<AdminQuestionsPage />} />
            <Route path="categories" element={<CategoriesAdminPage />} />
            <Route path="settings"   element={<SettingsPage />} />
            <Route path="logs"       element={<AuditLogPage />} />
            <Route path="health"     element={<SystemHealthPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="leads"       element={<AdminLeadsPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
