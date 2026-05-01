/**
 * Locale + tz-aware datetime formatting.
 *
 * Server returns naked UTC ISO strings. The browser formats them via
 * `Intl.DateTimeFormat()` which reads the OS time zone — that's the
 * "network-based" tz Boss asked for: NTP-synced from the OS, accurate
 * regardless of where the data was stored or where the user is sitting.
 *
 *   formatDateTime("2026-04-27T05:31:23Z")
 *     → in Yangon: "27/04/2026, 12:01"
 *     → in Singapore: "27/04/2026, 13:01"
 *     → in New York: "27/04/2026, 01:31"
 *
 * Day-bucketing for SQL aggregations is a separate concern — the server
 * still groups in a configured tz (default Asia/Yangon, can be made
 * tenant-configurable later) so daily charts have stable boundaries that
 * don't shift if the owner travels.
 */

type DateInput = string | number | Date | null | undefined;

function asDate(d: DateInput): Date | null {
  if (d == null || d === '') return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "27/04/2026, 12:01" — date + 24h time, browser tz */
export function formatDateTime(d: DateInput, locale: 'en' | 'my' = 'en'): string {
  const dt = asDate(d);
  if (!dt) return '—';
  const fmt = new Intl.DateTimeFormat(locale === 'my' ? 'my-MM' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(dt);
}

/** "27/04/2026" — date only, browser tz */
export function formatDate(d: DateInput, locale: 'en' | 'my' = 'en'): string {
  const dt = asDate(d);
  if (!dt) return '—';
  const fmt = new Intl.DateTimeFormat(locale === 'my' ? 'my-MM' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(dt);
}

/** "12:01" — time only, browser tz */
export function formatTime(d: DateInput, locale: 'en' | 'my' = 'en'): string {
  const dt = asDate(d);
  if (!dt) return '—';
  const fmt = new Intl.DateTimeFormat(locale === 'my' ? 'my-MM' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(dt);
}

/** "Apr 27" / "27 Apr" — short month label for chart x-axes */
export function formatShortDay(d: DateInput, locale: 'en' | 'my' = 'en'): string {
  const dt = asDate(d);
  if (!dt) return '—';
  const fmt = new Intl.DateTimeFormat(locale === 'my' ? 'my-MM' : 'en-GB', {
    month: 'short', day: '2-digit',
  });
  return fmt.format(dt);
}

/** Returns the user's resolved tz, e.g. "Asia/Yangon" or "America/New_York". */
export function getResolvedTimeZone(): string {
  if (typeof Intl === 'undefined') return 'UTC';
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Tenant-tz datetime — pinned to a specific timezone regardless of where
 * the document is opened. Used on PDFs so two managers comparing the same
 * closing report read the same generated-at, even if one is travelling.
 *
 *   formatDateTimeInTz("2026-04-27T05:31:23Z", "Asia/Yangon") → "27/04/2026, 12:01"
 */
export function formatDateTimeInTz(d: DateInput, tz: string, locale: 'en' | 'my' = 'en'): string {
  const dt = asDate(d);
  if (!dt) return '—';
  const fmt = new Intl.DateTimeFormat(locale === 'my' ? 'my-MM' : 'en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(dt);
}

/**
 * Period label as a calendar-date range. Closing reports get filed; "Today"
 * or "Last 7 days" rots within a week.
 *
 *   daily   → "27 Apr 2026"
 *   weekly  → "21 – 27 Apr 2026"     (today – 6 → today)
 *   monthly → "29 Mar – 27 Apr 2026" (today – 29 → today)
 *
 * Computed in the tenant tz so a midnight-crossing browser doesn't shift
 * the printed range.
 */
export function formatPeriodRange(
  period: 'daily' | 'weekly' | 'monthly',
  tz = 'Asia/Yangon',
  now: Date = new Date(),
): string {
  const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const fmtDay = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short' });
  const fmtFull = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
  if (days === 1) return fmtFull.format(now);
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  // If the range crosses a year boundary, show the year on the start side too;
  // else only on the end side to keep the line short.
  const startYear = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric' }).format(start);
  const endYear   = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric' }).format(now);
  const startLabel = startYear === endYear ? fmtDay.format(start) : fmtFull.format(start);
  return `${startLabel} – ${fmtFull.format(now)}`;
}
