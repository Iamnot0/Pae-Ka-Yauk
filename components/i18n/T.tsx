'use client';

import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';

/**
 * Translated text component.
 *
 *   <T k="pos.payNow" />    →  renders "ငွေရှင်းမည်" or "Pay Now" based on locale
 */
export function T({ k, className }: { k: DictKey; className?: string }) {
  const t = useT();
  return <span className={className}>{t(k)}</span>;
}
