import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  MessageSquare,
  CheckSquare,
  Users,
  BarChart2,
  Settings,
  RefreshCw,
  ChevronLeft,
  Wifi,
  WifiOff,
  Heart,
  Flame,
  PhoneCall,
  Clock,
  TrendingUp,
} from 'lucide-react';

import { useAuth }   from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api           from '../lib/api';
import { formatDate } from '../lib/utils';

// Existing dashboard sub-components (pre-existing)
import QuestionCard    from '../components/dashboard/QuestionCard';
import ActivityFeed    from '../components/dashboard/ActivityFeed';
import EmergencyBanner from '../components/dashboard/EmergencyBanner';

// New dashboard sub-components
import AdminStatCards        from '../components/dashboard/AdminStatCards';
import RabbiStatCards        from '../components/dashboard/RabbiStatCards';
import ActivityChart         from '../components/dashboard/ActivityChart';
import CategoryChart         from '../components/dashboard/CategoryChart';
import RecentActivity        from '../components/dashboard/RecentActivity';
import PendingQuestionsAlert from '../components/dashboard/PendingQuestionsAlert';
import OnlineRabbis          from '../components/dashboard/OnlineRabbis';

import Card    from '../components/ui/Card';
import Button  from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

// ── Helpers ─────────────────────────────────────────────────────────────────

function hebrewGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'בוקר טוב';
  if (h < 18) return 'צהריים טובים';
  return 'ערב טוב';
}

/** Section heading with optional action link */
function SectionHeading({ id, children, action }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <h2
        id={id}
        className="text-base font-bold font-heebo text-[var(--text-primary)]"
      >
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Admin quick-link tile */
function AdminQuickLink({ to, icon: Icon, label, description }) {
  return (
    <Link
      to={to}
      className={clsx(
        'group flex items-center gap-3 p-4 rounded-xl border',
        'bg-[var(--bg-surface)] border-[var(--border-default)]',
        'hover:border-[var(--accent)] hover:shadow-md hover:-translate-y-0.5',
        'transition-all duration-200'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0',
          'bg-[var(--bg-muted)] group-hover:bg-[#B8973A]/15 transition-colors duration-200'
        )}
      >
        <Icon className="w-5 h-5 text-[var(--accent)]" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
          {label}
        </p>
        {description && (
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5 truncate">
            {description}
          </p>
        )}
      </div>
      <ChevronLeft
        className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors duration-150 flex-shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}

// ── Normalise API response shapes ─────────────────────────────────────────────

function extractRabbiStats(data) {
  // Backend may wrap in { ok, data: {...} }
  const s = data?.rabbi || data?.myStats || data?.data || data || {};
  return {
    answeredThisMonth: s.answeredThisMonth ?? s.answeredThisWeek ?? s.weekAnswers ?? s.totalAnswered ?? 0,
    avgResponseTimeLabel: s.avgResponseTimeLabel
      ?? (s.avgResponseTime ? `${s.avgResponseTime}ש'` : '—'),
    thanksReceived: s.thanksReceived ?? s.thanksThisWeek ?? s.totalThanks ?? 0,
    openQuestions: s.openQuestions ?? s.inProcess ?? 0,
    answeredTrend: s.answeredTrend ?? null,
    responseTrend: s.responseTrend ?? null,
    thanksTrend: s.thanksTrend ?? null,
  };
}

function extractAdminStats(data) {
  // Backend returns { ok: true, data: { pending, inProcess, thisWeekAnswers, ... } }
  const s = data?.system || data?.adminStats || data?.data || data || {};
  return {
    pendingCount:         s.totalPending    ?? s.pendingCount    ?? s.pending    ?? 0,
    inProcessCount:       s.totalInProcess  ?? s.inProcessCount  ?? s.inProcess  ?? 0,
    answeredThisWeek:     s.answeredThisWeek ?? s.thisWeekAnswers ?? s.answeredToday ?? 0,
    onlineRabbis:         s.onlineRabbis ?? 0,
    avgResponseTimeLabel: s.avgResponseTimeLabel
      ?? (s.avgResponseTime ? `${s.avgResponseTime}ש'` : '—'),
    totalThanks:    s.totalThanks ?? 0,
    pendingTrend:   s.pendingTrend   ?? null,
    inProcessTrend: s.inProcessTrend ?? null,
    answeredTrend:  s.answeredTrend  ?? null,
    responseTrend:  s.responseTrend  ?? null,
    thanksTrend:    s.thanksTrend    ?? null,
  };
}

// ── Main component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { rabbi, isAdmin } = useAuth();
  const { connected, on }  = useSocket();
  const navigate           = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Aggregated stats for the new stat-card components
  const [rabbiStats, setRabbiStats] = useState({});
  const [adminStats, setAdminStats] = useState({});

  // Chart data
  const [weeklyActivity,   setWeeklyActivity]   = useState([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState([]);

  // Activity feed / recent events
  const [recentEvents, setRecentEvents] = useState([]);

  // Online rabbis list (admin)
  const [onlineRabbisList, setOnlineRabbisList] = useState([]);

  // Legacy: in-process questions assigned to me, pending queue
  const [myQuestions, setMyQuestions] = useState([]);
  const [pendingQ,    setPendingQ]    = useState([]);
  const [claimingId,  setClaimingId]  = useState(null);

  // Emergency banner
  const [emergency, setEmergency] = useState({ message: null, id: null });

  // ROI stats (admin only)
  const [roiStats, setRoiStats] = useState(null);

  // Pulse tracking for live stat updates
  const pulseTimerRef = useRef(null);

  // ── Fetch dashboard data ───────────────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try the admin endpoint first, fall back to general
      const endpoint = isAdmin ? '/admin/dashboard/stats' : '/dashboard/stats';

      const requests = [
        api.get(endpoint),
        api.get('/dashboard/my-questions'),
        api.get('/questions', { params: { status: 'pending', limit: 10 } }),
        api.get('/dashboard/activity', { params: { limit: 20 } }),
      ];
      if (isAdmin) {
        requests.push(api.get('/admin/dashboard/activity'));
        requests.push(api.get('/admin/dashboard/categories/breakdown'));
        requests.push(api.get('/admin/dashboard/roi'));
      }

      const [statsRes, myQRes, pendingRes, activityRes, adminActivityRes, catRes, roiRes] =
        await Promise.allSettled(requests);

      if (statsRes.status === 'fulfilled') {
        const d = statsRes.value.data;

        if (isAdmin) {
          setAdminStats(extractAdminStats(d));
          setRabbiStats(extractRabbiStats(d));
        } else {
          setRabbiStats(extractRabbiStats(d));
          // non-admin: chart data may be in stats response
          const s = d?.data || d || {};
          setWeeklyActivity(s.weeklyActivity ?? s.weeklyChart ?? s.questionsPerDay ?? []);
          setCategoryBreakdown(s.categoryBreakdown ?? s.categories ?? []);
          setRecentEvents(s.recentActivity ?? []);
        }

        const base = d?.data || d || {};
        setOnlineRabbisList(base.onlineRabbisList ?? []);
        if (base.emergency) {
          setEmergency({ message: base.emergency.message, id: base.emergency._id || base.emergency.id });
        }
      }

      // Admin chart data from dedicated endpoints
      if (isAdmin) {
        if (adminActivityRes?.status === 'fulfilled') {
          const ad = adminActivityRes.value.data;
          setWeeklyActivity(ad?.data ?? ad ?? []);
        }
        if (catRes?.status === 'fulfilled') {
          const cd = catRes.value.data;
          setCategoryBreakdown(cd?.data ?? cd ?? []);
        }
        if (roiRes?.status === 'fulfilled') {
          const rd = roiRes.value.data;
          setRoiStats(rd?.data ?? rd ?? null);
        }
      }

      if (myQRes.status === 'fulfilled') {
        setMyQuestions(myQRes.value.data?.questions || myQRes.value.data || []);
      }

      if (pendingRes.status === 'fulfilled') {
        const pData = pendingRes.value.data;
        const pArr  = pData?.questions || pData || [];
        setPendingQ(pArr);
        // Sync pending count into adminStats if not already set
        if (isAdmin) {
          setAdminStats((prev) => ({
            ...prev,
            pendingCount: prev.pendingCount || pArr.length,
          }));
        }
      }

      if (activityRes.status === 'fulfilled') {
        const aData = activityRes.value.data;
        const events = aData?.activities || aData?.recentActivity || aData || [];
        // Merge with stats-provided recent events (dedup by id)
        setRecentEvents((prev) => {
          const merged = [...events, ...prev];
          const seen = new Set();
          return merged
            .filter((e) => {
              const key = e.id || e._id || JSON.stringify(e);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, 10);
        });
      }

      setLastRefreshed(new Date());
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        'לא ניתן לטעון את נתוני לוח הבקרה. אנא נסה שוב.'
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ── Claim question ─────────────────────────────────────────────────────
  const handleClaim = useCallback(
    async (questionId) => {
      setClaimingId(questionId);
      try {
        await api.post(`/questions/${questionId}/claim`);
        setPendingQ((prev) => prev.filter((q) => (q._id || q.id) !== questionId));
        navigate(`/questions/${questionId}?answer=1`);
      } catch (err) {
        const msg =
          err.response?.data?.message ||
          'לא ניתן לתפוס את השאלה. ייתכן שנתפסה כבר.';
        alert(msg);
      } finally {
        setClaimingId(null);
      }
    },
    [navigate]
  );

  const handleTimerExpired = useCallback(() => {
    setTimeout(fetchDashboard, 1500);
  }, [fetchDashboard]);

  // ── Real-time socket updates ───────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      on('question:new', (payload) => {
        setAdminStats((prev) => ({
          ...prev,
          pendingCount: (prev.pendingCount ?? 0) + 1,
        }));
        // Prepend to pending list (for admin view)
        if (payload && Object.keys(payload).length > 1) {
          setPendingQ((prev) => [payload, ...prev].slice(0, 10));
        }
      }),

      on('question:claimed', (payload) => {
        const qId = payload?.id || payload?._id;
        if (qId) {
          setPendingQ((prev) => prev.filter((q) => (q._id || q.id) !== qId));
        }
        setAdminStats((prev) => ({
          ...prev,
          pendingCount: Math.max(0, (prev.pendingCount ?? 0) - 1),
          inProcessCount: (prev.inProcessCount ?? 0) + 1,
        }));
        setRabbiStats((prev) => ({
          ...prev,
          openQuestions: (prev.openQuestions ?? 0) + 1,
        }));
      }),

      on('question:answered', (payload) => {
        const qId = payload?.id || payload?._id;
        if (qId) {
          setMyQuestions((prev) => prev.filter((q) => (q._id || q.id) !== qId));
        }
        setAdminStats((prev) => ({
          ...prev,
          inProcessCount: Math.max(0, (prev.inProcessCount ?? 0) - 1),
          answeredThisWeek: (prev.answeredThisWeek ?? 0) + 1,
        }));
        setRabbiStats((prev) => ({
          ...prev,
          answeredThisMonth: (prev.answeredThisMonth ?? 0) + 1,
          openQuestions: Math.max(0, (prev.openQuestions ?? 0) - 1),
        }));
      }),

      on('rabbi:online', (payload) => {
        setOnlineRabbisList((prev) =>
          prev.some((r) => r.id === payload.id) ? prev : [...prev, payload]
        );
        setAdminStats((prev) => ({
          ...prev,
          onlineRabbis: (prev.onlineRabbis ?? 0) + 1,
        }));
      }),

      on('rabbi:offline', (payload) => {
        setOnlineRabbisList((prev) => prev.filter((r) => r.id !== payload.id));
        setAdminStats((prev) => ({
          ...prev,
          onlineRabbis: Math.max(0, (prev.onlineRabbis ?? 0) - 1),
        }));
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn && fn());
      clearTimeout(pulseTimerRef.current);
    };
  }, [on]);

  // ── Derived values ─────────────────────────────────────────────────────
  const firstName  = rabbi?.name?.split(' ')[0] || 'הרב';
  const greeting   = hebrewGreeting();
  const todayLabel = formatDate(new Date(), 'EEEE, d בMMMM yyyy');

  // Pending count for the alert banner
  const pendingCount = isAdmin
    ? (adminStats.pendingCount ?? pendingQ.length)
    : 0;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="page-enter" dir="rtl">

      {/* ── Pending alert bar ── */}
      <PendingQuestionsAlert pendingCount={pendingCount} loading={loading} />

      {/* ── Emergency banner ── */}
      {emergency.message && (
        <EmergencyBanner
          initialMessage={emergency.message}
          messageId={emergency.id}
        />
      )}

      {/* ── Page header ── */}
      <div
        className={clsx(
          'flex items-start justify-between gap-4 flex-wrap',
          'px-6 py-5',
          'bg-[var(--bg-surface)] border-b border-[var(--border-default)]'
        )}
      >
        <div>
          <h1 className="text-2xl font-bold font-heebo text-[var(--text-primary)]">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            {todayLabel}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Socket connection pill */}
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 text-xs font-heebo px-2.5 py-1 rounded-full border',
              connected
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-800'
                : 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800'
            )}
            aria-label={connected ? 'מחובר בזמן אמת' : 'מנותק מהשרת'}
          >
            {connected
              ? <Wifi className="w-3 h-3" aria-hidden="true" />
              : <WifiOff className="w-3 h-3" aria-hidden="true" />}
            {connected ? 'מחובר' : 'מנותק'}
          </span>

          {lastRefreshed && (
            <span className="text-xs text-[var(--text-muted)] font-heebo hidden sm:inline">
              עודכן {formatDate(lastRefreshed, 'HH:mm')}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDashboard}
            loading={loading}
            leftIcon={<RefreshCw className="w-4 h-4" />}
            aria-label="רענן נתונים"
          >
            רענן
          </Button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="p-6 space-y-8">

        {/* Error state */}
        {error && !loading && (
          <div
            className={clsx(
              'rounded-xl border px-5 py-4',
              'bg-red-50 dark:bg-red-900/20',
              'border-red-200 dark:border-red-800',
              'text-red-700 dark:text-red-400',
              'text-sm font-heebo flex items-center gap-3'
            )}
            role="alert"
          >
            <span className="flex-1">{error}</span>
            <Button variant="ghost" size="sm" onClick={fetchDashboard}>
              נסה שוב
            </Button>
          </div>
        )}

        {/* ══ Stats cards ══ */}
        <section aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="sr-only">סטטיסטיקות</h2>
          {isAdmin ? (
            <AdminStatCards stats={adminStats} loading={loading} />
          ) : (
            <RabbiStatCards stats={rabbiStats} loading={loading} />
          )}
        </section>

        {/* ══ Charts row ══ */}
        <section aria-labelledby="charts-heading">
          <h2 id="charts-heading" className="sr-only">גרפים</h2>
          <div
            className={clsx(
              'grid gap-6',
              isAdmin ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
            )}
          >
            <ActivityChart data={weeklyActivity} loading={loading} />
            {isAdmin && (
              <CategoryChart data={categoryBreakdown} loading={loading} />
            )}
          </div>
        </section>

        {/* ══ Middle section: my questions + pending ══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left 2/3: question lists */}
          <div className="lg:col-span-2 space-y-6">

            {/* My in-process questions */}
            <section aria-labelledby="my-questions-heading">
              <SectionHeading
                id="my-questions-heading"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/my-questions')}
                    leftIcon={<ChevronLeft className="w-4 h-4" />}
                  >
                    כל השאלות שלי
                  </Button>
                }
              >
                השאלות שלי{' '}
                {myQuestions.length > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1B2B5E] text-white text-xs font-bold font-heebo ms-2">
                    {myQuestions.length}
                  </span>
                )}
              </SectionHeading>

              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="skeleton h-24 w-full rounded-xl" />
                  ))}
                </div>
              ) : myQuestions.length === 0 ? (
                <Card>
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <CheckSquare
                      className="w-10 h-10 text-[var(--text-muted)] mb-3"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-[var(--text-muted)] font-heebo">
                      אין לך שאלות פתוחות כרגע
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {myQuestions.map((q) => (
                    <QuestionCard
                      key={q._id || q.id}
                      question={q}
                      mode="my"
                      onTimerExpired={handleTimerExpired}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Pending questions queue */}
            <section aria-labelledby="pending-questions-heading">
              <SectionHeading
                id="pending-questions-heading"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/questions?status=pending')}
                    leftIcon={<ChevronLeft className="w-4 h-4" />}
                  >
                    כל השאלות הממתינות
                  </Button>
                }
              >
                שאלות ממתינות{' '}
                {pendingQ.length > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold font-heebo ms-2">
                    {pendingQ.length}
                  </span>
                )}
              </SectionHeading>

              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="skeleton h-24 w-full rounded-xl" />
                  ))}
                </div>
              ) : pendingQ.length === 0 ? (
                <Card>
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <MessageSquare
                      className="w-10 h-10 text-[var(--text-muted)] mb-3"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-[var(--text-muted)] font-heebo">
                      אין שאלות ממתינות לטיפול כרגע
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {pendingQ.map((q) => (
                    <QuestionCard
                      key={q._id || q.id}
                      question={q}
                      mode="pending"
                      onClaim={handleClaim}
                      claimLoading={claimingId === (q._id || q.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right 1/3: legacy activity feed */}
          <section aria-labelledby="activity-feed-heading">
            <Card
              header={
                <h2
                  id="activity-feed-heading"
                  className="text-sm font-bold font-heebo text-[var(--text-primary)]"
                >
                  עדכונים אחרונים
                </h2>
              }
              noPadding
            >
              <div className="px-5 py-3">
                <ActivityFeed initialItems={[]} />
              </div>
            </Card>
          </section>
        </div>

        {/* ══ Bottom row: RecentActivity + OnlineRabbis ══ */}
        <section aria-labelledby="realtime-heading">
          <h2 id="realtime-heading" className="sr-only">עדכוני זמן אמת</h2>
          <div
            className={clsx(
              'grid gap-6',
              isAdmin ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'
            )}
          >
            {/* Recent activity — 2/3 width on admin */}
            <div className={isAdmin ? 'lg:col-span-2' : ''}>
              <RecentActivity initialEvents={recentEvents} loading={loading} />
            </div>

            {/* Online rabbis (admin only) */}
            {isAdmin && (
              <OnlineRabbis initialRabbis={onlineRabbisList} loading={loading} />
            )}
          </div>
        </section>

        {/* ══ ROI Stats section (admin only) ══ */}
        {isAdmin && roiStats && (
          <section aria-labelledby="roi-heading">
            <div className="divider-text mb-6">
              <span>נתוני ROI</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {/* תודות החודש / סה"כ */}
              <Card>
                <div className="flex items-center gap-3 p-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/20 flex-shrink-0">
                    <Heart className="w-5 h-5 text-pink-500" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-muted)] font-heebo">תודות החודש / סה"כ</p>
                    <p className="text-lg font-bold font-heebo text-[var(--text-primary)]">
                      {roiStats.thanks_this_month ?? 0}
                      <span className="text-sm font-normal text-[var(--text-muted)] ms-1">
                        / {roiStats.total_thanks ?? 0}
                      </span>
                    </p>
                  </div>
                </div>
              </Card>

              {/* לידים חמים */}
              <Card>
                <div className="flex items-center gap-3 p-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-900/20 flex-shrink-0">
                    <Flame className="w-5 h-5 text-orange-500" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-muted)] font-heebo">לידים חמים</p>
                    <p className="text-lg font-bold font-heebo text-[var(--text-primary)]">
                      {roiStats.hot_leads_count ?? 0}
                    </p>
                  </div>
                </div>
              </Card>

              {/* לידים שנוצר קשר */}
              <Card>
                <div className="flex items-center gap-3 p-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex-shrink-0">
                    <PhoneCall className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-muted)] font-heebo">לידים שנוצר קשר</p>
                    <p className="text-lg font-bold font-heebo text-[var(--text-primary)]">
                      {roiStats.leads_converted_to_contacted ?? 0}
                    </p>
                  </div>
                </div>
              </Card>

              {/* זמן מענה ממוצע */}
              <Card>
                <div className="flex items-center gap-3 p-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex-shrink-0">
                    <Clock className="w-5 h-5 text-blue-500" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-muted)] font-heebo">זמן מענה ממוצע</p>
                    <p className="text-lg font-bold font-heebo text-[var(--text-primary)]">
                      {roiStats.avg_response_hours != null
                        ? (roiStats.avg_response_hours < 1
                            ? `${Math.round(roiStats.avg_response_hours * 60)} דקות`
                            : `${roiStats.avg_response_hours} שעות`)
                        : '—'}
                    </p>
                  </div>
                </div>
              </Card>

              {/* קטגוריות מובילות */}
              <Card className="sm:col-span-2">
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#B8973A]/10 flex-shrink-0">
                      <TrendingUp className="w-5 h-5 text-[var(--accent)]" aria-hidden="true" />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] font-heebo">קטגוריות מובילות (Top 5)</p>
                  </div>
                  {roiStats.top_categories && roiStats.top_categories.length > 0 ? (
                    <ul className="space-y-2">
                      {roiStats.top_categories.map((cat, idx) => (
                        <li key={cat.name || idx} className="flex items-center justify-between">
                          <span className="text-sm font-heebo text-[var(--text-primary)]">
                            {idx + 1}. {cat.name}
                          </span>
                          <span className="text-sm font-bold font-heebo text-[var(--text-primary)] tabular-nums">
                            {cat.count} {cat.count === 1 ? 'שאלה' : 'שאלות'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] font-heebo">אין נתונים</p>
                  )}
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* ══ Admin quick-links section ══ */}
        {isAdmin && (
          <section aria-labelledby="admin-quick-heading">
            <div className="divider-text mb-6">
              <span>ניהול מהיר</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AdminQuickLink
                to="/admin"
                icon={Settings}
                label="ניהול מערכת"
                description="ניהול רבנים, הגדרות ותוכן"
              />
              <AdminQuickLink
                to="/admin?tab=rabbis"
                icon={Users}
                label="ניהול רבנים"
                description="הוספה, עריכה והפסקת שירות"
              />
              <AdminQuickLink
                to="/questions?status=pending"
                icon={MessageSquare}
                label="שאלות ממתינות לשיבוץ"
                description="שאלות שלא נתפסו עדיין"
              />
              <AdminQuickLink
                to="/admin?tab=stats"
                icon={BarChart2}
                label="דוחות וסטטיסטיקות"
                description="ניתוח נתוני המערכת"
              />
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
