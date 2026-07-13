interface RowsProps {
  count?: number;
}

// Shimmer placeholder rows for list loading states.
export function SkeletonRows({ count = 3 }: RowsProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-line" />
            <span className="h-3.5 w-40 animate-pulse rounded bg-line" />
            <span className="h-3.5 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-3 h-2.5 w-56 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
          <div className="h-8 w-14 animate-pulse rounded bg-line" />
          <div className="mt-2 h-2.5 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// Placeholder matching the ActivityChart card while overview data loads.
export function SkeletonChart() {
  const bars = [36, 56, 24, 64, 40, 72, 48];
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center justify-between">
        <div className="h-3.5 w-24 animate-pulse rounded bg-line" />
        <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-3 flex h-[90px] w-full max-w-sm items-end gap-4">
        {bars.map((h, i) => (
          <div
            key={i}
            className="w-7 animate-pulse rounded-t bg-muted"
            style={{ height: h }}
          />
        ))}
      </div>
    </div>
  );
}
