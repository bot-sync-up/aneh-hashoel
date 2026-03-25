import React, { useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp, X, Filter, Flame } from 'lucide-react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { useDebounce } from '../../hooks/useDebounce';
import api from '../../lib/api';

const STATUS_OPTIONS = [
  { value: '', label: 'ממתין + בטיפול' },
  { value: 'pending', label: 'ממתין' },
  { value: 'in_process', label: 'בטיפול' },
  { value: 'hidden', label: 'מוסתר' },
];

const SORT_OPTIONS = [
  { value: 'created_at_desc', label: 'חדשות ראשון' },
  { value: 'created_at_asc', label: 'ישנות ראשון' },
  { value: 'urgent_first', label: 'דחוף ראשון' },
];

/**
 * QuestionFilters — collapsible filter panel for the questions list.
 *
 * Props:
 *   filters        — current filter state object
 *   onChange       — (updatedFilters) => void
 *   onClear        — () => void
 *   defaultOpen    — whether panel starts expanded (default false)
 */
function QuestionFilters({
  filters = {},
  onChange,
  onClear,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [localSearch, setLocalSearch] = useState(filters.search || '');
  const debouncedSearch = useDebounce(localSearch, 400);
  const [categoryOptions, setCategoryOptions] = useState([{ value: '', label: 'כל הקטגוריות' }]);

  // Fetch categories from API
  useEffect(() => {
    api.get('/categories')
      .then(res => {
        const cats = res.data?.categories || res.data || [];
        setCategoryOptions([
          { value: '', label: 'כל הקטגוריות' },
          ...cats.map(c => ({ value: String(c.id), label: c.name })),
        ]);
      })
      .catch(() => {});
  }, []);

  // Push debounced search up
  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onChange?.({ ...filters, search: debouncedSearch, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleField = useCallback(
    (field, value) => {
      onChange?.({ ...filters, [field]: value, page: 1 });
    },
    [filters, onChange]
  );

  const handleUrgentToggle = useCallback(() => {
    handleField('is_urgent', filters.is_urgent ? '' : 'true');
  }, [filters.is_urgent, handleField]);

  const handleClear = () => {
    setLocalSearch('');
    onClear?.();
  };

  // Count active filters (excluding page/sort/status — status is always pending)
  const activeCount = [
    filters.category,
    filters.is_urgent,
    filters.search,
    filters.date_from,
    filters.date_to,
  ].filter(Boolean).length;

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-card shadow-soft overflow-hidden">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'w-full flex items-center justify-between px-5 py-3.5',
          'text-[var(--text-primary)] font-heebo text-sm font-medium',
          'hover:bg-[var(--bg-muted)] transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-inset'
        )}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-[var(--text-muted)]" />
          <span>סינון שאלות</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-gold text-white text-xs font-bold">
              {activeCount}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Collapsible body */}
      <div
        className={clsx(
          'transition-all duration-300 overflow-hidden',
          open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-5 pb-5 pt-1 border-t border-[var(--border-default)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
            {/* Search */}
            <div className="sm:col-span-2">
              <Input
                type="search"
                label="חיפוש חופשי"
                placeholder="חפש לפי כותרת או תוכן..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
              />
            </div>

            {/* Category */}
            <Select
              label="קטגוריה"
              options={categoryOptions}
              value={filters.category || ''}
              onChange={(e) => handleField('category', e.target.value)}
            />

            {/* Sort */}
            <Select
              label="מיון"
              options={SORT_OPTIONS}
              value={filters.sort || 'created_at_desc'}
              onChange={(e) => handleField('sort', e.target.value)}
            />

            {/* Date from */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">
                מתאריך
              </label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => handleField('date_from', e.target.value)}
                className={clsx(
                  'w-full rounded-md border border-[var(--border-default)]',
                  'bg-[var(--bg-surface)] text-[var(--text-primary)]',
                  'px-3 py-2.5 text-sm font-heebo',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold',
                  'hover:border-[var(--border-strong)] transition-colors duration-150'
                )}
              />
            </div>

            {/* Date to */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">
                עד תאריך
              </label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => handleField('date_to', e.target.value)}
                className={clsx(
                  'w-full rounded-md border border-[var(--border-default)]',
                  'bg-[var(--bg-surface)] text-[var(--text-primary)]',
                  'px-3 py-2.5 text-sm font-heebo',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold',
                  'hover:border-[var(--border-strong)] transition-colors duration-150'
                )}
              />
            </div>
          </div>

          {/* Bottom row: urgent toggle + clear */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border-default)] flex-wrap gap-3">
            {/* Urgent toggle */}
            <button
              type="button"
              onClick={handleUrgentToggle}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-heebo font-medium',
                'transition-all duration-150',
                filters.is_urgent
                  ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700'
                  : 'border-[var(--border-default)] text-[var(--text-muted)] hover:border-red-300 hover:text-red-600'
              )}
              aria-pressed={Boolean(filters.is_urgent)}
            >
              <Flame
                size={15}
                className={clsx(
                  filters.is_urgent
                    ? 'text-red-500 fill-red-300'
                    : 'text-[var(--text-muted)]'
                )}
              />
              דחוף בלבד
            </button>

            {/* Active filter badges + clear */}
            <div className="flex items-center gap-2 flex-wrap">
              {filters.category && (
                <ActiveFilterPill
                  label={categoryOptions.find((o) => o.value === filters.category)?.label}
                  onRemove={() => handleField('category', '')}
                />
              )}
              {filters.date_from && (
                <ActiveFilterPill
                  label={`מ-${filters.date_from}`}
                  onRemove={() => handleField('date_from', '')}
                />
              )}
              {filters.date_to && (
                <ActiveFilterPill
                  label={`עד ${filters.date_to}`}
                  onRemove={() => handleField('date_to', '')}
                />
              )}

              {activeCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  leftIcon={<X size={13} />}
                  className="text-[var(--text-muted)] hover:text-red-600"
                >
                  נקה הכל
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveFilterPill({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-brand-navy/10 text-brand-navy text-xs font-heebo font-medium px-2.5 py-1 rounded-full">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="hover:text-red-600 transition-colors ml-0.5"
        aria-label={`הסר סינון: ${label}`}
      >
        <X size={11} />
      </button>
    </span>
  );
}

export default QuestionFilters;
