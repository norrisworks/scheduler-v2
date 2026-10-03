import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useCenter } from '../centers/CenterProvider'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { addDays, formatDateShort, formatTime, minutesToTime, todayISO } from '../../lib/dates'
import {
  centerOperatingHours,
  defaultPlanWeekStart,
  inCenterCellClass,
  monthDay,
  onlineCellClass,
  planWeekDates,
  planWeekGrid,
  weekdayGrandTotal,
  weekdayRowTotals,
} from './weekPlan'

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The Week tab: next week's demand, half hour by half hour, for planning
 * instructor shifts before they are entered. ONE full-width heatmap — each
 * day a tight pair of columns (in-center, then a narrower online), each
 * metric on its own fixed color scale. Read-only counts.
 */
export default function WeekPlanView() {
  const { isAdmin } = useAuth()
  const { centerId, center } = useCenter()
  const [weekStart, setWeekStart] = useState(() => defaultPlanWeekStart(todayISO()))
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!centerId || !isAdmin) return
    let stale = false
    setSessions(null)
    const dates = planWeekDates(weekStart)
    supabase
      .from('sessions')
      .select('date, start_time, duration, status, delivery_method')
      .eq('center_id', centerId)
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
  }, [centerId, weekStart, isAdmin])

  const grid = useMemo(
    () =>
      sessions
        ? planWeekGrid({ sessions, weekStart, hours: centerOperatingHours(center) })
        : null,
    [sessions, weekStart, center],
  )

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
            {isNextWeek && <span className="ml-1.5 text-xs font-normal text-zinc-400">next week</span>}
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
        <p className="ml-auto text-[11px] text-zinc-400">
          Scheduled sessions per half hour · counts only, read-only.
        </p>
      </div>

      {error ? (
        <div className="mt-6">
          <QueryError error={error} />
        </div>
      ) : !grid ? (
        <div className="mt-10">
          <Spinner label="Loading week…" />
        </div>
      ) : grid.weekdays.length === 0 && !grid.saturday ? (
        <p className="mt-10 text-center text-sm text-zinc-400">
          No scheduled sessions that week yet.
        </p>
      ) : (
        <WeekTable grid={grid} />
      )}
    </div>
  )
}

/** Day boundary: a touch more air plus a hairline, so pairs read as units. */
const DAY_EDGE = 'border-l border-zinc-200 pl-1'

/**
 * One full-width heatmap table. Cells are painted edge to edge with a 1px
 * padding gap; zero stays on the uncolored zinc-50 ground. Each day is a
 * TIGHT pair — in-center, then a narrower online column (its counts are
 * small) — under one spanning date header. table-fixed + the colgroup give
 * the axes their px and split the rest In:Online ≈ 1:0.62.
 */
function WeekTable({ grid }) {
  const hasSaturday = Boolean(grid.saturday)
  const pairs = grid.weekdays.length + (hasSaturday ? 1 : 0)
  // Percent widths for the day columns; the px axis columns come off the top.
  const inPct = 97 / (pairs * 1.62)
  const onPct = inPct * 0.62
  // Far-right reference column: weekday cells summed per row. Saturday rows
  // are other clock times, so they never join these.
  const rowTotals = weekdayRowTotals(grid)
  const grand = weekdayGrandTotal(grid)

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

  const heatCell = (n, ramp, extra = '') => (
    <td className={`p-px ${extra}`}>
      <div
        className={
          'flex h-8 items-center justify-center rounded-[2px] text-sm font-semibold tabular-nums ' +
          (n > 0 ? ramp(n) : 'bg-zinc-50')
        }
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
        {heatCell(day.inCenter[i] ?? 0, inCenterCellClass, DAY_EDGE)}
        {heatCell(day.online[i] ?? 0, onlineCellClass)}
      </>
    )
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3">
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
            {grid.weekdays.map(({ date }) => (
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
            <th className={`px-1 pt-1 text-center ${DAY_EDGE}`}>
              <span className="block text-base leading-tight font-bold text-zinc-900">Total</span>
              <span className="block text-sm font-normal text-zinc-500">Mon–Fri</span>
            </th>
          </tr>
          <tr>
            <th />
            {grid.weekdays.map(({ date }) => (
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
              {grid.weekdays.map((day) => (
                <DayCells key={day.date}>
                  {dayPair(day, row.w, grid.weekdayBands)}
                </DayCells>
              ))}
              {hasSaturday && axisLabel(row.s, 'pl-1')}
              {hasSaturday && (
                <DayCells>{dayPair(grid.saturday, row.s, grid.saturdayBands)}</DayCells>
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
            {grid.weekdays.map((day) => (
              <TotalsPair key={day.date} totals={day.totals} />
            ))}
            {hasSaturday && <td className="border-t border-zinc-200 pt-1.5" />}
            {hasSaturday && <TotalsPair totals={grid.saturday.totals} />}
            {/* The weekday grand total — Saturday keeps its own column. */}
            <td className={`border-t border-zinc-200 pt-1.5 text-center text-sm font-bold text-zinc-900 tabular-nums ${DAY_EDGE}`}>
              {grand}
            </td>
          </tr>
          <tr>
            <td className="pr-1.5 pb-0.5 text-right text-xs font-semibold text-zinc-500">All</td>
            {grid.weekdays.map((day) => (
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
