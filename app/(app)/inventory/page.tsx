import { requireUser } from '@/lib/auth';
import { listMaterials } from '@/lib/repos/materials';
import { getOnHandSnapshot } from '@/lib/stock/ledger';
import { MaterialList } from '@/components/inventory/MaterialList';

export default async function InventoryPage() {
  const user = await requireUser();
  const { rows } = await listMaterials(user.tenantId, { limit: 500 });
  const snapshots = await getOnHandSnapshot(
    user.tenantId,
    rows.map((m) => m.id)
  );

  return <MaterialList materials={rows} snapshots={snapshots} />;
}
