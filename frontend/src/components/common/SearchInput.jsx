import React, { useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Search, X } from 'lucide-react';
import { useDebouncedCallback } from '../../hooks/useDebounce';

/**
 * SearchInput — RTL-aware search field with debounced onChange,
 * magnifier icon on the right (visual start in RTL), and a clear button.
 *
 * @param {string}   value         — controlled input value
 * @param {(val: string) => void} onChange — fired after the debounce delay
 * @param {string}   [placeholder='חיפוש...'] — placeholder text
 * @param {() => void} [onClear]   — called when the X button is clicked;
 *                                    if omitted, clears via onChange('')
 * @param {number}   [debounce=300] — debounce delay in ms
 * @param {string}   [className]   — extra classes for the wrapper
 * @param {boolean}  [autoFocus]   — focus on mount
 * @param {string}   [name]        — input name attribute
 * @param {string}   [id]          — input id attribute
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'חיפוש...',
  onClear,
  debounce = 300,
  className,
  autoFocus = false,
  name,
  id,
  ...rest
}) {
  const inputRef = useRef(null);

  // Debounced version of onChange
  const [debouncedOnChange] = useDebouncedCallback(
    (val) => onChange?.(val),
    debounce
  );

  // Internal change handler: updates the input value immediately for UX,
  // but fires onChange after the debounce delay.
  const handleChange = useCallback(
    (e) => {
      debouncedOnChange(e.target.value);
    },
    [debouncedOnChange]
  );

  // Clear handler
  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
    } else {
      onChange?.('');
    }
    inputRef.current?.focus();
  }, [onClear, onChange]);

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  const hasValue = Boolean(value && value.length > 0);

  return (
    <div
      className={clsx('relative flex items-center', className)}
      dir="rtl"
    >
      {/* Magnifier icon — right side (RTL start) */}
      <span
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex-shrink-0"
        aria-hidden="true"
      >
        <Search
          size={16}
          strokeWidth={2}
          style={{ color: 'var(--text-muted)' }}
        />
      </span>

      {/* Input */}
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        name={name}
        id={id}
        defaultValue={value}
        key={value} // re-mount when value is cleared externally
        onChange={handleChange}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={clsx(
          'w-full h-10 rounded-lg text-sm font-heebo',
          'pr-9 pl-9',               // space for both icons (RTL: pr = right, pl = left)
          'border transition-all duration-150',
          'placeholder:text-[var(--text-muted)]',
          'focus:outline-none focus:ring-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          '[&::-webkit-search-cancel-button]:hidden', // hide native clear in webkit
        )}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
          '--tw-ring-color': 'rgba(184,151,58,0.4)',
        }}
        {...rest}
      />

      {/* Clear button — left side (RTL end), only shown when value is set */}
      {hasValue && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="נקה חיפוש"
          className={clsx(
            'absolute left-2.5 top-1/2 -translate-y-1/2',
            'w-5 h-5 rounded-full flex items-center justify-center',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2',
          )}
          style={{
            backgroundColor: 'var(--bg-muted)',
            color: 'var(--text-muted)',
            '--tw-ring-color': 'rgba(184,151,58,0.4)',
          }}
          tabIndex={0}
        >
          <X size={11} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
