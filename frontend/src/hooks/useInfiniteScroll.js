import { useEffect, useRef, useCallback } from 'react';

/**
 * useInfiniteScroll — triggers a callback when a sentinel element
 * enters the viewport. Uses the IntersectionObserver API.
 *
 * Returns a ref that must be attached to a sentinel DOM element at the
 * bottom of the list (e.g. an empty <div>). When that element becomes
 * visible, `onLoadMore` is called if there are more pages to load.
 *
 * @param {() => void}  onLoadMore   — called when the sentinel is visible
 * @param {boolean}     hasMore      — set to false to stop observing
 * @param {boolean}     [loading]    — prevents double-firing during a fetch
 * @param {number}      [threshold]  — IntersectionObserver threshold (0–1)
 * @param {string}      [rootMargin] — IntersectionObserver rootMargin
 *
 * @returns {React.RefObject<HTMLElement>} sentinelRef — attach to a <div> at list end
 *
 * Usage:
 *   const sentinelRef = useInfiniteScroll(fetchNextPage, hasMore, loading);
 *
 *   return (
 *     <ul>
 *       {items.map(item => <li key={item.id}>{item.name}</li>)}
 *       <div ref={sentinelRef} />
 *     </ul>
 *   );
 */
function useInfiniteScroll(
  onLoadMore,
  hasMore,
  loading = false,
  threshold = 0.1,
  rootMargin = '0px 0px 200px 0px'
) {
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  // Keep the latest `onLoadMore` in a ref to avoid stale closures
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  const handleIntersection = useCallback(
    (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting && !loading) {
        onLoadMoreRef.current?.();
      }
    },
    [loading]
  );

  useEffect(() => {
    // Disconnect any previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    const sentinel = sentinelRef.current;

    if (!sentinel || !hasMore) return;

    observerRef.current = new IntersectionObserver(handleIntersection, {
      threshold,
      rootMargin,
    });

    observerRef.current.observe(sentinel);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [hasMore, handleIntersection, threshold, rootMargin]);

  return sentinelRef;
}

export default useInfiniteScroll;
