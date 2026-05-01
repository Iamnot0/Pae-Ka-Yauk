'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only.
 * Dev builds skip it to avoid cache staleness while editing.
 * Rendered once in the root layout, returns null (no UI).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('[sw] registration failed:', err);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
