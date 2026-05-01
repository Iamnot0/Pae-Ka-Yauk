/**
 * Placeholder page shown at routes not yet implemented.
 * Useful during Phase 1 so navigation works from day 1.
 */
export function ComingInSprint({
  title,
  titleMy,
  sprint,
}: {
  title: string;
  titleMy: string;
  sprint: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        textAlign: 'center',
        gap: 'var(--space-4)',
        color: 'var(--color-muted-fg)',
      }}
    >
      <h1 style={{ marginBottom: 0 }}>{title}</h1>
      <p lang="my" className="text-myanmar" style={{ fontSize: '1.125rem', margin: 0 }}>
        {titleMy}
      </p>
      <div
        className="pill"
        style={{
          background: 'var(--color-surface-alt)',
          color: 'var(--color-muted-fg)',
          marginTop: 'var(--space-4)',
        }}
      >
        Coming in Sprint {sprint}
      </div>
    </div>
  );
}
