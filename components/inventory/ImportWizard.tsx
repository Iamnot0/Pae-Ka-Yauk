'use client';

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Upload, Download, CheckCircle2, AlertCircle, FileSpreadsheet,
  Check, ArrowLeft, ArrowRight, Sparkles, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { autoDetect, type DetectionResult } from '@/lib/import/autoDetect';
import type { ParseResult } from '@/lib/import/parse';
import type {
  MaterialCategory,
  StorageZone,
  Unit,
  TrackingMode,
  CreateMaterialInput,
} from '@/lib/repos/materials';

const CATEGORIES: MaterialCategory[] = [
  'FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING',
  'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR',
  'BEVERAGE_BASE', 'PACKAGING', 'OTHER',
];
const ZONES: StorageZone[] = ['COLD', 'DRY', 'SUPPLIES'];
const UNITS: Unit[] = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'PACK', 'CARTON', 'BOTTLE', 'CAN'];

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_LIMIT = 50;

type Step = 'upload' | 'preview' | 'done';

interface EditableRow extends CreateMaterialInput {
  errors: string[];
  _inferred: { category: boolean; storageZone: boolean; baseUnit: boolean };
}

interface ImportResult {
  createdCount: number;
  skipped: Array<{ name: string; reason: string }>;
  total: number;
}

// ===========================================================================

export function ImportWizard() {
  const router = useRouter();
  const t = useT();

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  // -------------------------------------------------------------------------
  // Upload step
  // -------------------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setParseError('');
    if (file.size > MAX_FILE_BYTES) {
      setParseError('File too large — max 5 MB');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import/materials/parse', { method: 'POST', body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not read file');
      }
      const p = (await res.json()) as ParseResult;
      setParsed(p);

      // Auto-detect everything
      const d = autoDetect(p);
      setDetection(d);
      setRows(d.rows.map((r) => ({ ...r })));
      setStep('preview');
    } catch (e) {
      setParseError((e as Error).message || t('import.errorReadFile'));
    }
  }, [t]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  // -------------------------------------------------------------------------
  // Per-row editing (user overrides detection)
  // -------------------------------------------------------------------------

  const updateRow = useCallback((idx: number, patch: Partial<EditableRow>) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  // Bulk-apply category/zone/unit to ALL rows at once
  const bulkApply = useCallback((patch: { category?: MaterialCategory; storageZone?: StorageZone; baseUnit?: Unit }) => {
    setRows((prev) => prev.map((r) => ({ ...r, ...patch })));
  }, []);

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const errorRows = rows.length - validRows.length;

  const commit = async () => {
    setCommitting(true);
    setCommitError('');
    try {
      const payload = {
        rows: validRows.map((r) => ({
          name: r.name,
          nameLocal: r.nameLocal ?? null,
          code: r.code ?? null,
          category: r.category,
          storageZone: r.storageZone,
          baseUnit: r.baseUnit,
          trackBy: r.trackBy,
          replenishOnly: r.replenishOnly ?? false,
          tracksExpiry: r.tracksExpiry ?? false,
          enforceFifo: r.enforceFifo ?? false,
          parLevel: r.parLevel ?? null,
          lastUnitCost: r.lastUnitCost ?? null,
          notes: r.notes ?? null,
        })),
      };
      const res = await fetch('/api/import/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCommitError(d.error || 'Import failed');
        return;
      }
      const r = (await res.json()) as ImportResult;
      setResult(r);
      setStep('done');
      router.refresh();
    } finally {
      setCommitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <StepBar step={step} />

      {step === 'upload' && (
        <UploadStep
          dragging={dragging}
          setDragging={setDragging}
          onDrop={onDrop}
          onFileChange={onFileChange}
          fileInputRef={fileInputRef}
          parseError={parseError}
          t={t}
        />
      )}

      {step === 'preview' && parsed && detection && (
        <PreviewStep
          parsed={parsed}
          detection={detection}
          rows={rows}
          validCount={validRows.length}
          errorCount={errorRows}
          committing={committing}
          commitError={commitError}
          t={t}
          onUpdateRow={updateRow}
          onBulkApply={bulkApply}
          onBack={() => { setStep('upload'); setParsed(null); setDetection(null); setRows([]); }}
          onCommit={commit}
        />
      )}

      {step === 'done' && result && (
        <DoneStep
          result={result}
          t={t}
          onAnother={() => {
            setStep('upload');
            setParsed(null);
            setDetection(null);
            setRows([]);
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Step bar (3 visible steps)
// ===========================================================================

function StepBar({ step }: { step: Step }) {
  const t = useT();
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'upload',  label: t('import.step.upload') },
    { id: 'preview', label: t('import.step.preview') },
    { id: 'done',    label: t('import.step.done') },
  ];
  const currentIdx = steps.findIndex((s) => s.id === step);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '50%',
              background: done ? 'var(--color-success)' : active ? 'var(--color-primary)' : 'var(--color-surface-alt)',
              color: (done || active) ? '#fff' : 'var(--color-muted-fg)',
              fontWeight: 600, fontSize: 13, flexShrink: 0,
            }}>
              {done ? <Check size={14} /> : i + 1}
            </div>
            <span style={{ fontWeight: active ? 600 : 500, color: active ? 'var(--color-foreground)' : 'var(--color-muted-fg)' }}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span style={{ width: 24, height: 1, background: 'var(--color-border)', margin: '0 var(--space-1)' }} />}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Upload step
// ===========================================================================

function UploadStep({
  dragging, setDragging, onDrop, onFileChange, fileInputRef, parseError, t,
}: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  parseError: string;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-7) var(--space-5)',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'var(--color-surface-alt)' : 'transparent',
          transition: 'all var(--transition-fast)',
        }}
      >
        <FileSpreadsheet size={48} style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-3)' }} />
        <h3 style={{ margin: 0 }}>{t('import.dropFile')}</h3>
        <p style={{ color: 'var(--color-muted-fg)', marginTop: 'var(--space-2)' }}>{t('import.fileTypes')}</p>
        <div style={{ marginTop: 'var(--space-3)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-accent)', fontSize: '0.875rem', fontWeight: 500 }}>
          <Sparkles size={14} /> {t('import.autoHint')}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <div style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
        <a href="/api/import/materials?template=true" className="btn btn-ghost" download>
          <Download size={16} /> {t('import.downloadTemplate')}
        </a>
      </div>

      {parseError && (
        <div role="alert" style={{
          marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-destructive-bg)', border: '1px solid var(--color-destructive)',
          color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)',
        }}>
          {parseError}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Preview step — auto-detection shown, per-row editable
// ===========================================================================

function PreviewStep({
  parsed, detection, rows, validCount, errorCount, committing, commitError, t,
  onUpdateRow, onBulkApply, onBack, onCommit,
}: {
  parsed: ParseResult;
  detection: DetectionResult;
  rows: EditableRow[];
  validCount: number;
  errorCount: number;
  committing: boolean;
  commitError: string;
  t: ReturnType<typeof useT>;
  onUpdateRow: (idx: number, patch: Partial<EditableRow>) => void;
  onBulkApply: (p: { category?: MaterialCategory; storageZone?: StorageZone; baseUnit?: Unit }) => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const topCategories = detection.summary.byCategory.slice(0, 4);

  const previewRows = rows.slice(0, PREVIEW_LIMIT);

  return (
    <>
      {/* Detection summary card */}
      <div className="card" style={{ borderColor: 'var(--color-accent)', background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-alt) 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <Sparkles size={20} style={{ color: 'var(--color-accent)' }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{t('import.autoDetectedFrom').replace('{file}', parsed.fileName)}</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--color-muted-fg)', fontSize: '0.9375rem' }}>
              {t('import.summary')
                .replace('{total}', String(rows.length))
                .replace('{cats}', String(detection.summary.byCategory.length))
                .replace('{valid}', String(validCount))
                .replace('{errors}', errorCount > 0 ? t('import.summaryErrors').replace('{n}', String(errorCount)) : '')}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowDetails(!showDetails)}
            style={{ minHeight: 32 }}
          >
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {showDetails ? t('import.hide') : t('import.details')}
          </button>
        </div>

        {/* Top categories quick chips */}
        {topCategories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            {topCategories.map((c) => (
              <span key={c.category} className="pill" style={{ background: 'var(--color-surface-alt)', color: 'var(--color-foreground)' }}>
                {c.category.replace(/_/g, ' ')} · {c.count}
              </span>
            ))}
            {detection.summary.byCategory.length > 4 && (
              <span className="pill" style={{ background: 'transparent', color: 'var(--color-muted-fg)' }}>
                +{detection.summary.byCategory.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Collapsible details */}
        {showDetails && (
          <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
            <h4 style={{ margin: '0 0 var(--space-2)', fontSize: '0.875rem', color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('import.mapping')}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {(['name', 'nameLocal', 'code', 'parLevel', 'lastUnitCost', 'notes'] as const).map((f) => (
                <div key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--color-muted-fg)' }}>{f}</span>
                  <span style={{ fontWeight: 500 }}>{detection.columns[f] ?? '—'}</span>
                </div>
              ))}
            </div>

            <h4 style={{ margin: '0 0 var(--space-2)', fontSize: '0.875rem', color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('import.bulkApply')}
            </h4>
            <div className="form-grid-3" style={{ gap: 'var(--space-3)' }}>
              <div>
                <label>{t('import.bulkZone')}</label>
                <select onChange={(e) => e.target.value && onBulkApply({ storageZone: e.target.value as StorageZone })} defaultValue="">
                  <option value="">—</option>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label>{t('import.bulkUnit')}</label>
                <select onChange={(e) => e.target.value && onBulkApply({ baseUnit: e.target.value as Unit })} defaultValue="">
                  <option value="">—</option>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label>{t('import.bulkCategory')}</label>
                <select onChange={(e) => e.target.value && onBulkApply({ category: e.target.value as MaterialCategory })} defaultValue="">
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Per-row preview table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>{t('import.rowsHeader')}</h3>
            <p style={{ color: 'var(--color-muted-fg)', margin: '4px 0 0', fontSize: '0.875rem' }}>
              {t('import.previewHint').replace('{n}', String(Math.min(rows.length, PREVIEW_LIMIT)))}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <span className="pill pill-online">
              <CheckCircle2 size={14} /> {validCount} {t('import.valid')}
            </span>
            {errorCount > 0 && (
              <span className="pill pill-offline">
                <AlertCircle size={14} /> {errorCount} {t('import.errors')}
              </span>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-alt)' }}>
                <th style={{ padding: 'var(--space-3)', textAlign: 'left', width: 40 }}>#</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'left' }}>{t('inv.th.name')}</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'left' }}>{t('inv.th.category')}</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'left' }}>{t('inv.th.zone')}</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'left' }}>{t('inv.th.unit')}</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>{t('inv.th.parLevel')}</th>
                <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>{t('inv.th.lastCost')}</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => {
                const hasErr = r.errors.length > 0;
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--color-border)', background: hasErr ? 'var(--color-destructive-bg)' : 'transparent' }}>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--color-subtle-fg)' }}>{i + 1}</td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <div style={{ fontWeight: 500 }}>
                        {r.code && <span style={{ color: 'var(--color-subtle-fg)', marginRight: 6, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{r.code}</span>}
                        {r.name || <span style={{ color: 'var(--color-destructive)' }}>{t('import.rowEmpty')}</span>}
                      </div>
                      {r.nameLocal && <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{r.nameLocal}</div>}
                      {hasErr && <div style={{ color: 'var(--color-destructive)', fontSize: '0.8125rem', marginTop: 2 }}>{r.errors.join(' · ')}</div>}
                    </td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <InlineSelect
                        value={r.category}
                        onChange={(v) => onUpdateRow(i, { category: v as MaterialCategory })}
                        options={CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
                        inferred={r._inferred.category}
                      />
                    </td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <InlineSelect
                        value={r.storageZone!}
                        onChange={(v) => onUpdateRow(i, { storageZone: v as StorageZone })}
                        options={ZONES.map((z) => ({ value: z, label: z }))}
                        inferred={r._inferred.storageZone}
                      />
                    </td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <InlineSelect
                        value={r.baseUnit}
                        onChange={(v) => onUpdateRow(i, { baseUnit: v as Unit })}
                        options={UNITS.map((u) => ({ value: u, label: u }))}
                        inferred={r._inferred.baseUnit}
                      />
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right' }} className="tabular-nums">{r.parLevel ?? '—'}</td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right' }} className="tabular-nums">{r.lastUnitCost ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > PREVIEW_LIMIT && (
          <div style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'center', color: 'var(--color-muted-fg)', borderTop: '1px solid var(--color-border)', fontSize: '0.875rem' }}>
            {t('import.moreRows').replace('{n}', String(rows.length - PREVIEW_LIMIT))}
          </div>
        )}
      </div>

      {commitError && (
        <div role="alert" className="card" style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive)', background: 'var(--color-destructive-bg)' }}>
          {commitError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={committing}>
          <ArrowLeft size={16} /> {t('import.back')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onCommit} disabled={committing || validCount === 0}>
          {committing ? t('import.committing') : t('import.commitBtn').replace('{n}', String(validCount))}
          {!committing && <ArrowRight size={16} />}
        </button>
      </div>
    </>
  );
}

// ===========================================================================
// Inline select — shows a subtle "inferred" dot when the value came from
// auto-detection (not the user/file). Disappears once user changes it.
// ===========================================================================

function InlineSelect({
  value, onChange, options, inferred,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  inferred: boolean;
}) {
  const t = useT();
  const [changed, setChanged] = useState(false);
  const showDot = inferred && !changed;
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {showDot && (
        <span
          title={t('import.inferredTooltip')}
          style={{
            position: 'absolute',
            left: -10, top: '50%', transform: 'translateY(-50%)',
            width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)',
            pointerEvents: 'none',
          }}
        />
      )}
      <select
        value={value}
        onChange={(e) => { setChanged(true); onChange(e.target.value); }}
        style={{
          padding: '4px 8px',
          minHeight: 'auto',
          fontSize: '0.8125rem',
          width: 'auto',
          minWidth: 100,
          background: 'var(--color-surface)',
          border: `1px solid var(--color-border${showDot ? '' : '-strong'})`,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ===========================================================================
// Done step
// ===========================================================================

function DoneStep({
  result, t, onAnother,
}: {
  result: ImportResult;
  t: ReturnType<typeof useT>;
  onAnother: () => void;
}) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7) var(--space-5)' }}>
      <CheckCircle2 size={56} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
      <h2 style={{ margin: 0 }}>{t('import.successTitle')}</h2>
      <p style={{ color: 'var(--color-foreground)', fontSize: '1.125rem', marginTop: 'var(--space-3)' }}>
        {t('import.successCreated').replace('{n}', String(result.createdCount))}
        {result.skipped.length > 0 && ` · ${t('import.successSkipped').replace('{n}', String(result.skipped.length))}`}
      </p>

      {result.skipped.length > 0 && (
        <details style={{ textAlign: 'left', margin: 'var(--space-4) auto', maxWidth: 520 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-muted-fg)' }}>
            {t('import.showSkipped').replace('{n}', String(result.skipped.length))}
          </summary>
          <ul style={{ marginTop: 'var(--space-2)', fontSize: '0.875rem' }}>
            {result.skipped.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <strong>{s.name}</strong> <span style={{ color: 'var(--color-muted-fg)' }}>— {s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Link href="/inventory" className="btn btn-primary">
          {t('import.viewMaterials')}
        </Link>
        <button type="button" className="btn btn-secondary" onClick={onAnother}>
          <RefreshCw size={16} /> {t('import.importAnother')}
        </button>
      </div>
    </div>
  );
}
