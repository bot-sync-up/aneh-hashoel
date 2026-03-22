import React, { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, UserPlus, LogOut, ExternalLink, Users } from 'lucide-react';
import api from '../../lib/api';
import Avatar, { AvatarGroup } from '../ui/Avatar';
import Tooltip from '../ui/Tooltip';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Top bar of DiscussionChat.
 *
 * Props:
 *   discussion           — discussion object (may be null while loading)
 *   discussionId         — string
 *   onBack()             — mobile: back to list
 *   onDiscussionUpdate() — update parent discussion state
 */
export default function DiscussionHeader({
  discussion,
  discussionId,
  onBack,
  onDiscussionUpdate,
}) {
  const { rabbi } = useAuth();
  const { on } = useSocket();

  const [showAddMember, setShowAddMember] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [leavingDiscussion, setLeavingDiscussion] = useState(false);

  // Online member IDs tracked via socket presence
  const [onlineIds, setOnlineIds] = useState(() => new Set());

  // Subscribe to presence events
  React.useEffect(() => {
    const unsub = on('presence:online', ({ rabbiId }) => {
      setOnlineIds((prev) => new Set([...prev, rabbiId]));
    });
    const unsub2 = on('presence:offline', ({ rabbiId }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.delete(rabbiId);
        return next;
      });
    });
    const unsub3 = on('presence:snapshot', ({ onlineIds: ids }) => {
      setOnlineIds(new Set(ids));
    });
    return () => {
      unsub();
      unsub2();
      unsub3();
    };
  }, [on]);

  // ── Add member search ──────────────────────────────────────────────────────

  const handleAddSearch = useCallback(async (query) => {
    setAddSearch(query);
    if (!query.trim()) {
      setAddResults([]);
      return;
    }
    setAddLoading(true);
    try {
      const { data } = await api.get('/rabbis', {
        params: { search: query, limit: 8 },
      });
      setAddResults(data.rabbis || data.data || data || []);
    } catch {
      setAddResults([]);
    } finally {
      setAddLoading(false);
    }
  }, []);

  const handleAddMember = useCallback(
    async (targetRabbi) => {
      try {
        await api.post(`/discussions/${discussionId}/members`, {
          rabbiIds: [targetRabbi.id],
        });
        // Update local discussion members
        onDiscussionUpdate?.((prev) => ({
          ...prev,
          members: [...(prev?.members || []), targetRabbi],
          member_count: (prev?.member_count || 0) + 1,
        }));
        setAddResults([]);
        setAddSearch('');
        setShowAddMember(false);
      } catch {
        // ignore — TODO: show toast
      }
    },
    [discussionId, onDiscussionUpdate]
  );

  // ── Leave discussion ───────────────────────────────────────────────────────

  const handleLeave = useCallback(async () => {
    if (!window.confirm('האם אתה בטוח שברצונך לצאת מהדיון?')) return;
    setLeavingDiscussion(true);
    try {
      await api.post(`/discussions/${discussionId}/leave`);
      onBack?.();
    } catch {
      setLeavingDiscussion(false);
    }
  }, [discussionId, onBack]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const members = discussion?.members || [];
  const memberCount = discussion?.member_count ?? members.length;
  const questionLink = discussion?.question;

  // Build avatar list for AvatarGroup
  const avatarList = members.slice(0, 5).map((m) => ({
    id: m.id,
    name: m.name || m.full_name || 'רב',
    src: m.avatar_url || m.profile_photo,
  }));

  return (
    <div
      className="
        flex items-center gap-2 px-3 py-2.5
        border-b border-[var(--border-default)]
        bg-[var(--bg-surface)]
        flex-shrink-0
      "
      dir="rtl"
    >
      {/* Mobile back button */}
      {onBack && (
        <button
          onClick={onBack}
          aria-label="חזור לרשימה"
          className="
            md:hidden p-1.5 rounded-md
            text-[var(--text-muted)] hover:text-[var(--text-primary)]
            hover:bg-[var(--bg-muted)] transition-colors
          "
        >
          <ChevronRight size={20} />
        </button>
      )}

      {/* Discussion icon / avatar */}
      <div
        className="
          w-9 h-9 rounded-full bg-[#1B2B5E]
          flex items-center justify-center
          text-white text-sm font-semibold font-heebo
          flex-shrink-0 select-none
        "
        aria-hidden="true"
      >
        {(discussion?.title || '').slice(0, 2) || '??'}
      </div>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate leading-tight">
          {discussion?.title || 'דיון'}
        </h2>
        <div className="flex items-center gap-2 mt-0.5">
          {/* Member count */}
          <span className="text-xs text-[var(--text-muted)] font-heebo flex items-center gap-1">
            <Users size={11} />
            {memberCount > 0 ? `${memberCount} משתתפים` : 'טוען...'}
          </span>

          {/* Question badge */}
          {questionLink && (
            <a
              href={`/questions/${questionLink.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center gap-1 px-1.5 py-0.5 rounded
                bg-[#B8973A]/15 text-[#B8973A] text-[10px] font-heebo font-medium
                hover:bg-[#B8973A]/25 transition-colors
              "
              title={questionLink.title || questionLink.subject}
            >
              <ExternalLink size={10} />
              <span className="max-w-[120px] truncate">
                {questionLink.title || questionLink.subject || 'שאלה'}
              </span>
            </a>
          )}
        </div>
      </div>

      {/* Member avatars (with online dots) */}
      {avatarList.length > 0 && (
        <div className="hidden sm:flex flex-shrink-0">
          <div className="flex flex-row-reverse -space-x-2 space-x-reverse">
            {avatarList.map((av, i) => (
              <Tooltip key={av.id} content={av.name} placement="bottom">
                <div className="relative" style={{ zIndex: avatarList.length - i }}>
                  <Avatar
                    src={av.src}
                    name={av.name}
                    size="xs"
                    showBorder
                    online={onlineIds.has(av.id)}
                  />
                </div>
              </Tooltip>
            ))}
            {memberCount > 5 && (
              <span
                className="
                  w-6 h-6 rounded-full flex items-center justify-center
                  bg-[var(--bg-muted)] text-[var(--text-secondary)]
                  text-[10px] font-medium font-heebo
                  border-2 border-white
                "
              >
                +{memberCount - 5}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Add member */}
        <div className="relative">
          <Tooltip content="הוסף משתתף" placement="bottom">
            <button
              onClick={() => setShowAddMember((v) => !v)}
              aria-label="הוסף משתתף"
              className="
                p-2 rounded-md text-[var(--text-muted)]
                hover:text-[#1B2B5E] hover:bg-[var(--bg-muted)]
                transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-[#B8973A]
              "
            >
              <UserPlus size={17} />
            </button>
          </Tooltip>

          {/* Add member dropdown */}
          {showAddMember && (
            <div
              className="
                absolute left-0 top-full mt-1 z-30
                w-56 bg-[var(--bg-surface)] border border-[var(--border-default)]
                rounded-lg shadow-lg overflow-hidden
              "
              dir="rtl"
            >
              <div className="p-2 border-b border-[var(--border-default)]">
                <input
                  type="search"
                  value={addSearch}
                  onChange={(e) => handleAddSearch(e.target.value)}
                  placeholder="חיפוש רב..."
                  autoFocus
                  dir="rtl"
                  className="
                    w-full px-2.5 py-1.5 text-sm font-heebo rounded-md
                    bg-[var(--bg-muted)] border border-transparent
                    focus:outline-none focus:border-[#1B2B5E]
                    text-right direction-rtl
                  "
                />
              </div>

              {addLoading && (
                <div className="flex justify-center py-3">
                  <span className="w-4 h-4 border-2 border-[#1B2B5E]/30 border-t-[#1B2B5E] rounded-full animate-spin" />
                </div>
              )}

              {!addLoading && addResults.length > 0 && (
                <ul className="max-h-36 overflow-y-auto">
                  {addResults.map((r) => {
                    const alreadyMember = members.some((m) => m.id === r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={alreadyMember}
                          onClick={() => handleAddMember(r)}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-2 text-sm font-heebo text-right',
                            'hover:bg-[var(--bg-muted)] transition-colors duration-100',
                            alreadyMember && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <Avatar
                            src={r.avatar_url}
                            name={r.name || r.full_name}
                            size="xs"
                          />
                          <span className="truncate text-[var(--text-primary)]">
                            {r.name || r.full_name}
                          </span>
                          {alreadyMember && (
                            <span className="text-xs text-[var(--text-muted)] mr-auto">
                              משתתף
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!addLoading && addSearch && addResults.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] font-heebo px-3 py-2">
                  לא נמצאו רבנים
                </p>
              )}
            </div>
          )}
        </div>

        {/* Leave discussion */}
        <Tooltip content="צא מהדיון" placement="bottom">
          <button
            onClick={handleLeave}
            disabled={leavingDiscussion}
            aria-label="צא מהדיון"
            className="
              p-2 rounded-md text-[var(--text-muted)]
              hover:text-red-500 hover:bg-red-50
              transition-colors duration-150
              focus-visible:ring-2 focus-visible:ring-red-400
              disabled:opacity-50
            "
          >
            {leavingDiscussion ? (
              <span className="w-4 h-4 border-2 border-red-300 border-t-red-500 rounded-full animate-spin inline-block" />
            ) : (
              <LogOut size={17} />
            )}
          </button>
        </Tooltip>
      </div>

      {/* Click-away for add member dropdown */}
      {showAddMember && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setShowAddMember(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
