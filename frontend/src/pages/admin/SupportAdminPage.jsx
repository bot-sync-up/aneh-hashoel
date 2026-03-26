import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Headphones,
  CheckCircle2,
  Clock,
  User,
  RefreshCw,
  Inbox,
  ArrowRight,
  Send,
  MessageSquare,
} from 'lucide-react';
import { get, post, patch } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import Button from '../../components/ui/Button';
import { BlockSpinner } from '../../components/ui/Spinner';

const FILTERS = [
  { value: 'all',     label: 'הכל' },
  { value: 'open',    label: 'פתוחות' },
  { value: 'handled', label: 'טופלו' },
];

// ── Conversation View ─────────────────────────────────────────────────────

function ConversationView({ request, onBack, onStatusUpdate }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const bottomRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await get(`/admin/support/${request.id}/messages`);
      setMessages(data.messages || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [request.id]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      const data = await post(`/admin/support/${request.id}/messages`, { message: newMessage.trim() });
      setMessages((prev) => [...prev, data.message]);
      setNewMessage('');
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  const handleToggleStatus = async () => {
    setToggling(true);
    try {
      const newStatus = request.status === 'handled' ? 'open' : 'handled';
      const result = await patch(`/admin/support/${request.id}`, { status: newStatus });
      onStatusUpdate(result.request || { ...request, status: newStatus });
    } catch { /* ignore */ }
    finally { setToggling(false); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors"
        >
          <ArrowRight size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate">
              {request.subject}
            </h3>
            {request.status === 'handled' ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-1.5 py-0.5 font-heebo flex-shrink-0">
                <CheckCircle2 size={9} />
                טופל
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-full px-1.5 py-0.5 font-heebo flex-shrink-0">
                <Clock size={9} />
                פתוח
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-heebo">
            <span className="flex items-center gap-1">
              <User size={11} />
              {request.rabbi_name}
            </span>
            <span>{formatDate(request.created_at)}</span>
          </div>
        </div>
        <Button
          variant={request.status === 'handled' ? 'ghost' : 'secondary'}
          size="sm"
          loading={toggling}
          onClick={handleToggleStatus}
          leftIcon={<CheckCircle2 size={13} />}
        >
          {request.status === 'handled' ? 'סמן כפתוח' : 'סמן כטופל'}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8F6F1]">
        {/* Original request message */}
        <div className="max-w-[80%] ms-auto rounded-xl rounded-tr-sm px-4 py-2.5 shadow-sm bg-white text-[var(--text-primary)] border border-[var(--border-default)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold font-heebo text-[var(--text-muted)]">
              {request.rabbi_name}
            </span>
            <span className="text-[10px] font-heebo text-[var(--text-muted)]">
              {formatDate(request.created_at)}
            </span>
          </div>
          <p className="text-sm font-heebo whitespace-pre-wrap leading-relaxed">{request.message}</p>
        </div>

        {loading ? (
          <div className="text-center py-4 text-[var(--text-muted)] font-heebo text-sm">טוען הודעות...</div>
        ) : (
          messages
            .filter((msg, idx) => {
              // Skip first message if it's the same as the original request message
              if (idx === 0 && msg.sender_role === 'rabbi' && msg.message === request.message) return false;
              return true;
            })
            .map((msg) => (
              <div
                key={msg.id}
                className={clsx(
                  'max-w-[80%] rounded-xl px-4 py-2.5 shadow-sm',
                  msg.sender_role === 'admin'
                    ? 'me-auto bg-[#1B2B5E] text-white rounded-tl-sm'
                    : 'ms-auto bg-white text-[var(--text-primary)] border border-[var(--border-default)] rounded-tr-sm'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={clsx(
                    'text-xs font-semibold font-heebo',
                    msg.sender_role === 'admin' ? 'text-white/80' : 'text-[var(--text-muted)]'
                  )}>
                    {msg.sender_name}
                  </span>
                  <span className={clsx(
                    'text-[10px] font-heebo',
                    msg.sender_role === 'admin' ? 'text-white/50' : 'text-[var(--text-muted)]'
                  )}>
                    {formatDate(msg.created_at)}
                  </span>
                </div>
                <p className="text-sm font-heebo whitespace-pre-wrap leading-relaxed">{msg.message}</p>
              </div>
            ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-default)] bg-[var(--bg-surface)]">
        <textarea
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="הקלד תגובה..."
          rows={1}
          dir="rtl"
          className="flex-1 px-3 py-2 text-sm font-heebo rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent resize-none"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
          loading={sending}
          leftIcon={<Send size={14} />}
        >
          שלח
        </Button>
      </div>
    </div>
  );
}

// ── Request Card ─────────────────────────────────────────────────────────

function RequestCard({ request, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-right rounded-xl border px-5 py-4 bg-[var(--bg-surface)] transition-all hover:shadow-soft cursor-pointer',
        request.status === 'handled'
          ? 'border-emerald-200 dark:border-emerald-800'
          : 'border-[var(--border-default)]'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate">
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
            {request.message_count > 1 && (
              <span className="flex items-center gap-1">
                <MessageSquare size={11} />
                {request.message_count} הודעות
              </span>
            )}
          </div>
        </div>
        {request.status === 'handled' ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-2 py-0.5 font-heebo flex-shrink-0">
            <CheckCircle2 size={10} />
            טופל
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5 font-heebo flex-shrink-0">
            <Clock size={10} />
            פתוח
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--text-secondary)] font-heebo leading-relaxed whitespace-pre-wrap line-clamp-2">
        {request.message}
      </p>
    </button>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function SupportAdminPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [activeRequest, setActiveRequest] = useState(null);

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

  const handleStatusUpdate = useCallback((updated) => {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setActiveRequest((prev) => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
  }, []);

  // Conversation view
  if (activeRequest) {
    return (
      <div className="space-y-3" dir="rtl">
        <ConversationView
          request={activeRequest}
          onBack={() => { setActiveRequest(null); fetchRequests(); }}
          onStatusUpdate={handleStatusUpdate}
        />
      </div>
    );
  }

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
            <RequestCard
              key={req.id}
              request={req}
              onClick={() => setActiveRequest(req)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
