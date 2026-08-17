/**
 * Date/time helpers for the scheduler.
 *
 * Two rules this file exists to enforce:
 *  1. "Today" is always today at the CENTER, America/New_York — never the
 *     browser's timezone and never `toISOString()` (v1 showed tomorrow after
 *     8pm ET because it did exactly that).
 *  2. An ISO date string ('YYYY-MM-DD') is a pure calendar date. We never let
 *     it become an instant, so DST can never shift it by a day.
 */

export const CENTER_TZ = 'America/New_York'

// en-CA formats as YYYY-MM-DD, which is exactly the shape Postgres `date` wants.
const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CENTER_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar date at the center for a given instant (default: now). */
export function toCenterISODate(instant = new Date()) {
  return isoFormatter.format(instant)
}

/** Today's date at the center, as 'YYYY-MM-DD'. */
export function todayISO() {
  return toCenterISODate()
}

/** Wall-clock time at the center right now, as 'HH:MM' (24h). */
export function centerNowTime(instant = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CENTER_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant)
}

/**
 * Parse 'YYYY-MM-DD' into a Date anchored at UTC noon. Noon keeps every
 * arithmetic result inside the same calendar day no matter the offset.
 */
function anchor(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

function fromAnchor(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`
}

/** Shift an ISO date by n days (n may be negative). */
export function addDays(iso, n) {
  const d = anchor(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return fromAnchor(d)
}

/** Day of week for an ISO date: 0 = Sunday … 6 = Saturday (matches recurring_slots). */
export function dayOfWeek(iso) {
  return anchor(iso).getUTCDay()
}

/** ISO date of the Sunday on or before the given date. */
export function startOfWeek(iso) {
  return addDays(iso, -dayOfWeek(iso))
}

/** e.g. 'Mon, Aug 10' */
/**
 * A real timestamp (not a date-only ISO) shown as the center-local day it
 * happened: 'Aug 3', with the year added once it isn't this year. Used on
 * notes, where the whole point of the date is making stale ones look stale.
 */
export function formatStampDate(timestamp, now = new Date()) {
  const d = new Date(timestamp)
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(d) ===
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(now)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? null : { year: 'numeric' }),
  }).format(d)
}

export function formatDateShort(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(anchor(iso))
}

/** e.g. 'Monday, August 10, 2026' */
export function formatDateLong(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(anchor(iso))
}

/**
 * Format a naive DB time ('HH:MM:SS' or 'HH:MM') for display: '3:30', '5:00'.
 * 12-hour, no leading zero, minutes always shown (v1 formatTime behavior —
 * capacity_colors: never 24-hour in the UI). DB times are center-local wall
 * clock — no conversion, just presentation.
 */
export function formatTime(time) {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${mStr}`
}

/** Format with meridiem: '3:30pm'. */
export function formatTimeMeridiem(time) {
  if (!time) return ''
  const h = Number(time.split(':')[0])
  return `${formatTime(time)}${h < 12 ? 'am' : 'pm'}`
}

/** Minutes since midnight for a naive time string. Useful for grid layout. */
export function timeToMinutes(time) {
  if (!time) return 0
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Inverse of timeToMinutes, back to 'HH:MM:SS'. */
export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}
