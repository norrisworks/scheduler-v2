import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useCenter } from '../centers/CenterProvider'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { addDays, formatDateShort, formatTime, minutesToTime, todayISO } from '../../lib/dates'
import { slotChipClass } from '../day/load'
import { centerOperatingHours, defaultPlanWeekStart, planWeekDates, planWeekGrid } from './weekPlan'

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The Week tab: next week's demand, half hour by half hour, for planning
 * instructor shifts before they are entered. Read-only counts — in-center
 * and online stacked as two identically laid-out tables — with Saturday's
 * axis offset so its morning sits beside the weekday 4:00pm rows.
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
        <div className="mt-5 space-y-6">
          <CountTable grid={grid} metric="inCenter" title="In-center students" />
          <CountTable grid={grid} metric="online" title="Online students" />
        </div>
      )}
    </div>
  )
}

/**
 * One table, both metrics share it so the two stack in perfect alignment:
 * weekday axis · weekday columns · Saturday axis · Saturday column. The
 * Saturday axis repeats per table because each table must read on its own.
 */
function CountTable({ grid, metric, title }) {
  const hasSaturday = Boolean(grid.saturday)
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">{title}</p>
      <table className="border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-16" />
            {grid.weekdays.map(({ date }) => (
              <th key={date} className="px-1 pb-1 text-center text-[11px] font-semibold text-zinc-600">
                {DAY_LABEL[new Date(`${date}T12:00:00`).getDay()]}{' '}
                <span className="font-normal text-zinc-400">{formatDateShort(date)}</span>
              </th>
            ))}
            {hasSaturday && <th className="w-16" />}
            {hasSaturday && (
              <th className="px-1 pb-1 text-center text-[11px] font-semibold text-zinc-600">
                Sat <span className="font-normal text-zinc-400">{formatDateShort(grid.saturday.date)}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-[11px] text-zinc-500 tabular-nums">
                {row.w !== null ? formatTime(minutesToTime(row.w)) : ''}
              </td>
              {grid.weekdays.map((day) => (
                <td key={day.date} className="px-1 py-px text-center">
                  {row.w !== null && (
                    <Chip n={day[metric][grid.weekdayBands.indexOf(row.w)] ?? 0} />
                  )}
                </td>
              ))}
              {hasSaturday && (
                <td className="pr-2 pl-3 text-right text-[11px] text-zinc-500 tabular-nums">
                  {row.s !== null ? formatTime(minutesToTime(row.s)) : ''}
                </td>
              )}
              {hasSaturday && (
                <td className="px-1 py-px text-center">
                  {row.s !== null && (
                    <Chip n={grid.saturday[metric][grid.saturdayBands.indexOf(row.s)] ?? 0} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The day-view axis chip bands, without the uncovered-red (no shifts here). */
function Chip({ n }) {
  return (
    <span
      className={
        'inline-block min-w-[26px] rounded px-1 text-center text-[11px] leading-5 font-semibold tabular-nums ' +
        slotChipClass(n, 1)
      }
    >
      {n}
    </span>
  )
}
