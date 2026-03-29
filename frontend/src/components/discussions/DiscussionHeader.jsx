import React, { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, UserPlus, LogOut, ExternalLink, Users, Lock, Unlock, Trash2, X, UserMinus } from 'lucide-react';
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
  onLeave,
  onDiscussionUpdate,
}) {
  const { rabbi } = useAuth();
  const { on } = useSocket();

  const [showAddMember, setShowAddMember] = useState(false);
  const [showMembersList, setShowMembersList] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [allRabbis, setAllRabbis] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState(null);
  const [leavingDiscussion, setLeavingDiscussion] = useState(false);
  const [lockingDiscussion, setLockingDiscussion] = useState(false);
  const [deletingDiscussion, setDeletingDiscussion] = useState(false);

  // Load all rabbis when add-member panel opens
  React.useEffect(() => {
    if (!showAddMember || allRabbis.length > 0) return;
    setAddLoading(true);
    api.get('/rabbis', { params: { limit: 200 } })
      .then(({ data }) => setAllRabbis(data.rabbis || data.data || data || []))
      .catch(() => {})
      .finally(() => setAddLoading(false));
  }, [showAddMember]);

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

  // Filter rabbis locally by search term
  const filteredRabbis = React.useMemo(() => {
    const term = addSearch.trim().toLowerCase();
    const list = allRabbis.filter(r => {
      if (!term) return true;
      return (r.name || r.full_name || '').toLowerCase().includes(term);
    });
    return list;
  }, [allRabbis, addSearch]);

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

  // ── Remove member ─────────────────────────────────────────────────────────

  const handleRemoveMember = useCallback(
    async (targetRabbiId) => {
      setRemovingMemberId(targetRabbiId);
      try {
        await api.delete(`/discussions/${discussionId}/members/${targetRabbiId}`);
        // Update local discussion members
        onDiscussionUpdate?.((prev) => ({
          ...prev,
          members: (prev?.members || []).filter((m) => m.id !== targetRabbiId),
          member_count: Math.max(0, (prev?.member_count || 1) - 1),
        }));
        setConfirmRemoveMember(null);
      } catch {
        // ignore — TODO: show toast
      } finally {
        setRemovingMemberId(null);
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
      onLeave?.(discussionId);
      onBack?.();
    } catch {
      setLeavingDiscussion(false);
    }
  }, [discussionId, onBack, onLeave]);

  // ── Lock discussion ──────────────────────────────────────────────────────

  const handleToggleLock = useCallback(async () => {
    const isLocked = discussion?.locked;
    const msg = isLocked ? 'האם לפתוח את הדיון?' : 'האם לנעול את הדיון? לא ניתן יהיה לשלוח הודעות.';
    if (!window.confirm(msg)) return;
    setLockingDiscussion(true);
    try {
      await api.patch(`/discussions/${discussionId}/lock`, { locked: !isLocked });
      onDiscussionUpdate?.((prev) => ({ ...prev, locked: !isLocked }));
    } catch {
      // ignore
    } finally {
      setLockingDiscussion(false);
    }
  }, [discussionId, discussion?.locked, onDiscussionUpdate]);

  // ── Delete discussion (admin only) ──────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק את הדיון לצמיתות? פעולה זו בלתי הפיכה.')) return;
    setDeletingDiscussion(true);
    try {
      await api.delete(`/discussions/${discussionId}/permanent`);
      onLeave?.(discussionId);
      onBack?.();
    } catch {
      setDeletingDiscussion(false);
    }
  }, [discussionId, onBack, onLeave]);

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

      {/* Member avatars (with online dots) — clickable to open members panel */}
      {avatarList.length > 0 && (
        <div className="hidden sm:flex flex-shrink-0 relative">
          <button
            type="button"
            onClick={() => setShowMembersList((v) => !v)}
            className="flex flex-row-reverse -space-x-2 space-x-reverse hover:opacity-80 transition-opacity"
            aria-label="ניהול משתתפים"
          >
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
          </button>

          {/* Members management dropdown */}
          {showMembersList && (
            <div
              className="
                absolute left-0 top-full mt-1 z-30
                w-64 bg-[var(--bg-surface)] border border-[var(--border-default)]
                rounded-lg shadow-lg overflow-hidden
              "
              dir="rtl"
            >
              <div className="px-3 py-2 border-b border-[var(--border-default)] flex items-center justify-between">
                <span className="text-sm font-bold font-heebo text-[var(--text-primary)]">
                  משתתפים ({memberCount})
                </span>
                <button
                  type="button"
                  onClick={() => setShowMembersList(false)}
                  className="p-0.5 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)]"
                >
                  <X size={14} />
                </button>
              </div>
              <ul className="max-h-60 overflow-y-auto">
                {members.map((m) => {
                  const isCreator = String(m.id) === String(discussion?.created_by);
                  const canRemove =
                    !isCreator &&
                    (String(discussion?.created_by) === String(rabbi?.id) || rabbi?.role === 'admin');
                  const isSelf = String(m.id) === String(rabbi?.id);

                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)] last:border-b-0"
                    >
                      <Avatar
                        src={m.avatar_url || m.profile_photo}
                        name={m.name || m.full_name || 'רב'}
                        size="xs"
                        online={onlineIds.has(m.id)}
                      />
                      <span className="flex-1 text-sm font-heebo text-[var(--text-primary)] truncate">
                        {m.name || m.full_name || 'רב'}
                        {isCreator && (
                          <span className="text-xs text-[var(--text-muted)] mr-1">(יוצר)</span>
                        )}
                        {isSelf && (
                          <span className="text-xs text-[var(--text-muted)] mr-1">(אני)</span>
                        )}
                      </span>
                      {canRemove && (
                        <Tooltip content="הסר מהדיון" placement="left">
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveMember(m)}
                            disabled={removingMemberId === m.id}
                            className="
                              p-1 rounded text-[var(--text-muted)]
                              hover:text-red-500 hover:bg-red-50
                              transition-colors duration-150
                              disabled:opacity-50
                            "
                            aria-label={`הסר ${m.name || 'משתתף'} מהדיון`}
                          >
                            {removingMemberId === m.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin inline-block" />
                            ) : (
                              <UserMinus size={14} />
                            )}
                          </button>
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Confirm remove member modal */}
      {confirmRemoveMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
          <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold font-heebo text-[var(--text-primary)] mb-3">
              הסרת משתתף
            </h3>
            <p className="text-sm text-[var(--text-primary)] font-heebo mb-5">
              האם להסיר את {confirmRemoveMember.name || confirmRemoveMember.full_name || 'המשתתף'} מהדיון?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmRemoveMember(null)}
                className="px-4 py-2 rounded-lg text-sm font-heebo border border-[var(--border-default)] hover:bg-[var(--bg-muted)]"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => handleRemoveMember(confirmRemoveMember.id)}
                disabled={removingMemberId === confirmRemoveMember.id}
                className="px-4 py-2 rounded-lg text-sm font-heebo font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {removingMemberId === confirmRemoveMember.id ? 'מסיר...' : 'הסר'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Add member (creator or admin only) */}
        {(String(discussion?.created_by) === String(rabbi?.id) || rabbi?.role === 'admin') && (
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

          {/* Members toggle board */}
          {showAddMember && (
            <div
              className="
                absolute left-0 top-full mt-1 z-30
                w-72 bg-[var(--bg-surface)] border border-[var(--border-default)]
                rounded-lg shadow-lg overflow-hidden
              "
              dir="rtl"
            >
              <div className="px-3 py-2 border-b border-[var(--border-default)] bg-[var(--bg-muted)]">
                <p className="text-xs font-bold font-heebo text-[var(--text-primary)] mb-1.5">ניהול משתתפים</p>
                <input
                  type="search"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder="חיפוש רב..."
                  autoFocus
                  dir="rtl"
                  className="
                    w-full px-2.5 py-1.5 text-sm font-heebo rounded-md
                    bg-[var(--bg-surface)] border border-[var(--border-default)]
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

              {!addLoading && filteredRabbis.length > 0 && (
                <ul className="max-h-64 overflow-y-auto divide-y divide-[var(--border-default)]">
                  {filteredRabbis.map((r) => {
                    const isMember = members.some((m) => m.id === r.id);
                    const isDiscussionCreator = String(r.id) === String(discussion?.created_by);
                    return (
                      <li key={r.id}>
                        <label
                          className={clsx(
                            'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-heebo text-right',
                            'transition-colors duration-100',
                            isDiscussionCreator ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--bg-muted)]',
                            isMember && 'bg-[#1B2B5E]/5'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isMember}
                            disabled={isDiscussionCreator}
                            onChange={() => {
                              if (isMember && !isDiscussionCreator) {
                                handleRemoveMember(r.id);
                              } else if (!isMember) {
                                handleAddMember(r);
                              }
                            }}
                            className="rounded border-[var(--border-default)] text-[#1B2B5E] focus:ring-[#1B2B5E]/20 w-4 h-4 flex-shrink-0"
                          />
                          <Avatar
                            src={r.avatar_url}
                            name={r.name || r.full_name}
                            size="xs"
                          />
                          <span className="truncate text-[var(--text-primary)] flex-1">
                            {r.name || r.full_name}
                          </span>
                          {isDiscussionCreator && (
                            <span className="text-[10px] text-[#B8973A] font-medium mr-auto">יוצר</span>
                          )}
                          {onlineIds.has(r.id) && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!addLoading && filteredRabbis.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] font-heebo px-3 py-3 text-center">
                  לא נמצאו רבנים
                </p>
              )}

              <div className="px-3 py-2 border-t border-[var(--border-default)] bg-[var(--bg-muted)]">
                <p className="text-[10px] text-[var(--text-muted)] font-heebo text-center">
                  {members.length} משתתפים בדיון
                </p>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Lock discussion (creator or admin) */}
        {(String(discussion?.created_by) === String(rabbi?.id) || rabbi?.role === 'admin') && (
          <Tooltip content={discussion?.locked ? 'בטל נעילה' : 'נעל דיון'} placement="bottom">
            <button
              onClick={handleToggleLock}
              disabled={lockingDiscussion}
              aria-label={discussion?.locked ? 'בטל נעילה' : 'נעל דיון'}
              className="
                p-2 rounded-md text-[var(--text-muted)]
                hover:text-[#1B2B5E] hover:bg-[var(--bg-muted)]
                transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-[#B8973A]
                disabled:opacity-50
              "
            >
              {discussion?.locked ? <Unlock size={17} /> : <Lock size={17} />}
            </button>
          </Tooltip>
        )}

        {/* Delete discussion (creator or admin) */}
        {(String(discussion?.created_by) === String(rabbi?.id) || rabbi?.role === 'admin') && (
          <Tooltip content="מחק דיון" placement="bottom">
            <button
              onClick={handleDelete}
              disabled={deletingDiscussion}
              aria-label="מחק דיון"
              className="
                p-2 rounded-md text-[var(--text-muted)]
                hover:text-red-500 hover:bg-red-50
                transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-red-400
                disabled:opacity-50
              "
            >
              <Trash2 size={17} />
            </button>
          </Tooltip>
        )}

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

      {/* Click-away for members list dropdown */}
      {showMembersList && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setShowMembersList(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
