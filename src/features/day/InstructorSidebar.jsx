import { useMemo } from 'react'
import { formatTimeMeridiem } from '../../lib/dates'
import { readableTextOn } from '../../lib/colors'
import { peakConcurrent } from './shiftCoverage'
import { INSTRUCTOR_DRAG_TYPE } from './dnd'

export default function InstructorSidebar({
  instructors,
  shiftByInstructor,
  sessions,
  armedInstructorId,
  onArm,
  onDragStateChange,
}) {
  const load = useMemo(() => {
    const map = new Map()
    // Cancelled sessions still hold an assignment row but cost nobody time.
    const billable = sessions.filter((s) => s.status !== 'cancelled')
    for (const instructor of instructors) {
      const mine = billable.filter((s) => s.instructor_id === instructor.id)
      map.set(instructor.id, { total: mine.length, peak: peakConcurrent(mine) })
    }
    return map
  }, [instructors, sessions])

  const scheduled = instructors.filter((i) => shiftByInstructor.has(i.id))
  const offToday = instructors.filter((i) => !shiftByInstructor.has(i.id))
  const unassignedCount = sessions.filter(
    (s) => !s.instructor_id && s.status !== 'cancelled',
  ).length

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Instructors</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {scheduled.length} on shift · {unassignedCount} session
          {unassignedCount === 1 ? '' : 's'} unassigned
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {scheduled.length === 0 && offToday.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            No active instructors at this center.
          </p>
        )}

        {scheduled.map((instructor) => (
          <InstructorRow
            key={instructor.id}
            instructor={instructor}
            shift={shiftByInstructor.get(instructor.id)}
            load={load.get(instructor.id)}
            armed={armedInstructorId === instructor.id}
            onArm={onArm}
            onDragStateChange={onDragStateChange}
          />
        ))}

        {offToday.length > 0 && (
          <>
            <p className="mt-4 mb-1 px-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Not scheduled today
            </p>
            {offToday.map((instructor) => (
              <InstructorRow
                key={instructor.id}
                instructor={instructor}
                shift={null}
                load={load.get(instructor.id)}
                armed={armedInstructorId === instructor.id}
                onArm={onArm}
                onDragStateChange={onDragStateChange}
              />
            ))}
          </>
        )}
      </div>

      <p className="border-t border-slate-200 px-4 py-2.5 text-[11px] leading-snug text-slate-400">
        Drag onto a session to assign, or tap to select then tap sessions.
      </p>
    </aside>
  )
}

function InstructorRow({ instructor, shift, load, armed, onArm, onDragStateChange }) {
  const capabilities = [
    instructor.can_teach_elementary && 'E',
    instructor.can_teach_middle && 'M',
    instructor.can_teach_high && 'H',
  ].filter(Boolean)

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(INSTRUCTOR_DRAG_TYPE, instructor.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStateChange?.(true)
      }}
      onDragEnd={() => onDragStateChange?.(false)}
      onClick={() => onArm(armed ? null : instructor.id)}
      aria-pressed={armed}
      className={
        'mb-1 flex w-full cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition active:cursor-grabbing ' +
        (armed
          ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200'
          : 'border-transparent hover:border-slate-200 hover:bg-slate-50') +
        (shift ? '' : ' opacity-60')
      }
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
        style={{ backgroundColor: instructor.color, color: readableTextOn(instructor.color) }}
      >
        {initials(instructor.name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">{instructor.name}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {shift
            ? `${formatTimeMeridiem(shift.start_time)}–${formatTimeMeridiem(shift.end_time)}`
            : 'No shift'}
          {' · '}
          {capabilities.join('') || 'no levels'}
          {instructor.last_resort ? ' · last resort' : ''}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-slate-900">{load?.total ?? 0}</span>
        <span className="block text-[10px] text-slate-400" title="Peak concurrent students">
          pk {load?.peak ?? 0}
        </span>
      </span>
    </button>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
