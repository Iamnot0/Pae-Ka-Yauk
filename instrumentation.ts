/**
 * Next.js instrumentation hook — runs ONCE when the server starts, before
 * any route handler module loads. We use it to fix Node 22's IPv6-first
 * DNS preference, which causes undici fetch to hang for ~10s when the host
 * machine has AAAA records reachable via the OS resolver but no actual
 * IPv6 path (common on dev machines behind a Proton/Wireguard VPN whose
 * tun device only carries IPv4).
 *
 * Curl uses libcurl's Happy Eyeballs and side-steps this; undici doesn't
 * cancel stalled IPv6 branches as aggressively, so a single Neon HTTP call
 * can stall the whole request budget. Forcing 'ipv4first' makes Node match
 * curl's behavior — IPv4 is tried first, IPv6 only on IPv4 failure.
 *
 * Safe to ship: on a host with healthy IPv6 (e.g. Vercel infra), Node still
 * prefers IPv4 but has zero added latency since IPv4 also resolves cleanly.
 * No-op on edge / non-Node runtimes (the dynamic import guards).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('node:dns');
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv4first');
    }
  }
}
