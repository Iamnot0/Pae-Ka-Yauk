'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, X } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import type { Modifier } from '@/lib/repos/modifiers';

interface Props {
  initial: Modifier[];
}

const DEFAULT_GROUPS = ['Size', 'Milk', 'Add-on', 'Sweetness', 'Temperature'];

export function ModifierManager({ initial }: Props) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState<Modifier[]>(initial);
  const [showForm, setShowForm] = useState(false);

  // Group by group name for display
  const grouped = rows.reduce<Record<string, Modifier[]>>((acc, m) => {
    (acc[m.group] ??= []).push(m);
    return acc;
  }, {});

  const refresh = async () => {
    const res = await fetch('/api/modifiers');
    if (res.ok) {
      const { rows } = await res.json();
      setRows(rows);
      router.refresh();
    }
  };

  const deleteModifier = async (id: string) => {
    if (!confirm('Delete this modifier?')) return;
    const res = await fetch(`/api/modifiers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRows((prev) => prev.filter((m) => m.id !== id));
      router.refresh();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Groups */}
      {Object.keys(grouped).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
                <h3 style={{ margin: 0 }}>{group}</h3>
                <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{items.length} options</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {items.map((m) => (
                  <div key={m.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--space-3) var(--space-4)',
                    background: 'var(--color-background)', borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{m.name}</div>
                      {m.nameLocal && (
                        <div lang="my" style={{ fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
                          {m.nameLocal}
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontWeight: 600,
                      color: m.priceDelta > 0 ? 'var(--color-primary)' : m.priceDelta < 0 ? 'var(--color-success)' : 'var(--color-muted-fg)',
                      marginRight: 'var(--space-3)',
                    }}>
                      {m.priceDelta > 0 ? '+' : ''}<MMK amount={m.priceDelta} />
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteModifier(m.id)}
                      className="btn btn-ghost btn-sm"
                      style={{ minHeight: 32, color: 'var(--color-destructive)' }}
                      aria-label={`Delete ${m.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
          <h3 style={{ marginTop: 0 }}>No modifiers yet</h3>
          <p style={{ color: 'var(--color-muted-fg)' }}>
            Modifiers let customers customise items — size, milk type, add-ons, sweetness. Each adds (or subtracts) from the base price.
          </p>
        </div>
      )}

      {/* Add button / Form */}
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
        >
          <Plus size={16} /> Add modifier
        </button>
      ) : (
        <AddForm
          onDone={async () => { setShowForm(false); await refresh(); }}
          onCancel={() => setShowForm(false)}
          existingGroups={Array.from(new Set(rows.map((r) => r.group)))}
        />
      )}
    </div>
  );
}

function AddForm({
  onDone, onCancel, existingGroups,
}: {
  onDone: () => Promise<void>;
  onCancel: () => void;
  existingGroups: string[];
}) {
  const [group, setGroup]           = useState(existingGroups[0] ?? DEFAULT_GROUPS[0]);
  const [customGroup, setCustomGroup] = useState('');
  const [name, setName]             = useState('');
  const [nameLocal, setNameLocal]   = useState('');
  const [priceDelta, setPriceDelta] = useState('0');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const groupOptions = Array.from(new Set([...DEFAULT_GROUPS, ...existingGroups]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const finalGroup = group === '__custom' ? customGroup.trim() : group;
    if (!finalGroup) { setError('Group is required'); setSaving(false); return; }
    try {
      const res = await fetch('/api/modifiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: finalGroup,
          name: name.trim(),
          nameLocal: nameLocal.trim() || null,
          priceDelta: Number(priceDelta) || 0,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Save failed');
        return;
      }
      await onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ marginTop: 0 }}>Add modifier</h3>

      <div className="form-grid-2" style={{ gap: 'var(--space-3)' }}>
        <div>
          <label>Group *</label>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {groupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value="__custom">+ New group…</option>
          </select>
        </div>
        {group === '__custom' && (
          <div>
            <label>New group name *</label>
            <input value={customGroup} onChange={(e) => setCustomGroup(e.target.value)} maxLength={60} />
          </div>
        )}
      </div>

      <div className="form-grid-2" style={{ gap: 'var(--space-3)' }}>
        <div>
          <label>Name (English) *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Large" />
        </div>
        <div>
          <label>Name (Myanmar)</label>
          <input lang="my" value={nameLocal} onChange={(e) => setNameLocal(e.target.value)} maxLength={120} placeholder="e.g. ကြီး" />
        </div>
      </div>

      <div>
        <label>Price Delta (MMK) *</label>
        <input
          type="number" inputMode="numeric" step="1"
          value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)}
          placeholder="e.g. 500 or -200"
        />
        <small style={{ color: 'var(--color-muted-fg)' }}>Positive = upcharge · Negative = discount · 0 = no change</small>
      </div>

      {error && (
        <div role="alert" style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-destructive-bg)',
          color: 'var(--color-destructive)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save modifier'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          <X size={16} /> Cancel
        </button>
      </div>
    </form>
  );
}
