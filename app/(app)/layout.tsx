import { redirect } from 'next/navigation';
import { Header } from '@/components/global/Header';
import { Footer } from '@/components/global/Footer';
import { Sidebar } from '@/components/global/Sidebar';
import { OfflineBoot } from '@/components/global/OfflineBoot';
import { GlobalScanner } from '@/components/global/GlobalScanner';
import { SidebarProvider } from '@/lib/ui/useSidebar';
import { requireUser } from '@/lib/auth';
import { getTenantBrand, getTenantSlugById } from '@/lib/repos/tenants';
import { getInventoryMode } from '@/lib/featureMode';
import { isPathAllowed, defaultPathFor } from '@/lib/rbac';
import { headers } from 'next/headers';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Re-check role against the actual URL. The proxy already does this at the
  // edge, but proxy only trusts the cookie's role claim; here we trust the
  // DB-backed role and redirect if the user sneaked past.
  const h = await headers();
  const pathname = h.get('x-pathname') ?? h.get('x-invoke-path') ?? '/';
  if (!isPathAllowed(user.role, pathname)) {
    redirect(defaultPathFor(user.role) as unknown as never);
  }

  // Per-tenant brand — drives the header logo + name. cache()-wrapped so
  // multi-page renders only hit Neon once per request.
  const [brand, tenantSlug, inventoryMode] = await Promise.all([
    getTenantBrand(user.tenantId),
    getTenantSlugById(user.tenantId).catch(() => 'pae-ka-yauk'),
    getInventoryMode(user.tenantId).catch(() => 'POS_PAUSED' as const),
  ]);

  return (
    <SidebarProvider>
      <div className="app-shell app-shell--with-sidebar">
        <Header brand={brand} role={user.role} />
        <Sidebar role={user.role} />
        <main className="app-main" id="main-content">
          {children}
        </main>
        <Footer />
        {/* Phase 2 client machinery — outbox drain + catalog SWR refresh */}
        <OfflineBoot tenantSlug={tenantSlug} inventoryMode={inventoryMode} />
        {/* Global barcode scanner — listens app-wide. On scan, navigates to
            /pos?scan=<code>; PosScreen reads the param and adds to cart. */}
        <GlobalScanner />
      </div>
    </SidebarProvider>
  );
}
