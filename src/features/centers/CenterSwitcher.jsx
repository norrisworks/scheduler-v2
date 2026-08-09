import { useCenter } from './CenterProvider'

export default function CenterSwitcher() {
  const { centers, centerId, setCenterId } = useCenter()

  if (centers.length === 0) return null

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
      role="group"
      aria-label="Active center"
    >
      {centers.map((c) => {
        const active = c.id === centerId
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => setCenterId(c.id)}
            aria-pressed={active}
            title={c.name}
            className={
              'rounded-md px-3 py-1.5 text-sm font-semibold transition ' +
              (active
                ? 'bg-white text-brand-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800')
            }
          >
            {c.short_code}
          </button>
        )
      })}
    </div>
  )
}
