import { useEffect, useRef } from 'react';
import { useSocket as useSocketContext } from '../contexts/SocketContext';

/**
 * useSocket — subscribe to a Socket.IO event with automatic cleanup on unmount.
 *
 * Wraps the `on` helper exposed by SocketContext, so there is no need to
 * manually call `off` or manage subscriptions in components.
 *
 * The handler ref is kept up-to-date on every render so callers do not need
 * to memoize it — stale-closure bugs are avoided automatically.
 *
 * @param {string}   event    — the Socket.IO event name to listen for
 * @param {Function} handler  — callback invoked when the event fires
 *
 * @returns {{ connected: boolean, emit: Function }}
 *   Re-exposes `connected` and `emit` from SocketContext for convenience.
 *
 * Usage:
 *   useSocket('new_question', (data) => {
 *     setQuestions(prev => [data, ...prev]);
 *   });
 *
 *   // With emit:
 *   const { emit } = useSocket('typing', (data) => console.log(data));
 *   emit('typing', { roomId });
 */
function useSocket(event, handler) {
  const { on, connected, emit, socket } = useSocketContext();

  // Keep the latest handler in a ref so we never need to re-subscribe
  // when the handler identity changes (e.g. inline arrow functions).
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!event) return;

    // Stable wrapper: always calls the current handler ref
    const stableHandler = (...args) => {
      handlerRef.current?.(...args);
    };

    const unsubscribe = on(event, stableHandler);

    return () => {
      unsubscribe?.();
    };
  }, [event, on, socket]); // re-subscribe if socket instance changes (reconnect)

  return { connected, emit };
}

export default useSocket;
