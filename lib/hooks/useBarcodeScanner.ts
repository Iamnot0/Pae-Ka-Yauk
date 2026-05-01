'use client';

/**
 * useBarcodeScanner — global keystroke listener for USB-HID barcode scanners.
 *
 * Scanners type characters into the focused element at high speed, sometimes
 * followed by Enter or Tab and sometimes nothing. We capture keys app-wide,
 * treat any rapid burst (≥ minLength chars with ≤ gapMs between adjacent
 * keys) as a scan, and fire `onScan(code)` once per burst.
 *
 * Three flush triggers cover every scanner profile:
 *   - Enter/Tab arrives mid-burst → flush + preventDefault so the focused
 *     input/form doesn't act on it.
 *   - No further keys for `gapMs * 2` → timer fires, flush.
 *   - The next keydown's gap exceeds `gapMs` → previous burst is treated
 *     as broken (human typing), buffer resets to that one key.
 *
 * Capture phase guarantees we see keys before any focused <input>. After a
 * successful fire we strip the contaminating chars from the focused field
 * via the React-friendly native setter trick.
 *
 * Set `?debug=scan` in the URL to log every keystroke decision to the
 * console — useful when calibrating gapMs against an unfamiliar scanner.
 */

import { useEffect, useRef } from 'react';

interface Options {
  onScan: (code: string) => void;
  /** Minimum chars required to accept a burst as a scan. */
  minLength?: number;
  /** Maximum ms between adjacent keys for them to count as the same burst. */
  gapMs?: number;
}

function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === 'scan';
}

/**
 * Remove `code` from the tail of the focused input/textarea. Uses the native
 * `value` setter so React sees the change in its synthetic onChange.
 */
function stripFromActiveInput(code: string): void {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
  if (!el.value.endsWith(code)) return;

  const proto = el instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = el.value.slice(0, -code.length);
  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useBarcodeScanner({
  onScan,
  minLength = 4,
  gapMs = 120,
}: Options): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let buffer = '';
    let lastT = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const dbg = debugEnabled();
    const log = dbg ? (...a: unknown[]) => console.log('[scan]', ...a) : () => {};

    const fire = (reason: 'enter' | 'tab' | 'timeout'): boolean => {
      if (timer) { clearTimeout(timer); timer = null; }
      const code = buffer;
      buffer = '';
      lastT = 0;
      if (code.length < minLength) {
        log(`drop (${reason}) code="${code}" len<${minLength}`);
        return false;
      }
      log(`fire (${reason}) code="${code}"`);
      stripFromActiveInput(code);
      // Defer one tick so any pending input mutations settle first.
      setTimeout(() => onScanRef.current(code), 0);
      return true;
    };

    const onKey = (e: KeyboardEvent) => {
      // Modifier combos are never scan output.
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Enter / Tab → early flush. Suppress the trailing key only when we
      // actually fire — so an unrelated Enter in a regular form still works.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (fire(e.key === 'Enter' ? 'enter' : 'tab')) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Single-character keys only (skip Arrow / Shift / F-keys / etc.).
      if (e.key.length !== 1) return;

      const now = performance.now();
      const gap = lastT === 0 ? 0 : now - lastT;

      // Slow gap = human typing or new burst → start fresh from this key.
      if (buffer.length > 0 && gap > gapMs) {
        log(`break gap=${gap.toFixed(0)} > ${gapMs}, was buffer="${buffer}"`);
        buffer = '';
      }
      buffer += e.key;
      lastT = now;
      log(`key="${e.key}" gap=${gap.toFixed(0)} buffer="${buffer}"`);

      // Reschedule the auto-flush. If no more keys arrive within `gapMs * 2`,
      // we treat the burst as ended — supports scanners with no terminator.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fire('timeout'), gapMs * 2);
    };

    document.addEventListener('keydown', onKey, { capture: true });
    if (dbg) console.log('[scan] hook installed', { gapMs, minLength });

    return () => {
      document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
      if (timer) clearTimeout(timer);
    };
  }, [minLength, gapMs]);
}
