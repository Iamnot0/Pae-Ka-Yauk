'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Pencil, Power, PowerOff, Trash2, X } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import type { StaffRow } from '@/lib/repos/users';
import type { Role } from '@/lib/rbac';

const ROLES: Role[] = ['OWNER', 'MANAGER', 'CASHIER', 'BAKER'];

interface Props {
  rows: StaffRow[];
  currentUserId: string;
  currentUserRole: string;
}

type Modal = { kind: 'create' } | { kind: 'edit'; row: StaffRow } | null;

export function StaffsView({ rows, currentUserId, currentUserRole }: Props) {
  const canDelete = currentUserRole === 'OWNER';
  const t = useT();
  const router = useRouter();
  const [modal, setModal] = useState<Modal>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  const onSuspend = async (row: StaffRow) => {
    if (!window.confirm(t('staffs.confirmSuspend'))) return;
    const res = await fetch(`/api/users/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert((body as { error?: string }).error ?? 'Failed');
      return;
    }
    refresh();
  };

  const onReactivate = async (row: StaffRow) => {
    const res = await fetch(`/api/users/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert((body as { error?: string }).error ?? 'Failed');
      return;
    }
    refresh();
  };

  const onDelete = async (row: StaffRow) => {
    const prompt = t('staffs.confirmDelete').replace('{name}', row.name);
    if (!window.confirm(prompt)) return;
    const res = await fetch(`/api/users/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert((body as { error?: string }).error ?? 'Failed');
      return;
    }
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ margin: 0, flex: 1 }}>{t('staffs.title')}</h1>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          style={buttonPrimary}
        >
          <UserPlus size={16} strokeWidth={2} />
          {t('staffs.add')}
        </button>
      </div>

      <div className="card-xl" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <p style={{ padding: 'var(--space-5)', color: 'var(--color-muted-fg)', margin: 0 }}>
            {t('staffs.empty')}
          </p>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 520 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-surface-alt)' }}>
                <tr>
                  <Th>{t('staffs.col.name')}</Th>
                  <Th>{t('staffs.col.email')}</Th>
                  <Th>{t('staffs.col.role')}</Th>
                  <Th>{t('staffs.col.status')}</Th>
                  <Th>{t('staffs.col.lastLogin')}</Th>
                  <Th align="right">—</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelf = row.id === currentUserId;
                  return (
                    <tr key={row.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <strong style={{ fontWeight: 500 }}>{row.name}</strong>
                          {row.nameLocal && (
                            <span lang="my" style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>{row.nameLocal}</span>
                          )}
                        </div>
                      </Td>
                      <Td>{row.email}{isSelf && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--color-muted-fg)' }}>(you)</span>}</Td>
                      <Td>
                        <span style={roleBadge}>{t(`role.${row.role}` as DictKey)}</span>
                      </Td>
                      <Td>
                        <span style={row.active ? statusOk : statusOff}>
                          {t(row.active ? 'staffs.status.active' : 'staffs.status.suspended')}
                        </span>
                      </Td>
                      <Td>{row.lastLoginAt ?? '—'}</Td>
                      <Td align="right">
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => setModal({ kind: 'edit', row })}
                            className="icon-btn"
                            aria-label={t('staffs.edit')}
                            title={t('staffs.edit')}
                            style={{ width: 32, height: 32, minHeight: 32 }}
                          >
                            <Pencil size={15} strokeWidth={2} />
                          </button>
                          {row.active ? (
                            <button
                              type="button"
                              onClick={() => onSuspend(row)}
                              disabled={isSelf || pending}
                              className="icon-btn"
                              aria-label={t('staffs.action.suspend')}
                              title={isSelf ? "Can't suspend yourself" : t('staffs.action.suspend')}
                              style={{ width: 32, height: 32, minHeight: 32, color: isSelf ? 'var(--color-subtle-fg)' : 'var(--color-warning)' }}
                            >
                              <PowerOff size={15} strokeWidth={2} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onReactivate(row)}
                              disabled={pending}
                              className="icon-btn"
                              aria-label={t('staffs.action.reactivate')}
                              title={t('staffs.action.reactivate')}
                              style={{ width: 32, height: 32, minHeight: 32, color: 'var(--color-success)' }}
                            >
                              <Power size={15} strokeWidth={2} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => onDelete(row)}
                              disabled={isSelf || pending}
                              className="icon-btn"
                              aria-label={t('staffs.action.delete')}
                              title={isSelf ? "Can't delete yourself" : t('staffs.action.delete')}
                              style={{ width: 32, height: 32, minHeight: 32, color: isSelf ? 'var(--color-subtle-fg)' : 'var(--color-destructive)' }}
                            >
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <StaffModal
          mode={modal.kind}
          row={modal.kind === 'edit' ? modal.row : undefined}
          isSelf={modal.kind === 'edit' && modal.row.id === currentUserId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Modal form — create OR edit
// ────────────────────────────────────────────────────────────────────
function StaffModal({
  mode, row, isSelf, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  row?: StaffRow;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(row?.name ?? '');
  const [nameLocal, setNameLocal] = useState(row?.nameLocal ?? '');
  const [email, setEmail] = useState(row?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>((row?.role ?? 'CASHIER') as Role);
  const [active, setActive] = useState(row?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    try {
      const url = mode === 'create' ? '/api/users' : `/api/users/${row!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const body =
        mode === 'create'
          ? { email, password, name, nameLocal: nameLocal || null, role }
          : {
              name,
              nameLocal: nameLocal || null,
              role,
              active,
              ...(password ? { password } : {}),
            };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr((b as { error?: string }).error ?? `Request failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={onSubmit}
        className="modal-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2 style={{ margin: 0, flex: 1 }}>{t(mode === 'create' ? 'staffs.add' : 'staffs.edit')}</h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <Field label={t('staffs.field.name')}>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </Field>

        <Field label={t('staffs.field.nameLocal')}>
          <input type="text" lang="my" value={nameLocal ?? ''} onChange={(e) => setNameLocal(e.target.value)} disabled={busy} />
        </Field>

        <Field label={t('staffs.field.email')}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || mode === 'edit'}
            autoComplete="off"
          />
        </Field>

        <Field
          label={t('staffs.field.password')}
          hint={mode === 'edit' ? t('staffs.field.passwordHint') : undefined}
        >
          <input
            type="password"
            minLength={6}
            required={mode === 'create'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoComplete="new-password"
          />
        </Field>

        <Field label={t('staffs.field.role')}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy || isSelf}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role.${r}` as DictKey)}</option>
            ))}
          </select>
          {isSelf && (
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-fg)', marginTop: 4 }}>
              You can&rsquo;t change your own role.
            </span>
          )}
        </Field>

        {mode === 'edit' && (
          <Field label={t('staffs.field.active')}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: isSelf ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                disabled={busy || isSelf}
              />
              <span>{t(active ? 'staffs.status.active' : 'staffs.status.suspended')}</span>
            </label>
          </Field>
        )}

        {err && (
          <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--color-destructive-bg)', color: 'var(--color-destructive)', fontSize: '0.875rem' }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonGhost}>
            {t('common.cancel')}
          </button>
          <div style={{ flex: 1 }} />
          <button type="submit" disabled={busy} style={buttonPrimary}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Styles + primitives
// ────────────────────────────────────────────────────────────────────
const buttonPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
  padding: '8px 16px', borderRadius: 'var(--radius-md)',
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  fontWeight: 500, cursor: 'pointer',
};

const buttonGhost: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 'var(--radius-md)',
  background: 'transparent', color: 'var(--color-foreground)',
  border: '1px solid var(--color-border)',
  fontWeight: 500, cursor: 'pointer',
};

const roleBadge: React.CSSProperties = {
  display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-pill)',
  background: 'var(--color-surface-alt)', color: 'var(--color-foreground)',
  fontSize: '0.75rem', fontWeight: 500,
};

const statusOk: React.CSSProperties = {
  display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-pill)',
  background: 'var(--color-success-bg)', color: 'var(--color-success)',
  fontSize: '0.75rem', fontWeight: 500,
};

const statusOff: React.CSSProperties = {
  display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-pill)',
  background: 'var(--color-destructive-bg)', color: 'var(--color-destructive)',
  fontSize: '0.75rem', fontWeight: 500,
};

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      padding: 'var(--space-2) var(--space-3)',
      textAlign: align,
      fontWeight: 600,
      color: 'var(--color-muted-fg)',
      fontSize: '0.75rem',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
    }}>{children}</th>
  );
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: align }}>{children}</td>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-foreground)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-fg)' }}>{hint}</span>}
    </label>
  );
}
