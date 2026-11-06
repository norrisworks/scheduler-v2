import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { addDays, formatTime, minutesToTime, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { attendanceByWeekday, slotTable, trendWeeks, weeklyTotals } from './trends'
import { HEAT_HUES, monthDay, oklchToRgb } from './weekPlan'

// All three charts always cover the same stretch, chosen by the owner from
// these lengths, ENDING at the week the planner is showing.
export const PERIOD_CHOICES = [4, 8, 16]
export const DEFAULT_PERIOD = 8
const MAX_WEEKS = Math.max(...PERIOD_CHOICES)

/**
 * Chart 3 shading: a CONTINUOUS ramp in the center's hue (same hue family
 * as the week grid), from very light at 1 to deep at the period's busiest
 * cell, so every count is its own shade. Zero is a plain gray block, not a
 * colour. Darker than the grid's calm ramp so the 8-to-12 week spread reads.
 */
function slotShade(n, max, hue) {
  const { hLight, hDeep } = HEAT_HUES[hue] ?? HEAT_HUES.red
  const t = max <= 1 ? 1 : Math.min(1, (n - 1) / (max - 1))
  const L = 0.97 - 0.42 * t
  const C = 0.025 + 0.15 * t
  const [r, g, b] = oklchToRgb(L, C, hLight + (hDeep - hLight) * t)
  return { background: `rgb(${r}, ${g}, ${b})`, color: L < 0.7 ? '#ffffff' : '#27272a' }
}
const ZERO_FILL = '#e4e4e7'

// Same hues as the week grid beside them: in-center red at Montgomeryville,
// blue at Blue Bell; online green everywhere.
const PALETTE = {
  red: {
    hue: 'red',
    line: '#d9473f',
    partial: '#f0b3ae',
  },
  blue: {
    hue: 'blue',
    line: '#2a78d6',
    partial: '#a9c8ee',
  },
}
const ONLINE_COLOR = '#1baf7a'
const ONLINE_PARTIAL = '#a7e0c9'


/**
 * Attendance trends on the Week tab: the `count` weeks ENDING with the week
 * the planner is showing (`anchorMonday`), so paging the planner back pages
 * the charts back too. Everything here is actual attendance (the attendance
 * import), never bookings; in-center and online both count. The longest
 * period is fetched for each anchor, so switching periods is instant; the
 * previous data stays up while a new anchor loads.
 */
export function useAttendanceTrends(centers, count = DEFAULT_PERIOD, anchorMonday) {
  const [visits, setVisits] = useState(null)
  const [error, setError] = useState(null)
  const today = todayISO()
  const anchor = anchorMonday ?? today
  const from = useMemo(() => trendWeeks(anchor, MAX_WEEKS)[0], [anchor])
  const weeks = useMemo(() => trendWeeks(anchor, count), [anchor, count])
  const to = useMemo(() => {
    const end = addDays(weeks[weeks.length - 1], 6)
    return end < today ? end : today
  }, [weeks, today])

  useEffect(() => {
    if (!centers?.length) return
    let stale = false
    fetchAll(() =>
      supabase
        .from('attendance_visits')
        .select('center_id, date, arrival, departure, delivery')
        .in('center_id', centers.map((c) => c.id))
        .gte('date', from)
        .lte('date', to)
        .order('id'),
    ).then(({ data, error: err }) => {
      if (stale) return
      if (err) setError(err.message)
      else {
        setError(null)
        setVisits(data ?? [])
      }
    })
    return () => {
      stale = true
    }
  }, [centers, from, to])

  return { visits, error, weeks, today }
}

/** Wraps a trends panel with the loading / error / empty states. */
function withVisits(trends, center, render) {
  const { visits, error, weeks, today } = trends
  if (error) return <QueryError error={error} compact />
  if (!visits) return <Spinner label="Loading attendance…" />
  const mine = visits.filter((v) => v.center_id === center.id)
  if (mine.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-400">
        No attendance imported for these weeks yet.
      </p>
    )
  }
  return render(mine, weeks, today)
}

/** Charts 1 and 2 — the column beside the week grid. */
export function TrendsSide({ center, trends, hue = 'red' }) {
  const pal = PALETTE[hue] ?? PALETTE.red
  return withVisits(trends, center, (visits, weeks, today) => (
    <div className="space-y-3">
      <Panel title="Attendance per week" note={`Last ${weeks.length} weeks. The lighter bar is this week so far.`}>
        <WeeklyBars totals={weeklyTotals(visits, weeks, today)} pal={pal} />
      </Panel>
      <Panel title="Attendance by day, week by week" note={`Kids per day over the same ${weeks.length} weeks, in-center and online together.`}>
        <DayRows byDay={attendanceByWeekday(visits, weeks, today)} weeks={weeks} pal={pal} />
      </Panel>
    </div>
  ))
}

/** Kids per date (visits, in-center + online) — chart 3's bottom row. */
function visitsPerDate(visits) {
  const m = new Map()
  for (const v of visits) m.set(v.date, (m.get(v.date) ?? 0) + 1)
  return m
}

/** Chart 3 — every slot, week by week — under the week grid. */
export function TrendsBelow({ center, trends, hue = 'red' }) {
  const pal = PALETTE[hue] ?? PALETTE.red
  return withVisits(trends, center, (visits, weeks, today) => (
    <Panel
      title="Every slot, week by week"
      note={`Kids in the room in each half hour over the same ${weeks.length} weeks, oldest to newest under each day. Outlined: that week's busiest half hour.`}
    >
      <SlotGrid table={slotTable(visits, weeks, today)} weeks={weeks} pal={pal} dayTotals={visitsPerDate(visits)} />
    </Panel>
  ))
}

function Panel({ title, note, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      <p className="mb-3 text-xs text-zinc-500">{note}</p>
      {children}
    </div>
  )
}

function Swatch({ color, label }) {
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-600">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

/**
 * Chart 1: stacked bars, in-center below and online on top, each section
 * carrying its own count, the week's total above. The online section is
 * given room for its number even though online is a sliver of the week.
 */
function WeeklyBars({ totals, pal }) {
  const max = Math.max(1, ...totals.map((t) => t.total))
  const H = 150
  const MIN_ONLINE = 15
  return (
    <div>
      <div className="mb-2 flex gap-3">
        <Swatch color={pal.line} label="In-center" />
        <Swatch color={ONLINE_COLOR} label="Online" />
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${totals.length}, minmax(0, 1fr))` }}>
        {totals.map((t) => {
          const onH = t.online > 0 ? Math.max(MIN_ONLINE, (t.online / max) * H) : 0
          const inH = (t.inCenter / max) * H
          return (
            <div key={t.week} className="flex flex-col items-center justify-end" style={{ height: H + MIN_ONLINE + 18 }}>
              <span className="mb-0.5 text-xs font-semibold text-zinc-800 tabular-nums">{t.total}</span>
              <div className="flex w-full max-w-14 flex-col overflow-hidden rounded-t text-[11px] font-medium tabular-nums">
                {t.online > 0 && (
                  <div
                    className="flex items-center justify-center"
                    style={{ height: onH, background: t.partial ? ONLINE_PARTIAL : ONLINE_COLOR, color: t.partial ? '#064e3b' : '#ffffff' }}
                  >
                    {t.online}
                  </div>
                )}
                <div
                  className="flex items-start justify-center pt-1"
                  style={{ height: inH, background: t.partial ? pal.partial : pal.line, color: t.partial ? '#3f3f46' : '#ffffff' }}
                >
                  {t.inCenter > 0 ? t.inCenter : ''}
                </div>
              </div>
            </div>
          )
        })}
        {totals.map((t) => (
          <div key={t.week} className="text-center text-[11px] text-zinc-500 tabular-nums">
            {monthDay(t.week)}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Chart 2: one small line chart per open weekday, side by side in one row,
 * all on the same scale so they compare and none overlapping (six lines in
 * one chart were illegible). The scale does not start at zero: days sit at
 * 20–55 and a zero baseline flattens them. A day with no attendance in the
 * last 4 weeks (Friday is summer-only) is left out and named in the note.
 */
function DayRows({ byDay, weeks, pal }) {
  const recent = (d) => d.values.slice(-4).some((v) => v !== null)
  const shown = byDay.filter(recent)
  const hidden = byDay.filter((d) => !recent(d))
  const all = shown.flatMap((d) => d.values.filter((v) => v !== null))
  const top = Math.ceil(Math.max(1, ...all) / 10) * 10
  // Half a step of air under the lowest value, so its label fits below it.
  const bottom = Math.max(0, Math.floor(Math.min(top, ...all) / 10) * 10 - 5)
  return (
    <div>
      <div className="grid gap-x-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((d) => (
          <DaySpark key={d.day} d={d} weeks={weeks} top={top} bottom={bottom} color={pal.line} axis />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {monthDay(weeks[0])} → {monthDay(weeks[weeks.length - 1])}, same {bottom}–{top} scale in every box, so the gridlines line up across the row. Hover a dot for that week.
        {hidden.length > 0 && ` ${hidden.map((d) => d.label).join(', ')}: no attendance in the last 4 weeks.`}
      </p>
    </div>
  )
}

function DaySpark({ d, weeks, top, bottom, color, axis }) {
  const W = 150
  const H = 100
  const padL = 22
  const padR = 22
  const padT = 12
  const padB = 12
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, weeks.length - 1)
  const y = (v) => padT + (1 - (v - bottom) / (top - bottom || 1)) * (H - padT - padB)
  const ticks = []
  for (let t = bottom; t <= top; t += 5) ticks.push(t)
  const pts = d.values.map((v, i) => (v === null ? null : { i, v }))
  const segs = []
  let cur = []
  for (const p of pts) {
    if (p) cur.push(p)
    else if (cur.length) {
      segs.push(cur)
      cur = []
    }
  }
  if (cur.length) segs.push(cur)
  const real = pts.filter(Boolean)
  const first = real[0]
  const last = real[real.length - 1]
  // First value goes on the side of its dot away from where the line heads.
  const next = real[1]
  const firstAbove = !next || next.v <= first?.v

  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-zinc-800" style={{ paddingLeft: `${(padL / W) * 100}%` }}>{d.label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${d.label} attendance by week`}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(t)}
              y2={y(t)}
              stroke={t % 10 === 0 ? '#d4d4d8' : '#ececee'}
              strokeWidth="0.75"
            />
            {axis && t % 10 === 0 && (
              <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize="8.5" fill="#a1a1aa">{t}</text>
            )}
          </g>
        ))}
        {segs.map((seg, k) => (
          <polyline
            key={k}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinejoin="round"
            points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
          />
        ))}
        {real.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p === last ? 3 : 2} fill={color}>
            <title>{`${d.label}, week of ${monthDay(weeks[p.i])}: ${p.v}`}</title>
          </circle>
        ))}
        {first && first !== last && (
          <text x={x(first.i) + 3} y={firstAbove ? y(first.v) - 5 : y(first.v) + 11} textAnchor="start" fontSize="10" fill="#71717a">
            {first.v}
          </text>
        )}
        {last && (
          <text x={x(last.i) + 5} y={y(last.v) + 3.5} textAnchor="start" fontSize="10" fontWeight="700" fill="#18181b">{last.v}</text>
        )}
      </svg>
    </div>
  )
}

/**
 * Chart 3, laid out like the week grid: times down the side, days across,
 * and under each day the period's weeks side by side. Saturday is its own
 * block (different hours). Short enough to see without scrolling.
 */
function SlotGrid({ table, weeks, pal, dayTotals }) {
  const { rows: allRows, busiest } = table
  // Same rule as chart 2: a day with no attendance in the last 4 weeks
  // (summer-only Fridays) is left out and named under the legend.
  const open = (d) => allRows.some((r) => r.day === d && r.cells.slice(-4).some((c) => c !== null))
  const rows = allRows.filter((r) => open(r.day))
  const hidden = [...new Set(allRows.filter((r) => !open(r.day)).map((r) => r.dayLabel))]
  const weekdayRows = rows.filter((r) => r.day >= 1 && r.day <= 5)
  const saturdayRows = rows.filter((r) => r.day === 6)
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.filter((c) => c !== null)))
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        <span className="flex items-center gap-1 text-xs text-zinc-600">
          <span className="inline-block h-3 w-3.5 rounded-sm" style={{ background: ZERO_FILL }} />
          0
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-600 tabular-nums">
          1
          <span
            className="inline-block h-3 w-28 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
                .map((t) => slotShade(1 + t * (max - 1), max, pal.hue).background)
                .join(', ')})`,
            }}
          />
          {max}
        </span>
        <span className="flex items-center gap-1 text-xs text-zinc-600">
          <span className="inline-block h-3 w-3.5 rounded-sm border-2 border-zinc-900" />
          Busiest half hour that week
        </span>
        {hidden.length > 0 && (
          <span className="text-xs text-zinc-500">{hidden.join(', ')}: no attendance in the last 4 weeks, not shown.</span>
        )}
      </div>
      {/* Weekdays stretch to fill the card; Saturday keeps its own width. */}
      <div className="flex items-start gap-6 overflow-x-auto">
        {weekdayRows.length > 0 && (
          // Stretch to fill the card, but never past ~44px a cell (a short
          // period would otherwise blow the cells up).
          <div
            className="min-w-0 flex-1"
            style={{ maxWidth: 70 + new Set(weekdayRows.map((r) => r.day)).size * weeks.length * 44 }}
          >
            <SlotBlock rows={weekdayRows} weeks={weeks} busiest={busiest} pal={pal} max={max} dayTotals={dayTotals} />
          </div>
        )}
        {saturdayRows.length > 0 && (
          <div className="flex-none">
            <SlotBlock rows={saturdayRows} weeks={weeks} busiest={busiest} pal={pal} max={max} dayTotals={dayTotals} />
          </div>
        )}
      </div>
    </div>
  )
}

function SlotBlock({ rows, weeks, busiest, pal, max, dayTotals }) {
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b)
  const times = [...new Set(rows.map((r) => r.minutes))].sort((a, b) => a - b)
  const byKey = new Map(rows.map((r) => [`${r.day}|${r.minutes}`, r]))
  const dayLabel = (d) => rows.find((r) => r.day === d).dayLabel
  // Day boundary: a dark divider plus a few pixels of air before the day's first week.
  const edge = 'border-l-2 border-zinc-500 pl-1.5'

  const wide = weeks.length > 8
  // Each column's date: that week's copy of the day.
  const dateOf = (w, d) => addDays(w, (d + 6) % 7)
  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          <th />
          {days.map((d) => (
            <th key={d} colSpan={weeks.length} className={`pb-0.5 text-center font-semibold text-zinc-800 ${edge}`}>
              {dayLabel(d)}
            </th>
          ))}
        </tr>
        <tr>
          <th />
          {days.map((d) =>
            weeks.map((w, i) => (
              <th
                key={`${d}-${w}`}
                className={`pb-1 align-bottom ${i === 0 ? edge : 'pl-px'} ${i === weeks.length - 1 ? 'pr-1.5' : 'pr-px'} ${wide ? 'text-[9px]' : 'text-[10px]'} font-normal whitespace-nowrap text-zinc-400 tabular-nums`}
              >
                {/* 16 weeks: labels stand on end so the columns can stay narrow */}
                {wide ? <span className="inline-block rotate-180 [writing-mode:vertical-rl]">{monthDay(w)}</span> : monthDay(w)}
              </th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        {times.map((m) => (
          <tr key={m}>
            <td className="pr-2 text-right whitespace-nowrap text-zinc-500 tabular-nums">{formatTime(minutesToTime(m))}</td>
            {days.map((d) => {
              const row = byKey.get(`${d}|${m}`)
              return weeks.map((w, i) => {
                // No row = nobody that half hour the whole period; still "–" when
                // that day of the week hasn't happened yet.
                const n = row ? row.cells[i] : rows.find((r) => r.day === d).cells[i] === null ? null : 0
                const cls = `h-6 ${wide ? 'min-w-5 text-[10px]' : 'min-w-8'} py-px ${i === weeks.length - 1 ? 'pr-1.5' : 'pr-px'} ${i === 0 ? edge : 'pl-px'} text-center tabular-nums`
                if (n === null) return <td key={`${d}-${w}`} className={`${cls} text-zinc-300`}>–</td>
                const shade = n > 0 ? slotShade(n, max, pal.hue) : { background: ZERO_FILL, color: '#71717a' }
                const peak = n > 0 && n === busiest[i]
                return (
                  <td key={`${d}-${w}`} className={cls}>
                    <div
                      className="flex h-full items-center justify-center rounded-sm"
                      style={{
                        background: shade.background,
                        color: shade.color,
                        boxShadow: peak ? 'inset 0 0 0 2px #18181b' : undefined,
                        fontWeight: peak ? 700 : 400,
                      }}
                    >
                      {n}
                    </div>
                  </td>
                )
              })
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="pt-1.5 pr-2 text-right text-xs font-bold whitespace-nowrap text-zinc-800">Total</td>
          {days.map((d) =>
            weeks.map((w, i) => {
              const n = dayTotals?.get(dateOf(w, d))
              return (
                <td
                  key={`${d}-${w}`}
                  className={`border-t border-zinc-300 pt-1.5 text-center font-bold tabular-nums ${wide ? 'text-[10px]' : 'text-xs'} ${
                    i === 0 ? edge : 'pl-px'
                  } ${i === weeks.length - 1 ? 'pr-1.5' : 'pr-px'} ${n ? 'text-zinc-900' : 'text-zinc-300'}`}
                >
                  {n ?? '–'}
                </td>
              )
            }),
          )}
        </tr>
      </tfoot>
    </table>
  )
}
