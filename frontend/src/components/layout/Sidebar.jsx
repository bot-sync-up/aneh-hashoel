import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  MessageCircleQuestion,
  ListFilter,
  CheckCircle2,
  MessageSquare,
  FileText,
  Bell,
  UserRound,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSocket } from '../../contexts/SocketContext';
import { get } from '../../lib/api';
import Avatar from '../ui/Avatar';
import Tooltip from '../ui/Tooltip';

const NAV_ITEMS = [
  {
    to: '/',
    label: 'דשבורד',
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: '/my-questions',
    label: 'השאלות שלי',
    icon: MessageCircleQuestion,
  },
  {
    to: '/questions',
    label: 'שאלות פתוחות',
    icon: ListFilter,
  },
  {
    to: '/answers',
    label: 'תשובות',
    icon: CheckCircle2,
  },
  {
    to: '/discussions',
    label: 'דיונים',
    icon: MessageSquare,
  },
  {
    to: '/templates',
    label: 'תבניות',
    icon: FileText,
  },
  {
    to: '/notifications',
    label: 'התראות',
    icon: Bell,
    badge: true,
  },
  {
    to: '/profile',
    label: 'פרופיל',
    icon: UserRound,
  },
];

const ADMIN_ITEM = {
  to: '/admin',
  label: 'ניהול',
  icon: ShieldCheck,
};

const COLLAPSED_KEY = 'sidebar_collapsed';

function Sidebar({ notificationCount = 0 }) {
  const { rabbi, logout, isAdmin } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { on } = useSocket();
  const location = useLocation();

  const [pendingCount, setPendingCount] = useState(0);
  const [myOpenCount, setMyOpenCount] = useState(0);

  const fetchCounts = useCallback(async () => {
    try {
      const data = await get('/questions/counts');
      setPendingCount(data.pendingCount ?? 0);
      setMyOpenCount(data.myOpenCount ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchCounts();
    const offNew      = on('question:new',      fetchCounts);
    const offClaimed  = on('question:claimed',  fetchCounts);
    const offReleased = on('question:released', fetchCounts);
    const offAnswered = on('question:answered', fetchCounts);
    return () => { offNew(); offClaimed(); offReleased(); offAnswered(); };
  }, [fetchCounts, on]);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {}
  };

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Build nav items list
  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  const sidebarContent = (
    <aside
      className={clsx(
        'flex flex-col h-full',
        'bg-[var(--sidebar-bg)]',
        'transition-all duration-300 ease-in-out',
        'sidebar',
        collapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* ── Brand header ── */}
      <div
        className={clsx(
          'flex items-center h-16 px-4 flex-shrink-0',
          'border-b border-white/10',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <div className="flex flex-col leading-tight overflow-hidden">
            <span className="text-white font-bold text-base font-heebo truncate">
              ענה את השואל
            </span>
            <span className="text-white/50 text-[11px] font-heebo truncate">
              פלטפורמת שאלות ותשובות
            </span>
          </div>
        )}

        {collapsed && (
          <span
            className={clsx(
              'w-9 h-9 rounded-full flex items-center justify-center',
              'bg-brand-gold/20 text-brand-gold font-bold text-sm font-heebo'
            )}
          >
            ע
          </span>
        )}

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'הרחב סרגל צד' : 'כווץ סרגל צד'}
          className={clsx(
            'hidden md:flex items-center justify-center',
            'w-7 h-7 rounded-md',
            'text-white/60 hover:text-white hover:bg-white/10',
            'transition-colors duration-150 flex-shrink-0',
            collapsed && 'mt-0'
          )}
        >
          {collapsed ? (
            <ChevronLeft size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden py-4 px-2"
        aria-label="ניווט ראשי"
      >
        <ul className="flex flex-col gap-0.5" role="list">
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              collapsed={collapsed}
              notificationCount={
                item.to === '/my-questions'  ? myOpenCount  :
                item.to === '/questions'     ? pendingCount :
                item.badge                  ? notificationCount : 0
              }
            />
          ))}
        </ul>
      </nav>

      {/* ── Rabbi info ── */}
      {rabbi && (
        <div
          className={clsx(
            'border-t border-white/10 px-3 py-3 flex-shrink-0',
            collapsed ? 'flex justify-center' : 'flex items-center gap-3'
          )}
        >
          <Avatar
            src={rabbi.photoUrl || rabbi.avatar}
            name={rabbi.name || rabbi.displayName}
            size="sm"
            showBorder
          />
          {!collapsed && (
            <div className="flex-1 overflow-hidden min-w-0">
              <p className="text-white text-sm font-semibold font-heebo truncate leading-tight">
                {rabbi.name || rabbi.displayName || 'הרב'}
              </p>
              <p className="text-white/50 text-xs font-heebo truncate">
                {rabbi.role === 'admin'
                  ? 'מנהל מערכת'
                  : rabbi.role === 'senior'
                  ? 'רב בכיר'
                  : 'רב'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom actions ── */}
      <div
        className={clsx(
          'border-t border-white/10 px-2 py-3 flex-shrink-0',
          'flex gap-1',
          collapsed ? 'flex-col items-center' : 'flex-row items-center justify-between'
        )}
      >
        {/* Theme toggle */}
        <Tooltip
          content={isDark ? 'מצב בהיר' : 'מצב כהה'}
          placement="top"
        >
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
            className={clsx(
              'flex items-center justify-center',
              'w-9 h-9 rounded-md',
              'text-[var(--sidebar-text)] hover:text-white hover:bg-white/10',
              'transition-colors duration-150'
            )}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </Tooltip>

        {/* Logout */}
        <Tooltip content="התנתק" placement="top">
          <button
            onClick={logout}
            aria-label="התנתקות"
            className={clsx(
              'flex items-center justify-center',
              'w-9 h-9 rounded-md',
              'text-[var(--sidebar-text)] hover:text-red-300 hover:bg-red-500/10',
              'transition-colors duration-150'
            )}
          >
            <LogOut size={18} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:block h-full">{sidebarContent}</div>

      {/* Mobile: hamburger trigger exposed via context; overlay rendered here */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 flex"
          onClick={() => setMobileOpen(false)}
        >
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
          <div
            className="relative flex h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

// ── NavItem sub-component ──────────────────────────────────────────────────

function NavItem({ item, collapsed, notificationCount = 0 }) {
  const Icon = item.icon;
  const hasNotif = notificationCount > 0;
  // notification items use red; question count items use gold
  const isQCount = item.to === '/my-questions' || item.to === '/questions';
  const badgeBg = isQCount ? 'bg-brand-gold text-brand-navy' : 'bg-red-500 text-white';

  const linkContent = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-md px-3 py-2.5',
          'text-sm font-medium font-heebo',
          'transition-colors duration-150',
          'relative group',
          isActive
            ? [
                'bg-[var(--sidebar-item-active-bg)]',
                'text-[var(--sidebar-text-active)]',
                'border-r-2 border-brand-gold dark:border-dark-accent',
              ]
            : [
                'text-[var(--sidebar-text)]',
                'hover:bg-[var(--sidebar-item-hover-bg)]',
                'hover:text-[var(--sidebar-text-active)]',
                'border-r-2 border-transparent',
              ],
          collapsed && 'justify-center px-0 w-11 mx-auto'
        )
      }
    >
      <span className="relative flex-shrink-0">
        <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
        {hasNotif && collapsed && (
          <span
            className={clsx(
              'absolute -top-1 -right-1',
              'min-w-[14px] h-3.5 rounded-full',
              badgeBg,
              'text-[9px] font-bold font-heebo',
              'flex items-center justify-center px-0.5',
              'notification-dot'
            )}
            aria-label={`${notificationCount} התראות`}
          >
            {notificationCount > 99 ? '99+' : notificationCount}
          </span>
        )}
      </span>

      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>

          {hasNotif && (
            <span
              className={clsx(
                'min-w-[20px] h-5 rounded-full px-1',
                badgeBg,
                'text-xs font-bold font-heebo',
                'flex items-center justify-center',
                'flex-shrink-0'
              )}
              aria-label={`${notificationCount} התראות`}
            >
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  // Wrap with tooltip when collapsed to show label on hover
  if (collapsed) {
    return (
      <li>
        <Tooltip content={item.label} placement="left">
          {linkContent}
        </Tooltip>
      </li>
    );
  }

  return <li>{linkContent}</li>;
}

export default Sidebar;
