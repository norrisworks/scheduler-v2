import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { formatTime, minutesToTime, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { attendanceByWeekday, slotTable, trendWeeks, weeklyTotals } from './trends'
import { monthDay } from './weekPlan'

const CHART_WEEKS = 12
const TABLE_WEEKS = 8

// One color + dash pattern per weekday, so lines are told apart without color.
const DAY_STYLE = {
  1: { color: '#2a78d6', dash: '' },
  2: { color: '#eb6834', dash: '6 3' },
  3: { color: '#1baf7a', dash: '2 3' },
  4: { color: '#c98500', dash: '' },
  5: { color: '#d55181', dash: '8 3 2 3' },
  6: { color: '#6250d6', dash: '4 4' },
  0: { color: '#888780', dash: '1 3' },
}

// Five steps of one blue, with a legend — counts read at a glance.
const BINS = [
  { max: 4, bg: '#E6F1FB', fg: '#0C447C', label: '0–4' },
  { max: 9, bg: '#B5D4F4', fg: '#0C447C', label: '5–9' },
  { max: 14, bg: '#85B7EB', fg: '#042C53', label: '10–14' },
  { max: 19, bg: '#378ADD', fg: '#ffffff', label: '15–19' },
  { max: Infinity, bg: '#185FA5', fg: '#ffffff', label: '20+' },
]
const binOf = (n) => BINS.find((b) => n <= b.max)

/**
 * Attendance trends, shown beside each center's week table on the Week tab.
 * Always the last 12 weeks whatever week the planner is on. Everything here
 * is actual attendance (the attendance import), never bookings.
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
        .select('center_id, date, arrival, departure')
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

/** One center's trends column. `trends` is useAttendanceTrends' result. */
export function CenterTrends({ center, trends }) {
  const { visits: all, error, weeks, today } = trends
  if (error) return <QueryError error={error} compact />
  if (!all) return <Spinner label="Loading attendance…" />
  return <CenterTrendsBody visits={all.filter((v) => v.center_id === center.id)} weeks={weeks} today={today} />
}

function CenterTrendsBody({ visits, weeks, today }) {
  const totals = useMemo(() => weeklyTotals(visits, weeks, today), [visits, weeks, today])
  const byDay = useMemo(() => attendanceByWeekday(visits, weeks, today), [visits, weeks, today])
  const tableWeeks = useMemo(() => weeks.slice(-TABLE_WEEKS), [weeks])
  const slots = useMemo(() => slotTable(visits, tableWeeks, today), [visits, tableWeeks, today])

  return (
    <section>
      <p className="mb-2 text-xs text-zinc-500">
        Attendance trends · actual attendance, in-center and online together
      </p>
      {visits.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-400">
          No attendance imported for these weeks yet.
        </p>
      ) : (
        <div className="space-y-3">
          <Panel title="1. Total attendance per week" note="The last bar is this week so far.">
            <WeeklyBars totals={totals} />
          </Panel>
          <Panel title="2. Attendance by day, each week" note="One line per day the center was open.">
            <DayLines byDay={byDay} weeks={weeks} />
          </Panel>
          <Panel
            title="3. Every slot, week by week"
            note="Kids in the room in that half hour that week. The outlined box in each week is that week's busiest slot."
          >
            <SlotTable table={slots} weeks={tableWeeks} />
          </Panel>
        </div>
      )}
    </section>
  )
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

function WeeklyBars({ totals }) {
  const max = Math.max(1, ...totals.map((t) => t.total))
  return (
    <div className="flex h-40 items-end gap-1.5">
      {totals.map((t) => (
        <div key={t.week} className="flex min-w-0 flex-1 flex-col items-center justify-end">
          <span className="mb-1 text-xs font-semibold text-zinc-700 tabular-nums">{t.total}</span>
          <div
            className="w-full max-w-8 rounded-t"
            style={{
              height: `${(t.total / max) * 110}px`,
              background: t.partial ? '#a9c8ee' : '#2a78d6',
            }}
            title={`Week of ${monthDay(t.week)}: ${t.total}${t.partial ? ' so far' : ''}`}
          />
          <span className="mt-1 text-[11px] text-zinc-500 tabular-nums">{monthDay(t.week)}</span>
        </div>
      ))}
    </div>
  )
}

function DayLines({ byDay, weeks }) {
  const W = 760
  const H = 200
  const padL = 30
  const padR = 12
  const padT = 12
  const padB = 24
  const max = Math.max(1, ...byDay.flatMap((d) => d.values.filter((v) => v !== null)))
  const top = Math.ceil(max / 10) * 10
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, weeks.length - 1)
  const y = (v) => padT + (1 - v / top) * (H - padT - padB)
  const ticks = [0, top / 2, top]

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4">
        {byDay.map((d) => (
          <span key={d.day} className="flex items-center gap-1.5 text-xs text-zinc-600">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={DAY_STYLE[d.day].color} strokeWidth="2" strokeDasharray={DAY_STYLE[d.day].dash} />
            </svg>
            {d.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Attendance by weekday, week by week">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e4e4e7" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#71717a">{t}</text>
          </g>
        ))}
        {weeks.map((w, i) => (
          <text key={w} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#71717a">{monthDay(w)}</text>
        ))}
        {byDay.map((d) => {
          // Break the line where a day had no data (closed, or not yet).
          const segs = []
          let cur = []
          d.values.forEach((v, i) => {
            if (v === null) {
              if (cur.length) segs.push(cur)
              cur = []
            } else cur.push([x(i), y(v), v, weeks[i]])
          })
          if (cur.length) segs.push(cur)
          const st = DAY_STYLE[d.day]
          return (
            <g key={d.day}>
              {segs.map((seg, si) => (
                <polyline key={si} fill="none" stroke={st.color} strokeWidth="2" strokeDasharray={st.dash} strokeLinejoin="round" points={seg.map((p) => `${p[0]},${p[1]}`).join(' ')} />
              ))}
              {segs.flat().map(([px, py, v, w]) => (
                <circle key={w} cx={px} cy={py} r="3" fill={st.color}>
                  <title>{`${d.label}, week of ${monthDay(w)}: ${v}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SlotTable({ table, weeks }) {
  let prevDay = null
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
          Busiest slot that week
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th />
              <th />
              {weeks.map((w) => (
                <th key={w} className="px-1 pb-1 font-medium whitespace-nowrap text-zinc-500">{monthDay(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => {
              const first = r.day !== prevDay
              prevDay = r.day
              return (
                <tr key={`${r.day}-${r.minutes}`} className={first ? 'border-t' : ''}>
                  <td className={`pr-2 text-left font-semibold whitespace-nowrap text-zinc-800 ${first ? 'pt-2' : ''}`}>{first ? r.dayLabel : ''}</td>
                  <td className={`pr-2 text-right whitespace-nowrap text-zinc-500 tabular-nums ${first ? 'pt-2' : ''}`}>
                    {formatTime(minutesToTime(r.minutes))}
                  </td>
                  {r.cells.map((n, i) => {
                    if (n === null) {
                      return <td key={i} className="h-6 min-w-9 text-center text-zinc-300">–</td>
                    }
                    const b = binOf(n)
                    const peak = n > 0 && n === table.busiest[i]
                    return (
                      <td
                        key={i}
                        className="h-6 min-w-9 rounded-sm text-center tabular-nums"
                        style={{
                          background: b.bg,
                          color: b.fg,
                          boxShadow: peak ? 'inset 0 0 0 2px #18181b' : undefined,
                          fontWeight: peak ? 600 : 400,
                        }}
                      >
                        {n}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
