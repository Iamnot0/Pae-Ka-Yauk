'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ImageIcon, Upload, X, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

interface Props {
  value: string | null;        // current image URL (or null)
  onChange: (url: string | null) => void;
  /** Fallback letter shown on empty tile — usually item's first letter */
  fallbackLetter?: string;
}

/**
 * Square image dropzone with preview.
 * Uploads to /api/upload/image (server-side sharp compression).
 */
export function ImageDropzone({ value, onChange, fallbackLetter }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'items');
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Upload failed');
        return;
      }
      const { url } = await res.json();
      onChange(url);
    } finally {
      setUploading(false);
    }
  };

  const onChangeFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    if (e.target) e.target.value = '';
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload image"
        style={{
          position: 'relative',
          width: 200,
          height: 200,
          borderRadius: 'var(--radius-md)',
          border: `2px ${value ? 'solid' : 'dashed'} ${dragging ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          background: value ? 'var(--color-surface)' : dragging ? 'var(--color-surface-alt)' : 'var(--color-surface)',
          overflow: 'hidden',
          cursor: uploading ? 'wait' : 'pointer',
          transition: 'border-color var(--transition-fast), background var(--transition-fast)',
          flexShrink: 0,
        }}
      >
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={value}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-muted-fg)',
            textAlign: 'center',
            padding: 'var(--space-3)',
          }}>
            {fallbackLetter ? (
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 72, fontWeight: 700,
                color: 'var(--color-primary)', opacity: 0.4,
              }}>
                {fallbackLetter.slice(0, 1).toUpperCase()}
              </span>
            ) : (
              <>
                <ImageIcon size={36} style={{ marginBottom: 8 }} />
                <Upload size={14} />
              </>
            )}
          </div>
        )}

        {uploading && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}>
            <Loader2 size={24} style={{ animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {value && !uploading && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            aria-label={t('item.imageRemove')}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 28, height: 28, minHeight: 28,
              borderRadius: '50%', padding: 0,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)', maxWidth: 200, margin: 0 }}>
        {uploading ? 'Uploading…' : t('item.imageHint')}
      </p>

      {error && (
        <p role="alert" style={{ color: 'var(--color-destructive)', fontSize: '0.8125rem', margin: 0 }}>
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onChangeFile}
        style={{ display: 'none' }}
      />
    </div>
  );
}
