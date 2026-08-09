/**
 * The three level columns the floor is organised by, plus a catch-all for
 * students whose level hasn't been set yet — those shouldn't silently vanish
 * from the day, they should be visibly wrong so someone fixes the record.
 */
export const LEVELS = [
  { key: 'elementary', label: 'Elementary', accent: 'bg-sky-500' },
  { key: 'middle', label: 'Middle', accent: 'bg-violet-500' },
  { key: 'high', label: 'High', accent: 'bg-amber-500' },
]

export const UNSET_LEVEL = { key: 'unset', label: 'Level not set', accent: 'bg-slate-400' }

export function levelOf(session) {
  const level = session.student?.level
  return LEVELS.some((l) => l.key === level) ? level : UNSET_LEVEL.key
}

/** The capability flag on `instructors` that gates teaching this level. */
export const CAPABILITY_FLAG = {
  elementary: 'can_teach_elementary',
  middle: 'can_teach_middle',
  high: 'can_teach_high',
}

export const STATUSES = {
  scheduled: { label: 'Scheduled', dot: 'bg-emerald-500', muted: false },
  completed: { label: 'Completed', dot: 'bg-slate-400', muted: false },
  no_show: { label: 'No show', dot: 'bg-amber-500', muted: true },
  cancelled: { label: 'Cancelled', dot: 'bg-red-500', muted: true },
}
