import React from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { MessageSquarePlus, Eye, ChevronLeft, Paperclip } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import CountdownTimer from './CountdownTimer';
import { truncate, formatRelative, getCategoryLabel, colorFromCategory } from '../../lib/utils';

/**
 * QuestionCard — mini card for dashboard question lists.
 *
 * @param {object}   question           — question object from API
 * @param {'my'|'pending'} mode         — 'my' = rabbi's in-process questions, 'pending' = unassigned
 * @param {function} onClaim            — called when rabbi clicks "תפוס שאלה" (pending mode)
 * @param {function} onTimerExpired     — called when countdown hits 0 (my mode)
 * @param {boolean}  claimLoading       — show spinner on claim button
 */
export default function QuestionCard({
  question,
  mode = 'my',
  onClaim,
  onTimerExpired,
  claimLoading = false,
}) {
  const navigate = useNavigate();

  if (!question) return null;

  const {
    _id,
    id,
    title,
    category,
    status,
    createdAt,
    lockedAt,
    timeoutHours = 24,
    isUrgent,
    askerName,
    attachment_url,
    attachmentUrl,
  } = question;

  const hasAttachment = !!(attachment_url || attachmentUrl);

  const questionId = _id || id;
  const titleTruncated = truncate(title || 'שאלה ללא כותרת', 80);
  const categoryLabel   = getCategoryLabel(category);
  const categoryColor   = colorFromCategory(category);
  const timeAgo         = formatRelative(createdAt);

  const handleNavigate = () => navigate(`/questions/${questionId}`);
  const handleAnswer   = () => navigate(`/questions/${questionId}?answer=1`);

  return (
    <div
      className={clsx(
        'group relative rounded-xl border bg-[var(--bg-surface)]',
        'border-[var(--border-default)] transition-all duration-200',
        'hover:border-[var(--accent)] hover:shadow-md hover:-translate-y-0.5',
        'overflow-hidden',
      )}
    >
      {/* Urgency stripe */}
      {isUrgent && (
        <div
          className="absolute top-0 right-0 bottom-0 w-1 bg-red-500 rounded-r-xl"
          aria-hidden="true"
        />
      )}

      <div className="p-4 flex flex-col gap-2.5">
        {/* Top row: badges + time */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Category badge */}
            {categoryLabel && (
              <span
                className={clsx(
                  'inline-flex items-center text-xs font-medium font-heebo',
                  'px-2 py-0.5 rounded-full',
                  categoryColor
                )}
              >
                {categoryLabel}
              </span>
            )}

            {/* Status badge */}
            <Badge
              status={isUrgent ? 'urgent' : status || 'pending'}
              size="xs"
              withDot
            />
          </div>

          {/* Time ago */}
          {timeAgo && (
            <span className="text-xs text-[var(--text-muted)] font-heebo flex-shrink-0">
              {timeAgo}
            </span>
          )}
        </div>

        {/* Title */}
        <button
          onClick={handleNavigate}
          className={clsx(
            'text-right text-sm font-medium font-heebo leading-snug',
            'text-[var(--text-primary)] hover:text-[var(--accent)]',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:underline',
          )}
          aria-label={`פתח שאלה: ${titleTruncated}`}
        >
          {titleTruncated}
        </button>

        {/* Asker (if available) */}
        {askerName && (
          <p className="text-xs text-[var(--text-muted)] font-heebo">
            שואל: {askerName}
          </p>
        )}

        {/* Attachment indicator */}
        {hasAttachment && (
          <a
            href={attachment_url || attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="block"
            title="קובץ מצורף"
          >
            {/\.(jpe?g|png|gif|webp)(\?|$)/i.test(attachment_url || attachmentUrl) ? (
              <img src={attachment_url || attachmentUrl} alt="קובץ מצורף" className="max-h-28 rounded border border-gray-200 object-contain mt-1" />
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline font-heebo">
                <Paperclip className="w-3 h-3" />
                קובץ מצורף
              </span>
            )}
          </a>
        )}

        {/* Countdown (only for in_process / my-questions mode) */}
        {mode === 'my' && status === 'in_process' && lockedAt && (
          <div className="mt-0.5">
            <CountdownTimer
              lockTimestamp={lockedAt}
              timeoutHours={timeoutHours}
              onExpired={onTimerExpired}
            />
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border-default)]">
          {mode === 'my' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNavigate}
                rightIcon={<Eye className="w-3.5 h-3.5" />}
                aria-label="צפה בשאלה"
              >
                צפה
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAnswer}
                rightIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
                aria-label="ענה על השאלה"
              >
                ענה
              </Button>
            </>
          )}

          {mode === 'pending' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNavigate}
                rightIcon={<Eye className="w-3.5 h-3.5" />}
                aria-label="צפה בשאלה"
              >
                צפה
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={claimLoading}
                onClick={() => onClaim?.(questionId)}
                rightIcon={!claimLoading ? <ChevronLeft className="w-3.5 h-3.5" /> : undefined}
                aria-label="תפוס שאלה זו לטיפול"
              >
                תפוס שאלה
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
