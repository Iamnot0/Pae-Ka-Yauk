'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Coffee,
  BookOpen,
  BarChart3,
  UsersRound,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import { useSidebar } from '@/lib/ui/useSidebar';
import { SidebarToggle } from './SidebarToggle';
import { isPathAllowed } from '@/lib/rbac';

interface NavItem {
  href: string;
  labelKey: DictKey;
  Icon: LucideIcon;
}

// Order: workflow-grouped. Stocks → Recipes → Production → Inventory cluster
// the four screens that share the same data lineage (sellable items + BOM
// + bake events + raw materials), then Reports at the bottom.
const NAV: NavItem[] = [
  { href: '/',           labelKey: 'nav.dashboard',  Icon: LayoutDashboard },
  { href: '/staffs',     labelKey: 'nav.staffs',     Icon: UsersRound },
  { href: '/pos',        labelKey: 'nav.pos',        Icon: ShoppingCart },
  { href: '/stocks',     labelKey: 'nav.items',      Icon: Coffee },
  { href: '/recipes',    labelKey: 'nav.recipes',    Icon: BookOpen },
  { href: '/production', labelKey: 'nav.production', Icon: Flame },
  { href: '/inventory',  labelKey: 'nav.inventory',  Icon: Package },
  { href: '/reports',    labelKey: 'nav.reports',    Icon: BarChart3 },
];

interface SidebarProps {
  role: string;
}

export function Sidebar({ role }: SidebarProps) {
  const t = useT();
  const pathname = usePathname();
  const { close } = useSidebar();

  const visible = NAV.filter((item) => isPathAllowed(role, item.href));

  return (
    <aside className="app-sidebar" aria-label="Primary navigation">
      <div className="sidebar-toggle-row">
        <h3 className="sidebar-title">{t('nav.section.operations')}</h3>
        <SidebarToggle />
      </div>

      <nav>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {visible.map(({ href, labelKey, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href as Route}
                  className="nav-item"
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  title={t(labelKey)}
                >
                  <Icon size={20} strokeWidth={2} />
                  <span className="nav-label">{t(labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
