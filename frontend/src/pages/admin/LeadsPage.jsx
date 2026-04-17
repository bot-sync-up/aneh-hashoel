import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
  Users, Flame, Phone, Mail, MessageSquare,
  CheckCircle2, Clock, Search, RefreshCw, ChevronRight, ChevronLeft,
  StickyNote, X, Download, AlertTriangle, ChevronDown, ChevronUp,
  CalendarDays, FileText, Bell, MailX, Heart, ArrowLeft, Trash2,
} from 'lucide-react';
import { get, patch, del } from '../../lib/api';
import api from '../../lib/api';
import { formatDate } from '../../lib/utils';
import Spinner, { BlockSpinner } from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useSocket } from '../../contexts/SocketContext';

const PAGE_SIZE = 20;

const FILTERS = [
  { value: 'all',           label: 'כל הלידים' },
  { value: 'hot',           label: 'חמים'       },
  { value: 'urgent',        label: 'דחופים'     },
  { value: 'not_contacted', label: 'טרם טופלו' },
  { value: 'contacted',     label: 'טופלו'      },
];

// ── Lead Row ─────────────────────────────────────────────────────────────────

const URGENCY_MAP = {
  urgent:   { label: 'דחוף',    color: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-700' },
  critical: { label: 'קריטי',   color: 'text-red-700 bg-red-100 border-red-300 dark:text-red-300 dark:bg-red-900/30 dark:border-red-600' },
  high:     { label: 'גבוה',    color: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-900/20 dark:border-orange-700' },
  normal:   { label: 'רגיל',    color: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600' },
};

const STATUS_MAP = {
  pending:    { label: 'ממתין',     color: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-700' },
  in_process: { label: 'בטיפול',   color: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-700' },
  answered:   { label: 'נענה',     color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-700' },
  hidden:     { label: 'מוסתר',    color: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600' },
};

function LeadRow({ lead, onUpdate, onDelete }) {
  const navigate = useNavigate();
  const [notesOpen,     setNotesOpen]     = useState(false);
  const [notes,         setNotes]         = useState(lead.contact_notes || '');
  const [savingNote,    setSavingNote]    = useState(false);
  const [toggling,      setToggling]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);

  const handleDelete = async () => {
    const ok = window.confirm(
      `למחוק את הליד "${lead.asker_name || 'ללא שם'}" לצמיתות?\n\n` +
      `פעולה זו לא ניתנת לשחזור. השאלות של הליד יישארו במערכת, רק רשומת הליד תימחק.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await del(`/leads/${lead.id}`);
      onDelete?.(lead.id);
    } catch (err) {
      alert(err?.response?.data?.error || 'שגיאה במחיקת הליד');
      setDeleting(false);
    }
  };

  const handleToggleContacted = async () => {
    setToggling(true);
    try {
      const result = await patch(`/leads/${lead.id}`, { contacted: !lead.contacted });
      onUpdate(result.lead || result);
    } catch { /* ignore */ }
    finally { setToggling(false); }
  };

  const handleSaveNotes = async () => {
    setSavingNote(true);
    try {
      const result = await patch(`/leads/${lead.id}`, { contact_notes: notes });
      onUpdate(result.lead || result);
      setNotesOpen(false);
    } catch { /* ignore */ }
    finally { setSavingNote(false); }
  };

  const questions = lead.questions || [];
  const hasUrgent = lead.has_urgent || questions.some(
    (q) => q.urgency === 'urgent' || q.urgency === 'critical' || q.urgency === 'high'
  );

  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-4 flex flex-col gap-3 transition-shadow',
        'bg-[var(--bg-surface)] hover:shadow-soft',
        lead.is_hot
          ? 'border-orange-300 dark:border-orange-700'
          : hasUrgent
            ? 'border-red-300 dark:border-red-700'
            : 'border-[var(--border-default)]'
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {lead.is_hot && (
              <span className="flex items-center gap-0.5 text-xs font-bold text-orange-600 font-heebo">
                <Flame size={12} className="text-orange-500" />
                חם
              </span>
            )}
            {hasUrgent && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-full px-2 py-0.5 font-heebo">
                <AlertTriangle size={10} />
                דחוף
              </span>
            )}
            <span className="text-sm font-bold text-[var(--text-primary)] font-heebo">
              {lead.asker_name || 'שואל אנונימי'}
            </span>
            {lead.contacted ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-2 py-0.5 font-heebo">
                <CheckCircle2 size={10} />
                טופל
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5 font-heebo">
                <Clock size={10} />
                טרם טופל
              </span>
            )}
            {lead.is_unsubscribed && (
              <span
                title={lead.unsubscribed_at ? `הוסר/ה ב-${formatDate(lead.unsubscribed_at)}` : 'הוסר/ה מרשימת התפוצה'}
                className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full px-2 py-0.5 font-heebo"
              >
                <MailX size={10} />
                הוסר/ה
              </span>
            )}
          </div>

          {/* Contact info */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--text-muted)] font-heebo">
            {lead.email && (
              <a href={`mailto:${lead.email}`} dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }} className="flex items-center gap-1 hover:text-brand-navy dark:hover:text-dark-accent transition-colors">
                <Mail size={11} />
                {lead.email}
              </a>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:text-brand-navy dark:hover:text-dark-accent transition-colors">
                <Phone size={11} />
                <span dir="ltr">{lead.phone}</span>
              </a>
            )}
            {lead.created_at && (
              <span className="flex items-center gap-1">
                <CalendarDays size={11} />
                נוצר: {formatDate(lead.created_at)}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-heebo flex-shrink-0">
          <span className="flex items-center gap-1">
            <MessageSquare size={11} />
            {lead.question_count} שאלות
          </span>
          {Number(lead.donations_count) > 0 && (
            <span className="flex items-center gap-1 text-pink-600 dark:text-pink-400 font-semibold">
              <Heart size={11} fill="currentColor" />
              {lead.donations_count} · ₪{Math.round(Number(lead.donations_total_ils) || 0)}
            </span>
          )}
          {lead.last_category_name && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              {lead.last_category_name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatDate(lead.last_question_at)}
          </span>
          <button
            onClick={() => {
              // Admin navigates within /admin/leads/:id, CS within /leads/:id.
              // Both routes share the same LeadDetailPage component.
              const basePath = window.location.pathname.startsWith('/admin')
                ? '/admin/leads'
                : '/leads';
              navigate(`${basePath}/${lead.id}`);
            }}
            className="inline-flex items-center gap-1 text-brand-navy dark:text-dark-accent hover:underline font-heebo"
            title="פתח כרטסת מלאה"
          >
            <ArrowLeft size={11} /> כרטסת
          </button>
        </div>
      </div>

      {/* Questions list (expandable) */}
      {questions.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setQuestionsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline self-start"
          >
            <FileText size={12} />
            {questions.length} שאלות ששאל
            {questionsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {questionsOpen && (
            <div className="flex flex-col gap-1.5 mt-1 bg-[var(--bg-muted)] rounded-lg p-3">
              {questions.map((q) => {
                const urg = URGENCY_MAP[q.urgency] || URGENCY_MAP.normal;
                const sts = STATUS_MAP[q.status] || STATUS_MAP.pending;
                return (
                  <div key={q.id} className="flex items-center justify-between gap-2 text-xs font-heebo py-1.5 border-b border-[var(--border-default)] last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[var(--text-primary)] truncate font-medium">
                        {q.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={clsx('inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5', urg.color)}>
                        {q.urgency !== 'normal' && <AlertTriangle size={9} />}
                        {urg.label}
                      </span>
                      <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5', sts.color)}>
                        {sts.label}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {formatDate(q.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Notes preview */}
      {lead.contact_notes && !notesOpen && (
        <p className="text-xs text-[var(--text-muted)] font-heebo bg-[var(--bg-muted)] rounded px-3 py-2 line-clamp-2">
          {lead.contact_notes}
        </p>
      )}

      {/* Notes editor */}
      {notesOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="הוסף הערות לגבי ליד זה..."
            dir="rtl"
            className={clsx(
              'w-full px-3 py-2 text-sm font-heebo resize-y',
              'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]',
              'border border-[var(--border-default)] rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent'
            )}
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={savingNote} onClick={handleSaveNotes}>
              שמור
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setNotesOpen(false); setNotes(lead.contact_notes || ''); }}>
              ביטול
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--border-default)]">
        <Button
          variant={lead.contacted ? 'ghost' : 'secondary'}
          size="sm"
          loading={toggling}
          onClick={handleToggleContacted}
          leftIcon={<CheckCircle2 size={13} />}
        >
          {lead.contacted ? 'סמן כלא טופל' : 'סמן כטופל'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNotesOpen((v) => !v)}
          leftIcon={<StickyNote size={13} />}
        >
          {notesOpen ? 'סגור הערות' : (lead.contact_notes ? 'ערוך הערות' : 'הוסף הערה')}
        </Button>
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="inline-flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline"
          >
            <Mail size={12} />
            שלח מייל
          </a>
        )}
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline"
          >
            <Phone size={12} />
            חייג
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          loading={deleting}
          onClick={handleDelete}
          leftIcon={<Trash2 size={13} />}
          className="!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/20 ml-auto"
          title="מחק ליד לצמיתות"
        >
          מחק
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Click Alert Toast ────────────────────────────────────────────────────────

function ClickAlertToast({ alert, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 12000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="flex items-start gap-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-xl px-4 py-3 shadow-lg animate-slide-in-top">
      <Bell size={18} className="text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-bold text-orange-800 dark:text-orange-200 font-heebo">
          גולש פתח תשובה עכשיו!
        </span>
        <span className="text-xs text-orange-700 dark:text-orange-300 font-heebo">
          {alert.name || 'שואל אנונימי'}
          {alert.category ? ` · ${alert.category}` : ''}
        </span>
        <span className="text-[10px] text-orange-500 dark:text-orange-400 font-heebo">
          זה הזמן המושלם לשיחה
        </span>
      </div>
      <button onClick={onClose} className="flex-shrink-0 text-orange-400 hover:text-orange-600 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads,   setLeads]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [page,    setPage]    = useState(1);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');
  const [searchQ, setSearchQ] = useState(''); // debounced
  const [clickAlerts, setClickAlerts] = useState([]);
  const { on } = useSocket();

  // Listen for real-time lead click events from CS socket room
  useEffect(() => {
    const unsub = on('lead:click', (data) => {
      const alertId = `${data.leadId}-${Date.now()}`;
      setClickAlerts((prev) => [{ ...data, _id: alertId }, ...prev].slice(0, 5));

      // Play notification sound if available
      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch { /* ignore */ }
    });
    return unsub;
  }, [on]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchQ(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await get('/leads', { page, limit: PAGE_SIZE, filter, search: searchQ });
      setLeads(result.leads ?? []);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בטעינת הלידים');
    } finally {
      setLoading(false);
    }
  }, [page, filter, searchQ]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleUpdate = useCallback((updated) => {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  }, []);

  const handleDelete = useCallback((deletedId) => {
    setLeads((prev) => prev.filter((l) => l.id !== deletedId));
    setTotal((t) => Math.max(0, (t || 0) - 1));
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hotCount   = leads.filter((l) => l.is_hot).length;

  return (
    <div className="min-h-screen bg-[var(--bg-page)]" dir="rtl">
      {/* Real-time click alerts */}
      {clickAlerts.length > 0 && (
        <div className="fixed top-4 left-4 z-50 flex flex-col gap-2 max-w-sm">
          {clickAlerts.map((alert) => (
            <ClickAlertToast
              key={alert._id}
              alert={alert}
              onClose={() => setClickAlerts((prev) => prev.filter((a) => a._id !== alert._id))}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="bg-[var(--bg-surface)] border-b border-[var(--border-default)] shadow-[var(--shadow-soft)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo flex items-center gap-2">
                <Users size={22} className="text-brand-navy" />
                ניהול לידים
              </h1>
              <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
                {total} לידים סה״כ
                {hotCount > 0 && (
                  <span className="mr-2 text-orange-600 font-medium">· {hotCount} חמים</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Download size={14} />}
                onClick={async () => {
                  try {
                    const response = await api.get('/leads/export', { responseType: 'blob' });
                    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', `leads-${new Date().toISOString().split('T')[0]}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    link.parentNode.removeChild(link);
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    alert(err?.response?.data?.error || 'שגיאה בייצוא הלידים. נסה שוב.');
                  }
                }}
              >
                ייצוא CSV
              </Button>
              <Button variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={fetchLeads}>
                רענן
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        {/* Filters + search */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setFilter(f.value); setPage(1); }}
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

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם..."
              dir="rtl"
              className={clsx(
                'w-full pe-9 ps-3 py-2 text-sm font-heebo',
                'bg-[var(--bg-surface)] text-[var(--text-primary)]',
                'border border-[var(--border-default)] rounded-lg',
                'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent'
              )}
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <BlockSpinner label="טוען לידים..." />
        ) : error ? (
          <p className="text-center text-red-600 font-heebo py-12">{error}</p>
        ) : leads.length === 0 ? (
          <div className="text-center py-16">
            <Users size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
            <p className="text-[var(--text-muted)] font-heebo">
              {filter !== 'all' || searchQ ? 'לא נמצאו לידים התואמים לסינון.' : 'אין לידים עדיין.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {leads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              leftIcon={<ChevronRight size={14} />}
            >
              הקודם
            </Button>
            <span className="text-sm text-[var(--text-muted)] font-heebo">
              עמוד {page} מתוך {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              rightIcon={<ChevronLeft size={14} />}
            >
              הבא
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
