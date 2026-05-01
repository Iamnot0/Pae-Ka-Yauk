'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

export function LogoutButton() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      className="icon-btn icon-btn--avatar"
      onClick={onClick}
      disabled={busy}
      aria-label={t('nav.logout')}
      title={t('nav.logout')}
    >
      <User size={18} strokeWidth={2} />
    </button>
  );
}
