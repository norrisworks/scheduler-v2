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

// ---- OKLCH color math, dependency-free. Interpolating in RGB made the
// same count read darker in one hue than another; OKLab's L is
// perceptually uniform, so pinning all three ramps to ONE lightness curve
// makes a given count equally dark in every hue.

const linearToSrgb = (c) =>
  Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** OKLCH -> sRGB bytes, reducing chroma (never lightness) if out of gamut. */
export function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  let c = C
  for (let i = 0; i < 12; i++) {
    const rgb = oklabToLinear(L, c * Math.cos(h), c * Math.sin(h))
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgb.map(linearToSrgb)
    c *= 0.9
  }
  return oklabToLinear(L, 0, 0).map(linearToSrgb)
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** Perceptual lightness of an sRGB color — the checks' measuring stick. */
export function rgbOklabLightness(r, g, b) {
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

/**
 * ONE lightness ramp for every hue, anchored to MV red's shades (red-200
 * at 1 — the floor the owner signed off on — down to red-600 at the
 * shared maximum). Chroma and hue angle vary per hue; lightness never
 * does, so the same count reads equally dark in red, blue and green.
 */
const HEAT_L = { light: 0.965, deep: 0.78 }

/**
 * Deliberately DESATURATED (owner: the table should read calm, not loud):
 * chroma runs 0.055 → 0.12 in every hue — the deepest shade is a muted
 * brick/dusty-blue/sage, never a pure bright primary — and the identical
 * cLight makes every hue's 1 equally pale.
 */
export const HEAT_HUES = {
  red: { hLight: 18.3, hDeep: 27.3, cLight: 0.03, cDeep: 0.1, ink: '#450a0a' },
  blue: { hLight: -105.9, hDeep: -97.1, cLight: 0.03, cDeep: 0.1, ink: '#172554' },
  green: { hLight: 156.0, hDeep: 149.2, cLight: 0.03, cDeep: 0.1, ink: '#052e16' },
}

/**
 * CONTINUOUS shading: each cell's color is interpolated directly from its
 * value against the shared maximum — t = (n−1)/(max−1) — so every distinct
 * count is a visibly distinct shade. Zero has no style (the gray ground);
 * a count that IS the maximum, however small, paints the deepest shade.
 */
export function heatStyle(n, max, hue) {
  if (n <= 0) return null
  const { hLight, hDeep, cLight, cDeep, ink } = HEAT_HUES[hue]
  const t = max <= 1 ? 1 : Math.min(1, (n - 1) / (max - 1))
  const L = HEAT_L.light + (HEAT_L.deep - HEAT_L.light) * t
  const C = cLight + (cDeep - cLight) * t
  const [r, g, b] = oklchToRgb(L, C, hLight + (hDeep - hLight) * t)
  return {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    // The ceiling is light enough (L 0.68) that the hue's dark ink reads
    // across the WHOLE ramp — the old white flip belonged to darker deeps.
    color: ink,
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
