import { useState } from 'react'
import { formatTimeMeridiem, minutesToTime } from '../../lib/dates'
import { readableTextOn, tint } from '../../lib/colors'
import { STATUSES } from './levels'
import { coverageWarning, sessionEndMinutes } from './shiftCoverage'
import { INSTRUCTOR_DRAG_TYPE } from './dnd'

export default function SessionCard({
  session,
  instructor,
  shift,
  notes = [],
  armedInstructor,
  onAssign,
  onUnassign,
  onStatusChange,
}) {
  const [dragOver, setDragOver] = useState(false)

  const student = session.student
  const status = STATUSES[session.status] ?? STATUSES.scheduled
  const endTime = minutesToTime(sessionEndMinutes(session))
  const warning = coverageWarning(instructor, shift, session)
  const accent = instructor?.color ?? null

  function handleDragOver(e) {
    if (!e.dataTransfer.types.includes(INSTRUCTOR_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  function handleDrop(e) {
    if (!e.dataTransfer.types.includes(INSTRUCTOR_DRAG_TYPE)) return
    e.preventDefault()
    setDragOver(false)
    const instructorId = e.dataTransfer.getData(INSTRUCTOR_DRAG_TYPE)
    if (instructorId) onAssign(session.id, instructorId)
  }

  // Click-to-assign: arm an instructor in the sidebar, then click cards. Keeps
  // the view usable on a tablet, where HTML5 drag events never fire.
  function handleClick() {
    if (armedInstructor) onAssign(session.id, armedInstructor.id)
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleClick}
      className={
        'group relative rounded-lg border bg-white p-2.5 text-left shadow-sm transition ' +
        (dragOver
          ? 'border-brand-500 ring-2 ring-brand-200'
          : 'border-slate-200 hover:border-slate-300') +
        (status.muted ? ' opacity-60' : '') +
        (armedInstructor ? ' cursor-copy' : '')
      }
      style={accent ? { backgroundColor: tint(accent, 0.07) } : undefined}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 rounded-l-lg"
        style={{ backgroundColor: accent ?? '#e2e8f0' }}
      />

      <div className="pl-1.5">
        <div className="flex items-start gap-2">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status.dot}`}
            title={status.label}
          />
          <div className="min-w-0 flex-1">
            <p
              className={
                'truncate text-sm font-semibold text-slate-900 ' +
                (session.status === 'cancelled' ? 'line-through' : '')
              }
            >
              {student?.name ?? 'Unknown student'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatTimeMeridiem(session.start_time)}–{formatTimeMeridiem(endTime)}
              {student?.grade ? ` · Gr ${student.grade}` : ''}
              {session.duration !== 60 ? ` · ${session.duration}m` : ''}
            </p>
          </div>
        </div>

        {(student?.first_day || student?.needs_schoolwork || session.source === 'radius') && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {student?.first_day && <Flag className="bg-emerald-100 text-emerald-800">First day</Flag>}
            {student?.needs_schoolwork && (
              <Flag className="bg-sky-100 text-sky-800">Schoolwork</Flag>
            )}
            {session.source === 'radius' && <Flag className="bg-slate-100 text-slate-600">Radius</Flag>}
          </div>
        )}

        {session.notes && (
          <p className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-xs text-amber-900">
            {session.notes}
          </p>
        )}

        {notes.map((note) => (
          <p
            key={note.id}
            className="mt-1.5 rounded bg-slate-100 px-1.5 py-1 text-xs text-slate-700"
            title={note.note_type}
          >
            {note.body}
          </p>
        ))}

        <div className="mt-2 flex items-center gap-1.5">
          {instructor ? (
            <>
              <span
                className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                style={{ backgroundColor: instructor.color, color: readableTextOn(instructor.color) }}
              >
                <span className="truncate">{instructor.name}</span>
              </span>
              {warning && (
                <span
                  className="cursor-help text-xs text-amber-600"
                  title={warning}
                  aria-label={warning}
                >
                  ⚠
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onUnassign(session.id)
                }}
                className="ml-auto rounded px-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700"
                aria-label={`Unassign ${instructor.name}`}
              >
                ✕
              </button>
            </>
          ) : (
            <span className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-xs text-slate-400">
              Unassigned
            </span>
          )}
        </div>

        <select
          value={session.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatusChange(session.id, e.target.value)}
          aria-label={`Status for ${student?.name ?? 'session'}`}
          className="mt-1.5 w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600 opacity-0 transition focus:opacity-100 group-hover:opacity-100"
        >
          {Object.entries(STATUSES).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function Flag({ children, className }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>
  )
}
