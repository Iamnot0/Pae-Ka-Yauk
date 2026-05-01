'use client';

import { useLocale } from '@/lib/i18n/useT';
import { formatMMK, type FormatMmkOptions } from '@/lib/format/mmk';

interface Props extends Omit<FormatMmkOptions, 'locale'> {
  amount: number | string | null | undefined;
  className?: string;
}

/**
 * Currency display — always uses tabular numerals so digits don't wiggle.
 * Respects current locale + Myanmar-numeral preference.
 *
 *   <MMK amount={2500} />            →  "2,500 ကျပ်"
 *   <MMK amount={2500} unitSuffix={false} />  →  "2,500"
 */
export function MMK({ amount, className, ...opts }: Props) {
  const { locale } = useLocale();
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      {formatMMK(amount, { ...opts, locale })}
    </span>
  );
}
