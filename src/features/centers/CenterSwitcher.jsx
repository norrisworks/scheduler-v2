import { useCenter } from './CenterProvider'

export default function CenterSwitcher() {
  const { centers, centerId, setCenterId, canSwitch, center } = useCenter()

  if (centers.length === 0) return null

  // Instructor accounts are pinned to one center — no switcher, but they still
  // need to see at a glance which center they're looking at.
  if (!canSwitch) {
    return (
      <span
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
        title={center?.name}
      >
        {center?.short_code}
      </span>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-brand-600 p-0.5"
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
              (active ? 'bg-white text-brand-600 shadow-sm' : 'text-red-100 hover:text-white')
            }
          >
            {c.short_code}
          </button>
        )
      })}
    </div>
  )
}
