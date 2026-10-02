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
 * The hour scale rendered directly above ONE gauge — every instructor gets
 * their own, because a single scale pinned at the top of the sidebar cannot
 * be lined up against a gauge half a screen below it. Same flex structure as
 * the gauge so the columns align; the bare hour sits LEFT-aligned in its
 * cell, at the start of that hour, reading like a time axis.
 */
export function GaugeHourRow({ slots }) {
  return (
    <div className="flex gap-px" aria-hidden="true">
      {slots.map((minutes) => (
        <span key={minutes} className="flex-1 text-left text-[9px] leading-3 text-slate-400">
          {gaugeHourLabel(minutes)}
        </span>
      ))}
    </div>
  )
}
