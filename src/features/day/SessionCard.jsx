import { useState } from 'react'
import { formatTime } from '../../lib/dates'
import { STATUSES } from './levels'
import { ACADEMIC_STATUS, BRAND_RED, SLOT_CERTAINTY } from './studentOptions'
import { coverageWarning } from './shiftCoverage'
import { INSTRUCTOR_DRAG_TYPE } from './dnd'

/**
 * One card component for both orientations, as the spec requires. Layout,
 * sizing and row order in the vertical form follow the v1 card verbatim
 * (v1_reference session_card). The horizontal form is the same information
 * on two lines, because a 30-minute bar is only ~76px wide.
 *
 * Two deliberate departures from v1, both required by BRIEF.md: notes are
 * pinned student_notes at readable size rather than 8px student.notes, and
 * session status is shown at all, which v1 had no concept of.
 */
export default function SessionCard({
  session,
  instructor,
  shift,
  notes = [],
  layout = 'vertical',
  style,
  selected,
  active,
  dragActive,
  armedInstructor,
  onSelect,
  onAssign,
  onUnassign,
  onStatusChange,
}) {
  const [dragOver, setDragOver] = useState(false)

  const student = session.student
  const status = STATUSES[session.status] ?? STATUSES.scheduled
  const certainty = SLOT_CERTAINTY[student?.slot_certainty]
  const academic = ACADEMIC_STATUS[student?.academic_status ?? student?.performance]
  const warning = coverageWarning(instructor, shift, session)
  const noteText = [session.notes, ...notes.map((n) => n.body)].filter(Boolean).join(' · ')

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

  // Armed instructor turns clicks into assignments (tablet path, where HTML5
  // drag never fires). Otherwise a click selects, as it did in v1.
  function handleClick() {
    if (armedInstructor) onAssign(session.id, armedInstructor.id)
    else onSelect(selected ? null : session.id)
  }

  const ring = dragOver || selected ? `2px solid ${BRAND_RED}` : active
    ? '2px solid #22C55E'
    : dragActive
      ? `2px solid ${BRAND_RED}80`
      : null

  const wrapperProps = {
    onDragOver: handleDragOver,
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
    onClick: handleClick,
    title: student?.name,
    style: {
      ...style,
      backgroundColor: instructor ? `${instructor.color}20` : '#f3f4f6',
      borderLeft: `3px solid ${instructor?.color || '#d1d5db'}`,
      // v1: a first-day student gets a full brand-red border, which
      // deliberately replaces the instructor stripe.
      ...(student?.first_day ? { border: `3px solid ${BRAND_RED}` } : null),
      ...(ring ? { outline: ring, outlineOffset: '-2px' } : null),
    },
  }

  const unassignButton = instructor && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onUnassign(session.id)
      }}
      aria-label={`Unassign ${instructor.name}`}
      className="shrink-0 rounded px-0.5 text-[9px] text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:text-zinc-700"
    >
      ✕
    </button>
  )

  const statusSelect = selected && (
    <select
      value={session.status}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onStatusChange(session.id, e.target.value)}
      aria-label={`Status for ${student?.name ?? 'session'}`}
      className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] text-zinc-700"
    >
      {Object.entries(STATUSES).map(([value, meta]) => (
        <option key={value} value={value}>
          {meta.label}
        </option>
      ))}
    </select>
  )

  if (layout === 'horizontal') {
    return (
      <div
        {...wrapperProps}
        className={
          'group absolute flex cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-lg px-1.5 shadow-sm transition-all ' +
          (status.muted ? 'opacity-60' : '')
        }
      >
        <div className="flex items-center gap-1">
          {certainty && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: certainty.color }}
              title={certainty.label}
            />
          )}
          <span
            className="truncate text-[11px] font-medium"
            style={{ color: instructor?.color || '#374151' }}
          >
            {student?.name || 'Unknown'}
          </span>
          {student?.grade && (
            <span className="shrink-0 rounded bg-zinc-200 px-1 text-[9px] text-zinc-600">
              {student.grade}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[9px] text-zinc-500">
            {formatTime(session.start_time)} • {session.duration}m
          </span>
        </div>

        <div className="flex items-center gap-1">
          {instructor ? (
            <span className="truncate text-[9px]" style={{ color: instructor.color }}>
              → {instructor.name}
            </span>
          ) : (
            <span className="truncate text-[9px] text-zinc-400">Unassigned</span>
          )}
          {warning && (
            <span className="shrink-0 text-[9px] text-amber-600" title={warning} aria-label={warning}>
              ⚠
            </span>
          )}
          {noteText && (
            <span
              className="shrink-0 text-[9px] text-amber-600"
              title={noteText}
              aria-label={`Note: ${noteText}`}
            >
              ●
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {student?.needs_schoolwork && (
              <span className="rounded bg-[#FFEB3B] px-1 text-[8px] font-bold text-black">Supp</span>
            )}
            {unassignButton}
          </span>
        </div>

        {statusSelect}
      </div>
    )
  }

  return (
    <div
      {...wrapperProps}
      className={
        'group absolute flex cursor-pointer flex-col overflow-hidden rounded-lg p-1.5 shadow-sm transition-all ' +
        (status.muted ? 'opacity-60' : '')
      }
    >
      {/* Row 1: certainty dot, name, grade */}
      <div className="flex items-center gap-1">
        {certainty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: certainty.color }}
            title={certainty.label}
          />
        )}
        <div
          className={
            'truncate text-[11px] font-medium ' +
            (session.status === 'cancelled' ? 'line-through' : '')
          }
          style={{ color: instructor?.color || '#374151' }}
        >
          {student?.name || 'Unknown'}
        </div>
        {student?.grade && (
          <span className="shrink-0 rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-600">
            {student.grade}
          </span>
        )}
      </div>

      {/* Row 2: time and duration */}
      <div className="mt-0.5 text-[9px] text-zinc-500">
        {formatTime(session.start_time)} • {session.duration}m
      </div>

      {/* Row 3: academic status, and session status when it isn't the norm */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {academic && (
          <span
            className="rounded px-1 py-0.5 text-[8px] font-medium"
            style={{ backgroundColor: academic.bg, color: academic.color }}
          >
            {academic.label}
          </span>
        )}
        {session.status !== 'scheduled' && (
          <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1 py-0.5 text-[8px] font-semibold text-zinc-700">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        )}
      </div>

      {/* Middle: pinned notes and the day's one-liner. BRIEF.md requires these
          at readable size; v1 rendered them at 8px. */}
      {(session.notes || notes.length > 0) && (
        <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden">
          {session.notes && (
            <p className="line-clamp-2 text-[11px] leading-snug break-words text-amber-900">
              {session.notes}
            </p>
          )}
          {notes.map((note) => (
            <p
              key={note.id}
              className="line-clamp-2 text-[11px] leading-snug break-words text-zinc-700"
              title={note.body}
            >
              {note.body}
            </p>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom: instructor left, Supp badge right */}
      <div className="mt-0.5 flex items-center justify-between gap-1">
        {instructor ? (
          <span className="flex min-w-0 items-center gap-0.5">
            <span className="truncate text-[9px]" style={{ color: instructor.color }}>
              → {instructor.name}
            </span>
            {warning && (
              <span className="shrink-0 text-[9px] text-amber-600" title={warning} aria-label={warning}>
                ⚠
              </span>
            )}
            {unassignButton}
          </span>
        ) : (
          <span />
        )}
        {student?.needs_schoolwork && (
          <span className="shrink-0 rounded bg-[#FFEB3B] px-1 py-0.5 text-[8px] font-bold text-black">
            Supp
          </span>
        )}
      </div>

      {statusSelect && <div className="mt-1">{statusSelect}</div>}
    </div>
  )
}
