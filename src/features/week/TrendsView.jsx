import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { formatTime, minutesToTime, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { attendanceByWeekday, slotTable, trendWeeks, weeklyTotals } from './trends'
import { monthDay } from './weekPlan'

// Every trend uses the same 8 weeks (the school year so far), so the three
// charts always cover the same stretch.
const WEEKS = 8

// Shade steps per center. Montgomeryville: the owner's agreed 0–9, 10–14,
// 15–19, 20–24, 25+. Blue Bell never passes ~14 in a half hour, so on those
// steps every cell was the same pale shade; its steps are scaled down.
const STEPS = {
  red: { max: [9, 14, 19, 24, Infinity], label: ['0–9', '10–14', '15–19', '20–24', '25+'] },
  blue: { max: [4, 7, 10, 13, Infinity], label: ['0–4', '5–7', '8–10', '11–13', '14+'] },
}

// Same hues as the week grid beside them: in-center red at Montgomeryville,
// blue at Blue Bell; online green everywhere.
const PALETTE = {
  red: {
    steps: STEPS.red,
    line: '#d9473f',
    partial: '#f0b3ae',
    bins: ['#FCEBEB', '#F7C1C1', '#F09595', '#E24B4A', '#A32D2D'],
    ink: ['#501313', '#501313', '#501313', '#ffffff', '#ffffff'],
  },
  blue: {
    steps: STEPS.blue,
    line: '#2a78d6',
    partial: '#a9c8ee',
    bins: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD', '#185FA5'],
    ink: ['#0C447C', '#0C447C', '#042C53', '#ffffff', '#ffffff'],
  },
}
const ONLINE_COLOR = '#1baf7a'
const ONLINE_PARTIAL = '#a7e0c9'


/**
 * Attendance trends on the Week tab. Always the last 8 weeks, whatever week
 * the planner is showing. Everything here is actual attendance (the
 * attendance import), never bookings; in-center and online both count.
 */
export function useAttendanceTrends(centers) {
  const [visits, setVisits] = useState(null)
  const [error, setError] = useState(null)
  const today = todayISO()
  const weeks = useMemo(() => trendWeeks(today, WEEKS), [today])

  useEffect(() => {
    if (!centers?.length) return
    let stale = false
    fetchAll(() =>
      supabase
        .from('attendance_visits')
        .select('center_id, date, arrival, departure, delivery')
        .in('center_id', centers.map((c) => c.id))
        .gte('date', weeks[0])
        .lte('date', today)
        .order('id'),
    ).then(({ data, error: err }) => {
      if (stale) return
      if (err) setError(err.message)
      else setVisits(data ?? [])
    })
    return () => {
      stale = true
    }
  }, [centers, weeks, today])

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
      <Panel title="Attendance per week" note="Last 8 weeks. The lighter bar is this week so far.">
        <WeeklyBars totals={weeklyTotals(visits, weeks, today)} pal={pal} />
      </Panel>
      <Panel title="Attendance by day, week by week" note="Kids per day over the same 8 weeks, in-center and online together.">
        <DayRows byDay={attendanceByWeekday(visits, weeks, today)} weeks={weeks} pal={pal} />
      </Panel>
    </div>
  ))
}

/** Chart 3 — every slot, week by week — under the week grid. */
export function TrendsBelow({ center, trends, hue = 'red' }) {
  const pal = PALETTE[hue] ?? PALETTE.red
  return withVisits(trends, center, (visits, weeks, today) => (
    <Panel
      title="Every slot, week by week"
      note="Kids in the room in each half hour over the same 8 weeks, oldest to newest under each day. Outlined: that week's busiest half hour."
    >
      <SlotGrid table={slotTable(visits, weeks, today)} weeks={weeks} pal={pal} />
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

/** Chart 1: stacked bars, in-center below and online on top, numbers for each. */
function WeeklyBars({ totals, pal }) {
  const max = Math.max(1, ...totals.map((t) => t.total))
  const H = 96
  return (
    <div>
      <div className="mb-2 flex gap-3">
        <Swatch color={pal.line} label="In-center" />
        <Swatch color={ONLINE_COLOR} label="Online" />
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `3.5rem repeat(${totals.length}, minmax(0, 1fr))` }}>
        {/* bars */}
        <div />
        {totals.map((t) => (
          <div key={t.week} className="flex flex-col items-center justify-end" style={{ height: H + 18 }}>
            <span className="mb-0.5 text-xs font-semibold text-zinc-800 tabular-nums">{t.total}</span>
            <div className="flex w-full max-w-12 flex-col overflow-hidden rounded-t">
              <div style={{ height: (t.online / max) * H, background: t.partial ? ONLINE_PARTIAL : ONLINE_COLOR }} />
              <div style={{ height: (t.inCenter / max) * H, background: t.partial ? pal.partial : pal.line }} />
            </div>
          </div>
        ))}
        {/* week labels */}
        <div className="text-[11px] text-zinc-500">Week of</div>
        {totals.map((t) => (
          <div key={t.week} className="text-center text-[11px] text-zinc-500 tabular-nums">
            {monthDay(t.week)}
          </div>
        ))}
        {/* split rows */}
        <div className="text-[11px] font-medium" style={{ color: pal.line }}>In-center</div>
        {totals.map((t) => (
          <div key={t.week} className="text-center text-[11px] text-zinc-700 tabular-nums">{t.inCenter}</div>
        ))}
        <div className="text-[11px] font-medium" style={{ color: ONLINE_COLOR }}>Online</div>
        {totals.map((t) => (
          <div key={t.week} className="text-center text-[11px] text-zinc-700 tabular-nums">{t.online}</div>
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
        {shown.map((d, k) => (
          <DaySpark key={d.day} d={d} weeks={weeks} top={top} bottom={bottom} color={pal.line} axis={k === 0} />
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
 * and under each day the 8 weeks side by side. Saturday is its own
 * block (different hours). Short enough to see without scrolling.
 */
function SlotGrid({ table, weeks, pal }) {
  const { rows, busiest } = table
  const weekdayRows = rows.filter((r) => r.day >= 1 && r.day <= 5)
  const saturdayRows = rows.filter((r) => r.day === 6)
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        {pal.steps.label.map((label, k) => (
          <span key={label} className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="inline-block h-3 w-3.5 rounded-sm border border-zinc-200" style={{ background: pal.bins[k] }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1 text-xs text-zinc-600">
          <span className="inline-block h-3 w-3.5 rounded-sm border-2 border-zinc-900" />
          Busiest half hour that week
        </span>
      </div>
      {/* Weekdays stretch to fill the card; Saturday keeps its own width. */}
      <div className="flex items-start gap-6 overflow-x-auto">
        {weekdayRows.length > 0 && (
          <div className="min-w-0 flex-[4]">
            <SlotBlock rows={weekdayRows} weeks={weeks} busiest={busiest} pal={pal} />
          </div>
        )}
        {saturdayRows.length > 0 && (
          <div className="min-w-0 flex-1">
            <SlotBlock rows={saturdayRows} weeks={weeks} busiest={busiest} pal={pal} />
          </div>
        )}
      </div>
    </div>
  )
}

function SlotBlock({ rows, weeks, busiest, pal }) {
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b)
  const times = [...new Set(rows.map((r) => r.minutes))].sort((a, b) => a - b)
  const byKey = new Map(rows.map((r) => [`${r.day}|${r.minutes}`, r]))
  const dayLabel = (d) => rows.find((r) => r.day === d).dayLabel
  const edge = 'border-l-2 border-zinc-300'

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
                className={`px-px pb-1 text-[10px] font-normal whitespace-nowrap text-zinc-400 tabular-nums ${i === 0 ? edge : ''}`}
              >
                {monthDay(w)}
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
                // No row = nobody that half hour all 8 weeks; still "–" when
                // that day of the week hasn't happened yet.
                const n = row ? row.cells[i] : rows.find((r) => r.day === d).cells[i] === null ? null : 0
                const cls = `h-6 min-w-8 p-px text-center tabular-nums ${i === 0 ? edge : ''}`
                if (n === null) return <td key={`${d}-${w}`} className={`${cls} text-zinc-300`}>–</td>
                const k = pal.steps.max.findIndex((m) => n <= m)
                const peak = n > 0 && n === busiest[i]
                return (
                  <td key={`${d}-${w}`} className={cls}>
                    <div
                      className="flex h-full items-center justify-center rounded-sm"
                      style={{
                        background: pal.bins[k],
                        color: pal.ink[k],
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
    </table>
  )
}
