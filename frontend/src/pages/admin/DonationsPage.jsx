import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Heart, TrendingUp, DollarSign, Calendar,
  ChevronRight, ChevronLeft, RefreshCw,
} from 'lucide-react';
import { get } from '../../lib/api';
import { formatDateTime } from '../../lib/utils';
import { BlockSpinner } from '../../components/ui/Spinner';

const PAGE_SIZE = 50;

// ── Stats Card ───────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = '#B8973A' }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 flex items-start gap-4">
      <div
        className="flex items-center justify-center w-11 h-11 rounded-lg shrink-0"
        style={{ backgroundColor: `${color}18` }}
      >
        <Icon size={22} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-muted)] font-heebo mb-1">{label}</p>
        <p className="text-2xl font-bold text-[var(--text-primary)] font-heebo leading-none">
          {value}
        </p>
        {sub && (
          <p className="text-xs text-[var(--text-muted)] mt-1 font-heebo">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ── Donation Row ─────────────────────────────────────────────────────────────

function DonationRow({ donation }) {
  const amountStr = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: donation.currency || 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(donation.amount);

  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3',
        'bg-[var(--bg-surface)] border-[var(--border-default)]',
        'hover:shadow-soft transition-shadow'
      )}
    >
      {/* Amount + date */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-[var(--text-primary)] font-heebo">
            {amountStr}
          </span>
          <span className="text-xs text-[var(--text-muted)] font-heebo">
            {donation.created_at ? formatDateTime(donation.created_at) : ''}
          </span>
        </div>

        {/* Donor info */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
          {donation.donor_name && (
            <span className="text-sm text-[var(--text-secondary)] font-heebo">
              {donation.donor_name}
            </span>
          )}
          {donation.donor_email && (
            <span className="text-xs text-[var(--text-muted)] font-heebo">
              {donation.donor_email}
            </span>
          )}
        </div>
      </div>

      {/* Linked context */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-heebo shrink-0">
        {donation.rabbi_name && (
          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {donation.rabbi_name}
          </span>
        )}
        {donation.question_title && (
          <span
            className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 max-w-[200px] truncate"
            title={donation.question_title}
          >
            {donation.question_title}
          </span>
        )}
        {donation.payment_method && (
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {donation.payment_method}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function DonationsPage() {
  const [stats,    setStats]    = useState(null);
  const [recent,   setRecent]   = useState([]);
  const [allDonations, setAllDonations] = useState([]);
  const [page,     setPage]     = useState(1);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showAll,  setShowAll]  = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        get('/admin/donations/stats'),
        get('/admin/donations/recent'),
      ]);
      setStats(statsRes.data);
      setRecent(recentRes.data);
    } catch (err) {
      console.error('Failed to load donations:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAll = async (p = 1) => {
    try {
      const res = await get('/admin/donations', { page: p, limit: PAGE_SIZE });
      setAllDonations(res.data);
      setTotal(res.pagination.total);
      setPage(p);
    } catch (err) {
      console.error('Failed to load donations list:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (showAll) fetchAll(page);
  }, [showAll]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fmtAmount = (n) =>
    new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
    }).format(n || 0);

  if (loading) return <BlockSpinner label="טוען תרומות..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
          תרומות
        </h2>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition font-heebo"
        >
          <RefreshCw size={14} />
          רענון
        </button>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Heart}
            label="סה״כ החודש"
            value={fmtAmount(stats.totalThisMonth)}
            sub={`${stats.countThisMonth} תרומות`}
            color="#B8973A"
          />
          <StatCard
            icon={TrendingUp}
            label="סה״כ כללי"
            value={fmtAmount(stats.totalAllTime)}
            sub={`${stats.countAllTime} תרומות`}
            color="#1B2B5E"
          />
          <StatCard
            icon={DollarSign}
            label="ממוצע לתרומה"
            value={fmtAmount(stats.averageDonation)}
            color="#16a34a"
          />
          <StatCard
            icon={Calendar}
            label="תרומות החודש"
            value={String(stats.countThisMonth)}
            color="#7c3aed"
          />
        </div>
      )}

      {/* Recent Donations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
            תרומות אחרונות
          </h3>
          {!showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-sm text-[#B8973A] hover:underline font-heebo"
            >
              הצג הכל
            </button>
          )}
        </div>

        {!showAll ? (
          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] font-heebo text-center py-8">
                אין תרומות עדיין
              </p>
            ) : (
              recent.map((d) => <DonationRow key={d.id} donation={d} />)
            )}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {allDonations.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] font-heebo text-center py-8">
                  אין תרומות עדיין
                </p>
              ) : (
                allDonations.map((d) => <DonationRow key={d.id} donation={d} />)
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-4 font-heebo">
                <button
                  onClick={() => fetchAll(page - 1)}
                  disabled={page <= 1}
                  className="p-2 rounded-lg hover:bg-[var(--bg-muted)] disabled:opacity-30"
                >
                  <ChevronRight size={18} />
                </button>
                <span className="text-sm text-[var(--text-secondary)]">
                  עמוד {page} מתוך {totalPages}
                </span>
                <button
                  onClick={() => fetchAll(page + 1)}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg hover:bg-[var(--bg-muted)] disabled:opacity-30"
                >
                  <ChevronLeft size={18} />
                </button>
              </div>
            )}

            <div className="text-center mt-2">
              <button
                onClick={() => setShowAll(false)}
                className="text-sm text-[var(--text-muted)] hover:underline font-heebo"
              >
                חזרה לתצוגה מקוצרת
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
