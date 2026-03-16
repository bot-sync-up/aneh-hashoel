import React, { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { formatRelative, stripHtml, truncate } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';

/**
 * Left/Right panel: searchable list of discussions.
 * Props:
 *   discussions  — array from GET /api/discussions
 *   activeId     — currently open discussion id
 *   onSelect(id) — callback when user clicks a discussion
 */
export default function DiscussionList({ discussions = [], activeId, onSelect }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return discussions;
    const q = debouncedSearch.trim().toLowerCase();
    return discussions.filter(
      (d) =>
        d.title?.toLowerCase().includes(q) ||
        (d.last_message?.content && stripHtml(d.last_message.content).toLowerCase().includes(q))
    );
  }, [discussions, debouncedSearch]);

  return (
    <div className="flex flex-col flex-1 min-h-0" dir="rtl">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-[var(--border-default)] flex-shrink-0">
        <div className="relative">
          <Search
            size={15}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש דיונים..."
            className="
              w-full pr-8 pl-3 py-2 text-sm rounded-md
              bg-[var(--bg-muted)] border border-transparent
              text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
              focus:outline-none focus:border-[#1B2B5E] focus:ring-1 focus:ring-[#1B2B5E]/20
              font-heebo direction-rtl text-right
              transition-colors duration-150
            "
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--text-muted)] text-sm gap-1">
            {search ? (
              <p>לא נמצאו דיונים עבור "{search}"</p>
            ) : (
              <p>אין דיונים עדיין</p>
            )}
          </div>
        ) : (
          <ul role="listbox" aria-label="רשימת דיונים">
            {filtered.map((discussion) => (
              <DiscussionItem
                key={discussion.id}
                discussion={discussion}
                isActive={discussion.id === activeId}
                onClick={() => onSelect(discussion.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DiscussionItem({ discussion, isActive, onClick }) {
  const hasUnread = (discussion.unread_count || 0) > 0;

  // Strip HTML from last message preview
  const preview = discussion.last_message
    ? truncate(stripHtml(discussion.last_message.content || ''), 40)
    : 'אין הודעות עדיין';

  const timeLabel = discussion.last_message?.created_at
    ? formatRelative(discussion.last_message.created_at, false)
    : discussion.created_at
    ? formatRelative(discussion.created_at, false)
    : '';

  return (
    <li>
      <button
        role="option"
        aria-selected={isActive}
        onClick={onClick}
        className={clsx(
          'w-full text-right px-4 py-3 flex items-start gap-3',
          'border-b border-[var(--border-default)]',
          'transition-colors duration-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#B8973A]',
          isActive
            ? 'bg-[#1B2B5E]/5 border-r-[3px] border-r-[#1B2B5E]'
            : 'hover:bg-[var(--bg-muted)]'
        )}
      >
        {/* Avatar / initials */}
        <div
          className="
            flex-shrink-0 w-10 h-10 rounded-full
            bg-[#1B2B5E] text-white
            flex items-center justify-center
            text-sm font-semibold font-heebo
            select-none
          "
          aria-hidden="true"
        >
          {(discussion.title || '').slice(0, 2)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={clsx(
                'text-sm truncate font-heebo',
                hasUnread
                  ? 'font-bold text-[var(--text-primary)]'
                  : 'font-medium text-[var(--text-primary)]'
              )}
            >
              {discussion.title || 'דיון ללא שם'}
            </span>
            {timeLabel && (
              <span className="text-xs text-[var(--text-muted)] flex-shrink-0 font-heebo">
                {timeLabel}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--text-muted)] truncate font-heebo">
              {preview}
            </span>
            {hasUnread && (
              <span
                className="
                  flex-shrink-0 min-w-[20px] h-5 px-1.5
                  bg-[#1B2B5E] text-white
                  text-[10px] font-bold font-heebo
                  rounded-full flex items-center justify-center
                "
                aria-label={`${discussion.unread_count} הודעות שלא נקראו`}
              >
                {discussion.unread_count > 99 ? '99+' : discussion.unread_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
