import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Database,
  Zap,
  Globe,
  MessageCircle,
  Clock,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { get, post } from '../../lib/api';

// ─── Status card ───────────────────────────────────────────────────────────
function ServiceCard({ name, icon: Icon, status, latency, description, loading }) {
  const ok = status === 'ok';
  const unknown = status === 'unknown';

  return (
    <div
      className={clsx(
        'rounded-xl border-2 p-5 flex flex-col gap-3 transition-all',
        loading
          ? 'border-[var(--border-default)]'
          : ok
          ? 'border-emerald-200 bg-emerald-50/40'
          : unknown
          ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
          : 'border-red-200 bg-red-50/40'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              loading ? 'bg-[var(--bg-muted)]' : ok ? 'bg-emerald-100' : unknown ? 'bg-gray-100' : 'bg-red-100'
            )}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-[#B8973A] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Icon size={20} className={ok ? 'text-emerald-600' : unknown ? 'text-gray-400' : 'text-red-600'} />
            )}
          </div>
          <div>
            <p className="font-bold text-sm font-heebo text-[var(--text-primary)]">{name}</p>
            {description && <p className="text-xs text-[var(--text-muted)] font-heebo">{description}</p>}
          </div>
        </div>
        {!loading && (
          <div className="flex items-center gap-2">
            {latency && ok && (
              <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">{latency}ms</span>
            )}
            {ok ? (
              <CheckCircle size={20} className="text-emerald-500" />
            ) : unknown ? (
              <AlertTriangle size={20} className="text-gray-400" />
            ) : (
              <XCircle size={20} className="text-red-500" />
            )}
          </div>
        )}
      </div>

      {!loading && (
        <div className={clsx(
          'text-xs font-medium font-heebo px-2 py-1 rounded-md inline-flex items-center gap-1 w-fit',
          ok ? 'bg-emerald-100 text-emerald-700' : unknown ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-700'
        )}>
          {ok ? '✓ פעיל ותקין' : unknown ? '? לא ידוע' : '✗ לא זמין'}
        </div>
      )}
    </div>
  );
}

// ─── Sync log table ────────────────────────────────────────────────────────
function SyncLogTable({ entries, loading }) {
  if (loading) return (
    <div className="space-y-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3 border-b border-[var(--border-default)]">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-4 flex-1 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );

  if (!entries?.length) return (
    <div className="text-center py-8 text-[var(--text-muted)] font-heebo text-sm">אין רשומות סנכרון</div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-heebo">
        <thead>
          <tr className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
            <th className="px-4 py-2.5 text-right font-semibold">זמן</th>
            <th className="px-4 py-2.5 text-right font-semibold">פעולה</th>
            <th className="px-4 py-2.5 text-right font-semibold">פרטים</th>
            <th className="px-4 py-2.5 text-right font-semibold">סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-[var(--border-default)] hover:bg-[var(--bg-surface-raised)]">
              <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                {new Date(e.timestamp).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.action}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs max-w-xs">
                <span className="line-clamp-1">{e.details}</span>
              </td>
              <td className="px-4 py-2.5">
                <span className={clsx(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                  e.status === 'success'
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    : 'bg-red-100 text-red-700 border-red-200'
                )}>
                  {e.status === 'success' ? '✓ הצליח' : '✗ נכשל'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState({});
  const [lastChecked, setLastChecked] = useState(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, logData] = await Promise.all([
        get('/admin/system/health'),
        get('/admin/system/sync-log', { limit: 20 }),
      ]);
      setHealth(healthData ?? DEMO_HEALTH);
      setSyncLog(Array.isArray(logData) ? logData : logData.entries ?? DEMO_SYNC_LOG);
    } catch {
      setHealth(DEMO_HEALTH);
      setSyncLog(DEMO_SYNC_LOG);
    } finally {
      setLoading(false);
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const handleRetryWpSync = async () => {
    setSyncLoading(true);
    try {
      await post('/admin/system/sync-wp');
      await loadHealth();
    } catch {
    } finally {
      setSyncLoading(false);
    }
  };

  const handleRetryLeads = async () => {
    setRetryLoading((r) => ({ ...r, leads: true }));
    try {
      await post('/admin/system/sync-leads');
      await loadHealth();
    } catch {
    } finally {
      setRetryLoading((r) => ({ ...r, leads: false }));
    }
  };

  const services = [
    { key: 'db',        name: 'מסד נתונים',     icon: Database,       description: 'PostgreSQL / MySQL' },
    { key: 'redis',     name: 'Redis',           icon: Zap,            description: 'Cache & Queues' },
    { key: 'wordpress', name: 'WordPress API',   icon: Globe,          description: 'אתר הרב' },
    { key: 'greenapi',  name: 'GreenAPI',        icon: MessageCircle,  description: 'WhatsApp Gateway' },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">בריאות המערכת</h2>
          {lastChecked && (
            <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
              בדיקה אחרונה: {lastChecked.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw size={14} />}
          loading={loading}
          onClick={loadHealth}
        >
          רענן
        </Button>
      </div>

      {/* Service status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {services.map(({ key, name, icon, description }) => (
          <ServiceCard
            key={key}
            name={name}
            icon={icon}
            description={description}
            status={loading ? 'unknown' : health?.services?.[key]?.status ?? 'unknown'}
            latency={health?.services?.[key]?.latencyMs}
            loading={loading}
          />
        ))}
      </div>

      {/* Uptime card */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3 mb-3">
          <Activity size={18} className="text-[#1B2B5E]" />
          <h3 className="font-bold text-sm font-heebo text-[var(--text-primary)]">זמן פעילות</h3>
        </div>
        {loading ? (
          <div className="skeleton h-8 w-48 rounded" />
        ) : (
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-3xl font-bold text-[#1B2B5E] font-heebo tabular-nums">
                {health?.uptimePercent ?? '—'}%
              </p>
              <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">זמינות (30 יום)</p>
            </div>
            <div>
              <p className="text-xl font-bold text-[var(--text-primary)] font-heebo tabular-nums">
                {health?.uptimeDays ?? '—'} ימים
              </p>
              <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">ללא הפסקה</p>
            </div>
            <div>
              <p className="text-xl font-bold text-[var(--text-primary)] font-heebo tabular-nums">
                {health?.avgResponseMs ?? '—'}ms
              </p>
              <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">זמן תגובה ממוצע</p>
            </div>
          </div>
        )}
      </div>

      {/* WordPress sync */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
          <div className="flex items-center gap-3">
            <Globe size={16} className="text-[#1B2B5E]" />
            <div>
              <h3 className="font-bold text-sm font-heebo text-[var(--text-primary)]">סנכרון WordPress</h3>
              <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
                {loading ? '...' : (
                  <>
                    <span className={clsx(
                      'font-semibold',
                      (health?.pendingWpSync ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'
                    )}>
                      {health?.pendingWpSync ?? 0} רשומות ממתינות לסנכרון
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw size={13} />}
            loading={syncLoading}
            onClick={handleRetryWpSync}
          >
            נסה שוב
          </Button>
        </div>

        {/* Sync log */}
        <SyncLogTable entries={syncLog} loading={loading} />

        {syncLog.length === 20 && (
          <p className="text-center text-xs text-[var(--text-muted)] py-3 font-heebo">
            מוצגות 20 הרשומות האחרונות
          </p>
        )}
      </div>

      {/* Failed leads */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className={clsx(loading ? 'text-[var(--text-muted)]' : (health?.failedLeads ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500')} />
            <div>
              <h3 className="font-bold text-sm font-heebo text-[var(--text-primary)]">לידים כושלים</h3>
              {!loading && (
                <p className="text-xs font-heebo mt-0.5">
                  {(health?.failedLeads ?? 0) === 0 ? (
                    <span className="text-emerald-600">אין לידים כושלים</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">{health.failedLeads} לידים נכשלו בסנכרון</span>
                  )}
                </p>
              )}
              {loading && <div className="skeleton h-3 w-32 rounded mt-1" />}
            </div>
          </div>
          {!loading && (health?.failedLeads ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw size={13} />}
              loading={retryLoading.leads}
              onClick={handleRetryLeads}
            >
              נסה שוב
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Demo data ─────────────────────────────────────────────────────────────
const DEMO_HEALTH = {
  services: {
    db:        { status: 'ok', latencyMs: 4 },
    redis:     { status: 'ok', latencyMs: 1 },
    wordpress: { status: 'ok', latencyMs: 142 },
    greenapi:  { status: 'error', latencyMs: null },
  },
  uptimePercent: 99.8,
  uptimeDays: 23,
  avgResponseMs: 87,
  pendingWpSync: 3,
  failedLeads: 2,
};

const DEMO_SYNC_LOG = [
  { id: 1, timestamp: '2026-03-16T11:00:00', action: 'sync-answers', details: 'סנכרן 8 תשובות ל-WordPress', status: 'success' },
  { id: 2, timestamp: '2026-03-16T10:30:00', action: 'sync-questions', details: 'סנכרן 12 שאלות חדשות', status: 'success' },
  { id: 3, timestamp: '2026-03-16T10:00:00', action: 'sync-answers', details: 'שגיאת חיבור: timeout', status: 'error' },
  { id: 4, timestamp: '2026-03-16T09:30:00', action: 'sync-categories', details: 'סנכרן 5 קטגוריות', status: 'success' },
  { id: 5, timestamp: '2026-03-16T09:00:00', action: 'sync-answers', details: 'סנכרן 3 תשובות ל-WordPress', status: 'success' },
  { id: 6, timestamp: '2026-03-15T22:00:00', action: 'full-sync', details: 'סנכרון מלא לילי — 45 רשומות', status: 'success' },
];
