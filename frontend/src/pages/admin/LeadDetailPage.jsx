import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ArrowRight, Phone, Mail, MailX, Flame, CalendarDays,
  MessageSquare, Heart, StickyNote, CheckCircle2, Clock,
  AlertTriangle, Loader2, DollarSign, TrendingUp,
} from 'lucide-react';
import { get, patch } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

/* ── Status & urgency colour maps (duplicated from LeadsPage for consistency) */
const URGENCY_MAP = {
  urgent:   { label: 'דחוף',    color: 'text-red-600 bg-red-50 border-red-200' },
  critical: { label: 'קריטי',   color: 'text-red-700 bg-red-100 border-red-300' },
  high:     { label: 'גבוה',    color: 'text-orange-600 bg-orange-50 border-orange-200' },
  normal:   { label: 'רגיל',    color: 'text-gray-500 bg-gray-50 border-gray-200' },
};

const STATUS_MAP = {
  pending:    { label: 'ממתין',   color: 'text-amber-600 bg-amber-50 border-amber-200' },
  in_process: { label: 'בטיפול', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  answered:   { label: 'נענה',   color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  hidden:     { label: 'מוסתר',  color: 'text-gray-500 bg-gray-50 border-gray-200' },
};

const TX_TYPE_LABEL = {
  regular:         'חד-פעמי',
  installments:    'תשלומים',
  standing_order:  'הוראת קבע',
};

/* ── Small KPI tile ───────────────────────────────────────────────────────── */
function KPI({ icon: Icon, label, value, sub, color = '#1B2B5E' }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}18` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-[var(--text-muted)] font-heebo">{label}</p>
        <p className="text-lg font-bold text-[var(--text-primary)] font-heebo leading-none">
          {value}
        </p>
        {sub && <p className="text-[11px] text-[var(--text-muted)] font-heebo mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [notes, setNotes] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get(`/leads/${id}`);
      setLead(data.lead ?? data);
      setNotes((data.lead ?? data)?.contact_notes || '');
    } catch {
      setError('שגיאה בטעינת הכרטסת');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleToggleContacted = async () => {
    if (!lead) return;
    setToggling(true);
    try {
      const { lead: updated } = await patch(`/leads/${lead.id}`, { contacted: !lead.contacted });
      setLead((prev) => ({ ...prev, ...updated }));
    } finally { setToggling(false); }
  };

  const handleSaveNotes = async () => {
    if (!lead) return;
    setSavingNote(true);
    try {
      const { lead: updated } = await patch(`/leads/${lead.id}`, { contact_notes: notes });
      setLead((prev) => ({ ...prev, ...updated }));
    } finally { setSavingNote(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin w-8 h-8 text-[#B8973A]" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center" dir="rtl">
        <p className="text-red-600 font-heebo mb-4">{error || 'ליד לא נמצא'}</p>
        <Button variant="ghost" onClick={() => navigate(window.location.pathname.startsWith('/admin') ? '/admin/leads' : '/leads')}>חזור לרשימה</Button>
      </div>
    );
  }

  const donations = lead.donations || [];
  const summary = lead.donations_summary || { count: 0, total_ils: 0, total_usd: 0 };
  const questions = lead.questions || [];

  return (
    <div className="space-y-5 max-w-5xl mx-auto p-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(window.location.pathname.startsWith('/admin') ? '/admin/leads' : '/leads')}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-muted)]"
            title="חזור"
          >
            <ArrowRight size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
              {lead.asker_name || 'שואל אנונימי'}
            </h1>
            <p className="text-xs text-[var(--text-muted)] font-heebo">
              נוצר: {formatDate(lead.created_at)}
              {lead.last_question_at && ` · שאלה אחרונה: ${formatDate(lead.last_question_at)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lead.is_hot && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full font-heebo">
              <Flame size={11} /> ליד חם
            </span>
          )}
          {lead.is_unsubscribed && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-700 bg-gray-100 border border-gray-300 rounded-full px-2 py-1 font-heebo">
              <MailX size={11} /> הוסר/ה מרשימת תפוצה
            </span>
          )}
          {lead.contacted ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1 font-heebo">
              <CheckCircle2 size={11} /> טופל
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1 font-heebo">
              <Clock size={11} /> טרם טופל
            </span>
          )}
        </div>
      </div>

      {/* Contact info */}
      <Card header={<Card.Title>פרטי קשר</Card.Title>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] hover:bg-[var(--bg-muted)]"
              dir="ltr"
              style={{ direction: 'ltr', textAlign: 'right' }}
            >
              <Mail size={15} className="text-brand-navy dark:text-dark-accent flex-shrink-0" />
              <span className="text-sm font-heebo truncate">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] hover:bg-[var(--bg-muted)]"
            >
              <Phone size={15} className="text-brand-navy dark:text-dark-accent flex-shrink-0" />
              <span className="text-sm font-heebo" dir="ltr">{lead.phone}</span>
            </a>
          )}
          {!lead.email && !lead.phone && (
            <p className="text-sm text-[var(--text-muted)] font-heebo col-span-2">
              לא נמצאו פרטי קשר זמינים לליד זה.
            </p>
          )}
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI
          icon={MessageSquare}
          label="שאלות"
          value={lead.question_count ?? questions.length ?? 0}
          color="#1B2B5E"
        />
        <KPI
          icon={Heart}
          label="תרומות"
          value={summary.count}
          color="#ec4899"
        />
        <KPI
          icon={DollarSign}
          label='סה"כ תרומות'
          value={`₪${Math.round(Number(summary.total_ils) || 0).toLocaleString('he-IL')}`}
          sub={summary.total_usd > 0 ? `+ $${Math.round(summary.total_usd)}` : undefined}
          color="#B8973A"
        />
        <KPI
          icon={TrendingUp}
          label="ציון עניין"
          value={Math.round(lead.interaction_score || 0)}
          color="#10b981"
        />
      </div>

      {/* Donations */}
      <Card
        header={
          <div className="flex items-center justify-between">
            <Card.Title>היסטוריית תרומות {summary.count > 0 && `(${summary.count})`}</Card.Title>
            {summary.last_donation_at && (
              <span className="text-xs text-[var(--text-muted)] font-heebo">
                אחרונה: {formatDate(summary.last_donation_at)}
              </span>
            )}
          </div>
        }
      >
        {donations.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] font-heebo text-center py-6">
            הליד עדיין לא תרם
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-heebo">
              <thead>
                <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border-default)]">
                  <th className="text-right py-2 font-semibold">תאריך</th>
                  <th className="text-right py-2 font-semibold">סכום</th>
                  <th className="text-right py-2 font-semibold">סוג</th>
                  <th className="text-right py-2 font-semibold">כרטיס</th>
                  <th className="text-right py-2 font-semibold">בעקבות</th>
                  <th className="text-right py-2 font-semibold">אישור</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--border-default)] last:border-b-0 hover:bg-[var(--bg-muted)]">
                    <td className="py-2.5 text-[var(--text-secondary)]">{formatDateTime(d.created_at)}</td>
                    <td className="py-2.5 font-bold text-[#B8973A]">
                      {d.currency === 'USD' ? '$' : '₪'}{Number(d.amount).toLocaleString('he-IL')}
                      {d.tashloumim > 1 && (
                        <span className="text-[10px] text-[var(--text-muted)] mr-1">×{d.tashloumim}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs">
                      <span className="px-2 py-0.5 rounded bg-[var(--bg-muted)]">
                        {TX_TYPE_LABEL[d.transaction_type] || d.transaction_type || '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-[var(--text-muted)] tabular-nums">
                      {d.last_num ? `···${d.last_num}` : '—'}
                    </td>
                    <td className="py-2.5 text-xs text-[var(--text-secondary)]">
                      {d.question_title ? (
                        <button
                          onClick={() => navigate(`/admin/questions/${d.question_id}`)}
                          className="hover:underline text-right"
                          title={d.question_title}
                        >
                          תודה לרב {d.rabbi_name ? `· הרב ${d.rabbi_name}` : ''}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 text-[10px] text-[var(--text-muted)] font-mono">
                      {d.confirmation || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Questions */}
      <Card
        header={<Card.Title>היסטוריית שאלות ({questions.length})</Card.Title>}
      >
        {questions.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] font-heebo text-center py-6">
            לא נמצאו שאלות
          </p>
        ) : (
          <div className="space-y-2">
            {questions.map((q) => {
              const urg = URGENCY_MAP[q.urgency] || URGENCY_MAP.normal;
              const sts = STATUS_MAP[q.status] || STATUS_MAP.pending;
              return (
                <div
                  key={q.id}
                  onClick={() => navigate(`/admin/questions/${q.id}`)}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)] cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] font-heebo truncate font-medium">
                      {q.title || 'שאלה ללא כותרת'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
                      {formatDate(q.created_at)}
                      {q.answered_at && ` · נענתה ${formatDate(q.answered_at)}`}
                      {q.thank_count > 0 && ` · ${q.thank_count} תודות`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {q.urgency && q.urgency !== 'normal' && (
                      <span className={clsx('inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs', urg.color)}>
                        <AlertTriangle size={10} />
                        {urg.label}
                      </span>
                    )}
                    <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', sts.color)}>
                      {sts.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Notes + actions */}
      <Card header={<Card.Title>הערות שירות לקוחות</Card.Title>}>
        <div className="space-y-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="הוסף/י הערות לליד זה..."
            dir="rtl"
            className={clsx(
              'w-full px-3 py-2.5 text-sm font-heebo resize-y',
              'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]',
              'border border-[var(--border-default)] rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent'
            )}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              loading={savingNote}
              onClick={handleSaveNotes}
              leftIcon={<StickyNote size={14} />}
            >
              שמור הערה
            </Button>
            <Button
              variant={lead.contacted ? 'ghost' : 'secondary'}
              size="sm"
              loading={toggling}
              onClick={handleToggleContacted}
              leftIcon={<CheckCircle2 size={14} />}
            >
              {lead.contacted ? 'סמן כלא טופל' : 'סמן כטופל'}
            </Button>
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline"
              >
                <Mail size={13} /> שלח מייל
              </a>
            )}
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-1.5 text-xs font-heebo text-brand-navy dark:text-dark-accent hover:underline"
              >
                <Phone size={13} /> חייג
              </a>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
