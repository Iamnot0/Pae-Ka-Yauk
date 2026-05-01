/**
 * Portable storage abstraction.
 *
 * Swappable provider via STORAGE_PROVIDER env:
 *   - "local"       → public/uploads/ (dev + Hostinger VPS)
 *   - "vercel-blob" → Vercel Blob (Vercel deploy default)
 *
 * All call sites use `storage.put(key, file)`, `storage.delete(key)` and
 * `storage.publicUrl(key)`. Swapping providers is a one-line env change —
 * no business-logic changes needed.
 *
 * Keys are namespaced by tenant: `t/{tenantId}/{kind}/{filename}`.
 */

import type { StorageProvider } from './providers/types';

let _instance: StorageProvider | null = null;

function getProviderName(): 'local' | 'vercel-blob' {
  const name = (process.env.STORAGE_PROVIDER ?? 'local').toLowerCase();
  if (name === 'vercel-blob' || name === 'vercelblob') return 'vercel-blob';
  return 'local';
}

async function loadProvider(): Promise<StorageProvider> {
  const name = getProviderName();
  if (name === 'vercel-blob') {
    const mod = await import('./providers/vercelBlob');
    return new mod.VercelBlobStorage();
  }
  const mod = await import('./providers/localFs');
  return new mod.LocalFsStorage();
}

export async function getStorage(): Promise<StorageProvider> {
  if (!_instance) _instance = await loadProvider();
  return _instance;
}

/** Build a tenant-scoped key. Never trust untrusted input for the filename part. */
export function tenantKey(tenantId: string, kind: 'items' | 'brand' | 'receipts', filename: string): string {
  const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `t/${tenantId}/${kind}/${safeFile}`;
}

export type { StorageProvider };
