import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useCenter } from '../centers/CenterProvider'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { addDays, formatDateShort, formatTime, minutesToTime, todayISO } from '../../lib/dates'
import {
  centerOperatingHours,
  centerWeekMax,
  defaultPlanWeekStart,
  heatStyle,
  monthDay,
  planWeekDates,
  planWeekGrid,
  weekdayRowTotals,
  weekGrandTotal,
} from './weekPlan'

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** In-center hue per center; online is green everywhere. */
const IN_CENTER_HUE = { 'Blue Bell': 'blue' }

/**
 * The Week tab: next week's demand, half hour by half hour, for planning
 * instructor shifts before they are entered. BOTH centers, Montgomeryville
 * over Blue Bell, one heatmap table each with the same layout; navigation
 * moves them together. Read-only counts.
 */
export default function WeekPlanView() {
  const { isAdmin } = useAuth()
  const { centers } = useCenter()
  const [weekStart, setWeekStart] = useState(() => defaultPlanWeekStart(todayISO()))
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState(null)

  // Montgomeryville on top, Blue Bell below — the owner's stacking order.
  const ordered = useMemo(
    () => [...(centers ?? [])].sort((a, b) => b.name.localeCompare(a.name)),
    [centers],
  )

  useEffect(() => {
    if (!isAdmin || ordered.length === 0) return
    let stale = false
    setSessions(null)
    const dates = planWeekDates(weekStart)
    supabase
      .from('sessions')
      .select('center_id, date, start_time, duration, status, delivery_method')
      .in('center_id', ordered.map((c) => c.id))
      .gte('date', dates[0])
      .lte('date', dates[dates.length - 1])
      .then(({ data, error }) => {
        if (stale) return
        if (error) setError(error.message)
        else {
          setSessions(data ?? [])
          setError(null)
        }
      })
    return () => {
      stale = true
    }
  }, [ordered, weekStart, isAdmin])

  const grids = useMemo(() => {
    if (!sessions) return null
    const perCenter = ordered.map((center) => {
      const grid = planWeekGrid({
        sessions: sessions.filter((s) => s.center_id === center.id),
        weekStart,
        hours: centerOperatingHours(center),
      })
      return { center, grid }
    })
    // ONE shared maximum across both centers and both metrics, so the two
    // tables' shading is directly comparable — the same count is the same
    // shade whichever center it is in.
    const sharedMax = Math.max(0, ...perCenter.map(({ grid }) => centerWeekMax(grid)))
    return perCenter.map((entry) => ({ ...entry, max: sharedMax }))
  }, [sessions, ordered, weekStart])

  if (!isAdmin) {
    return (
      <p className="mx-auto max-w-lg px-6 py-16 text-center text-sm text-zinc-500">
        The Week planner is admin-only.
      </p>
    )
  }

  const dates = planWeekDates(weekStart)
  const isNextWeek = weekStart === defaultPlanWeekStart(todayISO())

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold text-zinc-900">Week planner</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Previous week"
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            ‹
          </button>
          <span className="px-1 text-sm font-medium text-zinc-800 tabular-nums">
            {formatDateShort(dates[0])} – {formatDateShort(dates[dates.length - 1])}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Next week"
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            ›
          </button>
          {!isNextWeek && (
            <button
              type="button"
              onClick={() => setWeekStart(defaultPlanWeekStart(todayISO()))}
              className="ml-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Next week
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <QueryError error={error} />
        </div>
      ) : !grids ? (
        <div className="mt-10">
          <Spinner label="Loading week…" />
        </div>
      ) : (
        <div className="mt-5 space-y-8">
          {grids.map(({ center, grid, max }) => (
            <section key={center.id}>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">{center.name}</h2>
              {grid.weekdays.length === 0 && !grid.saturday ? (
                <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-400">
                  No scheduled sessions that week yet.
                </p>
              ) : (
                <WeekTable
                  grid={grid}
                  max={max}
                  inHue={IN_CENTER_HUE[center.name] ?? 'red'}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** Day boundary: a HEAVY divider plus extra air, so pairs read separately. */
const DAY_EDGE = 'border-l-2 border-zinc-300 pl-2'
/** Alternating day-pair shading; odd days get the tint. */
// Days separate by DIVIDER alone — the alternating bands read as weight.

/**
 * One center's heatmap. Cells paint edge to edge on each center's OWN
 * scale: lightest shade at 1, deepest at that center's weekly maximum
 * across both metrics. Zero stays a gray block. The far-right Total
 * column sums rows across weekdays only (Saturday rows are other clock
 * times); its bottom cell is the WHOLE week's session count.
 */
function WeekTable({ grid, max, inHue }) {
  const hasSaturday = Boolean(grid.saturday)
  const pairs = grid.weekdays.length + (hasSaturday ? 1 : 0)
  const inPct = 97 / (pairs * 1.62)
  const onPct = inPct * 0.62
  const rowTotals = weekdayRowTotals(grid)
  const satIndex = grid.weekdays.length

  // Calendar-style axis: the label sits ON the boundary line at the top of
  // the row it begins, not floating mid-row.
  const axisLabel = (minutes, extra = '') => (
    <td className={`relative ${extra}`}>
      {minutes !== null && (
        <span className="absolute top-0 right-1.5 -translate-y-1/2 text-xs text-zinc-500 tabular-nums">
          {formatTime(minutesToTime(minutes))}
        </span>
      )}
    </td>
  )

  const heatCell = (n, hue, tdClass) => (
    <td className={`p-px ${tdClass}`}>
      <div
        className={
          'flex h-8 items-center justify-center rounded-[2px] text-sm font-semibold tabular-nums' +
          (n > 0 ? '' : ' bg-zinc-50/60')
        }
        // Continuous: interpolated from the value against the SHARED max,
        // so every distinct count is a visibly distinct shade.
        style={n > 0 ? heatStyle(n, max, hue) : undefined}
      >
        {n > 0 ? n : ''}
      </div>
    </td>
  )

  const dayPair = (day, bandMinutes, bandList) => {
    if (bandMinutes === null) {
      return (
        <>
          <td className={`p-px ${DAY_EDGE}`} />
          <td className="p-px" />
        </>
      )
    }
    const i = bandList.indexOf(bandMinutes)
    return (
      <>
        {heatCell(day.inCenter[i] ?? 0, inHue, DAY_EDGE)}
        {heatCell(day.online[i] ?? 0, 'green', '')}
      </>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: 52 }} />
          {grid.weekdays.map(({ date }) => (
            <WeekCols key={date} inPct={inPct} onPct={onPct} />
          ))}
          {hasSaturday && <col style={{ width: 48 }} />}
          {hasSaturday && <WeekCols inPct={inPct} onPct={onPct} />}
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr>
            <th />
            {grid.weekdays.map(({ date }, i) => (
              <th
                key={date}
                colSpan={2}
                className={`px-1 pt-1 text-center ${DAY_EDGE}`}
              >
                <span className="block text-base leading-tight font-bold text-zinc-900">
                  {monthDay(date)}
                </span>
                <span className="block text-sm font-normal text-zinc-500">
                  {DAY_LABEL[new Date(`${date}T12:00:00`).getDay()]}
                </span>
              </th>
            ))}
            {hasSaturday && <th />}
            {hasSaturday && (
              <th colSpan={2} className={`px-1 pt-1 text-center ${DAY_EDGE}`}>
                <span className="block text-base leading-tight font-bold text-zinc-900">
                  {monthDay(grid.saturday.date)}
                </span>
                <span className="block text-sm font-normal text-zinc-500">Sat</span>
              </th>
            )}
            <th className={`px-1 pt-1 text-center align-top ${DAY_EDGE}`}>
              <span className="block text-base leading-tight font-bold text-zinc-900">Total</span>
            </th>
          </tr>
          <tr>
            <th />
            {grid.weekdays.map(({ date }, i) => (
              <SubHeads key={date} />
            ))}
            {hasSaturday && <th />}
            {hasSaturday && <SubHeads />}
            <th className={DAY_EDGE} />
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={i}>
              {axisLabel(row.w)}
              {grid.weekdays.map((day, d) => (
                <DayCells key={day.date}>
                  {dayPair(day, row.w, grid.weekdayBands)}
                </DayCells>
              ))}
              {hasSaturday && axisLabel(row.s, 'pl-1')}
              {hasSaturday && (
                <DayCells>
                  {dayPair(grid.saturday, row.s, grid.saturdayBands)}
                </DayCells>
              )}
              <td className={`text-center text-sm font-semibold text-zinc-700 tabular-nums ${DAY_EDGE}`}>
                {row.w !== null && rowTotals[grid.weekdayBands.indexOf(row.w)] > 0
                  ? rowTotals[grid.weekdayBands.indexOf(row.w)]
                  : ''}
              </td>
            </tr>
          ))}

          {/* SESSION counts, never cell sums — a 90-minute session spans
              three cells but is one session. */}
          <tr>
            <td className="border-t border-zinc-200 pt-1.5 pr-1.5 text-right text-xs font-semibold text-zinc-500">
              Total
            </td>
            {grid.weekdays.map((day, i) => (
              <TotalsPair key={day.date} totals={day.totals} />
            ))}
            {hasSaturday && <td className="border-t border-zinc-200 pt-1.5" />}
            {hasSaturday && <TotalsPair totals={grid.saturday.totals} />}
            {/* The WHOLE week, Saturday included. */}
            <td className={`border-t border-zinc-200 pt-1.5 text-center text-sm font-bold text-zinc-900 tabular-nums ${DAY_EDGE}`}>
              {weekGrandTotal(grid)}
            </td>
          </tr>
          <tr>
            <td className="pr-1.5 pb-0.5 text-right text-xs font-semibold text-zinc-500">All</td>
            {grid.weekdays.map((day, i) => (
              <td
                key={day.date}
                colSpan={2}
                className={`px-1 pb-0.5 text-center text-sm font-bold text-zinc-900 tabular-nums ${DAY_EDGE}`}
              >
                {day.totals.inCenter + day.totals.online}
              </td>
            ))}
            {hasSaturday && <td />}
            {hasSaturday && (
              <td
                colSpan={2}
                className={`px-1 pb-0.5 text-center text-sm font-bold text-zinc-900 tabular-nums ${DAY_EDGE}`}
              >
                {grid.saturday.totals.inCenter + grid.saturday.totals.online}
              </td>
            )}
            <td className={DAY_EDGE} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function WeekCols({ inPct, onPct }) {
  return (
    <>
      <col style={{ width: `${inPct}%` }} />
      <col style={{ width: `${onPct}%` }} />
    </>
  )
}

function SubHeads() {
  return (
    <>
      <th className={`pb-1 text-center text-xs font-semibold text-zinc-500 ${DAY_EDGE}`}>
        In-center
      </th>
      <th className="pb-1 text-center text-xs font-semibold text-zinc-500">Online</th>
    </>
  )
}

/** Fragment passthrough — the pair's two <td>s come from dayPair. */
function DayCells({ children }) {
  return children
}

function TotalsPair({ totals }) {
  return (
    <>
      <td className={`border-t border-zinc-200 pt-1.5 text-center text-sm font-bold text-zinc-800 tabular-nums ${DAY_EDGE}`}>
        {totals.inCenter}
      </td>
      <td className="border-t border-zinc-200 pt-1.5 text-center text-sm font-bold text-zinc-800 tabular-nums">
        {totals.online}
      </td>
    </>
  )
}
