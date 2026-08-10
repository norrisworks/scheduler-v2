import { formatTime, minutesToTime } from '../../lib/dates'
import { gaugeCellClass } from './load'

/**
 * One numbered cell per 30-min slot (v1 capacity_colors) so you can see
 * WHERE an instructor is loaded, not just how much.
 */
export default function LoadGauge({ slots, load, label }) {
  return (
    <div className="flex gap-px" role="img" aria-label={label}>
      {slots.map((minutes, i) => {
        const value = load[i] ?? 0
        return (
          <span
            key={minutes}
            className={
              'flex-1 rounded-[1px] text-center text-[9px] leading-3.5 tabular-nums ' +
              gaugeCellClass(value)
            }
            title={`${formatTime(minutesToTime(minutes))} — ${value} student${value === 1 ? '' : 's'}`}
          >
            {value}
          </span>
        )
      })}
    </div>
  )
}
