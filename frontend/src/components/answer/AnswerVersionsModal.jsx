import React, { useState, useEffect } from 'react';
import { History, X, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import Button from '../ui/Button';
import { BlockSpinner } from '../ui/Spinner';
import { get } from '../../lib/api';

/**
 * AnswerVersionsModal
 *
 * Shows the version history of an answer in a modal overlay.
 * Each version displays the timestamp and content, with a simple
 * visual diff indicator (version number + date).
 *
 * Props:
 *   answerId    – the answer row ID
 *   onClose     – callback to close the modal
 */
export default function AnswerVersionsModal({ answerId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [expandedVersion, setExpandedVersion] = useState(null);

  useEffect(() => {
    if (!answerId) return;
    setLoading(true);
    setError(null);

    get(`/questions/answer/${answerId}/versions`)
      .then((res) => {
        setData(res);
        // Auto-expand latest version
        if (res.versions?.length > 0) {
          setExpandedVersion(res.versions.length - 1);
        }
      })
      .catch((err) => {
        setError(err?.response?.data?.error || err.message || 'שגיאה בטעינת היסטוריית גרסאות');
      })
      .finally(() => setLoading(false));
  }, [answerId]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('he-IL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const versions = data?.versions || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-surface)] rounded-card shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-default)] flex-shrink-0">
          <h2 className="font-semibold text-[var(--text-primary)] font-heebo flex items-center gap-2">
            <History size={16} className="text-brand-navy" />
            היסטוריית גרסאות תשובה
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none px-2"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 flex-1">
          {loading && (
            <div className="py-8">
              <BlockSpinner label="טוען היסטוריה..." />
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 font-heebo">{error}</p>
            </div>
          )}

          {!loading && !error && versions.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-[var(--text-muted)] font-heebo">
                אין היסטוריית גרסאות עבור תשובה זו.
              </p>
            </div>
          )}

          {!loading && !error && versions.length > 0 && (
            <div className="space-y-2">
              {/* Show versions in reverse chronological order */}
              {[...versions].reverse().map((version, reverseIdx) => {
                const originalIdx = versions.length - 1 - reverseIdx;
                const isExpanded = expandedVersion === originalIdx;
                const isLatest = originalIdx === versions.length - 1;

                return (
                  <div
                    key={originalIdx}
                    className="border border-[var(--border-default)] rounded-lg overflow-hidden"
                  >
                    {/* Version header — clickable */}
                    <button
                      type="button"
                      onClick={() => setExpandedVersion(isExpanded ? null : originalIdx)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-right"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`
                          inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold font-heebo
                          ${isLatest
                            ? 'bg-brand-navy text-white'
                            : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'}
                        `}>
                          {version.version}
                        </span>
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium text-[var(--text-primary)] font-heebo">
                            {isLatest ? 'גרסה אחרונה (לפני עריכה נוכחית)' : `גרסה ${version.version}`}
                          </span>
                          <span className="text-xs text-[var(--text-muted)] font-heebo flex items-center gap-1">
                            <Clock size={11} />
                            {formatDate(version.edited_at)}
                          </span>
                        </div>
                      </div>
                      {isExpanded
                        ? <ChevronUp size={16} className="text-[var(--text-muted)]" />
                        : <ChevronDown size={16} className="text-[var(--text-muted)]" />
                      }
                    </button>

                    {/* Version content — collapsible */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-[var(--border-default)]">
                        <div
                          className="prose prose-sm max-w-none text-[var(--text-primary)] font-heebo leading-relaxed mt-3"
                          dangerouslySetInnerHTML={{ __html: version.content }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Info about current version */}
              {data?.lastEditedAt && (
                <p className="text-xs text-[var(--text-muted)] font-heebo text-center mt-4">
                  עריכה אחרונה: {formatDate(data.lastEditedAt)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-[var(--border-default)] flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            סגור
          </Button>
        </div>
      </div>
    </div>
  );
}
