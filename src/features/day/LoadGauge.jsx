import { formatTime, minutesToTime } from '../../lib/dates'
import { gaugeCellClass, gaugeHourLabel } from './load'

/**
 * One numbered cell per 30-min slot (v1 capacity_colors) so you can see
 * WHERE an instructor is loaded, not just how much. Each cell's tooltip
 * carries the slot time and, when known, who is with them in that half hour.
 */
export default function LoadGauge({ slots, load, names, label }) {
  return (
    <div className="flex gap-px" role="img" aria-label={label}>
      {slots.map((minutes, i) => {
        const value = load[i] ?? 0
        const who = names?.[i]?.length ? `: ${names[i].join(', ')}` : ''
        return (
          <span
            key={minutes}
            className={
              'flex-1 rounded-[1px] text-center text-[9px] leading-3.5 tabular-nums ' +
              gaugeCellClass(value)
            }
            title={`${formatTime(minutesToTime(minutes))} — ${value} student${value === 1 ? '' : 's'}${who}`}
          >
            {value}
          </span>
        )
      })}
    </div>
  )
}

/**
 * The shared hour scale for every gauge below it: the bare hour over each
 * on-the-hour cell, blank over the half hours. Rendered with the SAME flex
 * structure and horizontal insets as a row's gauge, so the columns line up.
 */
export function GaugeHourRow({ slots }) {
  return (
    <div className="mb-0.5 border border-transparent px-2" aria-hidden="true">
      <div className="flex gap-px">
        {slots.map((minutes) => (
          <span key={minutes} className="flex-1 text-center text-[9px] leading-3 text-slate-400">
            {gaugeHourLabel(minutes)}
          </span>
        ))}
      </div>
    </div>
  )
}
