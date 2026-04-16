import React, { Suspense, useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '../../components/ui/Spinner';
import { get } from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';

const RabbisAdminPage      = React.lazy(() => import('./RabbisAdminPage'));
const AdminQuestionsPage   = React.lazy(() => import('./AdminQuestionsPage'));
const CategoriesAdminPage  = React.lazy(() => import('./CategoriesAdminPage'));
const SettingsPage         = React.lazy(() => import('./SettingsPage'));
const AuditLogPage         = React.lazy(() => import('./AuditLogPage'));
const SystemHealthPage     = React.lazy(() => import('./SystemHealthPage'));
const LeaderboardPage      = React.lazy(() => import('./LeaderboardPage'));
const AdminLeadsPage       = React.lazy(() => import('./LeadsPage'));
const LeadDetailPage       = React.lazy(() => import('./LeadDetailPage'));
const EmailSettingsPage    = React.lazy(() => import('./EmailSettingsPage'));
const NewsletterPage        = React.lazy(() => import('./NewsletterPage'));
const NewsletterArchivePage = React.lazy(() => import('./NewsletterArchivePage'));
const EmergencyPage         = React.lazy(() => import('./EmergencyPage'));
const SupportAdminPage     = React.lazy(() => import('./SupportAdminPage'));
const DonationsPage        = React.lazy(() => import('./DonationsPage'));
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
  Mail,
  Newspaper,
  Archive,
  AlertTriangle,
  Headphones,
  Heart,
} from 'lucide-react';

const TABS = [
  { to: 'support',         label: 'פניות',          icon: Headphones },
  { to: 'rabbis',      label: 'רבנים',           icon: Users },
  { to: 'questions',   label: 'שאלות',           icon: HelpCircle },
  { to: 'categories',  label: 'קטגוריות',        icon: Tag },
  { to: 'leads',       label: 'לידים',           icon: UserCheck },
  { to: 'leaderboard', label: 'לוח מצטיינים',   icon: Trophy },
  { to: 'settings',    label: 'הגדרות',          icon: Settings },
  { to: 'logs',        label: 'לוגים',           icon: ScrollText },
  { to: 'health',      label: 'בריאות המערכת',   icon: Activity },
  { to: 'email-templates', label: 'תבניות אימייל', icon: Mail },
  { to: 'newsletter',      label: 'ניוזלטר',       icon: Newspaper },
  { to: 'newsletter-archive', label: 'ארכיון ניוזלטרים', icon: Archive },
  { to: 'donations',       label: 'תרומות',         icon: Heart },
  { to: 'emergency',       label: 'שידור חירום',   icon: AlertTriangle },
];

export default function AdminLayout() {
  const location = useLocation();

  // Pending category suggestions count → red badge on the "קטגוריות" tab
  const [pendingCategoryCount, setPendingCategoryCount] = useState(0);
  const socket = useSocket();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      get('/categories/pending/count')
        .then((d) => { if (!cancelled) setPendingCategoryCount(d?.count || 0); })
        .catch(() => { /* non-fatal — badge stays hidden */ });
    };
    refresh();
    // Refresh every minute in case another admin approves/rejects
    const t = setInterval(refresh, 60_000);
    // Real-time: refresh when we receive any category event via socket (optional)
    const off = socket?.on?.('category:new', refresh);
    return () => { cancelled = true; clearInterval(t); off?.(); };
  }, [socket]);

  // Build the tabs list with the badge count attached to 'categories'
  const tabsWithBadges = TABS.map((tab) =>
    tab.to === 'categories' ? { ...tab, badge: pendingCategoryCount } : tab
  );

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
            {tabsWithBadges.map(({ to, label, icon: Icon, badge }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'relative flex items-center gap-2 px-4 py-3 text-sm font-medium font-heebo whitespace-nowrap',
                    'border-b-2 transition-all duration-150 flex-shrink-0',
                    isActive
                      ? 'border-[#B8973A] text-[#B8973A]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  )
                }
              >
                <Icon size={16} strokeWidth={1.8} />
                {badge > 0 && (
                  <span
                    title={`${badge} הצעות ממתינות לאישור`}
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white leading-none"
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
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
            <Route index element={<Navigate to="support" replace />} />
            <Route path="rabbis"     element={<RabbisAdminPage />} />
            <Route path="questions"  element={<AdminQuestionsPage />} />
            <Route path="categories" element={<CategoriesAdminPage />} />
            <Route path="settings"   element={<SettingsPage />} />
            <Route path="logs"       element={<AuditLogPage />} />
            <Route path="health"     element={<SystemHealthPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="leads"       element={<AdminLeadsPage />} />
            <Route path="leads/:id"   element={<LeadDetailPage />} />
            <Route path="email-templates" element={<EmailSettingsPage />} />
            <Route path="newsletter"      element={<NewsletterPage />} />
            <Route path="newsletter-archive" element={<NewsletterArchivePage />} />
            <Route path="donations"       element={<DonationsPage />} />
            <Route path="emergency"       element={<EmergencyPage />} />
            <Route path="support"         element={<SupportAdminPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
