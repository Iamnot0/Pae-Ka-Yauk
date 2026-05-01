'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type {
  RawMaterial,
  MaterialCategory,
  StorageZone,
  Unit,
  TrackingMode,
} from '@/lib/repos/materials';

interface Props {
  initial?: RawMaterial | null;
  mode: 'create' | 'edit';
}

const CATEGORIES: Array<{ value: MaterialCategory; en: string; my: string }> = [
  { value: 'FLOUR_LEAVENING', en: 'Flour & Leavening',  my: 'မုန့်ညက်နှင့် ဖောင်းကြွ' },
  { value: 'FAT_OIL',         en: 'Fats & Oils',        my: 'ဆီနှင့် အဆီ' },
  { value: 'DAIRY',           en: 'Dairy',              my: 'နို့ထွက်ပစ္စည်း' },
  { value: 'SWEETENER',       en: 'Sweeteners',         my: 'သကြား' },
  { value: 'FRUIT_FILLING',   en: 'Fruits & Fillings',  my: 'အသီးနှင့် ဖြည့်စွက်' },
  { value: 'CHOCOLATE_NUT',   en: 'Chocolate & Nuts',   my: 'ချောကလက်နှင့် အခွံမာသီး' },
  { value: 'PROTEIN_SAVORY',  en: 'Protein & Savory',   my: 'အသား' },
  { value: 'SAUCE_SEASONING', en: 'Sauces & Seasonings', my: 'ဆော့စ်နှင့် မှုန့်' },
  { value: 'COLOR_FLAVOR',    en: 'Colors & Flavors',   my: 'အရောင်နှင့် အနံ့' },
  { value: 'BEVERAGE_BASE',   en: 'Beverage Base',      my: 'အဖျော်အခြေခံ' },
  { value: 'PACKAGING',       en: 'Packaging',          my: 'ထုပ်ပိုးပစ္စည်း' },
  { value: 'OTHER',           en: 'Other',              my: 'အခြား' },
];

const ZONES: Array<{ value: StorageZone; en: string; my: string; hint: string }> = [
  { value: 'COLD',     en: 'Cold',     my: 'အအေးခန်း',      hint: 'Fridge/freezer — expiry tracking + FIFO usually needed' },
  { value: 'DRY',      en: 'Dry',      my: 'ခြောက်သွေ့',     hint: 'Dry store — par-level based' },
  { value: 'SUPPLIES', en: 'Supplies', my: 'ထောက်ပံ့ပစ္စည်း', hint: 'Packaging, tape — count based, replenish-only' },
];

const UNITS: Unit[] = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'PACK', 'CARTON', 'BOTTLE', 'CAN'];
const TRACK_BY: TrackingMode[] = ['WEIGHT', 'COUNT'];

export function MaterialForm({ initial, mode }: Props) {
  const router = useRouter();
  const t = useT();

  const [name, setName]             = useState(initial?.name ?? '');
  const [nameLocal, setNameLocal]   = useState(initial?.nameLocal ?? '');
  const [code, setCode]             = useState(initial?.code ?? '');
  const [category, setCategory]     = useState<MaterialCategory>(initial?.category ?? 'OTHER');
  const [storageZone, setZone]      = useState<StorageZone>(initial?.storageZone ?? 'DRY');
  const [baseUnit, setBaseUnit]     = useState<Unit>(initial?.baseUnit ?? 'G');
  const [trackBy, setTrackBy]       = useState<TrackingMode>(initial?.trackBy ?? 'WEIGHT');
  const [parLevel, setParLevel]     = useState<string>(initial?.parLevel != null ? String(initial.parLevel) : '');
  const [lastUnitCost, setLastCost] = useState<string>(initial?.lastUnitCost != null ? String(initial.lastUnitCost) : '');
  const [replenishOnly, setRepl]    = useState(initial?.replenishOnly ?? false);
  const [tracksExpiry, setExpiry]   = useState(initial?.tracksExpiry ?? false);
  const [enforceFifo, setFifo]      = useState(initial?.enforceFifo ?? false);
  const [notes, setNotes]           = useState(initial?.notes ?? '');

  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const payload = {
      name: name.trim(),
      nameLocal: nameLocal.trim() || null,
      code: code.trim() || null,
      category,
      storageZone,
      baseUnit,
      trackBy,
      parLevel: parLevel === '' ? null : Number(parLevel),
      lastUnitCost: lastUnitCost === '' ? null : Number(lastUnitCost),
      replenishOnly,
      tracksExpiry,
      enforceFifo,
      notes: notes.trim() || null,
    };

    try {
      const url = mode === 'create' ? '/api/materials' : `/api/materials/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Save failed');
        return;
      }
      // push first (user sees list immediately), then refresh so the list
      // re-renders with the updated row in the background.
      router.push('/inventory');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    const msg = t('inv.deleteConfirm').replace('{name}', initial.name);
    if (!confirm(msg)) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/materials/${initial.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Delete failed');
        return;
      }
      router.push('/inventory');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 760 }}>
      {/* Section: basics */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Basic Info</h3>

        <div className="form-grid-2">
          <div>
            <label>Name (English) *</label>
            <input value={name} onChange={e => setName(e.target.value)} required maxLength={200} placeholder="e.g. Bread Flour" />
          </div>
          <div>
            <label>Name (Myanmar)</label>
            <input lang="my" value={nameLocal} onChange={e => setNameLocal(e.target.value)} maxLength={200} placeholder="e.g. ပေါင်မုန့်ညက်" />
          </div>
        </div>

        <div className="form-grid-2">
          <div>
            <label>Code / Abbreviation</label>
            <input value={code} onChange={e => setCode(e.target.value)} maxLength={20} placeholder="e.g. BF" />
          </div>
          <div>
            <label>Category *</label>
            <select value={category} onChange={e => setCategory(e.target.value as MaterialCategory)}>
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.en} · {c.my}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section: storage & units */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Storage & Unit</h3>

        <div>
          <label>Storage Zone *</label>
          <div className="form-grid-3" style={{ gap: 'var(--space-2)' }}>
            {ZONES.map(z => (
              <button
                key={z.value}
                type="button"
                onClick={() => setZone(z.value)}
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  background: storageZone === z.value ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: storageZone === z.value ? '#fff' : 'var(--color-foreground)',
                  border: `1px solid ${storageZone === z.value ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontWeight: 600 }}>{z.en}</span>
                <span lang="my" style={{ fontSize: '0.875rem', opacity: 0.8 }}>{z.my}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid-2">
          <div>
            <label>Base Unit *</label>
            <select value={baseUnit} onChange={e => setBaseUnit(e.target.value as Unit)}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label>Tracking *</label>
            <select value={trackBy} onChange={e => setTrackBy(e.target.value as TrackingMode)}>
              {TRACK_BY.map(t => <option key={t} value={t}>{t === 'WEIGHT' ? 'Weight (g/kg/ml/L)' : 'Count (pcs/box)'}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid-2">
          <div>
            <label>Par Level (low-stock alert at)</label>
            <input type="number" inputMode="decimal" step="any" min="0" value={parLevel} onChange={e => setParLevel(e.target.value)} placeholder="e.g. 2" />
          </div>
          <div>
            <label>Last Unit Cost (MMK per base unit)</label>
            <input type="number" inputMode="decimal" step="any" min="0" value={lastUnitCost} onChange={e => setLastCost(e.target.value)} placeholder="e.g. 350" />
          </div>
        </div>
      </div>

      {/* Section: flags */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h3 style={{ margin: 0 }}>Behavior Flags</h3>
        <FlagCheckbox
          checked={tracksExpiry}
          onChange={setExpiry}
          label="Tracks expiry dates"
          hint="Cold-storage items should track expiry — system warns near/past expiry"
        />
        <FlagCheckbox
          checked={enforceFifo}
          onChange={setFifo}
          label="Enforce FIFO"
          hint="Oldest batch consumes first. Usually ON for cold, OFF for dry."
        />
        <FlagCheckbox
          checked={replenishOnly}
          onChange={setRepl}
          label="Replenish-only (NOT deducted by recipes)"
          hint="Use for colors/flavors/packaging — tracked as stock, not in BOM math"
        />
      </div>

      {/* Notes */}
      <div className="card">
        <label>Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Optional notes about this material"
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-destructive-bg)',
            border: '1px solid var(--color-destructive)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-destructive)',
            fontSize: '0.9375rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          <Save size={16} /> {loading ? 'Saving…' : (mode === 'create' ? 'Create Material' : 'Save Changes')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push('/inventory')}
          disabled={loading}
        >
          {t('common.cancel')}
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleDelete}
            disabled={deleting}
            style={{ marginLeft: 'auto', color: 'var(--color-destructive)' }}
          >
            <Trash2 size={16} /> {deleting ? 'Deleting…' : t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
}

function FlagCheckbox({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer', marginBottom: 0 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
      />
      <span>
        <span style={{ fontWeight: 500, color: 'var(--color-foreground)', display: 'block' }}>{label}</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-muted-fg)', display: 'block' }}>{hint}</span>
      </span>
    </label>
  );
}
