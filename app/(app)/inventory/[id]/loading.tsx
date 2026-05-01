export default function EditMaterialLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SkeletonBox width="140px" height="18px" />
      <SkeletonBox width="280px" height="36px" />
      <SkeletonBox width="100%" height="260px" />
      <SkeletonBox width="100%" height="200px" />
      <SkeletonBox width="100%" height="160px" />
    </div>
  );
}

function SkeletonBox({ width, height }: { width: string; height: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        background: 'linear-gradient(90deg, var(--color-surface-alt) 25%, var(--color-border) 50%, var(--color-surface-alt) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
        borderRadius: 'var(--radius-md)',
      }}
    />
  );
}
