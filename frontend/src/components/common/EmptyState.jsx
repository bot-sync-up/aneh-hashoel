import React from 'react';
import { clsx } from 'clsx';
import {
  MessageSquare,
  Bell,
  MessagesSquare,
  FileText,
  Inbox,
} from 'lucide-react';
import Button from '../ui/Button';

/**
 * Pre-defined empty-state configurations.
 * Each key maps to a preset { icon, title, description }.
 */
const PRESETS = {
  'no-questions': {
    Icon: MessageSquare,
    title: 'אין שאלות להצגה',
    description: 'כאשר תתקבלנה שאלות חדשות הן יופיעו כאן.',
  },
  'no-notifications': {
    Icon: Bell,
    title: 'אין התראות',
    description: 'עדיין לא קיבלת התראות. בינתיים הכל שקט.',
  },
  'no-discussions': {
    Icon: MessagesSquare,
    title: 'אין דיונים פעילים',
    description: 'עדיין לא נפתחו דיונים. לחץ על שאלה כדי לפתוח דיון.',
  },
  'no-templates': {
    Icon: FileText,
    title: 'אין תבניות שמורות',
    description: 'צור תבנית ראשונה שתעזור לך לענות מהר יותר בעתיד.',
  },
};

/**
 * EmptyState (common) — reusable empty-state component.
 *
 * Can be used with a named preset OR with explicit props.
 *
 * @param {string}   [preset]          — one of the PRESETS keys (overrides icon/title/description)
 * @param {React.ElementType|React.ReactNode} [icon] — lucide component or custom ReactNode
 * @param {string}   [title]           — heading text
 * @param {string}   [description]     — body text
 * @param {{ label: string, onClick: () => void }} [action] — primary action button config
 * @param {string}   [className]       — extra wrapper classes
 */
export default function EmptyState({
  preset,
  icon,
  title,
  description,
  action,
  className,
}) {
  // Resolve props from preset, then explicit props override
  const resolved = preset ? PRESETS[preset] || {} : {};

  const ResolvedIcon = icon ?? resolved.Icon ?? Inbox;
  const resolvedTitle = title ?? resolved.title ?? 'אין נתונים להצגה';
  const resolvedDescription = description ?? resolved.description ?? null;

  // Determine whether the icon is a component (function) or a ReactNode
  const isComponent =
    typeof ResolvedIcon === 'function' ||
    (typeof ResolvedIcon === 'object' &&
      ResolvedIcon !== null &&
      '$$typeof' in ResolvedIcon === false &&
      typeof ResolvedIcon.render === 'function');

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        'py-16 px-6',
        'animate-fade-in',
        className
      )}
      dir="rtl"
    >
      {/* Icon circle */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
        style={{ backgroundColor: 'var(--bg-muted)' }}
      >
        {isComponent ? (
          <ResolvedIcon
            size={28}
            strokeWidth={1.5}
            style={{ color: 'var(--text-muted)' }}
          />
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{ResolvedIcon}</span>
        )}
      </div>

      {/* Title */}
      <h3
        className="text-lg font-semibold font-heebo mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {resolvedTitle}
      </h3>

      {/* Description */}
      {resolvedDescription && (
        <p
          className="text-sm font-heebo max-w-xs leading-relaxed mb-6"
          style={{ color: 'var(--text-muted)' }}
        >
          {resolvedDescription}
        </p>
      )}

      {/* Optional action button */}
      {action?.label && action?.onClick && (
        <Button variant="primary" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
