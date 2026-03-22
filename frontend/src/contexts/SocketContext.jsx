import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';
const RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

export function SocketProvider({ children }) {
  const { isAuthenticated, token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const socketRef = useRef(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const currentToken = localStorage.getItem('auth_token');
    if (!currentToken) return;

    const newSocket = io(SOCKET_URL, {
      auth: { token: currentToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: RECONNECT_ATTEMPTS,
      reconnectionDelay: RECONNECT_DELAY,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      autoConnect: true,
      path: '/socket.io',
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setConnectionError(null);
    });

    newSocket.on('disconnect', (reason) => {
      setConnected(false);
      // 'io server disconnect' = server intentionally closed → reconnect manually
      // Other reasons (transport error, ping timeout) → socket.io auto-reconnects
      if (reason === 'io server disconnect') {
        setTimeout(() => newSocket.connect(), RECONNECT_DELAY);
      }
    });

    newSocket.on('connect_error', (err) => {
      setConnected(false);
      setConnectionError(err.message);
    });

    newSocket.on('reconnect', () => {
      setConnected(true);
      setConnectionError(null);
    });

    newSocket.on('reconnect_failed', () => {
      setConnectionError('לא ניתן להתחבר לשרת. אנא רענן את הדף.');
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    }
  }, []);

  // Connect when authenticated, disconnect when not
  useEffect(() => {
    if (isAuthenticated && token) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      // Cleanup on unmount only
    };
  }, [isAuthenticated, token, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Helper: emit with optional callback
  const emit = useCallback((event, data, callback) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data, callback);
      return true;
    }
    return false;
  }, []);

  // Helper: subscribe to an event, returns unsubscribe fn
  const on = useCallback((event, handler) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler);
      return () => socketRef.current?.off(event, handler);
    }
    return () => {};
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        connectionError,
        emit,
        on,
        connect,
        disconnect,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return ctx;
}

export default SocketContext;
