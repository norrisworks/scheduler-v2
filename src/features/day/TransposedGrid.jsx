import { useMemo, useState } from 'react'
import { formatTime, minutesToTime } from '../../lib/dates'
import { LEVELS, UNSET_LEVEL, levelOf } from './levels'
import { sessionEndMinutes } from './shiftCoverage'
import {
  ROW_GAP,
  ROW_HEIGHT,
  SLOT_MINUTES,
  SLOT_WIDTH,
  axisWidth,
  groupByStudent,
  sessionSpan,
} from './timeGrid'
import SessionCard from './SessionCard'
import SlotCount from './SlotCount'
import { SLOT_CERTAINTY } from './studentOptions'

const NAME_COLUMN = 180 // px — name, certainty dot, grade and Supp live here

/**
 * Transposed orientation: time runs left-to-right, one row per student,
 * grouped into collapsible level sections. A student's sessions are bars on
 * their row, so the gaps in their afternoon read instantly.
 */
export default function TransposedGrid({
  axis,
  slotStats,
  sessions,
  instructorsById,
  shiftByInstructor,
  notesByStudent,
  nowMinutes,
  selectedId,
  dragActive,
  armedInstructor,
  onOpenStudent,
  onAssign,
  onUnassign,
  onStatusMenu,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())

  const groups = useMemo(() => {
    const hasUnset = sessions.some((s) => levelOf(s) === UNSET_LEVEL.key)
    const defs = hasUnset ? [...LEVELS, UNSET_LEVEL] : LEVELS
    return defs
      .map((def) => ({ def, rows: groupByStudent(sessions.filter((s) => levelOf(s) === def.key)) }))
      .filter((group) => group.rows.length > 0)
  }, [sessions])

  const width = axisWidth(axis)
  const nowLeft =
    nowMinutes !== null && nowMinutes >= axis.start && nowMinutes <= axis.end
      ? ((nowMinutes - axis.start) / SLOT_MINUTES) * SLOT_WIDTH
      : null

  function toggle(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (sessions.length === 0) {
    return (
      <p className="px-6 py-16 text-center text-xs text-slate-400">
        No sessions on this day. Sessions arrive from the materializer, the Radius import, or manual
        entry.
      </p>
    )
  }

  return (
    <div className="min-w-fit p-4">
      {/* Time axis header: labels and the per-half-hour student counts */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-2 bg-zinc-50 px-4 pt-4 pb-2">
        <div className="flex">
          <div style={{ width: NAME_COLUMN }} className="shrink-0" />
          <div style={{ width }} className="relative h-9 shrink-0">
            {axis.slots.map((minutes, i) => (
              <span
                key={minutes}
                className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
                style={{ left: i * SLOT_WIDTH }}
              >
                <span className="text-xs whitespace-nowrap text-zinc-500 tabular-nums">
                  {formatTime(minutesToTime(minutes))}
                </span>
                <SlotCount stat={slotStats[i]} />
              </span>
            ))}
          </div>
        </div>
      </div>

      {groups.map(({ def, rows }) => {
        const isCollapsed = collapsed.has(def.key)
        return (
          <div key={def.key} className="mb-3">
            <button
              type="button"
              onClick={() => toggle(def.key)}
              aria-expanded={!isCollapsed}
              className="mb-1 flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-left hover:bg-zinc-50"
              style={{ width: NAME_COLUMN + width }}
            >
              <span className="text-[10px] text-zinc-400">{isCollapsed ? '▸' : '▾'}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${def.accent}`} />
              <span className="text-xs font-semibold text-zinc-800">{def.label}</span>
              <span className="ml-auto text-xs text-zinc-400">
                {rows.length} student{rows.length === 1 ? '' : 's'}
              </span>
            </button>

            {!isCollapsed &&
              rows.map((row) => (
                <div key={row.studentId} className="flex" style={{ height: ROW_HEIGHT }}>
                  {/* The row label is the only place the student is named,
                      so the bars can stay slim. */}
                  <div
                    style={{ width: NAME_COLUMN }}
                    className="flex shrink-0 items-center gap-1 pr-2 text-xs text-zinc-700"
                  >
                    {SLOT_CERTAINTY[row.student?.slot_certainty] && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: SLOT_CERTAINTY[row.student.slot_certainty].color,
                        }}
                        title={SLOT_CERTAINTY[row.student.slot_certainty].label}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={row.student?.name}>
                      {row.student?.name ?? 'Unknown'}
                    </span>
                    {row.student?.grade && (
                      <span className="shrink-0 rounded bg-zinc-200 px-1 text-[9px] text-zinc-600">
                        {row.student.grade}
                      </span>
                    )}
                    {row.student?.needs_schoolwork && (
                      <span
                        className="shrink-0 rounded bg-[#FFEB3B] px-1 text-[8px] font-bold text-black"
                        title="Needs schoolwork"
                      >
                        Supp
                      </span>
                    )}
                  </div>

                  <div style={{ width }} className="relative shrink-0 rounded bg-white">
                    {axis.slots.map((minutes, i) => (
                      <div
                        key={minutes}
                        className={
                          'absolute inset-y-0 border-l ' +
                          (minutes % 60 === 0 ? 'border-zinc-200' : 'border-zinc-100')
                        }
                        style={{ left: i * SLOT_WIDTH }}
                      />
                    ))}

                    {nowLeft !== null && (
                      <div
                        className="absolute inset-y-0 z-10 border-l-2 border-emerald-500/70"
                        style={{ left: nowLeft }}
                      />
                    )}

                    {row.sessions.map((session) => {
                      const { left, width: barWidth } = sessionSpan(session, axis)
                      const active =
                        nowMinutes !== null &&
                        nowMinutes >= axis.start + (left / SLOT_WIDTH) * SLOT_MINUTES &&
                        nowMinutes < sessionEndMinutes(session)

                      return (
                        <SessionCard
                          key={session.id}
                          session={session}
                          instructor={instructorsById.get(session.instructor_id) ?? null}
                          shift={shiftByInstructor.get(session.instructor_id) ?? null}
                          notes={notesByStudent.get(session.student_id) ?? []}
                          layout="horizontal"
                          style={{
                            left,
                            width: barWidth - 2,
                            top: 0,
                            height: ROW_HEIGHT - ROW_GAP,
                          }}
                          selected={selectedId === session.id}
                          active={active}
                          dragActive={dragActive}
                          armedInstructor={armedInstructor}
                          onOpenStudent={onOpenStudent}
                          onAssign={onAssign}
                          onUnassign={onUnassign}
                          onStatusMenu={onStatusMenu}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
