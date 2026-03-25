import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Users, Flame, Phone, Mail, MessageSquare,
  CheckCircle2, Clock, Search, RefreshCw, ChevronRight, ChevronLeft,
  StickyNote, X, Download,
} from 'lucide-react';
import { get, patch } from '../../lib/api';
import api from '../../lib/api';
import { formatDate } from '../../lib/utils';
import Spinner, { BlockSpinner } from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const PAGE_SIZE = 20;

const FILTERS = [
  { value: 'all',           label: 'כל הלידים' },
  { value: 'hot',           label: '🔥 חמים'   },
  { value: 'not_contacted', label: 'טרם טופלו' },
  { value: 'contacted',     label: 'טופלו'      },
];

// ── Lead Row ─────────────────────────────────────────────────────────────────

function LeadRow({ lead, onUpdate }) {
  const [notesOpen,  setNotesOpen]  = useState(false);
  const [notes,      setNotes]      = useState(lead.contact_notes || '');
  const [savingNote, setSavingNote] = useState(false);
  const [toggling,   setToggling]   = useState(false);

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

  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-4 flex flex-col gap-3 transition-shadow',
        'bg-[var(--bg-surface)] hover:shadow-soft',
        lead.is_hot
          ? 'border-orange-300 dark:border-orange-700'
          : 'border-[var(--border-default)]'
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {lead.is_hot && (
              <span className="flex items-center gap-0.5 text-xs font-bold text-orange-600 font-heebo">
                <Flame size={12} className="text-orange-500" />
                חם
              </span>
            )}
            <span className="text-sm font-bold text-[var(--text-primary)] font-heebo">
              {lead.asker_name || 'שואל אנונימי'}
            </span>
            {lead.contacted && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-2 py-0.5 font-heebo">
                <CheckCircle2 size={10} />
                טופל
              </span>
            )}
          </div>

          {/* Contact info */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--text-muted)] font-heebo">
            {lead.email && (
              <span className="flex items-center gap-1">
                <Mail size={11} />
                {lead.email}
              </span>
            )}
            {lead.phone && (
              <span className="flex items-center gap-1">
                <Phone size={11} />
                {lead.phone}
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
          {lead.last_category_name && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              {lead.last_category_name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatDate(lead.last_question_at)}
          </span>
        </div>
      </div>

      {/* Notes preview */}
      {lead.contact_notes && !notesOpen && (
        <p className="text-xs text-[var(--text-muted)] font-heebo bg-[var(--bg-muted)] rounded px-3 py-2 line-clamp-2">
          📝 {lead.contact_notes}
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
      </div>
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

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hotCount   = leads.filter((l) => l.is_hot).length;

  return (
    <div className="min-h-screen bg-[var(--bg-page)]" dir="rtl">
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
                    const url = window.URL.createObjectURL(new Blob([response.data]));
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', `leads-${new Date().toISOString().split('T')[0]}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    link.parentNode.removeChild(link);
                    window.URL.revokeObjectURL(url);
                  } catch { /* ignore */ }
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
              <LeadRow key={lead.id} lead={lead} onUpdate={handleUpdate} />
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
