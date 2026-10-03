import { addDays, dayOfWeek, startOfWeek, timeToMinutes } from '../../lib/dates'
import { occupiesFloor, sessionCoversSlot } from '../day/load'
import { sessionEndMinutes } from '../day/shiftCoverage'

/**
 * The Week tab's demand grid: next week's half-hour counts per day, weekdays
 * and Saturday side by side on ONE row scale. Read-only — counts only, no
 * comparison against scheduled shifts (yet).
 */

/** Where Saturday's FIRST slot sits: beside this weekday row (4:00pm). */
export const SATURDAY_ANCHOR = 16 * 60

/** Fallbacks matching Montgomeryville, for a center row without the columns. */
const DEFAULT_HOURS = {
  weekday_open: '15:00',
  weekday_close: '19:30',
  saturday_open: '10:00',
  saturday_close: '13:00',
}

/** The center's operating hours as minutes, falling back per column. */
export function centerOperatingHours(center) {
  const minutes = (key) => timeToMinutes(center?.[key] ?? DEFAULT_HOURS[key])
  return {
    weekdayOpen: minutes('weekday_open'),
    weekdayClose: minutes('weekday_close'),
    saturdayOpen: minutes('saturday_open'),
    saturdayClose: minutes('saturday_close'),
  }
}

/**
 * The default week to plan: NEXT week's Monday. The owner plans on Thursday
 * or Friday for the following Mon–Sat, so "next week" is the useful default
 * every day of the current week.
 */
export function defaultPlanWeekStart(todayIso) {
  // startOfWeek is Sunday-based; +8 lands on next week's Monday.
  return addDays(startOfWeek(todayIso), 8)
}

/** Monday..Saturday of the plan week. */
export function planWeekDates(mondayIso) {
  return Array.from({ length: 6 }, (_, i) => addDays(mondayIso, i))
}

const snapDown = (m) => Math.floor(m / 30) * 30
const snapUp = (m) => Math.ceil(m / 30) * 30

/**
 * [open, close) widened so every session fits, snapped to the half hour —
 * a 2:45pm start pulls the axis down to 2:30pm rather than dropping the
 * session off the top.
 */
export function extendRange(openMin, closeMin, sessions) {
  let open = openMin
  let close = closeMin
  for (const s of sessions) {
    open = Math.min(open, snapDown(timeToMinutes(s.start_time)))
    close = Math.max(close, snapUp(sessionEndMinutes(s)))
  }
  return [open, close]
}

/** Half-hour band starts: open, open+30, …, close−30. */
export function bands(openMin, closeMin) {
  const out = []
  for (let m = openMin; m < closeMin; m += 30) out.push(m)
  return out
}

/**
 * One shared row scale: row i carries weekday band i, and Saturday's bands
 * start at the row whose weekday band is the anchor (Sat 10:00am beside
 * weekday 4:00pm). Rows above and below a side's range leave it null.
 */
export function alignRows(weekdayBands, saturdayBands, anchor = SATURDAY_ANCHOR) {
  if (weekdayBands.length === 0) {
    return saturdayBands.map((s) => ({ w: null, s }))
  }
  const anchorIndex = Math.max(0, (anchor - weekdayBands[0]) / 30)
  const total = Math.max(weekdayBands.length, anchorIndex + saturdayBands.length)
  const rows = []
  for (let i = 0; i < total; i++) {
    rows.push({
      w: weekdayBands[i] ?? null,
      s: i >= anchorIndex ? (saturdayBands[i - anchorIndex] ?? null) : null,
    })
  }
  return rows
}

const deliveryOf = (s) => (s.delivery_method === 'online' ? 'online' : 'in_center')

/** '2026-09-28' -> '9/28', for the stacked column headers. */
export function monthDay(iso) {
  const [, m, d] = String(iso ?? '').split('-')
  return `${Number(m)}/${Number(d)}`
}

/**
 * The heat anchors per hue: `light` is the visible FLOOR (a 1 is clearly
 * colored, never near-white), `deep` is the ceiling, `text` the ink used
 * until the fill gets dark enough to need white. Hues are per CENTER and
 * metric: Montgomeryville in-center red, Blue Bell in-center blue, online
 * green at both centers.
 */
export const HEAT_ANCHORS = {
  red: { light: [254, 202, 202], deep: [220, 38, 38], text: '#450a0a' },
  blue: { light: [191, 219, 254], deep: [37, 99, 235], text: '#172554' },
  green: { light: [187, 247, 208], deep: [22, 163, 74], text: '#052e16' },
}

/**
 * CONTINUOUS shading: each cell's color is interpolated directly from its
 * value against the shared maximum — t = (n−1)/(max−1) — so every distinct
 * count is a visibly distinct shade (the five fixed buckets made Blue
 * Bell's 1, 3 and 4 identical). Zero has no style (the gray ground); a
 * count that IS the maximum, however small, paints the deepest shade.
 */
export function heatStyle(n, max, hue) {
  if (n <= 0) return null
  const { light, deep, text } = HEAT_ANCHORS[hue]
  const t = max <= 1 ? 1 : Math.min(1, (n - 1) / (max - 1))
  const mix = light.map((c, i) => Math.round(c + (deep[i] - c) * t))
  return {
    backgroundColor: `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`,
    color: t >= 0.6 ? '#ffffff' : text,
  }
}

/** The single highest cell of the center's week — in-center AND online. */
export function centerWeekMax(grid) {
  let max = 0
  const days = [...grid.weekdays, ...(grid.saturday ? [grid.saturday] : [])]
  for (const day of days) {
    for (const n of day.inCenter) max = Math.max(max, n)
    for (const n of day.online) max = Math.max(max, n)
  }
  return max
}

/**
 * Per-row totals across the WEEKDAY columns only, in-center plus online.
 * Saturday rows are different clock times from the weekday rows they sit
 * beside, so Saturday never joins a row total.
 */
export function weekdayRowTotals(grid) {
  return grid.weekdayBands.map((_, i) =>
    grid.weekdays.reduce((n, d) => n + (d.inCenter[i] ?? 0) + (d.online[i] ?? 0), 0),
  )
}

/** The weekday grand total — SESSIONS, not cell sums; Saturday excluded. */
export function weekdayGrandTotal(grid) {
  return grid.weekdays.reduce((n, d) => n + d.totals.inCenter + d.totals.online, 0)
}

/** The WHOLE week's sessions, Saturday included — the bottom-right cell. */
export function weekGrandTotal(grid) {
  return (
    weekdayGrandTotal(grid) +
    (grid.saturday ? grid.saturday.totals.inCenter + grid.saturday.totals.online : 0)
  )
}

/** Count per band, day-view rule: a session counts in every band it overlaps. */
function countsFor(sessions, bandList) {
  return bandList.map((m) => sessions.reduce((n, s) => n + (sessionCoversSlot(s, m) ? 1 : 0), 0))
}

/**
 * The whole grid, pure. `sessions` is the week's rows (date, start_time,
 * duration, status, delivery_method). Days with no counting session are
 * hidden — Saturday included — and cancelled/no-show rows neither show a
 * day nor count on it (the day view's occupiesFloor rule).
 */
export function planWeekGrid({ sessions, weekStart, hours }) {
  const dates = planWeekDates(weekStart)
  const counting = (sessions ?? []).filter(occupiesFloor)
  const byDate = new Map(dates.map((d) => [d, counting.filter((s) => s.date === d)]))

  const weekdayDates = dates.filter((d) => dayOfWeek(d) >= 1 && dayOfWeek(d) <= 5)
  const saturdayDate = dates.find((d) => dayOfWeek(d) === 6) ?? null

  const visibleWeekdays = weekdayDates.filter((d) => (byDate.get(d) ?? []).length > 0)
  const saturdaySessions = saturdayDate ? (byDate.get(saturdayDate) ?? []) : []
  const saturdayVisible = saturdaySessions.length > 0

  const weekdaySessions = visibleWeekdays.flatMap((d) => byDate.get(d))
  const [wOpen, wClose] = extendRange(hours.weekdayOpen, hours.weekdayClose, weekdaySessions)
  const [sOpen, sClose] = extendRange(hours.saturdayOpen, hours.saturdayClose, saturdaySessions)

  const weekdayBands = visibleWeekdays.length ? bands(wOpen, wClose) : []
  const saturdayBands = saturdayVisible ? bands(sOpen, sClose) : []

  return {
    weekdayBands,
    saturdayBands,
    rows: alignRows(weekdayBands, saturdayBands),
    weekdays: visibleWeekdays.map((date) => {
      const mine = byDate.get(date)
      const inCenterSessions = mine.filter((s) => deliveryOf(s) === 'in_center')
      const onlineSessions = mine.filter((s) => deliveryOf(s) === 'online')
      return {
        date,
        inCenter: countsFor(inCenterSessions, weekdayBands),
        online: countsFor(onlineSessions, weekdayBands),
        // SESSION counts, not cell sums — a 90-minute session spans three
        // cells but is one session.
        totals: { inCenter: inCenterSessions.length, online: onlineSessions.length },
      }
    }),
    saturday: saturdayVisible
      ? {
          date: saturdayDate,
          inCenter: countsFor(
            saturdaySessions.filter((s) => deliveryOf(s) === 'in_center'),
            saturdayBands,
          ),
          online: countsFor(
            saturdaySessions.filter((s) => deliveryOf(s) === 'online'),
            saturdayBands,
          ),
          totals: {
            inCenter: saturdaySessions.filter((s) => deliveryOf(s) === 'in_center').length,
            online: saturdaySessions.filter((s) => deliveryOf(s) === 'online').length,
          },
        }
      : null,
  }
}
