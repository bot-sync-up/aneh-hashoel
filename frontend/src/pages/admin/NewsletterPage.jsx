import React, { useState, useEffect, useCallback } from 'react';
import {
  Newspaper,
  CheckCircle,
  Send,
  RefreshCw,
  Clock,
  ThumbsUp,
  Eye,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { get, post } from '../../lib/api';

export default function NewsletterPage() {
  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [status, setStatus] = useState({ lastSent: null, selectedQuestions: [] });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [candidatesRes, statusRes] = await Promise.all([
        get('/admin/newsletter/candidates'),
        get('/admin/newsletter/status'),
      ]);

      setCandidates(candidatesRes.candidates || []);
      setStatus({
        lastSent: statusRes.lastSent,
        selectedQuestions: statusRes.selectedQuestions || [],
      });

      // Pre-select already-selected questions
      if (statusRes.selectedQuestions?.length > 0) {
        setSelectedIds(statusRes.selectedQuestions.map((q) => q.id));
      }
    } catch (err) {
      setError('שגיאה בטעינת נתוני הניוזלטר');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleQuestion = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  };

  const handleSaveSelection = async () => {
    setSaving(true);
    setError('');
    try {
      await post('/admin/newsletter/select', { questionIds: selectedIds });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשמירת הבחירה');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!selectedIds.length) {
      setError('יש לבחור לפחות שאלה אחת לפני שליחה');
      return;
    }

    setSending(true);
    setError('');
    try {
      // Save selection first, then trigger send
      await post('/admin/newsletter/select', { questionIds: selectedIds });
      await post('/admin/newsletter/send');
      setSent(true);
      setSelectedIds([]);
      setTimeout(() => setSent(false), 5000);
      // Reload status
      const statusRes = await get('/admin/newsletter/status');
      setStatus({
        lastSent: statusRes.lastSent,
        selectedQuestions: statusRes.selectedQuestions || [],
      });
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשליחת הניוזלטר');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
            <div className="skeleton h-4 w-40 rounded mb-4" />
            <div className="skeleton h-16 w-full rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">ניוזלטר שבועי</h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            בחירת שאלות לניוזלטר השבועי ושליחה ידנית
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={loadData}
          leftIcon={<RefreshCw size={15} />}
        >
          רענן
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
          {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-heebo animate-fade-in">
          <CheckCircle size={16} /> הבחירה נשמרה בהצלחה
        </div>
      )}

      {sent && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-heebo animate-fade-in">
          <Send size={16} /> הניוזלטר נשלח בהצלחה!
        </div>
      )}

      {/* Status card */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
          <div className="w-8 h-8 rounded-lg bg-[#1B2B5E]/10 flex items-center justify-center">
            <Clock size={16} className="text-[#1B2B5E]" />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)] font-heebo text-sm">סטטוס</h3>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center gap-6 text-sm font-heebo">
          <div>
            <span className="text-[var(--text-muted)]">שליחה אחרונה: </span>
            <span className="text-[var(--text-primary)] font-medium">
              {status.lastSent
                ? new Date(status.lastSent).toLocaleDateString('he-IL', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'טרם נשלח'}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">שאלות נבחרות: </span>
            <span className="text-[var(--text-primary)] font-bold">{selectedIds.length}</span>
          </div>
        </div>
      </div>

      {/* Candidates list */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
          <div className="w-8 h-8 rounded-lg bg-[#B8973A]/10 flex items-center justify-center">
            <Newspaper size={16} className="text-[#B8973A]" />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)] font-heebo text-sm">
              שאלות מועמדות מהשבוע האחרון
            </h3>
            <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
              סמן את השאלות שברצונך לכלול בניוזלטר
            </p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--text-muted)] font-heebo">
            אין שאלות שנענו בשבוע האחרון
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-default)]">
            {candidates.map((q) => {
              const isSelected = selectedIds.includes(q.id);
              return (
                <label
                  key={q.id}
                  className={`flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#B8973A]/5'
                      : 'hover:bg-[var(--bg-surface-raised)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleQuestion(q.id)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-[#B8973A] focus:ring-[#B8973A]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate">
                      {q.title || 'ללא כותרת'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] font-heebo mt-1 line-clamp-2">
                      {(q.content || '').slice(0, 150)}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      {q.rabbi_name && (
                        <span className="text-xs text-[var(--text-secondary)] font-heebo">
                          הרב {q.rabbi_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <ThumbsUp size={12} /> {q.thank_count || 0}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Eye size={12} /> {q.view_count || 0}
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          loading={saving}
          disabled={!candidates.length}
          onClick={handleSaveSelection}
          leftIcon={<CheckCircle size={15} />}
        >
          שמור בחירה
        </Button>
        <Button
          variant="primary"
          loading={sending}
          disabled={!selectedIds.length}
          onClick={handleSend}
          leftIcon={<Send size={16} />}
        >
          שלח ניוזלטר עכשיו
        </Button>
      </div>

      {/* Info note */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700 font-heebo">
        הערה: אם לא תבחר שאלות, הניוזלטר האוטומטי (שישי ב-10:00) יבחר אוטומטית את השאלה עם הכי הרבה תודות.
        לאחר שליחה, הבחירה מתאפסת.
      </div>
    </div>
  );
}
