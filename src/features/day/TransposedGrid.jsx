import { useMemo, useState } from 'react'
import { formatTime, minutesToTime, timeToMinutes } from '../../lib/dates'
import { readableTextOn } from '../../lib/colors'
import { LEVELS, UNSET_LEVEL, levelOf } from './levels'
import { sessionEndMinutes } from './shiftCoverage'
import {
  ROW_GAP,
  ROW_HEIGHT,
  SLOT_MINUTES,
  SLOT_WIDTH,
  axisWidth,
  sessionSpan,
} from './timeGrid'
import { buildGroups } from './rowGrouping'
import SessionCard from './SessionCard'
import SlotCount from './SlotCount'
import { SLOT_CERTAINTY } from './studentOptions'

const NAME_COLUMN = 184
const SUMMARY_COLUMN = 74

/** A bar needs this much room before an instructor name is worth printing. */
const NAME_ON_BAR_MIN_WIDTH = 108

/**
 * Rows view: time runs left-to-right, one row per student, sessions as bars.
 * Rows are sorted by first session so the afternoon reads as a cascade.
 *
 * Two groupings. By level is the floor's usual shape. By instructor turns the
 * same data into one band per instructor — their whole afternoon on one line,
 * which is the ratio-management view the Grid cannot produce.
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
  grouping = 'level',
  onOpenStudent,
  onAssign,
  onUnassign,
  onStatusMenu,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())

  const groups = useMemo(
    () => buildGroups(sessions, grouping, instructorsById),
    [sessions, grouping, instructorsById],
  )

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
      <p className="px-6 py-16 text-center text-xs text-zinc-400">
        No sessions on this day. Sessions arrive from the materializer, the Radius import, or manual
        entry.
      </p>
    )
  }

  const totalWidth = NAME_COLUMN + width + SUMMARY_COLUMN

  return (
    <div className="min-w-fit p-4">
      {/* Time axis: labels on the ticks, counts centered in the bands */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-2 bg-zinc-50 px-4 pt-4 pb-2">
        <div className="flex">
          <div style={{ width: NAME_COLUMN }} className="shrink-0" />
          <div style={{ width }} className="relative h-10 shrink-0">
            {axis.slots.map((minutes, i) => (
              <span
                key={minutes}
                className="absolute top-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-zinc-500 tabular-nums"
                style={{ left: i * SLOT_WIDTH }}
              >
                {formatTime(minutesToTime(minutes))}
              </span>
            ))}
            {axis.slots.slice(0, -1).map((minutes, i) => (
              <span
                key={`count-${minutes}`}
                className="absolute bottom-0 flex justify-center"
                style={{ left: i * SLOT_WIDTH, width: SLOT_WIDTH }}
              >
                <SlotCount stat={slotStats[i]} />
              </span>
            ))}
          </div>
          <div
            style={{ width: SUMMARY_COLUMN }}
            className="shrink-0 self-end pb-0.5 text-center text-[10px] font-semibold text-zinc-500"
          >
            Total
          </div>
        </div>
      </div>

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="mb-3">
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={!isCollapsed}
              className="mb-1 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-left hover:bg-zinc-50"
              style={{ width: totalWidth }}
            >
              <span className="text-[10px] text-zinc-400">{isCollapsed ? '▸' : '▾'}</span>
              {group.color ? (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
              ) : (
                <span className={`h-2 w-2 shrink-0 rounded-full ${group.accent}`} />
              )}
              <span className="text-xs font-semibold text-zinc-800">{group.label}</span>
              <span className="ml-auto text-xs text-zinc-400">
                {group.rows.length} student{group.rows.length === 1 ? '' : 's'} ·{' '}
                {group.totalSessions} session{group.totalSessions === 1 ? '' : 's'} ·{' '}
                {formatMinutes(group.totalMinutes)}
              </span>
            </button>

            {!isCollapsed &&
              group.rows.map((row) => (
                <div key={row.key} className="flex" style={{ height: ROW_HEIGHT }}>
                  {/* The row label is the only place the student is named. */}
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
                      <span className="shrink-0 rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-600">
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
                        nowMinutes >= timeToMinutes(session.start_time) &&
                        nowMinutes < sessionEndMinutes(session)

                      return (
                        <SessionCard
                          key={session.id}
                          session={session}
                          instructor={instructorsById.get(session.instructor_id) ?? null}
                          shift={shiftByInstructor.get(session.instructor_id) ?? null}
                          notes={notesByStudent.get(session.student_id) ?? []}
                          layout="horizontal"
                          showInstructorName={barWidth >= NAME_ON_BAR_MIN_WIDTH}
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

                  {/* Summary: what this row actually costs in floor time. */}
                  <div
                    style={{ width: SUMMARY_COLUMN }}
                    className="flex shrink-0 flex-col items-center justify-center leading-tight"
                  >
                    <span className="text-xs font-semibold text-zinc-700 tabular-nums">
                      {formatMinutes(row.minutes)}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {row.sessions.length} session{row.sessions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}

function formatMinutes(total) {
  if (!total) return '—'
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

