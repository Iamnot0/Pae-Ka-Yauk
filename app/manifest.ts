import type { MetadataRoute } from 'next';

/**
 * PWA manifest — drives Add-to-Home-Screen on Android/iOS/desktop, plus the
 * Chrome install prompt and the macOS dock icon when standalone. Served at
 * /manifest.webmanifest by Next.js App Router. The static file alternative
 * in public/ would collide with this route — keep this single source of truth.
 *
 * Icons are regenerated from public/uploads/tenants/pae-ka-yauk/logo.jpg via
 * the ImageMagick recipe in public/icons/README.md. The old icon.svg "P"
 * monogram is retired — every modern browser handles PNGs cleanly and the
 * real logo is a raster.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pae Ka Yauk · ပဲကရောက်',
    short_name: 'ပဲကရောက်',
    description: 'Bakery & Coffee POS for Pae Ka Yauk (ပဲကရောက်)',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FAF7F2',
    theme_color: '#6B4423',
    lang: 'my-MM',
    categories: ['business', 'productivity', 'food'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Point of Sale',
        short_name: 'POS',
        url: '/pos',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Stocks',
        short_name: 'Stocks',
        url: '/stocks',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
