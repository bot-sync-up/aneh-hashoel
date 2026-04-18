import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Heart, TrendingUp, DollarSign, Calendar,
  ChevronRight, ChevronLeft, RefreshCw, User, ExternalLink, Download,
  Search, X as XIcon, Filter,
} from 'lucide-react';
import { get } from '../../lib/api';
import api from '../../lib/api';
import { formatDateTime } from '../../lib/utils';
import { BlockSpinner } from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';

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
  const navigate = useNavigate();
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
            {/* Real transaction date from Nedarim — NOT when we synced it */}
            {donation.transaction_time
              ? formatDateTime(donation.transaction_time)
              : (donation.created_at ? formatDateTime(donation.created_at) : '')}
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
        {donation.lead_id && (
          <button
            onClick={() => navigate(`/admin/leads/${donation.lead_id}`)}
            title="פתח כרטסת ליד"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-100"
          >
            <User size={10} />
            {donation.lead_name || 'ליד'}
            <ExternalLink size={10} />
          </button>
        )}
        {donation.rabbi_name && (
          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            הרב {donation.rabbi_name}
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
        {donation.transaction_type && (
          <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
            {donation.transaction_type === 'installments' ? 'תשלומים'
              : donation.transaction_type === 'standing_order' ? 'הוראת קבע'
              : 'חד-פעמי'}
          </span>
        )}
        {/* The 'sync/live' source label is intentionally hidden — it's an
            implementation detail users don't care about. */}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const PERIODS = [
  { value: 'today',  label: 'היום' },
  { value: 'week',   label: 'השבוע' },
  { value: 'month',  label: 'החודש' },
  { value: 'year',   label: 'השנה' },
  { value: 'all',    label: 'כל הזמן' },
];

const PERIOD_LABEL_MAP = {
  today: 'היום',
  week:  'השבוע',
  month: 'החודש',
  year:  'השנה',
  all:   'כל הזמן',
};

export default function DonationsPage({ scope: scopeProp = 'system' } = {}) {
  const [stats,    setStats]    = useState(null);
  const [recent,   setRecent]   = useState([]);
  const [allDonations, setAllDonations] = useState([]);
  const [page,     setPage]     = useState(1);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showAll,  setShowAll]  = useState(false);
  const [period,   setPeriod]   = useState('month'); // default: this month
  const [exporting, setExporting] = useState(false);

  // Search + filters (wired to backend)
  const [search,       setSearch]       = useState('');
  const [searchQ,      setSearchQ]      = useState(''); // debounced query
  const [txTypeFilter, setTxTypeFilter] = useState('all'); // all|regular|installments|standing_order

  // Debounce search input (avoid spamming backend on every keystroke)
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // scope: 'system' (popup-only) or 'all' (everything from Nedarim)
  const scope = scopeProp;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        get('/admin/donations/stats', { period, scope, search: searchQ || undefined }),
        get('/admin/donations/recent', {
          scope,
          search: searchQ || undefined,
          transaction_type: txTypeFilter !== 'all' ? txTypeFilter : undefined,
        }),
      ]);
      setStats(statsRes.data);
      // Client-side filter by transaction_type on /recent response since
      // the endpoint doesn't natively support it yet. Cheap — only 10 rows.
      const rec = txTypeFilter !== 'all'
        ? (recentRes.data || []).filter((d) => d.transaction_type === txTypeFilter)
        : recentRes.data;
      setRecent(rec);
    } catch (err) {
      console.error('Failed to load donations:', err);
    } finally {
      setLoading(false);
    }
  }, [period, scope, searchQ, txTypeFilter]);

  const fetchAll = useCallback(async (p = 1) => {
    try {
      const params = { page: p, limit: PAGE_SIZE, period, scope };
      if (searchQ)                 params.search = searchQ;
      if (txTypeFilter !== 'all')  params.transaction_type = txTypeFilter;
      const res = await get('/admin/donations', params);
      let data = res.data;
      // Same client-side tx_type filter on the list since backend may not
      // natively support it (still valid even if it does)
      if (txTypeFilter !== 'all') {
        data = (data || []).filter((d) => d.transaction_type === txTypeFilter);
      }
      setAllDonations(data);
      setTotal(res.pagination.total);
      setPage(p);
    } catch (err) {
      console.error('Failed to load donations list:', err);
    }
  }, [period, scope, searchQ, txTypeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (showAll) fetchAll(page);
  }, [showAll, page, fetchAll]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [period, searchQ, txTypeFilter]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const response = await api.get('/admin/donations/export.csv', {
        params: {
          period,
          scope,
          search: searchQ || undefined,
          transaction_type: txTypeFilter !== 'all' ? txTypeFilter : undefined,
        },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `donations-${period}-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err?.response?.data?.error || 'שגיאה בייצוא. נסה שוב.');
    } finally {
      setExporting(false);
    }
  };

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
      {/* Header with period tabs + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
            {scope === 'all' ? 'כל התרומות' : 'תרומות — פופאפ "תודה לרב"'}
          </h2>
          <span className="text-xs text-[var(--text-muted)] font-heebo">
            · {PERIOD_LABEL_MAP[period]}
            {scope === 'system' && ' · רק תרומות שהגיעו דרך המערכת'}
            {scope === 'all' && ' · כל התרומות מנדרים'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-heebo transition-colors',
                  period === p.value
                    ? 'bg-[#1B2B5E] text-white font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={exporting}
            onClick={handleExportCSV}
            leftIcon={<Download size={14} />}
          >
            ייצוא לאקסל
          </Button>
          <button
            onClick={fetchData}
            title="רענן נתונים"
            className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition font-heebo p-1.5 rounded"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Search + transaction-type filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search input */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם תורם או מייל..."
            dir="rtl"
            className={clsx(
              'w-full pe-9 ps-3 py-2 text-sm font-heebo',
              'bg-[var(--bg-surface)] text-[var(--text-primary)]',
              'border border-[var(--border-default)] rounded-lg',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent'
            )}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute top-1/2 -translate-y-1/2 start-2 p-1 rounded hover:bg-[var(--bg-muted)]"
              title="נקה חיפוש"
            >
              <XIcon size={12} className="text-[var(--text-muted)]" />
            </button>
          )}
        </div>

        {/* Transaction type filter pills */}
        <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-1">
          <Filter size={12} className="text-[var(--text-muted)] mx-1" />
          {[
            { value: 'all',             label: 'הכל' },
            { value: 'regular',         label: 'חד-פעמי' },
            { value: 'installments',    label: 'תשלומים' },
            { value: 'standing_order',  label: 'הוראת קבע' },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTxTypeFilter(t.value)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-heebo transition-colors',
                txTypeFilter === t.value
                  ? 'bg-[#B8973A] text-white font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Match summary */}
        {searchQ && (
          <span className="text-xs text-[var(--text-muted)] font-heebo ms-auto">
            חיפוש: <strong>{searchQ}</strong>
          </span>
        )}
      </div>

      {/* KPI Cards — now dynamic based on selected period */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Heart}
            label={`סה"כ ${PERIOD_LABEL_MAP[period]}`}
            value={fmtAmount(stats.periodTotal)}
            sub={`${stats.periodCount} תרומות`}
            color="#B8973A"
          />
          <StatCard
            icon={Calendar}
            label="מספר תרומות"
            value={String(stats.periodCount || 0)}
            sub={`ממוצע ${fmtAmount(stats.periodAvg)}`}
            color="#7c3aed"
          />
          <StatCard
            icon={TrendingUp}
            label='סה"כ כללי'
            value={fmtAmount(stats.totalAllTime)}
            sub={`${stats.countAllTime} תרומות`}
            color="#1B2B5E"
          />
          <StatCard
            icon={DollarSign}
            label="ממוצע כללי לתרומה"
            value={fmtAmount(stats.averageDonation)}
            sub={`לכל ${stats.countAllTime} התרומות`}
            color="#16a34a"
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
