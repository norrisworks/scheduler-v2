import { useState } from 'react'
import { formatTime } from '../../lib/dates'
import { STATUSES } from './levels'
import { ACADEMIC_STATUS, BRAND_RED, SLOT_CERTAINTY } from './studentOptions'
import { coverageWarning } from './shiftCoverage'
import { INSTRUCTOR_DRAG_TYPE } from './dnd'

/**
 * One card component for both orientations. Layout, sizing and row order in
 * the vertical form follow the v1 card verbatim (v1_reference session_card).
 * The horizontal form is the same information on two lines, because a
 * 30-minute bar is only ~76px wide.
 *
 * Clicking opens the student drawer, as it did in v1. Status changes live
 * behind the ⋯ menu rather than an always-present dropdown.
 */
export default function SessionCard({
  session,
  instructor,
  shift,
  notes = [],
  layout = 'vertical',
  showInstructorName = true,
  style,
  selected,
  active,
  dragActive,
  armedInstructor,
  onOpenStudent,
  onAssign,
  onUnassign,
  onStatusMenu,
}) {
  const [dragOver, setDragOver] = useState(false)

  const student = session.student
  const status = STATUSES[session.status] ?? STATUSES.scheduled
  const certainty = SLOT_CERTAINTY[student?.slot_certainty]
  const academic = ACADEMIC_STATUS[student?.academic_status]
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
  // drag never fires). Otherwise a click opens the student, as in v1.
  function handleClick() {
    if (armedInstructor) onAssign(session.id, armedInstructor.id)
    else onOpenStudent(session.student_id, session.id)
  }

  function openMenu(e) {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    onStatusMenu({ session, x: rect.right, y: rect.bottom })
  }

  const ring =
    dragOver || selected
      ? `2px solid ${BRAND_RED}`
      : active
        ? '2px solid #22C55E'
        : dragActive
          ? `2px solid ${BRAND_RED}80`
          : null

  const wrapperProps = {
    onDragOver: handleDragOver,
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
    onClick: handleClick,
    onContextMenu: (e) => {
      e.preventDefault()
      onStatusMenu({ session, x: e.clientX, y: e.clientY })
    },
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

  // No wrapper and no background of its own: anything permanently painted in
  // the corner reads as a dead white patch where the grade chip used to be.
  const menuButton = (
    <button
      type="button"
      onClick={openMenu}
      aria-label={`Change status for ${student?.name ?? 'session'}`}
      className="shrink-0 rounded px-0.5 text-[10px] leading-none text-zinc-500 opacity-0 transition focus-visible:opacity-100 group-hover:bg-white/80 group-hover:opacity-100 hover:text-zinc-800"
    >
      ⋯
    </button>
  )

  // Binder tick: prepped or not, nothing more. The note itself is prep-room
  // context and never appears on a card.
  const binderTick =
    session.binder_status === 'complete' ? (
      <span className="shrink-0 text-[8px] leading-none text-emerald-600" title="Binder ready" aria-label="Binder ready">
        ✓
      </span>
    ) : (
      <span className="shrink-0 text-[8px] leading-none text-red-500" title="Binder not ready" aria-label="Binder not ready">
        ✗
      </span>
    )

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

  // Rows view: the row label already carries the student's name, certainty
  // dot and grade, so the bar never repeats them. It stays slim and shows
  // only what varies per session.
  if (layout === 'horizontal') {
    return (
      <div
        {...wrapperProps}
        className={
          'group absolute flex cursor-pointer flex-col justify-center gap-px overflow-hidden rounded-lg px-1.5 shadow-sm transition-all ' +
          (status.muted ? 'opacity-60' : '')
        }
      >
        <div className="flex items-center gap-1">
          <span
            className={
              'shrink-0 text-[9px] text-zinc-600 ' +
              (session.status === 'cancelled' ? 'line-through' : '')
            }
          >
            {formatTime(session.start_time)} • {session.duration}m
          </span>
          {binderTick}
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
          <span className="ml-auto flex shrink-0 items-center">
            {unassignButton}
            {menuButton}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* On a narrow bar the fill colour already says who it is; printing
              a clipped name there costs more than it tells you. */}
          {instructor ? (
            showInstructorName ? (
              <span className="min-w-0 truncate text-[9px]" style={{ color: instructor.color }}>
                → {instructor.name}
              </span>
            ) : null
          ) : (
            <span className="truncate text-[9px] text-zinc-400">Unassigned</span>
          )}
          {session.status !== 'scheduled' && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-white/70 px-1 text-[8px] font-semibold text-zinc-700">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          )}
        </div>
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
      {/* Row 1: certainty dot and name. The grade chip used to sit inline
          here and cost the name most of the card's width. */}
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
            'min-w-0 flex-1 truncate text-[11px] font-medium ' +
            (session.status === 'cancelled' ? 'line-through' : '')
          }
          style={{ color: instructor?.color || '#374151' }}
        >
          {student?.name || 'Unknown'}
        </div>
      </div>

      {/* Floated rather than inline: as a flex sibling it permanently reserved
          ~13px of a 95px card and truncated names that would otherwise fit.
          It paints nothing until hover, so the corner is not dead space. */}
      <div className="absolute top-0.5 right-0.5">{menuButton}</div>

      {/* Row 2: time, duration and grade (session_card spec styling) */}
      <div className="mt-0.5 flex items-center gap-1 text-[9px] text-zinc-500">
        <span>
          {formatTime(session.start_time)} • {session.duration}m
        </span>
        {binderTick}
        {student?.grade && (
          <span className="shrink-0 rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-600">
            {student.grade}
          </span>
        )}
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
    </div>
  )
}
