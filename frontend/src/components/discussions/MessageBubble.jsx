import React, { useState, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { Pin, Pencil, Trash2, Reply, Check, X } from 'lucide-react';
import { formatTime } from '../../lib/utils';

// The 5 allowed reaction emojis
const ALLOWED_EMOJIS = ['👍', '✅', '❤️', '🙏', '💡'];

/**
 * A single chat message bubble.
 *
 * Props:
 *   message            — message object
 *   isOwn              — bool: current user's message
 *   showRabbiName      — bool: show sender name above bubble
 *   onReply()          — set as reply target
 *   onPin()            — toggle pin (admin / discussion creator)
 *   onReact(emoji)     — send a reaction
 *   onEdit(newContent) — edit own message
 *   onDelete()         — soft-delete own message
 *   currentRabbiId     — id of logged-in rabbi
 *   discussionOwnerId  — creator of the discussion (can pin)
 */
export default function MessageBubble({
  message,
  isOwn,
  showRabbiName,
  onReply,
  onPin,
  onReact,
  onEdit,
  onDelete,
  currentRabbiId,
  discussionOwnerId,
}) {
  const [hovered, setHovered] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const editRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  const isAdmin = false; // pulled from context if needed; passed via prop in real usage
  const canPin = isOwn || currentRabbiId === discussionOwnerId;

  // ── Soft delete placeholder ───────────────────────────────────────────────

  if (message.is_deleted) {
    return (
      <div
        className={clsx(
          'flex my-1',
          isOwn ? 'justify-start' : 'justify-end'
        )}
        dir="rtl"
      >
        <span className="text-xs text-[var(--text-muted)] italic font-heebo px-2">
          הודעה זו נמחקה
        </span>
      </div>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────

  const startEdit = () => {
    // Strip basic HTML for editing
    const plain = (message.content || '').replace(/<[^>]+>/g, '');
    setEditContent(plain);
    setIsEditing(true);
    setTimeout(() => {
      editRef.current?.focus();
      editRef.current?.select();
    }, 50);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent('');
  };

  const submitEdit = () => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== message.content) {
      onEdit?.(trimmed);
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitEdit();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  // ── Hover enter / leave with slight delay ─────────────────────────────────

  const handleMouseEnter = () => {
    clearTimeout(hoverTimeoutRef.current);
    setHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHovered(false);
      setShowEmojiPicker(false);
    }, 300);
  };

  // ── Reactions summary ─────────────────────────────────────────────────────

  const reactionGroups = React.useMemo(() => {
    const reactions = message.reactions;
    // Backend returns reactions as an object map: { emoji: { count, reacted, rabbis[] } }
    if (reactions && typeof reactions === 'object' && !Array.isArray(reactions)) {
      const grouped = {};
      for (const [emoji, data] of Object.entries(reactions)) {
        grouped[emoji] = {
          count: data.count || 0,
          myReaction: data.reacted || false,
          rabbis: Array.isArray(data.rabbis) ? data.rabbis : [],
        };
      }
      return grouped;
    }
    // Fallback: legacy array format
    if (Array.isArray(reactions)) {
      const grouped = {};
      reactions.forEach((r) => {
        if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, myReaction: false, rabbis: [] };
        grouped[r.emoji].count += 1;
        if (r.rabbi_name) grouped[r.emoji].rabbis.push({ id: r.rabbi_id, name: r.rabbi_name });
        if (String(r.rabbi_id) === String(currentRabbiId)) grouped[r.emoji].myReaction = true;
      });
      return grouped;
    }
    return {};
  }, [message.reactions, currentRabbiId]);

  const hasReactions = Object.keys(reactionGroups).length > 0;

  // ── Parent / quote ────────────────────────────────────────────────────────

  const parentMsg = message.parent_message;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={clsx(
        'flex flex-col mb-1 group',
        isOwn ? 'items-start' : 'items-end'
      )}
      dir="rtl"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Rabbi name */}
      {showRabbiName && !isOwn && (
        <span className="text-xs text-[#1B2B5E] font-semibold font-heebo mb-1 px-1">
          {message.rabbi_name || 'רב'}
        </span>
      )}

      <div
        className={clsx(
          'relative flex items-end gap-1.5',
          isOwn ? 'flex-row' : 'flex-row-reverse'
        )}
      >
        {/* Action buttons (appear on hover) */}
        <div
          className={clsx(
            'flex items-center gap-1 transition-opacity duration-150 flex-shrink-0 self-center',
            hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          {/* Reply */}
          <ActionButton
            icon={<Reply size={13} />}
            label="ענה"
            onClick={onReply}
          />

          {/* Emoji picker trigger — not on own message */}
          {!isOwn && (
            <div className="relative">
              <ActionButton
                icon={<span className="text-xs leading-none">😀</span>}
                label="הגב"
                onClick={() => setShowEmojiPicker((v) => !v)}
              />
              {showEmojiPicker && (
                <EmojiPickerPanel
                  onSelect={(emoji) => {
                    onReact?.(emoji);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                  isOwn={isOwn}
                />
              )}
            </div>
          )}

          {/* Pin (creator / admin) */}
          {canPin && (
            <ActionButton
              icon={<Pin size={13} className={message.is_pinned ? 'fill-[#B8973A] text-[#B8973A]' : ''} />}
              label={message.is_pinned ? 'בטל הצמדה' : 'הצמד'}
              onClick={onPin}
            />
          )}

          {/* Edit own */}
          {isOwn && (
            <ActionButton
              icon={<Pencil size={13} />}
              label="ערוך"
              onClick={startEdit}
            />
          )}

          {/* Delete own */}
          {isOwn && (
            <ActionButton
              icon={<Trash2 size={13} className="text-red-400" />}
              label="מחק"
              onClick={onDelete}
            />
          )}
        </div>

        {/* Bubble */}
        <div className="flex flex-col max-w-[70%] min-w-0">
          {/* Quote / parent */}
          {parentMsg && (
            <div
              className={clsx(
                'text-xs rounded-t-lg px-3 py-1.5 mb-0.5 border-r-2',
                isOwn
                  ? 'bg-[#0f1e45] border-[#B8973A] text-white/70'
                  : 'bg-gray-100 border-[#1B2B5E]/40 text-[var(--text-muted)]'
              )}
            >
              <span className="font-semibold font-heebo text-[#B8973A] block text-[10px] mb-0.5">
                {parentMsg.rabbi_name || 'ציטוט'}
              </span>
              <span className="font-heebo line-clamp-2">
                {(parentMsg.content || '').replace(/<[^>]+>/g, '').slice(0, 80)}
                {(parentMsg.content || '').length > 80 && '...'}
              </span>
            </div>
          )}

          {/* Main bubble */}
          <div
            className={clsx(
              'px-4 py-2.5 rounded-2xl shadow-sm',
              'transition-all duration-200',
              isOwn
                ? 'bg-[#1B2B5E] text-white rounded-tr-sm'
                : 'bg-white text-[#1B2B5E] rounded-tl-sm',
              parentMsg && 'rounded-t-none'
            )}
            style={{
              animation: 'messageSlideIn 0.18s ease-out',
            }}
          >
            {isEditing ? (
              /* Edit textarea */
              <div className="flex flex-col gap-2">
                <textarea
                  ref={editRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  rows={2}
                  className="
                    w-full text-sm font-heebo bg-transparent
                    border-b border-white/30 resize-none
                    focus:outline-none focus:border-[#B8973A]
                    text-right direction-rtl
                  "
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={cancelEdit}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    aria-label="בטל עריכה"
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={submitEdit}
                    className="p-1 rounded hover:bg-white/10 transition-colors text-[#B8973A]"
                    aria-label="שמור עריכה"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            ) : (
              /* Message content (rendered HTML) */
              <div
                className={clsx(
                  'text-sm font-heebo leading-relaxed prose-sm',
                  'prose max-w-none',
                  isOwn ? 'prose-invert' : ''
                )}
                dangerouslySetInnerHTML={{ __html: message.content || '' }}
              />
            )}

            {/* Meta row */}
            {!isEditing && (
              <div
                className={clsx(
                  'flex items-center gap-1.5 mt-1',
                  isOwn ? 'justify-start' : 'justify-end'
                )}
              >
                <span
                  className={clsx(
                    'text-[10px] font-heebo',
                    isOwn ? 'text-white/50' : 'text-[var(--text-muted)]'
                  )}
                >
                  {formatTime(message.created_at)}
                </span>
                {message.is_edited && (
                  <span
                    className={clsx(
                      'text-[10px] font-heebo italic',
                      isOwn ? 'text-white/40' : 'text-[var(--text-muted)]'
                    )}
                  >
                    (נערך)
                  </span>
                )}
                {message.is_pinned && (
                  <Pin
                    size={10}
                    className={clsx(
                      'fill-current',
                      isOwn ? 'text-[#B8973A]' : 'text-[#B8973A]'
                    )}
                  />
                )}
              </div>
            )}
          </div>

          {/* Reactions row */}
          {hasReactions && (
            <div
              className={clsx(
                'flex flex-wrap gap-1 mt-1',
                isOwn ? 'justify-start' : 'justify-end'
              )}
            >
              {Object.entries(reactionGroups).map(([emoji, { count, myReaction, rabbis = [] }]) => {
                const names = rabbis.map((r) => r.name).filter(Boolean).join(', ');
                return (
                  <button
                    key={emoji}
                    onClick={() => !isOwn && onReact?.(emoji)}
                    disabled={isOwn}
                    title={names || `${count} תגובות`}
                    className={clsx(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heebo',
                      'border transition-colors duration-150',
                      isOwn && 'cursor-default',
                      myReaction
                        ? 'bg-[#1B2B5E]/10 border-[#1B2B5E]/30 text-[#1B2B5E]'
                        : 'bg-white border-gray-200 text-[var(--text-secondary)]',
                      !isOwn && !myReaction && 'hover:border-[#1B2B5E]/30'
                    )}
                    aria-label={`${emoji} ${count} תגובות${names ? ': ' + names : ''}`}
                  >
                    <span>{emoji}</span>
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small circular action button
function ActionButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="
        w-7 h-7 rounded-full
        bg-white border border-gray-200 shadow-sm
        flex items-center justify-center
        text-[var(--text-secondary)]
        hover:bg-[var(--bg-muted)] hover:text-[#1B2B5E]
        transition-colors duration-100
        focus-visible:ring-2 focus-visible:ring-[#B8973A]
      "
    >
      {icon}
    </button>
  );
}

// Floating emoji picker panel
function EmojiPickerPanel({ onSelect, onClose, isOwn }) {
  return (
    <div
      className={clsx(
        'absolute bottom-full mb-1 z-20',
        isOwn ? 'right-0' : 'left-0'
      )}
    >
      <div
        className="
          flex items-center gap-1 p-1.5
          bg-white border border-gray-200 rounded-full shadow-lg
        "
      >
        {ALLOWED_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="
              w-8 h-8 text-lg rounded-full
              hover:bg-[var(--bg-muted)] hover:scale-110
              transition-transform duration-100
              flex items-center justify-center
            "
            aria-label={`הגב עם ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// Inject CSS keyframe for slide-in animation (once)
if (typeof document !== 'undefined') {
  const styleId = '__msg-slide-in__';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes messageSlideIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}
