import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Headphones,
  Send,
  CheckCircle,
  Clock,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import { get, post } from '../lib/api';
import { formatDate } from '../lib/utils';
import { useSocket } from '../contexts/SocketContext';
import { showToast } from '../components/common/Toast';

// ── Conversation view ─────────────────────────────────────────────────────

function ConversationView({ request, onBack }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const [fetchError, setFetchError] = useState(null);

  const fetchMessages = useCallback(async () => {
    setFetchError(null);
    try {
      const data = await get(`/support/${request.id}/messages`);
      setMessages(data.messages || []);
    } catch (err) {
      setFetchError('שגיאה בטעינת ההודעות. נסה לרענן.');
      console.error('[support] fetchMessages error:', err);
    } finally {
      setLoading(false);
    }
  }, [request.id]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [sendError, setSendError] = useState(null);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const data = await post(`/support/${request.id}/messages`, { message: newMessage.trim() });
      setMessages((prev) => [...prev, data.message]);
      setNewMessage('');
    } catch (err) {
      setSendError('שגיאה בשליחת ההודעה. נסה שוב.');
      console.error('[support] handleSend error:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors"
        >
          <ArrowRight size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate">
            {request.subject}
          </h3>
          <span className="text-xs text-[var(--text-muted)] font-heebo">
            {request.status === 'handled' ? 'טופל' : 'פתוח'} &middot; {formatDate(request.created_at)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8F6F1]">
        {fetchError && (
          <div className="text-center py-4 text-red-600 font-heebo text-sm">{fetchError}</div>
        )}
        {sendError && (
          <div className="text-center py-2 text-red-600 font-heebo text-xs bg-red-50 rounded-md mx-4 px-3 py-1.5">{sendError}</div>
        )}
        {loading ? (
          <div className="text-center py-8 text-[var(--text-muted)] font-heebo text-sm">טוען הודעות...</div>
        ) : messages.length === 0 && !fetchError ? (
          <div className="text-center py-8 text-[var(--text-muted)] font-heebo text-sm">אין הודעות</div>
        ) : (
          messages.map((msg) => (
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
                  {msg.sender_name || (msg.sender_role === 'admin' ? 'מנהל' : 'אני')}
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
          placeholder="הקלד הודעה..."
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

// ── Main SupportPage ─────────────────────────────────────────────────────

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // My requests list
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [activeRequest, setActiveRequest] = useState(null);

  const { on } = useSocket();

  const fetchMyRequests = useCallback(async () => {
    try {
      const data = await get('/support/my');
      setRequests(data.requests || []);
    } catch { /* ignore */ }
    finally { setLoadingRequests(false); }
  }, []);

  useEffect(() => { fetchMyRequests(); }, [fetchMyRequests]);

  // ── Real-time: admin replied to a support request ─────────────────────────
  useEffect(() => {
    const unsub = on('support:reply', (payload) => {
      showToast.info('קיבלת תשובה מההנהלה לפנייתך');
      // Refresh the requests list so message_count updates
      fetchMyRequests();
    });
    return unsub;
  }, [on, fetchMyRequests]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setSending(true);
    setError(null);
    try {
      const data = await post('/support/contact', {
        subject: subject.trim(),
        message: message.trim(),
      });
      // Add the new request to the list and open it
      const newReq = data.request;
      setRequests((prev) => [newReq, ...prev]);
      setActiveRequest(newReq);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשליחת הפנייה');
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2.5 text-sm font-heebo rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent transition-colors duration-150';

  // If viewing a conversation
  if (activeRequest) {
    return (
      <div className="page-enter h-[calc(100vh-4rem)]" dir="rtl">
        <ConversationView
          request={activeRequest}
          onBack={() => { setActiveRequest(null); fetchMyRequests(); }}
        />
      </div>
    );
  }

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="פניה לניהול"
        subtitle="שלח הודעה למנהלי המערכת"
      />

      <div className="p-6 max-w-2xl space-y-6">
        {/* New request form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
              נושא <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="נושא הפנייה..."
              maxLength={200}
              required
              dir="rtl"
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
              הודעה <span className="text-red-500">*</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="תאר את הנושא בפירוט..."
              rows={4}
              required
              dir="rtl"
              className={`${inputClass} resize-y`}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            loading={sending}
            disabled={!subject.trim() || !message.trim()}
            leftIcon={<Send size={15} />}
          >
            שלח פנייה
          </Button>
        </form>

        {/* Previous requests */}
        {loadingRequests ? (
          <p className="text-sm text-[var(--text-muted)] font-heebo">טוען פניות קודמות...</p>
        ) : requests.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] font-heebo mb-3 flex items-center gap-2">
              <MessageSquare size={16} />
              הפניות שלי
            </h3>
            <div className="space-y-2">
              {requests.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setActiveRequest(req)}
                  className="w-full text-right flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)] font-heebo truncate">
                      {req.subject}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-heebo mt-0.5">
                      <Clock size={10} />
                      {formatDate(req.created_at)}
                      {req.message_count > 1 && (
                        <span className="flex items-center gap-0.5">
                          <MessageSquare size={10} />
                          {req.message_count === 1 ? 'הודעה אחת' : `${req.message_count} הודעות`}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={clsx(
                    'inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-heebo flex-shrink-0',
                    req.status === 'handled'
                      ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                      : 'text-amber-700 bg-amber-50 border border-amber-200'
                  )}>
                    {req.status === 'handled' ? (
                      <><CheckCircle size={10} /> טופל</>
                    ) : (
                      <><Clock size={10} /> פתוח</>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
