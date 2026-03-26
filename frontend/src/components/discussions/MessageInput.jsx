import React, { useState, useRef, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import { Send, Smile, Paperclip, X } from 'lucide-react';
import api from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDebouncedCallback } from '../../hooks/useDebounce';
import Tooltip from '../ui/Tooltip';

// The 5 allowed emojis
const ALLOWED_EMOJIS = ['👍', '✅', '❤️', '🙏', '💡'];

/**
 * Message compose box.
 *
 * Props:
 *   discussionId    — string
 *   onSend(message) — called after successful POST
 *   replyTo         — message object to quote (or null)
 *   onCancelReply() — clear the reply
 */
export default function MessageInput({
  discussionId,
  onSend,
  replyTo,
  onCancelReply,
}) {
  const { rabbi } = useAuth();
  const { emit } = useSocket();

  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const isTypingRef = useRef(false);

  // ── Debounced "stopped typing" event ──────────────────────────────────────

  const [emitStopTyping] = useDebouncedCallback(() => {
    if (isTypingRef.current) {
      emit('discussion:typing', { discussionId, isTyping: false });
      isTypingRef.current = false;
    }
  }, 2000);

  const handleKeyDown = useCallback(
    (e) => {
      // Emit typing start
      if (!isTypingRef.current) {
        emit('discussion:typing', { discussionId, isTyping: true });
        isTypingRef.current = true;
      }
      emitStopTyping();

      // Enter = send; Shift+Enter = newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [discussionId, emit, emitStopTyping, handleSend]
  );

  // Auto-resize textarea
  const handleChange = useCallback((e) => {
    setContent(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    }
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    // Stop typing
    emit('discussion:typing', { discussionId, isTyping: false });
    isTypingRef.current = false;

    try {
      const payload = {
        content: trimmed,
        ...(replyTo ? { parentId: replyTo.id } : {}),
      };

      const { data } = await api.post(
        `/discussions/${discussionId}/messages`,
        payload
      );

      const newMsg = data.message || data;
      onSend?.(newMsg);
      setContent('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      setError(err.response?.data?.message || 'שגיאה בשליחת ההודעה');
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [content, discussionId, emit, onSend, replyTo, sending]);

  // ── Insert emoji into textarea ────────────────────────────────────────────

  const insertEmoji = useCallback((emoji) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPanel(false);
    textareaRef.current?.focus();
  }, []);

  // ── Focus textarea when reply changes ─────────────────────────────────────

  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="border-t border-[var(--border-default)] bg-[var(--bg-surface)] flex-shrink-0"
      dir="rtl"
    >
      {/* Reply / quote preview */}
      {replyTo && (
        <div
          className="
            flex items-center justify-between gap-2
            px-4 py-2
            bg-[#1B2B5E]/5 border-b border-[#1B2B5E]/15
          "
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-0.5 h-8 bg-[#B8973A] flex-shrink-0 rounded-full" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#B8973A] font-heebo">
                מגיב ל-{replyTo.rabbi_name || 'הודעה'}
              </p>
              <p className="text-xs text-[var(--text-muted)] font-heebo truncate">
                {(replyTo.content || '').replace(/<[^>]+>/g, '').slice(0, 60)}
                {(replyTo.content || '').length > 60 && '...'}
              </p>
            </div>
          </div>
          <button
            onClick={onCancelReply}
            className="p-1 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] flex-shrink-0 transition-colors"
            aria-label="בטל תגובה"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="px-4 pt-1.5 text-xs text-red-600 font-heebo">{error}</p>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 px-3 py-2.5">
        {/* Emoji button */}
        <div className="relative flex-shrink-0 self-end">
          <button
            type="button"
            onClick={() => setShowEmojiPanel((v) => !v)}
            aria-label="אמוג'י"
            className="
              w-9 h-9 flex items-center justify-center rounded-full
              text-[var(--text-muted)] hover:text-[#1B2B5E] hover:bg-[var(--bg-muted)]
              transition-colors duration-150
              focus-visible:ring-2 focus-visible:ring-[#B8973A]
            "
          >
            <Smile size={20} />
          </button>

          {/* Emoji panel */}
          {showEmojiPanel && (
            <div
              className="
                absolute bottom-full mb-2 right-0 z-20
                flex items-center gap-1.5 p-2
                bg-white border border-gray-200 rounded-2xl shadow-lg
              "
            >
              {ALLOWED_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="
                    text-xl w-9 h-9 rounded-xl
                    hover:bg-[var(--bg-muted)] hover:scale-110
                    transition-all duration-100
                    flex items-center justify-center
                  "
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* File attachment — v1 placeholder */}
        <Tooltip content="צירוף קבצים — בקרוב" placement="top">
          <button
            type="button"
            disabled
            aria-label="צרף קובץ (בקרוב)"
            className="
              w-9 h-9 flex items-center justify-center rounded-full
              text-[var(--text-muted)] opacity-40 cursor-not-allowed
              flex-shrink-0 self-end
            "
          >
            <Paperclip size={18} />
          </button>
        </Tooltip>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="כתוב הודעה..."
          disabled={sending}
          dir="rtl"
          className="
            flex-1 resize-none rounded-2xl
            bg-[var(--bg-muted)] border border-transparent
            px-4 py-2.5 text-sm font-heebo
            text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
            focus:outline-none focus:border-[#1B2B5E]/30 focus:ring-1 focus:ring-[#1B2B5E]/20
            disabled:opacity-50
            transition-colors duration-150
            leading-relaxed
            direction-rtl text-right
            overflow-hidden
          "
          style={{ minHeight: '42px', maxHeight: '140px' }}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!content.trim() || sending}
          aria-label="שלח הודעה"
          className={clsx(
            'flex-shrink-0 self-end w-10 h-10 rounded-full',
            'flex items-center justify-center',
            'transition-all duration-150',
            'focus-visible:ring-2 focus-visible:ring-[#B8973A]',
            content.trim() && !sending
              ? 'bg-[#1B2B5E] text-white hover:bg-[#152348] shadow-md hover:shadow-lg'
              : 'bg-[var(--bg-muted)] text-[var(--text-muted)] cursor-not-allowed'
          )}
        >
          {sending ? (
            <span
              className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
              aria-hidden="true"
            />
          ) : (
            /* Mirror Send icon for RTL */
            <Send size={17} style={{ transform: 'scaleX(-1)' }} />
          )}
        </button>
      </div>
    </div>
  );
}
