import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import {
  Flame,
  Lock,
  ChevronDown,
  ChevronUp,
  Eye,
  Heart,
  Calendar,
  MessageSquare,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Pencil,
  Send,
  Paperclip,
  History,
  Check,
  X as XIcon,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { BlockSpinner } from '../components/ui/Spinner';
import ClaimConfirmModal from '../components/questions/ClaimConfirmModal';
import AnswerEditorAdvanced from '../components/answer/AnswerEditor';
import EditAnswerEditor from '../components/answer/EditAnswerEditor';
import AnswerVersionsModal from '../components/answer/AnswerVersionsModal';
import ReleaseConfirmModal from '../components/questions/ReleaseConfirmModal';
import TransferModal from '../components/questions/TransferModal';
import { get, post, put, patch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import {
  formatDate,
  formatRelative,
  getCategoryLabel,
  colorFromCategory,
  stripHtml,
  truncate,
  decodeHTML,
} from '../lib/utils';

/**
 * Inline-editable question title. Any authenticated rabbi may edit —
 * persists via PUT /questions/:id/title which also syncs to WordPress.
 * Falls back gracefully on error.
 */
function TitleWithEdit({ title, questionId, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(title || ''); }, [title]);

  const save = async () => {
    const trimmed = (draft || '').trim();
    if (!trimmed) { toast.error('כותרת ריקה'); return; }
    if (trimmed === (title || '').trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await put(`/questions/${questionId}/title`, { title: trimmed });
      onUpdated?.(trimmed);
      toast.success('הכותרת עודכנה');
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'שגיאה בשמירת הכותרת');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 max-w-full" dir="rtl">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') { setEditing(false); setDraft(title || ''); }
          }}
          autoFocus
          disabled={saving}
          className="flex-1 min-w-0 text-lg font-bold font-heebo text-[var(--text-primary)] bg-[var(--bg-surface-raised)] border border-brand-gold rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
          maxLength={500}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title="שמור (Enter)"
          className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setDraft(title || ''); }}
          disabled={saving}
          title="בטל (Esc)"
          className="p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
        >
          <XIcon size={16} />
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="truncate">{truncate(title || 'שאלה', 60)}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="עריכת כותרת"
        className="flex-shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-brand-navy hover:bg-[var(--bg-muted)] transition-colors"
      >
        <Pencil size={13} />
      </button>
    </span>
  );
}

export default function QuestionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { rabbi, isAdmin } = useAuth();
  const { on } = useSocket();

  const [question, setQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modals
  const [showClaim, setShowClaim] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showCreateDiscussion, setShowCreateDiscussion] = useState(false);
  const [showAnswerModal, setShowAnswerModal] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  // Auto-open answer modal if ?answer=1 is in URL
  const answerParam = searchParams.get('answer');

  // UI state
  const [notesOpen, setNotesOpen] = useState(false);

  // Thank + Donation modal state
  const [showDonation, setShowDonation] = useState(false);
  const [thankLoading, setThankLoading] = useState(false);
  const [thankDone, setThankDone] = useState(false);

  // Category picker state
  const [editingCategory, setEditingCategory] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState(null);
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestCatName, setSuggestCatName] = useState('');
  const [suggestingCat, setSuggestingCat] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState('');

  // ── Fetch question ────────────────────────────────────────────────────────

  const fetchQuestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get(`/questions/${id}`);
      const q = data.question || data;

      // Merge follow-up data (returned separately from the API) into the question object
      // so FollowUpSection receives the correct fields.
      if (data.followUp) {
        q.follow_up_question  = data.followUp.asker_content  || q.follow_up_question  || null;
        q.follow_up_answer    = data.followUp.rabbi_answer    || q.follow_up_answer    || null;
        q.follow_up_count     = data.followUp ? 1 : (q.follow_up_count || 0);
      }

      setQuestion(q);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת השאלה.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchQuestion();
  }, [fetchQuestion]);

  // Auto-open answer editor when ?answer=1 and question is loaded
  useEffect(() => {
    if (answerParam === '1' && question && !loading) {
      setShowAnswerModal(true);
    }
  }, [answerParam, question, loading]);

  // ── Socket events ─────────────────────────────────────────────────────────

  useEffect(() => {
    const offClaimed = on('question:claimed', ({ id: qId, assigned_rabbi, status }) => {
      if (String(qId) !== String(id)) return;
      setQuestion((prev) => prev ? { ...prev, status, assigned_rabbi } : prev);
    });

    const offReleased = on('question:released', ({ id: qId }) => {
      if (String(qId) !== String(id)) return;
      setQuestion((prev) =>
        prev ? { ...prev, status: 'pending', assigned_rabbi: null } : prev
      );
    });

    const offAnswered = on('question:answered', (payload) => {
      if (String(payload.id) !== String(id)) return;
      setQuestion((prev) => prev ? { ...prev, ...payload } : prev);
    });

    const offThank = on('question:thankReceived', ({ questionId: qId, thankCount: thank_count }) => {
      if (String(qId) !== String(id)) return;
      setQuestion((prev) => prev ? { ...prev, thank_count } : prev);
    });

    const offFollowUp = on('question:followUpReceived', ({ questionId: qId, followUp }) => {
      if (String(qId) !== String(id)) return;
      setQuestion((prev) => prev ? {
        ...prev,
        follow_up_question: followUp?.asker_content || prev.follow_up_question,
        follow_up_count:    (prev.follow_up_count || 0) + 1,
      } : prev);
    });

    return () => {
      offClaimed();
      offReleased();
      offAnswered();
      offThank();
      offFollowUp();
    };
  }, [on, id]);

  // ── Load categories for picker ────────────────────────────────────────────

  useEffect(() => {
    if (!editingCategory) return;
    get('/categories').then((data) => {
      const flattenTree = (nodes) => {
        const result = [];
        const walk = (list, depth) => {
          for (const n of list) {
            result.push({ ...n, depth });
            if (n.children?.length) walk(n.children, depth + 1);
          }
        };
        walk(nodes, 0);
        return result;
      };
      setCategories(flattenTree(data.categories ?? []));
    }).catch(() => setCategories([]));
  }, [editingCategory]);

  const handleSetCategory = useCallback(async (catId) => {
    setCategoryError(null);
    try {
      await patch(`/questions/category/${id}`, { category_id: catId || null });
      setEditingCategory(false);
      fetchQuestion();
    } catch (err) {
      setCategoryError(err?.response?.data?.error || err.message || 'שגיאה בעדכון קטגוריה');
    }
  }, [id, fetchQuestion]);

  // ── Thank handler ──────────────────────────────────────────────────────────

  const handleThank = useCallback(async () => {
    if (thankLoading || thankDone) return;
    setThankLoading(true);
    try {
      const res = await post(`/questions/thank/${id}`);
      setQuestion((prev) => prev ? { ...prev, thank_count: res.thankCount ?? (prev.thank_count + 1) } : prev);
      setThankDone(true);
      // Show donation modal on success
      if (!res.alreadyThanked) {
        setShowDonation(true);
      }
    } catch (err) {
      console.error('Thank error:', err);
    } finally {
      setThankLoading(false);
    }
  }, [id, thankLoading, thankDone]);

  // ── Derived state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div dir="rtl">
        <PageHeader title="טוען שאלה..." />
        <div className="p-6">
          <BlockSpinner label="טוען שאלה..." />
        </div>
      </div>
    );
  }

  if (error || !question) {
    return (
      <div dir="rtl">
        <PageHeader title="שגיאה" />
        <div className="p-6 text-center py-16">
          <AlertCircle size={40} className="text-red-500 mx-auto mb-4" />
          <p className="text-[var(--text-primary)] font-heebo font-medium mb-2">
            {error || 'השאלה לא נמצאה'}
          </p>
          <Button variant="outline" onClick={() => navigate('/questions')} leftIcon={<ArrowRight size={14} />}>
            חזור לכל השאלות
          </Button>
        </div>
      </div>
    );
  }

  const {
    title,
    content,
    category,
    status,
    is_urgent,
    created_at,
    answered_at,
    assigned_rabbi,
    answer,
    answer_is_private,
    answer_rabbi_id,
    view_count = 0,
    thank_count = 0,
    follow_up_question,
    follow_up_answer,
    follow_up_count = 0,
    private_notes,
    discussion_count = 0,
    attachment_url,
    question_number,
    answer_id,
    asker_name,
  } = question;

  const isMyAnswer = rabbi && answer_rabbi_id && String(answer_rabbi_id) === String(rabbi?.id);

  // assigned_rabbi may be an object {id,name} or the API may return assigned_rabbi_id + rabbi_name flat
  const assignedRabbiId = assigned_rabbi?.id ?? question?.assigned_rabbi_id;
  const rawRabbiName = assigned_rabbi?.name ?? assigned_rabbi?.display_name ?? question?.rabbi_name;
  // Strip leading "הרב " / "הרה\"ג " prefix so we don't render "תשובת הרב הרב נחום"
  const assignedRabbiName = rawRabbiName
    ? String(rawRabbiName).replace(/^\s*(?:הרב|הרה"ג|הרה״ג|הגאון הרב)\s+/u, '').trim()
    : rawRabbiName;
  const isMe = rabbi && assignedRabbiId && String(assignedRabbiId) === String(rabbi?.id);
  const isPending = status === 'pending';
  const isInProcess = status === 'in_process';
  const isAnswered = status === 'answered';
  const isInProcessByOther = isInProcess && !isMe;

  // Edit window: 30 minutes for rabbis, unlimited for admins
  const EDIT_WINDOW_MS = 30 * 60 * 1000;
  const canEditAnswer = isAnswered && (isMyAnswer || isMe || isAdmin) && (() => {
    if (isAdmin) return true; // admins can always edit
    if (!answered_at) return false;
    const answeredMs = new Date(answered_at).getTime();
    return (Date.now() - answeredMs) < EDIT_WINDOW_MS;
  })();

  return (
    <div className="page-enter" dir="rtl">
      {/* Header */}
      <PageHeader
        title={
          <TitleWithEdit
            title={title}
            questionId={id}
            onUpdated={(newTitle) => {
              // Optimistically update the local question state so the
              // page re-renders with the new title without a full reload.
              if (typeof setQuestion === 'function') {
                setQuestion((prev) => prev ? { ...prev, title: newTitle } : prev);
              }
            }}
          />
        }
        breadcrumb={
          <nav aria-label="פירורי לחם">
            <ol className="flex items-center gap-1 text-sm font-heebo text-[var(--text-muted)]">
              <li>
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="hover:text-[var(--text-primary)] hover:underline transition-colors duration-150 flex items-center gap-1"
                >
                  <ArrowRight size={13} />
                  חזרה
                </button>
              </li>
              <li aria-hidden="true" className="text-[var(--border-strong)] text-xs">/</li>
              <li>
                <span className="text-[var(--text-primary)] font-medium">
                  שאלה #{question_number ?? id.slice(0,8)}
                </span>
              </li>
            </ol>
          </nav>
        }
        actions={
          <div className="flex items-center gap-2">
            {discussion_count > 0 && (
              <Link
                to={`/discussions?question_id=${id}`}
                className="flex items-center gap-1.5 text-sm text-brand-navy dark:text-dark-accent font-heebo hover:underline"
              >
                <MessageSquare size={14} />
                {discussion_count} דיונים קשורים
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<MessageSquare size={14} />}
              onClick={() => setShowCreateDiscussion(true)}
            >
              פתח דיון
            </Button>
            {isInProcess && isMe && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTransfer(true)}
              >
                העבר
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {/* Main question card */}
        <Card>
          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {is_urgent && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-600 font-heebo">
                <Flame size={14} className="text-red-500 fill-red-400" />
                דחוף
              </span>
            )}
            {category && !editingCategory && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium font-heebo',
                  colorFromCategory(category)
                )}
              >
                {getCategoryLabel(category)}
                {rabbi && (
                  <button
                    type="button"
                    title="שנה קטגוריה"
                    className="ml-1 opacity-60 hover:opacity-100"
                    onClick={() => setEditingCategory(true)}
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </span>
            )}
            {!category && rabbi && !editingCategory && (
              <button
                type="button"
                className="text-xs text-brand-navy dark:text-dark-accent font-heebo underline hover:no-underline"
                onClick={() => setEditingCategory(true)}
              >
                שייך קטגוריה
              </button>
            )}
            {editingCategory && (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="text-xs rounded border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-heebo px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__suggest__') {
                      setShowSuggestForm(true);
                      return;
                    } else {
                      handleSetCategory(val || null);
                    }
                  }}
                >
                  <option value="">-- בחר קטגוריה --</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {'  '.repeat(cat.depth)}{cat.name}
                    </option>
                  ))}
                  <option value="__suggest__">+ הצע קטגוריה חדשה</option>
                </select>
                <button
                  type="button"
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-heebo"
                  onClick={() => { setEditingCategory(false); setCategoryError(null); }}
                >
                  ביטול
                </button>
                {categoryError && (
                  <span className="text-xs text-red-600 font-heebo">{categoryError}</span>
                )}
              </div>
            )}
            {showSuggestForm && (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <input
                  type="text"
                  value={suggestCatName}
                  onChange={e => setSuggestCatName(e.target.value)}
                  placeholder="שם הקטגוריה המוצעת..."
                  className="text-xs rounded border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-heebo px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
                  dir="rtl"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') { setShowSuggestForm(false); setSuggestCatName(''); } }}
                />
                <button
                  type="button"
                  disabled={!suggestCatName.trim() || suggestingCat}
                  className="text-xs px-2 py-1 rounded bg-brand-navy text-white font-heebo hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
                  onClick={async () => {
                    if (!suggestCatName.trim()) return;
                    setSuggestingCat(true);
                    try {
                      await post('/categories', { name: suggestCatName.trim() });
                      setSuggestMsg('ההצעה נשלחה לאישור מנהל');
                      setSuggestCatName('');
                      setShowSuggestForm(false);
                      setTimeout(() => setSuggestMsg(''), 3000);
                    } catch(err) {
                      setSuggestMsg(err?.response?.data?.error || 'שגיאה בשליחת ההצעה');
                    } finally {
                      setSuggestingCat(false);
                    }
                  }}
                >
                  {suggestingCat ? 'שולח...' : 'שלח הצעה'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowSuggestForm(false); setSuggestCatName(''); }}
                  className="text-xs text-[var(--text-muted)] font-heebo hover:text-[var(--text-primary)]"
                >
                  ביטול
                </button>
                {suggestMsg && <span className="text-xs font-heebo text-emerald-600">{suggestMsg}</span>}
              </div>
            )}
            <Badge status={status} withDot className="mr-auto" />
          </div>

          {/* Asker name */}
          {asker_name && (
            <p className="text-xs text-[var(--text-muted)] font-heebo mb-1">
              שואל: <span className="font-medium text-[var(--text-secondary)]">{asker_name}</span>
            </p>
          )}

          {/* Title */}
          <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo leading-snug mb-4">
            {decodeHTML(title)}
          </h1>

          {/* Content */}
          <div
            className="prose prose-sm max-w-none text-[var(--text-secondary)] font-heebo leading-relaxed"
            dangerouslySetInnerHTML={{ __html: content }}
          />

          {/* Attachment */}
          {attachment_url && (
            <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
              <p className="text-xs text-[var(--text-muted)] font-heebo mb-2">קובץ מצורף:</p>
              {/\.(jpg|jpeg|png|gif|webp)$/i.test(attachment_url) ? (
                <a href={attachment_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={attachment_url}
                    alt="קובץ מצורף"
                    className="max-h-64 rounded-lg border border-[var(--border-default)] object-contain"
                  />
                </a>
              ) : (
                <a
                  href={attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-brand-navy dark:text-dark-accent font-heebo hover:underline"
                >
                  <Paperclip size={14} />
                  פתח קובץ מצורף
                </a>
              )}
            </div>
          )}

          {/* Footer meta */}
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-heebo mt-5 pt-4 border-t border-[var(--border-default)] flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              {formatDate(created_at)}
            </span>
            {isAnswered && (
              <>
                <span className="flex items-center gap-1">
                  <Eye size={12} />
                  {view_count} צפיות
                </span>
                <span className="flex items-center gap-1">
                  <Heart size={12} />
                  {thank_count} תודות
                </span>
              </>
            )}
          </div>
        </Card>

        {/* ── Status-driven action area ──────────────────────────────────── */}

        {/* PENDING: ענה + תפוס */}
        {isPending && (
          <div className="flex flex-col items-center gap-3 py-8 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-card shadow-soft">
            <p className="text-[var(--text-muted)] font-heebo text-sm">
              השאלה ממתינה לטיפול
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                leftIcon={<Pencil size={18} />}
                onClick={() => setShowAnswerModal(true)}
              >
                ענה
              </Button>
              <Button
                variant="secondary"
                size="lg"
                leftIcon={<Flame size={18} />}
                onClick={() => setShowClaim(true)}
                className="bg-brand-gold hover:bg-brand-gold-dark text-white"
              >
                תפוס
              </Button>
            </div>
          </div>
        )}

        {/* IN PROCESS — by me: ענה + שחרר + דיון */}
        {isInProcess && isMe && (
          <div className="flex flex-col items-center gap-3 py-8 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-card shadow-soft">
            <p className="text-[var(--text-muted)] font-heebo text-sm">
              השאלה בטיפולך
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                leftIcon={<Pencil size={18} />}
                onClick={() => setShowAnswerModal(true)}
              >
                ענה
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setShowRelease(true)}
              >
                שחרר
              </Button>
              <Button
                variant="ghost"
                size="lg"
                leftIcon={<MessageSquare size={18} />}
                onClick={() => setShowCreateDiscussion(true)}
              >
                דיון
              </Button>
            </div>
          </div>
        )}

        {/* Answer modal */}
        {showAnswerModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowAnswerModal(false); }}
          >
            <div className="bg-[var(--bg-surface)] rounded-card shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-[var(--border-default)]">
                <h2 className="font-semibold text-[var(--text-primary)] font-heebo flex items-center gap-2">
                  <Pencil size={16} className="text-brand-navy" />
                  {isAnswered ? 'עריכת תשובה' : 'כתיבת תשובה'}
                </h2>
                <button
                  onClick={() => setShowAnswerModal(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none px-2"
                >
                  ✕
                </button>
              </div>
              <div className="p-4">
                {isAnswered ? (
                  <EditAnswerEditor
                    questionId={id}
                    existingAnswer={answer || ''}
                    updatedAt={question.updated_at || question.answered_at}
                    onSave={() => {
                      fetchQuestion();
                      setShowAnswerModal(false);
                    }}
                  />
                ) : (
                  <AnswerEditorAdvanced
                    questionId={id}
                    existingAnswer={question.draft_content || ''}
                    hasCategory={!!question.category_id}
                    onCategorySet={() => {
                      // Lightweight update — don't refetch; just mark category as set
                      // so the header badge shows and localHasCategory stays true in editor.
                      setQuestion(prev => prev ? { ...prev, category: prev.category || '__set__' } : prev);
                    }}
                    onSave={({ publishNow }) => {
                      if (publishNow) {
                        fetchQuestion();
                        setShowAnswerModal(false);
                        toast.success('התשובה נשלחה בהצלחה');
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Answer version history modal */}
        {showVersions && answer_id && (
          <AnswerVersionsModal
            answerId={answer_id}
            onClose={() => setShowVersions(false)}
          />
        )}

        {/* IN PROCESS — by another rabbi */}
        {isInProcessByOther && (
          <div className="flex items-center gap-3 p-5 bg-blue-50 border border-blue-200 rounded-card dark:bg-blue-900/20 dark:border-blue-700">
            <User size={20} className="text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 font-heebo">
                בטיפול אצל רב אחר
              </p>
              {assignedRabbiName && (
                <p className="text-xs text-blue-600 dark:text-blue-400 font-heebo mt-0.5">
                  הרב {assignedRabbiName}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ANSWERED: full answer display */}
        {isAnswered && (answer || answer_is_private) && (
          <Card header={
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <span className="font-semibold text-[var(--text-primary)] font-heebo">
                  {assignedRabbiName ? `תשובת הרב ${assignedRabbiName}` : 'תשובת הרב'}
                </span>
                {answer_is_private && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium font-heebo px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                    🔒 פרטי
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-muted)] font-heebo">
                  {formatDate(answered_at)}
                </span>
                {answer_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<History size={13} />}
                    onClick={() => setShowVersions(true)}
                    className="text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                  >
                    היסטוריית גרסאות
                  </Button>
                )}
                {canEditAnswer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Pencil size={13} />}
                    onClick={() => setShowAnswerModal(true)}
                    className="text-brand-navy hover:bg-brand-navy/10"
                  >
                    ערוך תשובה
                  </Button>
                )}
              </div>
            </div>
          }>
            {/* Answer content — hide from other rabbis when private (admins always see it) */}
            {answer_is_private && !isMyAnswer && !isAdmin ? (
              <p className="text-sm text-[var(--text-muted)] font-heebo italic py-4 text-center">
                תשובה זו פרטית — גלויה לרב שענה בלבד.
              </p>
            ) : (
              <div
                className="prose prose-sm max-w-none text-[var(--text-primary)] font-heebo leading-relaxed"
                dangerouslySetInnerHTML={{ __html: answer }}
              />
            )}

            {/* Rabbi signature */}
            {(assignedRabbiName || assigned_rabbi) && (
              <div className="mt-6 pt-4 border-t border-[var(--border-default)] flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-navy/10 flex items-center justify-center">
                  <User size={16} className="text-brand-navy" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)] font-heebo">
                    {assignedRabbiName ? `תשובת הרב ${assignedRabbiName}` : 'תשובת הרב'}
                  </p>
                  {assigned_rabbi?.title && (
                    <p className="text-xs text-[var(--text-muted)] font-heebo">
                      {assigned_rabbi.title}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Thank count */}
            <div className="mt-4 flex items-center border-t border-[var(--border-default)] pt-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-heebo">
                <Heart size={12} className={thank_count > 0 ? 'fill-rose-400 text-rose-400' : ''} />
                {thank_count > 0 ? `${thank_count} אנשים הודו על התשובה` : 'טרם התקבלו תודות'}
              </div>
            </div>
          </Card>
        )}

        {/* ── Donation suggestion modal ─────────────────────────────────── */}
        {showDonation && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowDonation(false)}
          >
            <div
              className="bg-[var(--bg-surface)] rounded-2xl shadow-xl max-w-sm w-full p-8 text-center"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-4xl mb-4">🙏</div>
              <h3 className="text-lg font-bold font-heebo text-[var(--text-primary)] mb-3">
                התשובה עזרה לך?
              </h3>
              <p className="text-sm text-[var(--text-secondary)] font-heebo mb-6">
                הקדש תרומה להחזקת הפעילות
              </p>
              <div className="flex flex-col gap-3">
                <a
                  href="https://moreshet-maran.com/donate"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand-gold text-brand-navy font-bold font-heebo text-sm hover:bg-brand-gold-dark transition-colors shadow-md"
                >
                  לתרומה
                </a>
                <button
                  type="button"
                  onClick={() => setShowDonation(false)}
                  className="text-sm text-[var(--text-muted)] font-heebo hover:text-[var(--text-secondary)] transition-colors py-2"
                >
                  לא תודה
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Follow-up section ──────────────────────────────────────────── */}
        {isAnswered && (
          <FollowUpSection
            questionId={id}
            followUpQuestion={follow_up_question}
            followUpAnswer={follow_up_answer}
            followUpCount={follow_up_count}
            isMe={isMe}
          />
        )}

        {/* ── Private notes accordion (shown to assigned rabbi or admin) ───────── */}
        {(isMe || isAdmin) && (
          <div className="rounded-card border border-amber-200 dark:border-amber-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setNotesOpen((o) => !o)}
              className="w-full flex items-center justify-between px-5 py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm font-medium font-heebo hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Lock size={14} />
                הערות פרטיות שלי
              </span>
              {notesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {notesOpen && (
              <PrivateNotesEditor
                questionId={id}
                initialNotes={private_notes}
                onSaved={(notes) =>
                  setQuestion((prev) => prev ? { ...prev, private_notes: notes } : prev)
                }
              />
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <ClaimConfirmModal
        isOpen={showClaim}
        question={question}
        onClose={() => setShowClaim(false)}
        onClaimed={(updated) => setQuestion(updated)}
      />

      <ReleaseConfirmModal
        isOpen={showRelease}
        question={question}
        onClose={() => setShowRelease(false)}
        onReleased={(updated) => setQuestion(updated)}
      />

      <TransferModal
        isOpen={showTransfer}
        question={question}
        onClose={() => setShowTransfer(false)}
        onTransferred={(updated) => setQuestion(updated)}
      />

      {/* CreateDiscussionModal placeholder — rendered when imported */}
      {showCreateDiscussion && (
        <CreateDiscussionModal
          isOpen={showCreateDiscussion}
          question={question}
          onClose={() => setShowCreateDiscussion(false)}
        />
      )}
    </div>
  );
}

// ── AnswerEditor ───────────────────────────────────────────────────────────

function AnswerEditor({ questionId, initialDraft, onPublished }) {
  const [draft, setDraft] = useState(initialDraft || '');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const autoSaveRef = useRef(null);

  // Auto-save draft every 30 s of inactivity
  useEffect(() => {
    if (draft === (initialDraft || '')) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    setSaved(false);
    autoSaveRef.current = setTimeout(() => saveDraft(draft), 30_000);
    return () => clearTimeout(autoSaveRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const saveDraft = async (text) => {
    setSaving(true);
    try {
      await put(`/questions/draft/${questionId}`, { content: text });
      setSaved(true);
    } catch {
      // silent — don't block the rabbi
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!draft.trim()) {
      setError('יש לכתוב תשובה לפני פרסום.');
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const data = await post(`/questions/answer/${questionId}`, { content: draft, publishNow: true });
      onPublished?.(data.question || data);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message || 'שגיאה בפרסום התשובה.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Pencil size={15} className="text-brand-navy" />
          <span className="font-semibold text-[var(--text-primary)] font-heebo">
            כתוב תשובה
          </span>
        </div>
      }
    >
      <textarea
        rows={12}
        placeholder="כתוב את תשובתך כאן..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        dir="rtl"
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors duration-150 placeholder:text-[var(--text-muted)]"
      />

      {error && (
        <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700">
          <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300 font-heebo">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <span className="text-xs text-[var(--text-muted)] font-heebo">
          {saving
            ? 'שומר טיוטה...'
            : saved
            ? 'הטיוטה נשמרה'
            : 'הטיוטה תישמר אוטומטית'}
        </span>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saveDraft(draft)}
            loading={saving}
            disabled={saving || publishing}
          >
            שמור טיוטה
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handlePublish}
            loading={publishing}
            disabled={saving || publishing || !draft.trim()}
            leftIcon={<Send size={14} />}
          >
            פרסם תשובה
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── FollowUpSection ────────────────────────────────────────────────────────

function FollowUpSection({ questionId, followUpQuestion, followUpAnswer, followUpCount, isMe }) {
  // State for rabbi answering an existing follow-up
  const [rabbiAnswerText, setRabbiAnswerText] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [answerError, setAnswerError] = useState(null);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);

  // Rabbi submits an answer to an existing follow-up question
  const handleSubmitRabbiAnswer = async () => {
    if (!rabbiAnswerText.trim()) return;
    setSubmittingAnswer(true);
    setAnswerError(null);
    try {
      await post(`/questions/followup-answer/${questionId}`, { content: rabbiAnswerText });
      setAnswerSubmitted(true);
    } catch (err) {
      setAnswerError(err.response?.data?.message || err.message || 'שגיאה בשמירת התגובה.');
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // If there's already a follow-up question in the system, show the full section
  const hasFollowUpQuestion = !!followUpQuestion;

  return (
    <Card
      header={
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[var(--text-primary)] font-heebo text-sm">
            שאלת המשך
          </span>
          {hasFollowUpQuestion && (
            <span className="text-xs text-[var(--text-muted)] font-heebo">
              נשלחה מהשואל דרך האתר
            </span>
          )}
        </div>
      }
    >
      {/* Follow-up question submitted successfully (placeholder for legacy flow) */}
      {false && (
        <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-700">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 font-heebo">
            שאלת ההמשך נשלחה בהצלחה. הרב יחזור אליך בהקדם.
          </p>
        </div>
      )}

      {/* Existing follow-up question from asker */}
      {hasFollowUpQuestion && (
        <div className="mb-4 p-3 bg-[var(--bg-muted)] rounded-lg">
          <p className="text-xs text-[var(--text-muted)] font-heebo mb-1">שאלת המשך מהשואל:</p>
          <p className="text-sm text-[var(--text-primary)] font-heebo leading-relaxed">
            {followUpQuestion}
          </p>
        </div>
      )}

      {/* Existing follow-up answer from rabbi */}
      {followUpAnswer && (
        <div
          className="prose prose-sm max-w-none text-[var(--text-primary)] font-heebo leading-relaxed mb-4"
          dangerouslySetInnerHTML={{ __html: followUpAnswer }}
        />
      )}

      {/* Rabbi answer form — only shown to the answering rabbi when no answer yet */}
      {isMe && hasFollowUpQuestion && !followUpAnswer && !answerSubmitted && (
        <div className="space-y-3 pt-2 border-t border-[var(--border-default)]">
          <p className="text-xs font-medium text-[var(--text-muted)] font-heebo">
            כתוב תשובה לשאלת ההמשך:
          </p>
          <textarea
            rows={5}
            placeholder="כתוב תשובה לשאלת ההמשך..."
            value={rabbiAnswerText}
            onChange={(e) => setRabbiAnswerText(e.target.value)}
            dir="rtl"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold transition-colors placeholder:text-[var(--text-muted)]"
          />
          {answerError && (
            <p className="text-xs text-red-600 dark:text-red-400 font-heebo">{answerError}</p>
          )}
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Send size={13} />}
            onClick={handleSubmitRabbiAnswer}
            loading={submittingAnswer}
            disabled={!rabbiAnswerText.trim() || submittingAnswer}
          >
            שלח תגובה
          </Button>
        </div>
      )}

      {/* Rabbi answer submitted successfully */}
      {answerSubmitted && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-heebo">
          התגובה נשלחה בהצלחה.
        </p>
      )}

      {/* No follow-up at all */}
      {!hasFollowUpQuestion && (
        <p className="text-sm text-[var(--text-muted)] font-heebo">
          אין שאלת המשך לשאלה זו.
        </p>
      )}
    </Card>
  );
}

// ── PrivateNotesEditor ─────────────────────────────────────────────────────

function PrivateNotesEditor({ questionId, initialNotes, onSaved }) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // Sync local state when initialNotes changes (e.g., after refetch)
  useEffect(() => {
    setNotes(initialNotes || '');
  }, [initialNotes]);

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      await put(`/questions/${questionId}/notes`, { notes });
      setSavedMsg('נשמר');
      onSaved?.(notes);
    } catch {
      setSavedMsg('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 bg-amber-50 dark:bg-amber-900/10 space-y-3">
      <textarea
        rows={4}
        placeholder="הוסף הערות פרטיות לשאלה זו (לא יוצגו לשואל)..."
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSavedMsg('');
        }}
        dir="rtl"
        className="w-full rounded-md border border-amber-200 dark:border-amber-700 bg-white dark:bg-amber-900/20 text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-colors placeholder:text-amber-400"
      />
      <div className="flex items-center justify-between">
        {savedMsg && (
          <span className="text-xs font-heebo text-amber-700 dark:text-amber-400">
            {savedMsg}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSave}
          loading={saving}
          className="mr-auto text-amber-700 hover:text-amber-800 hover:bg-amber-100"
        >
          שמור הערות
        </Button>
      </div>
    </div>
  );
}

// ── CreateDiscussionModal (lightweight placeholder) ────────────────────────
// Full implementation lives in discussions feature; this is a shim so the
// "פתח דיון" button is functional without an import cycle.

function CreateDiscussionModal({ isOpen, question, onClose }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(question?.title ? `דיון: ${truncate(question.title, 50)}` : '');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('יש למלא כותרת לדיון.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await post('/discussions', {
        title,
        questionId: question?.id,
      });
      onClose();
      navigate(`/discussions/${data.discussion?.id || data.id}`);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'שגיאה ביצירת הדיון.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-surface)] rounded-card shadow-xl p-6 space-y-4"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-[var(--text-primary)] font-heebo">
          פתח דיון חדש
        </h2>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">
            כותרת הדיון
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">
            תוכן הדיון
          </label>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="כתוב את תוכן הדיון כאן..."
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors placeholder:text-[var(--text-muted)]"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 font-heebo">{error}</p>
        )}

        <div className="flex items-center gap-3 justify-end flex-row-reverse pt-2">
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting}
          >
            צור דיון
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
        </div>
      </div>
    </div>
  );
}
