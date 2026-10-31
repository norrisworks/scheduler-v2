import { addDays, dayOfWeek, startOfWeek, timeToMinutes } from '../../lib/dates'

/**
 * Attendance trends for the Week tab, from `attendance_visits` — who actually
 * came in, in-center and online together. Pure, so the checks can run it.
 *
 * Weeks run Monday–Sunday and are keyed by their Monday. "In the room at a
 * half hour" uses the same midpoint rule as the planner's past days: a kid
 * counts in a half hour when they were there at its middle (5:05–6:05 shows
 * in 5:00 and 5:30, not 6:00).
 */

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon … Sun
export const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Monday of the week containing `iso`. */
export function mondayOf(iso) {
  const sunday = startOfWeek(iso)
  return dayOfWeek(iso) === 0 ? addDays(sunday, -6) : addDays(sunday, 1)
}

/** The last `count` week Mondays, oldest first, ending with today's week. */
export function trendWeeks(todayIso, count) {
  const current = mondayOf(todayIso)
  return Array.from({ length: count }, (_, i) => addDays(current, (i - count + 1) * 7))
}

/**
 * Attendance per week, split in-center / online. `total` is both together;
 * `partial` marks the week still in progress.
 */
export function weeklyTotals(visits, weeks, todayIso) {
  const current = mondayOf(todayIso)
  const counts = new Map(weeks.map((w) => [w, { inCenter: 0, online: 0 }]))
  for (const v of visits) {
    const c = counts.get(mondayOf(v.date))
    if (!c) continue
    if (v.delivery === 'online') c.online++
    else c.inCenter++
  }
  return weeks.map((w) => {
    const c = counts.get(w)
    return { week: w, total: c.inCenter + c.online, inCenter: c.inCenter, online: c.online, partial: w === current }
  })
}

/**
 * Attendance per weekday per week. Only weekdays that had anyone in the
 * window appear (Fridays only ran in August). A day of a week with nobody is
 * null when the center was closed that day across the board, else 0.
 */
export function attendanceByWeekday(visits, weeks, todayIso) {
  const byKey = new Map()
  const daysSeen = new Set()
  for (const v of visits) {
    const w = mondayOf(v.date)
    if (!weeks.includes(w)) continue
    const d = dayOfWeek(v.date)
    daysSeen.add(d)
    const key = `${w}|${d}`
    byKey.set(key, (byKey.get(key) ?? 0) + 1)
  }
  return WEEKDAY_ORDER.filter((d) => daysSeen.has(d)).map((d) => ({
    day: d,
    label: DAY_NAME[d],
    values: weeks.map((w) => {
      const date = addDays(w, (d + 6) % 7)
      if (date > todayIso) return null // hasn't happened yet
      return byKey.get(`${w}|${d}`) ?? null
    }),
  }))
}

/** Kids in the room at the middle of the half hour starting at `bandMin`. */
export function inRoomAt(visits, bandMin) {
  const mid = bandMin + 15
  let n = 0
  for (const v of visits) {
    const a = timeToMinutes(v.arrival)
    const d = v.departure ? timeToMinutes(v.departure) : a + 60
    if (a <= mid && mid < d) n++
  }
  return n
}

/**
 * Every half-hour slot, week by week: rows are (weekday, half hour) in day
 * and time order; columns are weeks; each cell is the kids in the room in
 * that slot on that week's date. A row appears only for a slot that ever had
 * someone in it. `busiest[i]` is the highest cell in week i, so the busiest
 * slot of each week can be outlined.
 */
export function slotTable(visits, weeks, todayIso) {
  const byDate = new Map()
  for (const v of visits) {
    if (!weeks.includes(mondayOf(v.date))) continue
    byDate.set(v.date, [...(byDate.get(v.date) ?? []), v])
  }
  // Half hours that ever had someone, per weekday.
  const bandsByDay = new Map()
  for (const [date, list] of byDate) {
    const d = dayOfWeek(date)
    const set = bandsByDay.get(d) ?? new Set()
    for (const v of list) {
      const a = timeToMinutes(v.arrival)
      const end = v.departure ? timeToMinutes(v.departure) : a + 60
      for (let m = Math.floor((a - 15) / 30) * 30; m < end; m += 30) {
        if (inRoomAt([v], m) > 0) set.add(m)
      }
    }
    bandsByDay.set(d, set)
  }

  const rows = []
  for (const d of WEEKDAY_ORDER) {
    const bands = [...(bandsByDay.get(d) ?? [])].sort((a, b) => a - b)
    for (const m of bands) {
      rows.push({
        day: d,
        dayLabel: DAY_NAME[d],
        minutes: m,
        cells: weeks.map((w) => {
          const date = addDays(w, (d + 6) % 7)
          if (date > todayIso) return null
          const list = byDate.get(date)
          return list ? inRoomAt(list, m) : null
        }),
      })
    }
  }
  const busiest = weeks.map((_, i) => Math.max(0, ...rows.map((r) => r.cells[i] ?? 0)))
  return { rows, busiest }
}
