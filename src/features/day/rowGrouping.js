// Pure row/group building for the transposed day view. Lives outside the
// component file so the check suite can import it without dragging the React
// tree (SessionCard -> AuthProvider -> supabase client) into a node bundle.
import { timeToMinutes } from '../../lib/dates'
import { LEVELS, UNSET_LEVEL, levelOf } from './levels'

/**
 * One row per student within a group. Rows sort by their first session so the
 * day reads as a cascade; groups are levels, or one band per instructor.
 */
export function buildGroups(sessions, grouping, instructorsById) {
  const buckets = new Map()

  const push = (key, meta, session) => {
    const bucket = buckets.get(key) ?? { ...meta, key, rows: new Map() }
    // Grouping by instructor means one student can appear in two bands, so
    // rows are keyed by group AND student rather than student alone.
    const rowKey = `${key}|${session.student_id}`
    const row = bucket.rows.get(rowKey) ?? {
      key: rowKey,
      student: session.student,
      studentId: session.student_id,
      sessions: [],
    }
    row.sessions.push(session)
    bucket.rows.set(rowKey, row)
    buckets.set(key, bucket)
  }

  if (grouping === 'instructor') {
    for (const session of sessions) {
      const instructor = instructorsById.get(session.instructor_id)
      push(
        instructor ? instructor.id : 'unassigned',
        instructor
          ? { label: instructor.name, color: instructor.color, order: 0 }
          : { label: 'Unassigned', accent: 'bg-zinc-400', order: 1 },
        session,
      )
    }
  } else {
    const defs = [...LEVELS, UNSET_LEVEL]
    for (const session of sessions) {
      const key = levelOf(session)
      const def = defs.find((d) => d.key === key) ?? UNSET_LEVEL
      push(key, { label: def.label, accent: def.accent, order: defs.indexOf(def) }, session)
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const rows = [...bucket.rows.values()].map((row) => {
        const ordered = [...row.sessions].sort((a, b) =>
          a.start_time.localeCompare(b.start_time),
        )
        return {
          ...row,
          sessions: ordered,
          firstStart: timeToMinutes(ordered[0].start_time),
          minutes: ordered.reduce((n, s) => n + (s.duration ?? 60), 0),
        }
      })
      rows.sort(
        (a, b) =>
          a.firstStart - b.firstStart ||
          (a.student?.name ?? '').localeCompare(b.student?.name ?? ''),
      )
      return {
        ...bucket,
        rows,
        totalSessions: rows.reduce((n, r) => n + r.sessions.length, 0),
        totalMinutes: rows.reduce((n, r) => n + r.minutes, 0),
      }
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label))
}
