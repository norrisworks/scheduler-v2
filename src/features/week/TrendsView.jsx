import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { formatTime, minutesToTime, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { attendanceByWeekday, slotTable, trendWeeks, weeklyTotals } from './trends'
import { monthDay } from './weekPlan'

const CHART_WEEKS = 12
const SLOT_WEEKS = 8

const IN_COLOR = '#2a78d6'
const IN_PARTIAL = '#a9c8ee'
const ONLINE_COLOR = '#1baf7a'
const ONLINE_PARTIAL = '#a7e0c9'

// The owner's agreed scale: five steps of one blue, with a legend.
const BINS = [
  { max: 9, bg: '#E6F1FB', fg: '#0C447C', label: '0–9' },
  { max: 14, bg: '#B5D4F4', fg: '#0C447C', label: '10–14' },
  { max: 19, bg: '#85B7EB', fg: '#042C53', label: '15–19' },
  { max: 24, bg: '#378ADD', fg: '#ffffff', label: '20–24' },
  { max: Infinity, bg: '#185FA5', fg: '#ffffff', label: '25+' },
]
const binOf = (n) => BINS.find((b) => n <= b.max)

/**
 * Attendance trends on the Week tab. Always the last 12 weeks, whatever week
 * the planner is showing. Everything here is actual attendance (the
 * attendance import), never bookings; in-center and online both count.
 */
export function useAttendanceTrends(centers) {
  const [visits, setVisits] = useState(null)
  const [error, setError] = useState(null)
  const today = todayISO()
  const weeks = useMemo(() => trendWeeks(today, CHART_WEEKS), [today])

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
export function TrendsSide({ center, trends }) {
  return withVisits(trends, center, (visits, weeks, today) => (
    <div className="space-y-3">
      <Panel title="Attendance per week" note="Last 12 weeks. The last bar is this week so far.">
        <WeeklyBars totals={weeklyTotals(visits, weeks, today)} />
      </Panel>
      <Panel title="Attendance by day, each week" note="Kids per day, same 12 weeks. In-center and online together.">
        <DayRows byDay={attendanceByWeekday(visits, weeks, today)} weeks={weeks} />
      </Panel>
    </div>
  ))
}

/** Chart 3 — every slot, week by week — under the week grid. */
export function TrendsBelow({ center, trends }) {
  return withVisits(trends, center, (visits, weeks, today) => {
    const slotWeeks = weeks.slice(-SLOT_WEEKS)
    return (
      <Panel
        title="Every slot, week by week"
        note="Kids in the room in each half hour, last 8 weeks (oldest → newest under each day). Outlined: the busiest half hour of that week."
      >
        <SlotGrid table={slotTable(visits, slotWeeks, today)} weeks={slotWeeks} />
      </Panel>
    )
  })
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
function WeeklyBars({ totals }) {
  const max = Math.max(1, ...totals.map((t) => t.total))
  const H = 120
  return (
    <div>
      <div className="mb-2 flex gap-3">
        <Swatch color={IN_COLOR} label="In-center" />
        <Swatch color={ONLINE_COLOR} label="Online" />
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `3.5rem repeat(${totals.length}, minmax(0, 1fr))` }}>
        {/* bars */}
        <div />
        {totals.map((t) => (
          <div key={t.week} className="flex flex-col items-center justify-end" style={{ height: H + 18 }}>
            <span className="mb-0.5 text-xs font-semibold text-zinc-800 tabular-nums">{t.total}</span>
            <div className="flex w-full max-w-9 flex-col overflow-hidden rounded-t">
              <div style={{ height: (t.online / max) * H, background: t.partial ? ONLINE_PARTIAL : ONLINE_COLOR }} />
              <div style={{ height: (t.inCenter / max) * H, background: t.partial ? IN_PARTIAL : IN_COLOR }} />
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
        <div className="text-[11px] font-medium" style={{ color: IN_COLOR }}>In-center</div>
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
 * Chart 2: a plain number table, one row per weekday, one column per week.
 * No bars (the owner found them noise) and short, so chart 3 stays close.
 */
function DayRows({ byDay, weeks }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-zinc-500">
          <th className="pb-1 text-left font-normal">Week of</th>
          {weeks.map((w) => (
            <th key={w} className="pb-1 text-center font-normal">{monthDay(w)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {byDay.map((d) => (
          <tr key={d.day} className="border-t border-zinc-100">
            <td className="py-1 pr-2 font-semibold text-zinc-800">{d.label}</td>
            {d.values.map((v, i) => (
              <td key={i} className={`py-1 text-center ${v === null ? 'text-zinc-300' : 'text-zinc-800'}`}>
                {v ?? '–'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Chart 3, laid out like the week grid: times down the side, days across,
 * and under each day the last 8 weeks side by side. Saturday is its own
 * block (different hours). Short enough to see without scrolling.
 */
function SlotGrid({ table, weeks }) {
  const { rows, busiest } = table
  const weekdayRows = rows.filter((r) => r.day >= 1 && r.day <= 5)
  const saturdayRows = rows.filter((r) => r.day === 6)
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        {BINS.map((b) => (
          <span key={b.label} className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="inline-block h-3 w-3.5 rounded-sm border border-zinc-200" style={{ background: b.bg }} />
            {b.label}
          </span>
        ))}
        <span className="flex items-center gap-1 text-xs text-zinc-600">
          <span className="inline-block h-3 w-3.5 rounded-sm border-2 border-zinc-900" />
          Busiest half hour that week
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-6 overflow-x-auto">
        {weekdayRows.length > 0 && <SlotBlock rows={weekdayRows} weeks={weeks} busiest={busiest} />}
        {saturdayRows.length > 0 && <SlotBlock rows={saturdayRows} weeks={weeks} busiest={busiest} />}
      </div>
    </div>
  )
}

function SlotBlock({ rows, weeks, busiest }) {
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b)
  const times = [...new Set(rows.map((r) => r.minutes))].sort((a, b) => a - b)
  const byKey = new Map(rows.map((r) => [`${r.day}|${r.minutes}`, r]))
  const dayLabel = (d) => rows.find((r) => r.day === d).dayLabel
  const edge = 'border-l-2 border-zinc-300'

  return (
    <table className="border-separate border-spacing-0 text-xs">
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
                const b = binOf(n)
                const peak = n > 0 && n === busiest[i]
                return (
                  <td key={`${d}-${w}`} className={cls}>
                    <div
                      className="flex h-full items-center justify-center rounded-sm"
                      style={{
                        background: b.bg,
                        color: b.fg,
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
