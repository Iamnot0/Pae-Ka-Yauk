export default function ItemsLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Box width="240px" height="36px" />
      <Box width="100%" height="50px" />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {Array.from({ length: 5 }).map((_, i) => <Box key={i} width="80px" height="32px" />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <Box width="100%" height="180px" square />
            <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Box width="70%" height="16px" />
              <Box width="40%" height="18px" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Box({ width, height, square }: { width: string; height: string; square?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        background: 'linear-gradient(90deg, var(--color-surface-alt) 25%, var(--color-border) 50%, var(--color-surface-alt) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
        borderRadius: square ? 0 : 'var(--radius-sm)',
      }}
    />
  );
}
