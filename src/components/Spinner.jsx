export default function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center gap-3 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
      {label}
    </div>
  )
}
