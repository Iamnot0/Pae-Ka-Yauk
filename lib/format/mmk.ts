/**
 * MMK (Myanmar Kyat) formatting.
 *
 * MMK has no practical fractional unit — nobody prices a bun at 2,500.50 Kyat.
 * We store integers in the DB; formatting rounds to whole kyat.
 *
 * Default: Arabic numerals (universal readability: "2,500 ကျပ်").
 * Opt-in: Myanmar numerals via `useMyanmarNumerals = true` → "၂,၅၀၀ ကျပ်".
 */

type Locale = 'my' | 'en';

const MYANMAR_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];

function toMyanmarNumerals(s: string): string {
  return s.replace(/[0-9]/g, (d) => MYANMAR_DIGITS[parseInt(d, 10)]);
}

export interface FormatMmkOptions {
  locale?: Locale;
  myanmarNumerals?: boolean;       // override env default
  unitSuffix?: boolean;            // true: append "ကျပ်" / "MMK"
  symbolPosition?: 'suffix' | 'none';
}

export function formatMMK(
  amount: number | string | null | undefined,
  opts: FormatMmkOptions = {}
): string {
  if (amount === null || amount === undefined || amount === '') return '—';

  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(numeric)) return '—';

  const rounded = Math.round(numeric);
  const locale = opts.locale ?? 'my';
  const useMyanmarNumerals =
    opts.myanmarNumerals ??
    (typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_USE_MYANMAR_NUMERALS === 'true');

  let formatted = rounded.toLocaleString('en-US');  // always group with comma
  if (useMyanmarNumerals) formatted = toMyanmarNumerals(formatted);

  const suffix = opts.symbolPosition === 'none'
    ? ''
    : locale === 'my' ? ' ကျပ်' : ' MMK';

  return formatted + (opts.unitSuffix === false ? '' : suffix);
}

/**
 * Parse a user-typed MMK string back to number.
 * Accepts: "2,500", "2500", "၂,၅၀၀", "2,500 ကျပ်"
 */
export function parseMMK(input: string): number | null {
  if (!input) return null;

  let s = input.trim();
  // strip suffixes
  s = s.replace(/ကျပ်|MMK|mmk/g, '').trim();
  // Myanmar digits → Arabic
  s = s.replace(/[၀-၉]/g, (d) => String(MYANMAR_DIGITS.indexOf(d)));
  // strip commas and whitespace
  s = s.replace(/[, ]/g, '');

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
