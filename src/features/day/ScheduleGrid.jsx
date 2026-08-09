import { useMemo } from 'react'
import { formatTime, minutesToTime } from '../../lib/dates'
import { LEVELS, UNSET_LEVEL, levelOf } from './levels'
import { sessionEndMinutes } from './shiftCoverage'
import {
  SLOT_HEIGHT,
  SLOT_MINUTES,
  SUBCOL_WIDTH,
  buildTimeAxis,
  columnWidth,
  packSubColumns,
  sessionGeometry,
  subColumnLeft,
} from './timeGrid'
import SessionCard from './SessionCard'

const GUTTER = 56 // px

export default function ScheduleGrid({
  date,
  sessions,
  instructorsById,
  shiftByInstructor,
  notesByStudent,
  nowMinutes,
  selectedId,
  dragActive,
  armedInstructor,
  onSelect,
  onAssign,
  onUnassign,
  onStatusChange,
}) {
  const { axis, columns } = useMemo(() => {
    const hasUnset = sessions.some((s) => levelOf(s) === UNSET_LEVEL.key)
    const defs = hasUnset ? [...LEVELS, UNSET_LEVEL] : LEVELS

    return {
      axis: buildTimeAxis(date, sessions),
      columns: defs.map((def) => {
        const mine = sessions.filter((s) => levelOf(s) === def.key)
        return { def, sessions: mine, pack: packSubColumns(mine) }
      }),
    }
  }, [date, sessions])

  return (
    <div className="min-w-fit p-4">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 bg-slate-100 px-4 pt-4 pb-2">
        <div className="flex gap-3">
          <div style={{ width: GUTTER }} className="shrink-0" />
          {columns.map(({ def, sessions: mine, pack }) => (
            <div key={def.key} style={{ width: columnWidth(pack.count) }} className="shrink-0">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${def.accent}`} />
                <span className="truncate text-xs font-semibold text-slate-800">{def.label}</span>
                <span className="ml-auto text-xs text-slate-400">{mine.length}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div style={{ width: GUTTER, height: axis.height }} className="relative shrink-0">
          {axis.slots.map((minutes, i) => (
            <span
              key={minutes}
              className="absolute right-0 -translate-y-1/2 text-[10px] text-slate-500 tabular-nums"
              style={{ top: i * SLOT_HEIGHT }}
            >
              {formatTime(minutesToTime(minutes))}
            </span>
          ))}
        </div>

        {columns.map(({ def, pack }) => (
          <div
            key={def.key}
            style={{ width: columnWidth(pack.count), height: axis.height }}
            className="relative shrink-0"
          >
            {axis.slots.map((minutes, i) => (
              <div
                key={minutes}
                className={
                  'absolute inset-x-0 border-t ' +
                  (minutes % 60 === 0 ? 'border-slate-300' : 'border-slate-200')
                }
                style={{ top: i * SLOT_HEIGHT }}
              />
            ))}

            {nowMinutes !== null &&
              nowMinutes >= axis.start &&
              nowMinutes <= axis.end && (
                <div
                  className="absolute inset-x-0 z-10 border-t-2 border-emerald-500/70"
                  style={{ top: ((nowMinutes - axis.start) / SLOT_MINUTES) * SLOT_HEIGHT }}
                />
              )}

            {pack.sorted.map((session) => {
              const { top, height } = sessionGeometry(session, axis)
              const startMin = axis.start + (top / SLOT_HEIGHT) * SLOT_MINUTES
              const active =
                nowMinutes !== null &&
                nowMinutes >= startMin &&
                nowMinutes < sessionEndMinutes(session)

              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  instructor={instructorsById.get(session.instructor_id) ?? null}
                  shift={shiftByInstructor.get(session.instructor_id) ?? null}
                  notes={notesByStudent.get(session.student_id) ?? []}
                  style={{
                    top,
                    height: height - 2,
                    left: subColumnLeft(pack.indexById.get(session.id) ?? 0),
                    width: SUBCOL_WIDTH,
                  }}
                  selected={selectedId === session.id}
                  active={active}
                  dragActive={dragActive}
                  armedInstructor={armedInstructor}
                  onSelect={onSelect}
                  onAssign={onAssign}
                  onUnassign={onUnassign}
                  onStatusChange={onStatusChange}
                />
              )
            })}
          </div>
        ))}
      </div>

      {sessions.length === 0 && (
        <p className="mt-6 text-center text-xs text-slate-400">
          No sessions on this day. Sessions arrive from the materializer, the Radius import, or
          manual entry.
        </p>
      )}
    </div>
  )
}
