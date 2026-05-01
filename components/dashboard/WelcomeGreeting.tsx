'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';

function greetingKeyFor(hour: number): DictKey {
  if (hour >= 5 && hour < 12) return 'greet.morning';
  if (hour >= 12 && hour < 17) return 'greet.afternoon';
  if (hour >= 17 && hour < 21) return 'greet.evening';
  return 'greet.night';
}

export function WelcomeGreeting({ userName }: { userName: string }) {
  const t = useT();
  // Null on first render (both SSR and client hydrate identically);
  // populate with real local-time greeting after mount to avoid
  // server-timezone vs client-timezone hydration mismatches.
  const [key, setKey] = useState<DictKey | null>(null);

  useEffect(() => {
    const tick = () => setKey(greetingKeyFor(new Date().getHours()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <h1 style={{ margin: 0, fontSize: '1.75rem', lineHeight: 1.2 }}>
      {key && <>{t(key)}, </>}
      <span style={{ color: 'var(--color-primary)' }}>{userName}</span>
    </h1>
  );
}
