import { put as blobPut, del as blobDel } from '@vercel/blob';
import type { PutOptions, StorageProvider } from './types';

/**
 * Vercel Blob storage — for Vercel deployments.
 * Requires BLOB_READ_WRITE_TOKEN in env (auto-provisioned on Vercel).
 */
export class VercelBlobStorage implements StorageProvider {
  async put(key: string, data: Buffer | Uint8Array, opts?: PutOptions): Promise<{ url: string }> {
    // @vercel/blob's PutBody accepts ArrayBuffer / string / Blob / ReadableStream
    // but not Buffer/Uint8Array directly in the latest types. Wrap in a Blob
    // (zero-copy under the hood) to satisfy the type system. The cast keeps
    // TS happy across @types/node + DOM lib variants.
    const body = new Blob([data as BlobPart]);
    const result = await blobPut(key, body, {
      access: 'public',
      contentType: opts?.contentType,
      addRandomSuffix: false,
      allowOverwrite: opts?.overwrite ?? true,
    });
    return { url: result.url };
  }

  async delete(key: string): Promise<void> {
    try {
      await blobDel(key);
    } catch {
      // Ignore missing — idempotent
    }
  }

  /** Blob URLs are returned on put; we can't reliably construct them from key alone. */
  publicUrl(key: string): string {
    const base = process.env.VERCEL_BLOB_PUBLIC_BASE;
    if (base) return `${base.replace(/\/$/, '')}/${key}`;
    // Fallback: return the key as a hint — real URL came from put()
    return `/__blob/${key}`;
  }
}
