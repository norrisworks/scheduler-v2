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
} from './weekPlan'

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The Week tab: next week's demand, half hour by half hour, for planning
 * instructor shifts before they are entered. ONE table — each day is a
 * shaded pair of columns (in-center, then online), each metric on its own
 * fixed color scale so weeks stay comparable. Read-only counts.
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
    <div className="mx-auto max-w-5xl px-6 py-6">
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

/** The day-pair band: shared shade, with a divider on the pair's left edge. */
const BAND = 'bg-zinc-50'
const DIVIDER = 'border-l border-zinc-200'

/**
 * One table for everything. Each day is TWO columns — in-center, then
 * online — under one spanning date header, on a shared shaded band so the
 * pair reads as one unit; each metric keeps its own fixed color scale.
 * Saturday keeps its own time axis, offset per decision 44.
 */
function WeekTable({ grid }) {
  const hasSaturday = Boolean(grid.saturday)
  const cell = (n, ramp) => (
    <span
      className={
        'inline-block min-w-[24px] rounded px-1 text-center text-[11px] leading-5 font-semibold tabular-nums ' +
        ramp(n)
      }
    >
      {n > 0 ? n : ''}
    </span>
  )

  const dayPair = (day, bandMinutes, bandList) => {
    if (bandMinutes === null) {
      return (
        <>
          <td className={`${BAND} ${DIVIDER}`} />
          <td className={BAND} />
        </>
      )
    }
    const i = bandList.indexOf(bandMinutes)
    return (
      <>
        <td className={`px-0.5 py-px text-center ${BAND} ${DIVIDER}`}>
          {cell(day.inCenter[i] ?? 0, inCenterCellClass)}
        </td>
        <td className={`px-0.5 py-px text-center ${BAND}`}>
          {cell(day.online[i] ?? 0, onlineCellClass)}
        </td>
      </>
    )
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-14" />
            {grid.weekdays.map(({ date }) => (
              <th
                key={date}
                colSpan={2}
                className={`px-1 pt-1 text-center text-[11px] font-semibold text-zinc-700 ${BAND} ${DIVIDER}`}
              >
                <span className="block">{monthDay(date)}</span>
                <span className="block font-normal text-zinc-400">
                  {DAY_LABEL[new Date(`${date}T12:00:00`).getDay()]}
                </span>
              </th>
            ))}
            {hasSaturday && <th className="w-14" />}
            {hasSaturday && (
              <th
                colSpan={2}
                className={`px-1 pt-1 text-center text-[11px] font-semibold text-zinc-700 ${BAND} ${DIVIDER}`}
              >
                <span className="block">{monthDay(grid.saturday.date)}</span>
                <span className="block font-normal text-zinc-400">Sat</span>
              </th>
            )}
          </tr>
          <tr>
            <th />
            {grid.weekdays.map(({ date }) => (
              <SubHeads key={date} />
            ))}
            {hasSaturday && <th />}
            {hasSaturday && <SubHeads />}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-[11px] text-zinc-500 tabular-nums">
                {row.w !== null ? formatTime(minutesToTime(row.w)) : ''}
              </td>
              {grid.weekdays.map((day) => (
                <DayCells key={day.date}>
                  {dayPair(day, row.w, grid.weekdayBands)}
                </DayCells>
              ))}
              {hasSaturday && (
                <td className="pr-2 pl-3 text-right text-[11px] text-zinc-500 tabular-nums">
                  {row.s !== null ? formatTime(minutesToTime(row.s)) : ''}
                </td>
              )}
              {hasSaturday && (
                <DayCells>{dayPair(grid.saturday, row.s, grid.saturdayBands)}</DayCells>
              )}
            </tr>
          ))}

          {/* SESSION counts, never cell sums — a 90-minute session spans
              three cells but is one session. */}
          <tr>
            <td className="border-t border-zinc-200 pt-1 pr-2 text-right text-[11px] font-semibold text-zinc-500">
              Total
            </td>
            {grid.weekdays.map((day) => (
              <TotalsPair key={day.date} totals={day.totals} />
            ))}
            {hasSaturday && <td className="border-t border-zinc-200 pt-1" />}
            {hasSaturday && <TotalsPair totals={grid.saturday.totals} />}
          </tr>
          <tr>
            <td className="pr-2 pb-0.5 text-right text-[11px] font-semibold text-zinc-500">All</td>
            {grid.weekdays.map((day) => (
              <td
                key={day.date}
                colSpan={2}
                className={`px-1 pb-0.5 text-center text-[11px] font-bold text-zinc-900 tabular-nums ${BAND} ${DIVIDER}`}
              >
                {day.totals.inCenter + day.totals.online}
              </td>
            ))}
            {hasSaturday && <td />}
            {hasSaturday && (
              <td
                colSpan={2}
                className={`px-1 pb-0.5 text-center text-[11px] font-bold text-zinc-900 tabular-nums ${BAND} ${DIVIDER}`}
              >
                {grid.saturday.totals.inCenter + grid.saturday.totals.online}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SubHeads() {
  return (
    <>
      <th className={`px-0.5 pb-1 text-center text-[10px] font-medium text-zinc-400 ${BAND} ${DIVIDER}`}>
        In
      </th>
      <th className={`px-0.5 pb-1 text-center text-[10px] font-medium text-zinc-400 ${BAND}`}>
        Online
      </th>
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
      <td className={`border-t border-zinc-200 px-0.5 pt-1 text-center text-[11px] font-bold text-zinc-800 tabular-nums ${BAND} ${DIVIDER}`}>
        {totals.inCenter}
      </td>
      <td className={`border-t border-zinc-200 px-0.5 pt-1 text-center text-[11px] font-bold text-zinc-800 tabular-nums ${BAND}`}>
        {totals.online}
      </td>
    </>
  )
}
