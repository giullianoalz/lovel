import { useEffect, useState } from 'react';
import api from '../lib/api';

// Object URLs created per-hook-instance so components can revoke their own
// on unmount without stepping on other instances showing the same file.
const cache = new Map();

/**
 * Fetches a media file that requires our own auth (not a plain <img src>-able
 * static URL) and exposes it as a blob object URL. Used for chat attachments
 * and marketing photos, which are proxied through the API (backed by Drive
 * or local disk) instead of served from a public /uploads path.
 */
export function useProtectedMedia(apiPath) {
  const [url, setUrl] = useState(() => cache.get(apiPath) || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!apiPath) return;
    if (cache.has(apiPath)) {
      setUrl(cache.get(apiPath));
      return;
    }

    let cancelled = false;
    api.get(apiPath, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(res.data);
        cache.set(apiPath, objectUrl);
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });

    return () => { cancelled = true; };
  }, [apiPath]);

  return { url, error };
}
