import { useMemo, useState } from 'react'
import { formatTimeMeridiem } from '../../lib/dates'
import { readableTextOn } from '../../lib/colors'
import { peakConcurrent } from './shiftCoverage'
import {
  NORMAL_RATIO,
  STRETCH_RATIO,
  instructorCurrentCount,
  instructorLoadBySlot,
  instructorTotalCount,
  gaugeCellClass,
  occupiesFloor,
} from './load'
import LoadGauge from './LoadGauge'
import { INSTRUCTOR_DRAG_TYPE } from './dnd'

export default function InstructorSidebar({
  instructors,
  shiftByInstructor,
  sessions,
  axis,
  nowMinutes,
  armedInstructorId,
  onArm,
  onDragStateChange,
  open,
  onToggleOpen,
}) {
  // v1_reference: only instructors on shift are listed. Off-shift staff stay
  // reachable behind a disclosure — Workstream coverage is partial, and
  // someone who is physically here still has to be assignable.
  const [showOffShift, setShowOffShift] = useState(false)

  const stats = useMemo(() => {
    const map = new Map()
    for (const instructor of instructors) {
      const mine = sessions.filter((s) => s.instructor_id === instructor.id && occupiesFloor(s))
      map.set(instructor.id, {
        total: instructorTotalCount(sessions, instructor.id),
        now: instructorCurrentCount(sessions, instructor.id, nowMinutes),
        peak: peakConcurrent(mine),
        load: instructorLoadBySlot(sessions, instructor.id, axis.slots),
      })
    }
    return map
  }, [instructors, sessions, axis.slots, nowMinutes])

  const onShift = instructors.filter((i) => shiftByInstructor.has(i.id))
  const offShift = instructors.filter((i) => !shiftByInstructor.has(i.id))
  const unassigned = sessions.filter((s) => !s.instructor_id && occupiesFloor(s)).length

  // Collapsed: a thin rail the grid can have the width back from, still
  // showing the numbers worth glancing at.
  if (!open) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center gap-3 border-l border-zinc-200 bg-white py-2">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label="Show instructor sidebar"
          aria-expanded={false}
          title="Show instructors"
          className="rounded px-1.5 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          ‹
        </button>
        <span
          className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
          style={{ writingMode: 'vertical-rl' }}
        >
          Instructors
        </span>
        <span className="rounded bg-zinc-100 px-1 text-[10px] font-semibold text-zinc-600 tabular-nums">
          {onShift.length}
        </span>
        {unassigned > 0 && (
          <span
            className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 tabular-nums"
            title={`${unassigned} unassigned`}
          >
            {unassigned}
          </span>
        )}
      </aside>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-white">
      <div className="flex items-start gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-900">Instructors</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {onShift.length} on shift · {unassigned} unassigned
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label="Hide instructor sidebar"
          aria-expanded
          title="Hide instructors"
          className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ›
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {onShift.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            Nobody is on shift for this date.
          </p>
        )}

        {onShift.map((instructor) => (
          <InstructorRow
            key={instructor.id}
            instructor={instructor}
            shift={shiftByInstructor.get(instructor.id)}
            stats={stats.get(instructor.id)}
            slots={axis.slots}
            armed={armedInstructorId === instructor.id}
            onArm={onArm}
            onDragStateChange={onDragStateChange}
          />
        ))}

        {offShift.length > 0 && (
          <div className="mt-3 border-t border-slate-200 pt-2">
            <button
              type="button"
              onClick={() => setShowOffShift((v) => !v)}
              className="w-full px-2 py-1 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase hover:text-slate-600"
            >
              {showOffShift ? '▾' : '▸'} Not on shift ({offShift.length})
            </button>
            {showOffShift &&
              offShift.map((instructor) => (
                <InstructorRow
                  key={instructor.id}
                  instructor={instructor}
                  shift={null}
                  stats={stats.get(instructor.id)}
                  slots={axis.slots}
                  armed={armedInstructorId === instructor.id}
                  onArm={onArm}
                  onDragStateChange={onDragStateChange}
                />
              ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span>Load</span>
          <Swatch load={0} label="0" />
          <Swatch load={2} label="1–2" />
          <Swatch load={NORMAL_RATIO} label="3" />
          <Swatch load={STRETCH_RATIO} label="4" />
          <Swatch load={5} label="5+" />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          Drag onto a session to assign, or tap to select then tap sessions.
        </p>
      </div>
    </aside>
  )
}

function Swatch({ load, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className={'h-2.5 w-3 rounded-[1px] ' + gaugeCellClass(load)} />
      {label}
    </span>
  )
}

function InstructorRow({ instructor, shift, stats, slots, armed, onArm, onDragStateChange }) {
  const capabilities = [
    instructor.can_teach_elementary && 'E',
    instructor.can_teach_middle && 'M',
    instructor.can_teach_high && 'H',
  ].filter(Boolean)

  const atCap = (stats?.peak ?? 0) >= STRETCH_RATIO

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(INSTRUCTOR_DRAG_TYPE, instructor.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStateChange?.(true)
      }}
      onDragEnd={() => onDragStateChange?.(false)}
      onClick={() => onArm(armed ? null : instructor.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onArm(armed ? null : instructor.id)
        }
      }}
      aria-pressed={armed}
      className={
        'mb-1 w-full cursor-grab rounded-lg border px-2 py-1.5 text-left transition active:cursor-grabbing ' +
        (armed
          ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200'
          : 'border-transparent hover:border-slate-200 hover:bg-slate-50') +
        (shift ? '' : ' opacity-60')
      }
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
          style={{ backgroundColor: instructor.color, color: readableTextOn(instructor.color) }}
        >
          {initials(instructor.name)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">
            {instructor.name}
          </span>
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
          {stats?.now !== null && stats?.now !== undefined && (
            <span
              className={
                'block text-[10px] font-semibold ' +
                (stats.now > 0 ? 'text-emerald-600' : 'text-slate-300')
              }
            >
              now {stats.now}
            </span>
          )}
          <span
            className={'block text-sm font-semibold ' + (atCap ? 'text-red-600' : 'text-slate-900')}
            title={`${stats?.total ?? 0} today · peak ${stats?.peak ?? 0} at once`}
          >
            {stats?.total ?? 0}
          </span>
        </span>
      </div>

      <div className="mt-1.5">
        <LoadGauge
          slots={slots}
          load={stats?.load ?? []}
          label={`${instructor.name} load by half hour`}
        />
      </div>
    </div>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
