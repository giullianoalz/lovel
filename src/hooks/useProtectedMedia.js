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
  // The fetch result carries the path it belongs to, so a component that swaps
  // apiPath never shows the previous file while the new one loads. A cache hit
  // is read here during render rather than pushed through state by an effect.
  const [fetched, setFetched] = useState(null);
  const forThisPath = fetched && fetched.path === apiPath ? fetched : null;

  const url = (apiPath ? cache.get(apiPath) : null) || forThisPath?.url || null;
  const error = forThisPath?.error || null;

  useEffect(() => {
    if (!apiPath || cache.has(apiPath)) return;

    let cancelled = false;
    api.get(apiPath, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(res.data);
        cache.set(apiPath, objectUrl);
        setFetched({ path: apiPath, url: objectUrl });
      })
      .catch((err) => {
        if (!cancelled) setFetched({ path: apiPath, error: err });
      });

    return () => { cancelled = true; };
  }, [apiPath]);

  return { url, error };
}
