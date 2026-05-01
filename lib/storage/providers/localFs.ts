import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { PutOptions, StorageProvider } from './types';

const ROOT = path.join(process.cwd(), 'public', 'uploads');
const URL_PREFIX = '/uploads';

/**
 * Local filesystem storage — writes to public/uploads/.
 * Works in dev and on any Node VPS (Hostinger, DigitalOcean, etc.) with
 * persistent disk. Does NOT work on Vercel (read-only FS at runtime) —
 * use VercelBlobStorage in production there.
 */
export class LocalFsStorage implements StorageProvider {
  async put(key: string, data: Buffer | Uint8Array, _opts?: PutOptions): Promise<{ url: string }> {
    const fullPath = path.join(ROOT, key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return { url: `${URL_PREFIX}/${key}` };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(path.join(ROOT, key));
    } catch (e) {
      // Ignore missing file — idempotent delete
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  publicUrl(key: string): string {
    return `${URL_PREFIX}/${key}`;
  }
}
