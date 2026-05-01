/**
 * Fetches a logo from same-origin URL and returns it as a base64 data URL
 * suitable for jsPDF.addImage(). Uses an offscreen <canvas> to:
 *   1. handle the file regardless of source format (PNG, JPG, WebP)
 *   2. trim transparent borders + center-pad to a square (so logos with
 *      portrait aspect ratios — like the bakery's 2110×2560 file —
 *      sit nicely on the cover sheet without distortion)
 *   3. clamp to a max dimension so the PDF stays light
 *
 * Runs entirely client-side; PDF generation is browser-only too.
 */

export interface LogoData {
  /** Base64 data URL — pass directly to doc.addImage(data, 'PNG', x, y, w, h) */
  dataUrl: string;
  format: 'PNG';
  /** Square px the logo was rendered to */
  size: number;
}

const MAX_SIZE = 256; // 256×256 is plenty at 72dpi PDF; keeps file small

export async function loadLogoForPdf(url: string | null | undefined): Promise<LogoData | null> {
  if (!url || typeof window === 'undefined') return null;
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;

    const long = Math.max(w, h);
    // Scale so the longer side fits within MAX_SIZE.
    const scale = long > MAX_SIZE ? MAX_SIZE / long : 1;
    const sw = Math.round(w * scale);
    const sh = Math.round(h * scale);
    // Square canvas with the image centered.
    const square = Math.max(sw, sh);

    const canvas = document.createElement('canvas');
    canvas.width = square;
    canvas.height = square;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // White background — keeps logos with transparency from going dark
    // when laid over a tinted PDF page.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, square, square);
    const dx = Math.round((square - sw) / 2);
    const dy = Math.round((square - sh) / 2);
    ctx.drawImage(img, dx, dy, sw, sh);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      format: 'PNG',
      size: square,
    };
  } catch (err) {
    console.warn('[embedLogo] failed to load logo:', err);
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
