export default function AppPageLoading() {
  return (
    <div className="fade-in" role="status" aria-live="polite">
      <div className="h-3 w-28 animate-pulse rounded-full bg-[var(--line)]" />
      <div className="mt-4 h-9 w-44 animate-pulse rounded-xl bg-[var(--line)]" />
      <div className="mt-8 space-y-3">
        <div className="h-24 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--surface)]" />
        <div className="h-24 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--surface)]" />
      </div>
      <span className="sr-only">正在打开，请稍候</span>
    </div>
  );
}
