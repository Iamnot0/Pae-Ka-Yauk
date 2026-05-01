import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display, Padauk, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { LocaleProvider } from '@/lib/i18n/useT';
import { ThemeProvider, RESOLVED_COOKIE } from '@/lib/theme/useTheme';
import { ServiceWorkerRegister } from '@/components/global/ServiceWorkerRegister';
import './globals.css';

// ---------------------------------------------------------------------------
// Fonts (self-hosted via next/font — no FOUT, GDPR-friendly, Myanmar-friendly)
// ---------------------------------------------------------------------------
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const padauk = Padauk({
  subsets: ['myanmar'],
  weight: ['400', '700'],
  variable: '--font-myanmar',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// ---------------------------------------------------------------------------
// Viewport (CRITICAL for iOS notch — viewportFit: 'cover')
// ---------------------------------------------------------------------------
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,               // never disable zoom (accessibility)
  viewportFit: 'cover',          // makes env(safe-area-inset-*) actually work
  themeColor: '#6B4423',
};

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: {
    default: 'Pae Ka Yauk · ပဲကရောက်',
    template: '%s · Pae Ka Yauk',
  },
  description: 'Bakery & Coffee POS for Pae Ka Yauk (ပဲကရောက်)',
  manifest: '/manifest.webmanifest',
  applicationName: 'Pae Ka Yauk POS',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ပဲကရောက်',
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  icons: {
    // PNG-only: the real Pae Ka Yauk logo is a photograph (raster), so the
    // old icon.svg placeholder monogram has been retired. Browsers pick the
    // best size from this list for the active tab + bookmarks.
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/icons/favicon-32.png' }],
    apple: [
      { url: '/icons/apple-touch-icon-180.png', sizes: '180x180' },
      { url: '/icons/apple-touch-icon-167.png', sizes: '167x167' },
      { url: '/icons/apple-touch-icon-152.png', sizes: '152x152' },
      { url: '/icons/apple-touch-icon-120.png', sizes: '120x120' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Root layout — bare. Each route group ((app), (auth)) decides its own shell.
//
// Theme stamping happens server-side from a cookie ThemeProvider writes on
// the client. First-ever visit (no cookie yet) defaults to 'light' — the
// client mounts, reads localStorage / system preference, writes the cookie,
// and subsequent renders are correct. Solves React 19's script-tag warning
// by removing the inline script entirely.
// ---------------------------------------------------------------------------
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const stamped = cookieStore.get(RESOLVED_COOKIE)?.value;
  const dataTheme: 'light' | 'dark' = stamped === 'dark' ? 'dark' : 'light';

  return (
    <html
      lang="my-MM"
      data-theme={dataTheme}
      className={`${inter.variable} ${playfair.variable} ${padauk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <LocaleProvider initial="my">{children}</LocaleProvider>
        </ThemeProvider>
        <ServiceWorkerRegister />
        <Analytics />
      </body>
    </html>
  );
}
