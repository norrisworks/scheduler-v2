import { slotChipClass } from './load'

/**
 * Students in session during a half-hour slot. Colors are v1's fixed bands
 * (capacity_colors), plus the solid-red zero-instructors error state.
 */
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
        'min-w-[18px] rounded px-1 text-center text-[10px] leading-4 font-semibold tabular-nums ' +
        slotChipClass(stat.students, stat.onShift)
      }
      title={title}
    >
      {stat.students}
    </span>
  )
}
