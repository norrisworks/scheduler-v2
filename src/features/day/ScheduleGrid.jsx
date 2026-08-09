import { useMemo } from 'react'
import { formatTimeMeridiem } from '../../lib/dates'
import { LEVELS, UNSET_LEVEL, levelOf } from './levels'
import SessionCard from './SessionCard'

export default function ScheduleGrid({
  sessions,
  instructorsById,
  shiftByInstructor,
  notesByStudent,
  armedInstructor,
  onAssign,
  onUnassign,
  onStatusChange,
}) {
  const { columns, rows } = useMemo(() => {
    const hasUnset = sessions.some((s) => levelOf(s) === UNSET_LEVEL.key)
    const columns = hasUnset ? [...LEVELS, UNSET_LEVEL] : LEVELS

    const byTime = new Map()
    for (const session of sessions) {
      const list = byTime.get(session.start_time)
      if (list) list.push(session)
      else byTime.set(session.start_time, [session])
    }

    const rows = [...byTime.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, list]) => ({
        time,
        cells: columns.map((col) =>
          list
            .filter((s) => levelOf(s) === col.key)
            .sort((a, b) => (a.student?.name ?? '').localeCompare(b.student?.name ?? '')),
        ),
      }))

    return { columns, rows }
  }, [sessions])

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-20 text-center">
        <div>
          <p className="text-sm font-medium text-slate-600">No sessions on this day.</p>
          <p className="mt-1 text-xs text-slate-400">
            Sessions arrive from the materializer, the Radius import, or manual entry.
          </p>
        </div>
      </div>
    )
  }

  const template = `4.75rem repeat(${columns.length}, minmax(11rem, 1fr))`

  return (
    <div className="min-w-fit p-4">
      <div className="grid gap-x-3" style={{ gridTemplateColumns: template }}>
        <div className="sticky top-0 z-10 bg-slate-100 pb-2" />
        {columns.map((col) => (
          <div key={col.key} className="sticky top-0 z-10 bg-slate-100 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <span className={`h-2 w-2 rounded-full ${col.accent}`} />
              <span className="text-sm font-semibold text-slate-800">{col.label}</span>
              <span className="ml-auto text-xs text-slate-400">
                {sessions.filter((s) => levelOf(s) === col.key).length}
              </span>
            </div>
          </div>
        ))}

        {rows.map((row) => (
          <Row key={row.time} row={row}>
            {row.cells.map((cell, i) => (
              <div key={columns[i].key} className="min-w-0 space-y-2 border-t border-slate-200 py-2">
                {cell.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    instructor={instructorsById.get(session.instructor_id) ?? null}
                    shift={shiftByInstructor.get(session.instructor_id) ?? null}
                    notes={notesByStudent.get(session.student_id) ?? []}
                    armedInstructor={armedInstructor}
                    onAssign={onAssign}
                    onUnassign={onUnassign}
                    onStatusChange={onStatusChange}
                  />
                ))}
              </div>
            ))}
          </Row>
        ))}
      </div>
    </div>
  )
}

// `display: contents` lets the row's cells participate in the outer grid, so
// every column stays aligned across every time row.
function Row({ row, children }) {
  return (
    <div className="contents">
      <div className="border-t border-slate-200 py-2 text-right">
        <span className="text-sm font-semibold text-slate-700">
          {formatTimeMeridiem(row.time)}
        </span>
      </div>
      {children}
    </div>
  )
}
