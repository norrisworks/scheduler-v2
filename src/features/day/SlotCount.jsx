const PRESSURE_STYLE = {
  empty: 'bg-slate-100 text-slate-300',
  ok: 'bg-slate-200 text-slate-600',
  // Count exceeds what the instructors on shift can cover at the normal 3:1
  // ratio — the overbooked warning the owner scans for.
  over: 'bg-amber-200 text-amber-900',
  over_stretch: 'bg-red-200 text-red-800',
  uncovered: 'bg-red-500 text-white',
}

/** Students in session during a half-hour slot, tinted by staffing pressure. */
export default function SlotCount({ stat }) {
  if (!stat) return null

  const plural = stat.students === 1 ? '' : 's'
  const title =
    stat.onShift === 0
      ? `${stat.students} student${plural}, nobody on shift`
      : `${stat.students} student${plural} · ${stat.onShift} on shift · ` +
        `capacity ${stat.capacity} (stretch ${stat.stretchCapacity})`

  return (
    <span
      className={
        'min-w-[1.15rem] rounded px-1 text-center text-[10px] leading-4 font-semibold tabular-nums ' +
        PRESSURE_STYLE[stat.pressure]
      }
      title={title}
    >
      {stat.students}
    </span>
  )
}
