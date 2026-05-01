import { requireRole } from '@/lib/auth';
import { STAFF_ADMIN_ROLES } from '@/lib/rbac';
import { listStaff } from '@/lib/repos/users';
import { StaffsView } from '@/components/staffs/StaffsView';

export const dynamic = 'force-dynamic';

export default async function StaffsPage() {
  const user = await requireRole(...STAFF_ADMIN_ROLES);
  // Don't swallow DB errors with `.catch(() => [])` — an empty list would
  // misleadingly imply "no staff yet". Let the error boundary show a retry UI.
  const rows = await listStaff(user.tenantId);
  return <StaffsView rows={rows} currentUserId={user.id} currentUserRole={user.role} />;
}
