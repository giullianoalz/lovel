import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for data fetching with loading/error states.
 *
 * @param {() => Promise<any>} fetchFn  - async function that returns data
 * @param {any[]} deps                  - dependency array (re-fetches on change)
 * @returns {{ data, loading, error, retry }}
 */
export function useAsyncData(fetchFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current) {
        setError(err.userMessage || err.message || 'Error inesperado. Inténtalo de nuevo.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    execute();
    return () => { mountedRef.current = false; };
  }, [execute]);

  return { data, loading, error, retry: execute };
}
