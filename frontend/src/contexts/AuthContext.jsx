import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'refresh_token';
const RABBI_KEY = 'rabbi_data';

export function AuthProvider({ children }) {
  const [rabbi, setRabbi] = useState(() => {
    try {
      const stored = localStorage.getItem(RABBI_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  });

  const [refreshToken, setRefreshToken] = useState(() => {
    try {
      return localStorage.getItem(REFRESH_KEY) || null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const refreshPromiseRef = useRef(null);

  const isAuthenticated = Boolean(token && rabbi);

  // Persist auth state
  const persistAuth = useCallback((rabbiData, accessToken, refToken) => {
    try {
      if (rabbiData) {
        localStorage.setItem(RABBI_KEY, JSON.stringify(rabbiData));
      } else {
        localStorage.removeItem(RABBI_KEY);
      }
      if (accessToken) {
        localStorage.setItem(TOKEN_KEY, accessToken);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (refToken) {
        localStorage.setItem(REFRESH_KEY, refToken);
      } else {
        localStorage.removeItem(REFRESH_KEY);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  // Inject auth header into every request (except public auth endpoints)
  useEffect(() => {
    const PUBLIC_ROUTES = ['/auth/login', '/auth/refresh', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
    const requestInterceptor = api.interceptors.request.use(
      (config) => {
        const isPublic = PUBLIC_ROUTES.some((r) => config.url?.includes(r));
        if (!isPublic) {
          const currentToken = localStorage.getItem(TOKEN_KEY);
          if (currentToken) {
            config.headers.Authorization = `Bearer ${currentToken}`;
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
    };
  }, []);

  // 401 → attempt token refresh
  useEffect(() => {
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const original = error.config;

        if (
          error.response?.status === 401 &&
          !original._retry &&
          !original.url?.includes('/auth/refresh') &&
          !original.url?.includes('/auth/login')
        ) {
          original._retry = true;

          // Deduplicate parallel refresh calls
          if (!refreshPromiseRef.current) {
            refreshPromiseRef.current = (async () => {
              try {
                const currentRefresh = localStorage.getItem(REFRESH_KEY);
                if (!currentRefresh) throw new Error('No refresh token');

                const { data } = await api.post('/auth/refresh', {
                  refreshToken: currentRefresh,
                });

                const newAccessToken = data.token || data.accessToken;
                const newRefreshToken = data.refreshToken || currentRefresh;

                localStorage.setItem(TOKEN_KEY, newAccessToken);
                localStorage.setItem(REFRESH_KEY, newRefreshToken);
                setToken(newAccessToken);
                setRefreshToken(newRefreshToken);

                return newAccessToken;
              } catch (refreshErr) {
                // Refresh failed — sign out
                logout();
                return Promise.reject(refreshErr);
              } finally {
                refreshPromiseRef.current = null;
              }
            })();
          }

          try {
            const newToken = await refreshPromiseRef.current;
            original.headers.Authorization = `Bearer ${newToken}`;
            return api(original);
          } catch {
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(responseInterceptor);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Verify token on mount
  useEffect(() => {
    const verifySession = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        setLoading(false);
        setInitializing(false);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        setRabbi(data.rabbi || data);
        setToken(storedToken);
        persistAuth(data.rabbi || data, storedToken, localStorage.getItem(REFRESH_KEY));
      } catch {
        // Token invalid — clear
        persistAuth(null, null, null);
        setRabbi(null);
        setToken(null);
        setRefreshToken(null);
      } finally {
        setLoading(false);
        setInitializing(false);
      }
    };

    verifySession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (credentials) => {
      setLoading(true);
      try {
        const { data } = await api.post('/auth/login', credentials);
        const { rabbi: rabbiData, accessToken, token, refreshToken: refToken } = data;
        const resolvedToken = accessToken || token;

        setRabbi(rabbiData);
        setToken(resolvedToken);
        setRefreshToken(refToken || null);
        persistAuth(rabbiData, resolvedToken, refToken || null);

        return { success: true };
      } catch (error) {
        const message =
          error.response?.data?.error ||
          error.response?.data?.message ||
          'שגיאה בהתחברות. אנא נסה שוב.';
        return { success: false, message };
      } finally {
        setLoading(false);
      }
    },
    [persistAuth]
  );

  const logout = useCallback(async () => {
    try {
      const currentRefresh = localStorage.getItem(REFRESH_KEY);
      if (currentRefresh) {
        await api.post('/auth/logout', { refreshToken: currentRefresh }).catch(() => {});
      }
    } finally {
      persistAuth(null, null, null);
      setRabbi(null);
      setToken(null);
      setRefreshToken(null);
    }
  }, [persistAuth]);

  const updateRabbi = useCallback(
    (updates) => {
      setRabbi((prev) => {
        const updated = { ...prev, ...updates };
        persistAuth(updated, localStorage.getItem(TOKEN_KEY), localStorage.getItem(REFRESH_KEY));
        return updated;
      });
    },
    [persistAuth]
  );

  const isAdmin = rabbi?.role === 'admin' || rabbi?.isAdmin === true;
  const isSenior = rabbi?.role === 'senior' || rabbi?.isSenior === true;
  const isCS = rabbi?.role === 'customer_service' || rabbi?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        rabbi,
        token,
        isAuthenticated,
        isAdmin,
        isSenior,
        isCS,
        loading,
        initializing,
        login,
        logout,
        updateRabbi,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
