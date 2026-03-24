import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Flame,
  Eye,
  Heart,
  Clock,
  User,
  CheckCircle2,
  Lock,
  MessageSquare,
  Pencil,
  Paperclip,
} from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { formatRelative, getCategoryLabel, colorFromCategory, truncate } from '../../lib/utils';

/**
 * QuestionCard — displays a question summary with contextual action buttons.
 *
 * Props:
 *   question      — question object from API
 *   showActions   — whether to show action buttons (default true)
 *   onClaim       — callback when "תפוס" is clicked; receives question
 *   onRelease     — callback when "שחרר" is clicked; receives question
 *   onAnswer      — callback when "ענה" is clicked; receives question
 *   onDiscussion  — callback when "דיון" is clicked; receives question
 *   isNew         — if true, shows "חדש!" flash animation
 */
function QuestionCard({
  question,
  showActions = true,
  onClaim,
  onRelease,
  onAnswer,
  onDiscussion,
  isNew = false,
  className,
}) {
  const navigate = useNavigate();
  const { rabbi } = useAuth();
  const [flash, setFlash] = useState(isNew);

  // Clear the "new" flash after 4 seconds
  useEffect(() => {
    if (!isNew) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 4000);
    return () => clearTimeout(t);
  }, [isNew]);

  if (!question) return null;

  const {
    id,
    title,
    content,
    category,
    status,
    is_urgent,
    created_at,
    assigned_rabbi,
    assigned_rabbi_id,
    rabbi_name,
    answered_at,
    view_count = 0,
    thank_count = 0,
    private_notes,
    discussion_count = 0,
    attachment_url,
  } = question;

  // API may return flat fields (assigned_rabbi_id) or nested object (assigned_rabbi.id)
  const resolvedRabbiId = assigned_rabbi?.id ?? assigned_rabbi_id;
  const isMe = rabbi && resolvedRabbiId && String(resolvedRabbiId) === String(rabbi.id);
  const isPending = status === 'pending';
  const isInProcess = status === 'in_process';
  const isAnswered = status === 'answered';
  const isInProcessByOther = isInProcess && !isMe;

  const truncatedTitle = truncate(title || '', 80);

  const handleCardClick = (e) => {
    // Don't navigate when clicking buttons
    if (e.target.closest('button')) return;
    navigate(`/questions/${id}`);
  };

  const handleClaim = (e) => {
    e.stopPropagation();
    onClaim?.(question);
  };

  const handleRelease = (e) => {
    e.stopPropagation();
    onRelease?.(question);
  };

  const handleAnswer = (e) => {
    e.stopPropagation();
    onAnswer ? onAnswer(question) : navigate(`/questions/${id}`);
  };

  const handleDiscussion = (e) => {
    e.stopPropagation();
    onDiscussion ? onDiscussion(question) : navigate(`/questions/${id}`);
  };

  return (
    <div
      className={clsx(
        'relative group',
        flash && 'animate-pulse-once',
        className
      )}
    >
      {/* "חדש!" badge */}
      {flash && (
        <span className="absolute -top-2 -right-2 z-10 bg-red-500 text-white text-xs font-bold font-heebo px-2 py-0.5 rounded-full shadow animate-bounce">
          חדש!
        </span>
      )}

      <Card
        hoverable
        onClick={handleCardClick}
        className={clsx(
          'transition-all duration-200',
          'hover:border-brand-gold/60 hover:shadow-lg',
          flash && 'ring-2 ring-red-400 ring-offset-1',
          isInProcessByOther && 'opacity-75'
        )}
        bodyClassName="p-5"
      >
        {/* Top row: category + status + urgent flag */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {is_urgent && (
            <span
              className="flex items-center gap-1 text-xs font-bold text-red-600 font-heebo"
              title="שאלה דחופה"
              aria-label="שאלה דחופה"
            >
              <Flame size={14} className="text-red-500 fill-red-400" />
              דחוף
            </span>
          )}

          {category && (
            <span
              className={clsx(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-heebo',
                colorFromCategory(category)
              )}
            >
              {getCategoryLabel(category)}
            </span>
          )}

          <Badge
            status={status}
            withDot
            size="xs"
            className="mr-auto"
          />
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-[var(--text-primary)] font-heebo leading-snug mb-2 group-hover:text-brand-navy transition-colors">
          {truncatedTitle}
        </h3>

        {/* Attachment indicator — icon only, full image shown in detail page */}
        {attachment_url && (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-heebo mb-2">
            <Paperclip size={12} />
            קובץ מצורף
          </span>
        )}

        {/* Private notes snippet (only shown when rabbi owns it) */}
        {private_notes && isMe && (
          <div className="flex items-start gap-1.5 mb-2 p-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
            <Lock size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-heebo leading-snug line-clamp-2">
              {truncate(private_notes, 100)}
            </p>
          </div>
        )}

        {/* Meta row: date, views, thanks */}
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-heebo mt-3 flex-wrap">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatRelative(created_at)}
          </span>

          {isAnswered && (
            <>
              <span className="flex items-center gap-1">
                <Eye size={11} />
                {view_count} צפיות
              </span>
              <span className="flex items-center gap-1">
                <Heart size={11} />
                {thank_count} תודות
              </span>
            </>
          )}

          {discussion_count > 0 && (
            <span className="flex items-center gap-1 text-brand-navy/70 dark:text-dark-accent/70">
              <MessageSquare size={11} />
              {discussion_count} דיונים
            </span>
          )}

          {/* Answered by */}
          {isAnswered && assigned_rabbi && (
            <span className="flex items-center gap-1 mr-auto text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={11} />
              הרב {assigned_rabbi?.display_name || assigned_rabbi?.name || rabbi_name}
              {answered_at && ` · ${formatRelative(answered_at)}`}
            </span>
          )}

          {/* In process by other */}
          {isInProcessByOther && assigned_rabbi && (
            <span className="flex items-center gap-1 mr-auto text-blue-600 dark:text-blue-400">
              <User size={11} />
              נלקחה ע״י הרב {assigned_rabbi?.display_name || assigned_rabbi?.name || rabbi_name}
            </span>
          )}
        </div>

        {/* Action buttons */}
        {showActions && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            {/* Pending: ענה + תפוס */}
            {isPending && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Pencil size={13} />}
                  onClick={handleAnswer}
                >
                  ענה
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Flame size={13} />}
                  onClick={handleClaim}
                  className="bg-brand-gold hover:bg-brand-gold-dark text-white"
                >
                  תפוס
                </Button>
              </>
            )}

            {/* Mine: ענה + שחרר + דיון */}
            {isInProcess && isMe && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Pencil size={13} />}
                  onClick={handleAnswer}
                >
                  ענה
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRelease}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  שחרר
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<MessageSquare size={13} />}
                  onClick={handleDiscussion}
                >
                  דיון
                </Button>
              </>
            )}

            {isInProcessByOther && (
              <span className="text-xs text-[var(--text-muted)] font-heebo italic">
                נלקחה על ידי רב אחר
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export default QuestionCard;
