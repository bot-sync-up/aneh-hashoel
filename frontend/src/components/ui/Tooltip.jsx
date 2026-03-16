import React, { useState, useRef, useCallback, useId } from 'react';
import { clsx } from 'clsx';

const placementClasses = {
  top: {
    tooltip: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    arrow: 'top-full left-1/2 -translate-x-1/2 border-t-gray-800 dark:border-t-gray-700 border-x-transparent border-b-transparent',
  },
  bottom: {
    tooltip: 'top-full left-1/2 -translate-x-1/2 mt-2',
    arrow: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-800 dark:border-b-gray-700 border-x-transparent border-t-transparent',
  },
  right: {
    tooltip: 'top-1/2 -translate-y-1/2 right-full mr-2',
    arrow: 'left-full top-1/2 -translate-y-1/2 border-r-gray-800 dark:border-r-gray-700 border-y-transparent border-l-transparent',
  },
  left: {
    tooltip: 'top-1/2 -translate-y-1/2 left-full ml-2',
    arrow: 'right-full top-1/2 -translate-y-1/2 border-l-gray-800 dark:border-l-gray-700 border-y-transparent border-r-transparent',
  },
};

/**
 * Simple hover tooltip.
 *
 * @param {string | React.ReactNode} content  — tooltip text or node
 * @param {'top'|'bottom'|'right'|'left'} placement
 * @param {number} delay  — hover delay in ms (default 300)
 * @param {boolean} disabled
 */
function Tooltip({
  children,
  content,
  placement = 'top',
  delay = 300,
  disabled = false,
  className,
}) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);
  const tooltipId = useId();

  const show = useCallback(() => {
    if (disabled || !content) return;
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [disabled, content, delay]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  const config = placementClasses[placement] || placementClasses.top;

  // If no content or disabled, just render children
  if (!content || disabled) {
    return <>{children}</>;
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {/* Trigger — clone child to add aria-describedby */}
      {React.cloneElement(
        React.Children.only(children),
        { 'aria-describedby': visible ? tooltipId : undefined }
      )}

      {/* Tooltip bubble */}
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          className={clsx(
            'absolute z-50 pointer-events-none',
            'px-2.5 py-1.5 rounded',
            'bg-gray-800 dark:bg-gray-700 text-white',
            'text-xs font-heebo font-medium',
            'whitespace-nowrap',
            'shadow-lg',
            'animate-fade-in',
            config.tooltip,
            className
          )}
        >
          {content}

          {/* Arrow */}
          <span
            className={clsx(
              'absolute w-0 h-0',
              'border-4',
              config.arrow
            )}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}

export default Tooltip;
