import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  X,
  Calendar,
  Users,
  Eye,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { get } from '../../lib/api';

export default function NewsletterArchivePage() {
  const [newsletters, setNewsletters] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state for viewing full newsletter
  const [viewingNewsletter, setViewingNewsletter] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadArchive = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await get('/admin/newsletter/archive', { page, limit: 20 });
      setNewsletters(data.newsletters || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      setError('שגיאה בטעינת ארכיון הניוזלטרים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  const handleView = async (id) => {
    setViewLoading(true);
    try {
      const data = await get(`/admin/newsletter/archive/${id}`);
      setViewingNewsletter(data.newsletter);
    } catch (err) {
      setError('שגיאה בטעינת הניוזלטר');
    } finally {
      setViewLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '---';
    return new Date(dateStr).toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && newsletters.length === 0) {
    return (
      <div className="space-y-4 max-w-4xl">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
            <div className="skeleton h-4 w-60 rounded mb-3" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
            ארכיון ניוזלטרים
          </h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            {pagination.total > 0
              ? `${pagination.total} ניוזלטרים נשלחו`
              : 'טרם נשלחו ניוזלטרים'}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => loadArchive(pagination.page)}
          leftIcon={<RefreshCw size={15} />}
        >
          רענן
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
          {error}
        </div>
      )}

      {/* Newsletter list */}
      {newsletters.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <Archive size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-muted)] font-heebo">
            עדיין אין ניוזלטרים בארכיון.
          </p>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-1">
            ניוזלטרים יישמרו אוטומטית לאחר שליחה.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
            <div className="w-8 h-8 rounded-lg bg-[#1B2B5E]/10 flex items-center justify-center">
              <Archive size={16} className="text-[#1B2B5E]" />
            </div>
            <h3 className="font-bold text-[var(--text-primary)] font-heebo text-sm">
              ניוזלטרים שנשלחו
            </h3>
          </div>

          <div className="divide-y divide-[var(--border-default)]">
            {newsletters.map((nl) => (
              <button
                key={nl.id}
                onClick={() => handleView(nl.id)}
                className="w-full flex items-center gap-4 px-6 py-4 text-right hover:bg-[var(--bg-surface-raised)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] font-heebo truncate">
                    {nl.title}
                  </p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-heebo">
                      <Calendar size={12} />
                      {formatDate(nl.sent_at)}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-heebo">
                      <Users size={12} />
                      {nl.recipient_count || 0} נמענים
                    </span>
                  </div>
                </div>
                <Eye size={16} className="text-[var(--text-muted)] flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => loadArchive(pagination.page - 1)}
            leftIcon={<ChevronRight size={14} />}
          >
            הקודם
          </Button>
          <span className="text-sm text-[var(--text-muted)] font-heebo">
            עמוד {pagination.page} מתוך {pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => loadArchive(pagination.page + 1)}
            leftIcon={<ChevronLeft size={14} />}
          >
            הבא
          </Button>
        </div>
      )}

      {/* View newsletter modal */}
      {(viewingNewsletter || viewLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-surface)] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
              <div className="min-w-0">
                <h3 className="font-bold text-[var(--text-primary)] font-heebo text-base truncate">
                  {viewingNewsletter?.title || 'טוען...'}
                </h3>
                {viewingNewsletter && (
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs text-[var(--text-muted)] font-heebo">
                      {formatDate(viewingNewsletter.sent_at)}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] font-heebo">
                      {viewingNewsletter.recipient_count || 0} נמענים
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setViewingNewsletter(null)}
                className="p-2 rounded-lg hover:bg-[var(--bg-surface-raised)] transition-colors"
              >
                <X size={18} className="text-[var(--text-muted)]" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6">
              {viewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-2 border-[#B8973A] border-t-transparent rounded-full" />
                </div>
              ) : viewingNewsletter?.content_html ? (
                <div
                  className="newsletter-preview"
                  dangerouslySetInnerHTML={{ __html: viewingNewsletter.content_html }}
                />
              ) : (
                <p className="text-sm text-[var(--text-muted)] font-heebo text-center py-8">
                  אין תוכן להצגה
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
