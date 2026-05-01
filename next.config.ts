import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Dev-only: allow phones/tablets on the LAN to load HMR + JS bundles.
  // Without this, Next.js 16 blocks /_next/* as cross-origin on any
  // non-localhost host → JS never hydrates → every button looks dead.
  //
  // Covers every private (RFC1918) + link-local IPv4 range so any
  // home/office/hotel WiFi just works without code changes:
  //   10.0.0.0/8         (corporate)
  //   172.16.0.0/12      (docker/hotel)
  //   192.168.0.0/16     (most home routers)
  //   169.254.0.0/16     (link-local fallback)
  //   *.local            (mDNS — "pky.local" etc.)
  allowedDevOrigins: [
    '10.*.*.*',
    '172.16.*.*', '172.17.*.*', '172.18.*.*', '172.19.*.*',
    '172.20.*.*', '172.21.*.*', '172.22.*.*', '172.23.*.*',
    '172.24.*.*', '172.25.*.*', '172.26.*.*', '172.27.*.*',
    '172.28.*.*', '172.29.*.*', '172.30.*.*', '172.31.*.*',
    '192.168.*.*',
    '169.254.*.*',
    '*.local',
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
