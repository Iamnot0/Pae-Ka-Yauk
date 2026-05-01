'use client';

/**
 * Global header search — bridges Stocks (sellable items) AND Materials
 * (raw inventory). Cashiers searching "Soft Roll" from POS get a hit;
 * managers searching "flour" from the inventory page also get a hit.
 *
 * Two API calls fired in parallel against /api/items?search and
 * /api/materials?search. Results merged with a per-row `kind` tag and
 * routed to the appropriate detail page on click.
 *
 * Search semantics: starts-with on name/nameLocal, substring on SKU/code
 * (matches the rest of the app — see lib/repos/items.ts and
 * lib/repos/materials.ts).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Package, Boxes } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

type HitKind = 'stock' | 'material';

interface Hit {
  id: string;
  kind: HitKind;
  name: string;
  nameLocal: string | null;
  category: string;
}

// Routes per hit-kind. Stocks land at POS so the cashier flow is one
// click — type "Banan", click Banana Cake, item is in the cart. To EDIT
// a stock item the owner uses /stocks page directly. Raw materials go
// to their inventory detail (they're not sellable, so POS makes no
// sense). Owner brief 2026-04-28.
const HREF_FOR: Record<HitKind, (id: string) => string> = {
  stock: (id) => `/pos?addId=${encodeURIComponent(id)}`,
  material: (id) => `/inventory/${id}`,
};

export function SearchMaterials() {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced parallel fetch: stocks + materials. Single-letter is enough —
  // Boss expects "type A, show items starting with A". The API uses prefix
  // matching, so 1-char queries are bounded (≤ 8 hits per kind via limit).
  // The 200ms debounce keeps us from hammering Neon during fast typing.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 1) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const [stockRes, matRes] = await Promise.all([
          fetch(`/api/items?search=${encodeURIComponent(needle)}&limit=8`, { signal: ctrl.signal })
            .then((r) => r.ok ? r.json() : { rows: [] })
            .catch(() => ({ rows: [] })),
          fetch(`/api/materials?search=${encodeURIComponent(needle)}&limit=8`, { signal: ctrl.signal })
            .then((r) => r.ok ? r.json() : { rows: [] })
            .catch(() => ({ rows: [] })),
        ]);
        const stocks: Hit[] = (stockRes.rows ?? []).map((r: { id: string; name: string; nameLocal: string | null; category: string }) => ({
          id: r.id, kind: 'stock', name: r.name, nameLocal: r.nameLocal, category: String(r.category),
        }));
        const mats: Hit[] = (matRes.rows ?? []).map((r: { id: string; name: string; nameLocal: string | null; category: string }) => ({
          id: r.id, kind: 'material', name: r.name, nameLocal: r.nameLocal, category: String(r.category),
        }));
        // Stocks first — cashier-favoring order. Within each kind, the API
        // already sorts alphabetically.
        setHits([...stocks, ...mats]);
        setActive(0);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit) {
        router.push(HREF_FOR[hit.kind](hit.id) as unknown as never);
        setOpen(false);
        setQ('');
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = open && q.trim().length >= 1;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div className="search-pill">
        <Search size={16} style={{ color: 'var(--color-subtle-fg)' }} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('search.materials.placeholder')}
          aria-label={t('search.materials.placeholder')}
          autoComplete="off"
        />
      </div>
      {showDropdown && (
        <div className="dropdown-panel" role="listbox">
          {hits.length === 0 ? (
            <div style={{ padding: 'var(--space-3)', color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>
              {t('search.noResults')}
            </div>
          ) : (
            hits.map((h, i) => (
              <Link
                key={`${h.kind}-${h.id}`}
                href={HREF_FOR[h.kind](h.id) as unknown as never}
                className="dropdown-item"
                role="option"
                aria-selected={i === active}
                style={i === active ? { background: 'var(--color-surface-alt)' } : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => { setOpen(false); setQ(''); }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
                  {h.kind === 'stock'
                    ? <Package size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} aria-label={t('search.section.stocks')} />
                    : <Boxes size={14} style={{ color: 'var(--color-muted-fg)', flexShrink: 0 }} aria-label={t('search.section.materials')} />}
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 500 }}>{h.name}</span>
                    {h.nameLocal && (
                      <span lang="my" style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>{h.nameLocal}</span>
                    )}
                  </div>
                  <span style={{
                    fontSize: '0.6875rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-muted-fg)',
                    flexShrink: 0,
                  }}>
                    {h.kind === 'stock' ? t('search.section.stocks') : t('search.section.materials')}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
