/**
 * Loading skeleton for /inventory — shows instantly while server component
 * resolves. Eliminates the "blank screen" wait on cold-start or slow network.
 */
export default function InventoryLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <SkeletonBox width="200px" height="36px" />
          <div style={{ height: 8 }} />
          <SkeletonBox width="120px" height="14px" />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <SkeletonBox width="140px" height="44px" />
          <SkeletonBox width="140px" height="44px" />
        </div>
      </div>

      <SkeletonBox width="100%" height="50px" />

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <SkeletonBox width="60px" height="32px" />
        <SkeletonBox width="80px" height="32px" />
        <SkeletonBox width="80px" height="32px" />
        <SkeletonBox width="80px" height="32px" />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
              display: 'flex',
              gap: 'var(--space-4)',
              alignItems: 'center',
            }}
          >
            <SkeletonBox width="40%" height="18px" />
            <SkeletonBox width="80px" height="22px" />
            <SkeletonBox width="60px" height="22px" />
            <SkeletonBox width="40px" height="14px" style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonBox({
  width, height, style,
}: {
  width: string;
  height: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        background: 'linear-gradient(90deg, var(--color-surface-alt) 25%, var(--color-border) 50%, var(--color-surface-alt) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
        borderRadius: 'var(--radius-sm)',
        ...style,
      }}
    />
  );
}
