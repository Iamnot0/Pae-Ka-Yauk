'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface Props {
  value: string;              // e.g. "PKY00003"
  height?: number;            // px — tuned for 80mm thermal
  width?: number;             // bar unit width
  displayValue?: boolean;     // show the value as text beneath
}

/**
 * Inline SVG barcode — Code128 encoding, scannable at any print resolution.
 *
 * Why SVG (not canvas): vector scales cleanly for both 80mm thermal and A4,
 * no pixel blur when the browser rasterises for print. Also smaller DOM.
 *
 * Why Code128 (not EAN/UPC): handles alphanumeric ("PKY00003") which the
 * numeric-only retail codes can't. Industry standard for receipts.
 */
export function ReceiptBarcode({ value, height = 40, width = 1.4, displayValue = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width,
        height,
        displayValue,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (e) {
      console.error('[ReceiptBarcode] encode failed:', (e as Error).message);
    }
  }, [value, height, width, displayValue]);

  return (
    <svg
      ref={svgRef}
      aria-label={`Barcode for ${value}`}
      style={{ display: 'block', margin: '0 auto', maxWidth: '80%' }}
    />
  );
}
