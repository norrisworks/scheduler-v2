import { formatTime, minutesToTime } from '../../lib/dates'
import { STRETCH_RATIO, loadCellColor } from './load'

/** One cell per 30-min slot, so you can see WHERE an instructor is loaded. */
export default function LoadGauge({ slots, load, color, label }) {
  return (
    <div className="flex gap-px" role="img" aria-label={label}>
      {slots.map((minutes, i) => {
        const value = load[i] ?? 0
        return (
          <span
            key={minutes}
            className="h-2 flex-1 rounded-[1px]"
            style={{ backgroundColor: loadCellColor(value, color) }}
            title={`${formatTime(minutesToTime(minutes))} — ${value} student${
              value === 1 ? '' : 's'
            }${value >= STRETCH_RATIO ? ' (at stretch cap)' : ''}`}
          />
        )
      })}
    </div>
  )
}
