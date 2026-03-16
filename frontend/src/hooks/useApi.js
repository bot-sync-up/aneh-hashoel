import { useState, useCallback, useRef } from 'react';
import api from '../lib/api';

/**
 * useApi — wraps axios with loading, error, and data state.
 *
 * @param {string | ((args: any) => Promise<any>)} endpoint
 *   Either an endpoint string (GET by default) or an async function.
 *
 * @returns {{ data, loading, error, execute, reset }}
 *
 * Usage:
 *   const { data, loading, error, execute } = useApi('/questions');
 *   await execute(); // GET /questions
 *
 *   const { execute: createQuestion } = useApi(
 *     (body) => api.post('/questions', body)
 *   );
 *   await createQuestion(formData);
 */
function useApi(endpoint, options = {}) {
  const {
    method = 'GET',
    immediate = false,
    initialData = null,
    onSuccess,
    onError,
    transform,
  } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const execute = useCallback(
    async (...args) => {
      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      setLoading(true);
      setError(null);

      try {
        let response;

        if (typeof endpoint === 'function') {
          // Custom function: user controls the axios call
          response = await endpoint(...args);
        } else {
          // String endpoint: build axios call from method + optional body
          const [bodyOrParams] = args;

          const axiosConfig = { signal };

          if (method.toUpperCase() === 'GET') {
            axiosConfig.params = bodyOrParams;
            response = await api.get(endpoint, axiosConfig);
          } else if (method.toUpperCase() === 'DELETE') {
            response = await api.delete(endpoint, {
              ...axiosConfig,
              data: bodyOrParams,
            });
          } else if (method.toUpperCase() === 'POST') {
            response = await api.post(endpoint, bodyOrParams, axiosConfig);
          } else if (method.toUpperCase() === 'PUT') {
            response = await api.put(endpoint, bodyOrParams, axiosConfig);
          } else if (method.toUpperCase() === 'PATCH') {
            response = await api.patch(endpoint, bodyOrParams, axiosConfig);
          } else {
            response = await api.get(endpoint, axiosConfig);
          }
        }

        const result = response?.data ?? response;
        const finalData = transform ? transform(result) : result;

        setData(finalData);
        onSuccess?.(finalData);
        return finalData;
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') {
          // Request was intentionally cancelled — do not update error state
          return;
        }

        const apiError = {
          message:
            err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            'שגיאה בלתי צפויה',
          status: err.response?.status,
          data: err.response?.data,
          original: err,
        };

        setError(apiError);
        onError?.(apiError);

        // Re-throw so the caller can also catch
        throw apiError;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, method, onSuccess, onError, transform]
  );

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setLoading(false);
  }, [initialData]);

  // Cancel on unmount
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    data,
    loading,
    error,
    execute,
    reset,
    cancel,
    setData,
  };
}

/**
 * usePaginatedApi — extends useApi with pagination state.
 */
export function usePaginatedApi(endpoint, options = {}) {
  const { pageSize = 20, ...rest } = options;
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const transform = useCallback(
    (result) => {
      if (result?.pagination) {
        setTotalPages(result.pagination.totalPages || 1);
        setTotalItems(result.pagination.total || 0);
      }
      return result?.data || result?.items || result;
    },
    []
  );

  const api = useApi(endpoint, { ...rest, transform });

  const fetchPage = useCallback(
    (pageNum, extraParams = {}) => {
      setPage(pageNum);
      return api.execute({ page: pageNum, limit: pageSize, ...extraParams });
    },
    [api, pageSize]
  );

  return {
    ...api,
    page,
    totalPages,
    totalItems,
    pageSize,
    fetchPage,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export default useApi;
