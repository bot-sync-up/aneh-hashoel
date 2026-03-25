import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Headphones,
  CheckCircle2,
  Clock,
  User,
  RefreshCw,
  Inbox,
} from 'lucide-react';
import { get, patch } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import Button from '../../components/ui/Button';
import { BlockSpinner } from '../../components/ui/Spinner';

const FILTERS = [
  { value: 'all',     label: 'הכל' },
  { value: 'open',    label: 'פתוחות' },
  { value: 'handled', label: 'טופלו' },
];

function RequestCard({ request, onUpdate }) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const newStatus = request.status === 'handled' ? 'open' : 'handled';
      const result = await patch(`/admin/support/${request.id}`, { status: newStatus });
      onUpdate(result.request || { ...request, status: newStatus });
    } catch { /* ignore */ }
    finally { setToggling(false); }
  };

  return (
    <div
      className={clsx(
        'rounded-xl border px-5 py-4 bg-[var(--bg-surface)] transition-shadow hover:shadow-soft',
        request.status === 'handled'
          ? 'border-emerald-200 dark:border-emerald-800'
          : 'border-[var(--border-default)]'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)] font-heebo">
            {request.subject}
          </h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)] font-heebo">
            <span className="flex items-center gap-1">
              <User size={11} />
              {request.rabbi_name}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatDate(request.created_at)}
            </span>
          </div>
        </div>
        {request.status === 'handled' && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-2 py-0.5 font-heebo">
            <CheckCircle2 size={10} />
            טופל
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--text-secondary)] font-heebo leading-relaxed whitespace-pre-wrap mb-3">
        {request.message}
      </p>

      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-default)]">
        <Button
          variant={request.status === 'handled' ? 'ghost' : 'secondary'}
          size="sm"
          loading={toggling}
          onClick={handleToggle}
          leftIcon={<CheckCircle2 size={13} />}
        >
          {request.status === 'handled' ? 'סמן כפתוח' : 'סמן כטופל'}
        </Button>
        {request.rabbi_email && (
          <a
            href={`mailto:${request.rabbi_email}`}
            className="inline-flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline"
          >
            השב
          </a>
        )}
      </div>
    </div>
  );
}

export default function SupportAdminPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/admin/support', { status: filter });
      setRequests(data.requests || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בטעינת הפניות');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleUpdate = useCallback((updated) => {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo flex items-center gap-2">
            <Headphones size={22} className="text-brand-navy" />
            פניות לניהול
          </h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            {requests.length} פניות
          </p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={fetchRequests}>
          רענן
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-heebo transition-colors',
              filter === f.value
                ? 'bg-brand-navy text-white font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <BlockSpinner label="טוען פניות..." />
      ) : error ? (
        <p className="text-center text-red-600 font-heebo py-12">{error}</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-16">
          <Inbox size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-[var(--text-muted)] font-heebo">אין פניות</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((req) => (
            <RequestCard key={req.id} request={req} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
