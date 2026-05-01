export interface PutOptions {
  contentType?: string;
  /** If true, overwrite existing object at this key. Default: true. */
  overwrite?: boolean;
}

export interface StorageProvider {
  /** Upload bytes. Returns a public URL. */
  put(key: string, data: Buffer | Uint8Array, opts?: PutOptions): Promise<{ url: string }>;

  /** Delete by key. No-op if missing. */
  delete(key: string): Promise<void>;

  /** Construct the public URL for a key (without uploading). */
  publicUrl(key: string): string;
}
