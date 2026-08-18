import { useMemo, useState } from 'react'
import QueryError from '../../components/QueryError'
import { useCenter } from '../centers/CenterProvider'
import {
  addDays,
  formatDateShort,
  formatTimeMeridiem,
  startOfWeek,
  todayISO,
} from '../../lib/dates'
import { readableTextOn } from '../../lib/colors'
import Spinner from '../../components/Spinner'
import { DAYS } from '../roster/studentFields'
import { useWeekShifts } from './useWeekShifts'
import { indexShifts, suggestTimes, totalHours } from './weekShifts'
import ShiftCellEditor from './ShiftCellEditor'

const NAME_COLUMN = 190

export default function ShiftsView() {
  const { centerId } = useCenter()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()))
  const [cell, setCell] = useState(null)
  const [copyResult, setCopyResult] = useState(null)

  const {
    days,
    shifts,
    instructors,
    loading,
    saving,
    error,
    refetch,
    saveShift,
    deleteShift,
    copyLastWeek,
    dismissError,
  } = useWeekShifts(centerId, weekStart)

  const byCell = useMemo(() => indexShifts(shifts), [shifts])
  const today = todayISO()
  const thisWeek = startOfWeek(today)

  function openCell(instructor, date, shift, event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const mine = shifts.filter((s) => s.instructor_id === instructor.id)
    const suggested = suggestTimes(mine)
    setCell({
      instructor,
      date,
      shift: shift ?? null,
      start: shift ? shift.start_time.slice(0, 5) : suggested.start,
      end: shift ? shift.end_time.slice(0, 5) : suggested.end,
      x: rect.left,
      y: rect.bottom,
    })
  }

  async function runCopy() {
    const result = await copyLastWeek()
    setCopyResult(result)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-1">
          <NavButton onClick={() => setWeekStart(addDays(weekStart, -7))} label="Previous week">
            ‹
          </NavButton>
          <NavButton onClick={() => setWeekStart(addDays(weekStart, 7))} label="Next week">
            ›
          </NavButton>
        </div>
        <button
          type="button"
          onClick={() => setWeekStart(thisWeek)}
          disabled={weekStart === thisWeek}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
        >
          This week
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-zinc-900">
            {formatDateShort(weekStart)} – {formatDateShort(addDays(weekStart, 6))}
          </h1>
          <p className="text-xs text-zinc-500">
            {shifts.length} shift{shifts.length === 1 ? '' : 's'} ·{' '}
            {totalHours(shifts).toFixed(1)} hours
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={runCopy}
            disabled={saving}
            title="Copy the previous week's shifts into this one. Existing shifts are never overwritten."
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
          >
            Copy last week
          </button>
          <button
            type="button"
            onClick={refetch}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {copyResult && (
        <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span className="flex-1">
            {copyResult.source === 0
              ? 'The previous week has no shifts to copy.'
              : `Copied ${copyResult.inserted} shift${copyResult.inserted === 1 ? '' : 's'} from last week` +
                (copyResult.skipped ? `, skipping ${copyResult.skipped} already entered` : '') +
                '.'}
          </span>
          <button
            type="button"
            onClick={() => setCopyResult(null)}
            className="font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && instructors.length === 0 ? (
          <div className="p-6">
            <QueryError error={error} onRetry={refetch} />
          </div>
        ) : loading && instructors.length === 0 ? (
          <Spinner label="Loading week…" />
        ) : instructors.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-zinc-400">
            No active instructors at this center. Add them under Instructors first.
          </p>
        ) : (
          <div className="min-w-fit">
            <div className="flex gap-1">
              <div style={{ width: NAME_COLUMN }} className="shrink-0" />
              {days.map((date, i) => (
                <div
                  key={date}
                  className={
                    'w-32 shrink-0 rounded-t-lg px-2 py-1.5 text-center ' +
                    (date === today ? 'bg-brand-50' : '')
                  }
                >
                  <p className="text-xs font-semibold text-zinc-800">{DAYS[i].short}</p>
                  <p className="text-[11px] text-zinc-500">{formatDateShort(date).slice(5)}</p>
                </div>
              ))}
              <div className="w-16 shrink-0 px-2 py-1.5 text-center text-[11px] font-semibold text-zinc-500">
                Hours
              </div>
            </div>

            {instructors.map((instructor) => {
              const mine = shifts.filter((s) => s.instructor_id === instructor.id)
              return (
                <div key={instructor.id} className="flex gap-1 border-t border-zinc-200">
                  <div
                    style={{ width: NAME_COLUMN }}
                    className="flex shrink-0 items-center gap-2 py-2 pr-2"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                      style={{
                        backgroundColor: instructor.color,
                        color: readableTextOn(instructor.color),
                      }}
                    >
                      {initials(instructor.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                      {instructor.name}
                    </span>
                  </div>

                  {days.map((date) => {
                    const cellShifts = byCell.get(`${instructor.id}|${date}`) ?? []
                    return (
                      <div key={date} className="w-32 shrink-0 py-1.5">
                        {cellShifts.length === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => openCell(instructor, date, null, e)}
                            aria-label={`Add shift for ${instructor.name} on ${formatDateShort(date)}`}
                            className={
                              'h-9 w-full rounded-lg border border-dashed border-zinc-200 text-xs text-zinc-300 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 ' +
                              (date < today ? 'opacity-50' : '')
                            }
                          >
                            +
                          </button>
                        ) : (
                          <div className="space-y-1">
                            {cellShifts.map((shift) => (
                              <button
                                key={shift.id}
                                type="button"
                                onClick={(e) => openCell(instructor, date, shift, e)}
                                title={
                                  shift.source === 'workstream'
                                    ? 'From the Workstream import'
                                    : 'Entered by hand'
                                }
                                className="w-full rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 transition hover:border-brand-400 hover:bg-brand-50"
                              >
                                <span className="block truncate">
                                  {formatTimeMeridiem(shift.start_time)}–
                                  {formatTimeMeridiem(shift.end_time)}
                                </span>
                                {shift.source === 'workstream' && (
                                  <span className="block text-[9px] text-zinc-400">Workstream</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div className="flex w-16 shrink-0 items-center justify-center text-xs font-semibold text-zinc-600 tabular-nums">
                    {totalHours(mine) ? totalHours(mine).toFixed(1) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {cell && (
        <ShiftCellEditor
          cell={cell}
          saving={saving}
          onSave={saveShift}
          onDelete={deleteShift}
          onClose={() => setCell(null)}
        />
      )}
    </div>
  )
}

function NavButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-8 w-8 rounded-lg border border-zinc-300 text-lg leading-none text-zinc-600 transition hover:bg-zinc-100"
    >
      {children}
    </button>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
