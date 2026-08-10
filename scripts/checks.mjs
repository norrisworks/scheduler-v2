import { shiftCoversSession, coverageWarning, peakConcurrent, sessionEndMinutes } from '../src/features/day/shiftCoverage.js'
import { levelOf, UNSET_LEVEL } from '../src/features/day/levels.js'
import { readableTextOn, tint } from '../src/lib/colors.js'
import { centerHours, buildTimeAxis, sessionGeometry, packSubColumns, columnWidth, subColumnLeft, SLOT_HEIGHT, SLOT_WIDTH, sessionSpan, axisWidth, groupByStudent } from '../src/features/day/timeGrid.js'
import { getRole, getPinnedCenter, centerMatchesPin } from '../src/features/auth/roles.js'
import { emptyToNull, missingAttributes } from '../src/features/roster/studentFields.js'
import { toCenterISODate, addDays, dayOfWeek, startOfWeek, formatDateLong, formatTime, formatTimeMeridiem, timeToMinutes, minutesToTime } from '../src/lib/dates.js'
import { occupiesFloor, studentsAtSlot, instructorsOnShiftAtSlot, instructorLoadBySlot, instructorCurrentCount, instructorTotalCount, slotPressure, buildSlotStats, loadCellColor } from '../src/features/day/load.js'

const checks = []
const eq = (label, got, want) => checks.push([label, got, want, JSON.stringify(got) === JSON.stringify(want)])

const sess = (start, duration = 60, id = start + '/' + duration) => ({ id, start_time: start, duration })
const shift = (s, e) => ({ start_time: s, end_time: e })

// ---- shift coverage: the v1 bug, exactly (shift ends 19:00, session 18:30-19:30)
eq('shift ending 19:00 fails 6:30 session', shiftCoversSession(shift('15:00:00','19:00:00'), sess('18:30:00')), false)
eq('same shift covers 5:30 session',        shiftCoversSession(shift('15:00:00','19:00:00'), sess('17:30:00')), true)
eq('exact fit counts as covered',           shiftCoversSession(shift('15:30:00','16:30:00'), sess('15:30:00')), true)
eq('one minute short is not covered',       shiftCoversSession(shift('15:30:00','16:29:00'), sess('15:30:00')), false)
eq('late start is not covered',             shiftCoversSession(shift('15:31:00','17:00:00'), sess('15:30:00')), false)
eq('90-min session needs 90 min of shift',  shiftCoversSession(shift('15:00:00','16:00:00'), sess('15:00:00', 90)), false)
eq('no shift is not covered',               shiftCoversSession(null, sess('15:30:00')), false)
eq('session end minutes',                   sessionEndMinutes(sess('18:30:00', 90)), 20 * 60)

const kieran = { name: 'Kieran Duffy' }
eq('warns when no shift',   coverageWarning(kieran, null, sess('15:30:00')), 'Kieran Duffy has no shift on this day')
eq('warns on partial cover',coverageWarning(kieran, shift('15:00:00','19:00:00'), sess('18:30:00')), "Kieran Duffy's shift does not cover the full session")
eq('silent when covered',   coverageWarning(kieran, shift('15:00:00','19:00:00'), sess('16:00:00')), null)

// ---- peak concurrent load
eq('back-to-back peak is 1',     peakConcurrent([sess('15:00:00'), sess('16:00:00'), sess('17:00:00')]), 1)
eq('three at once peak is 3',    peakConcurrent([sess('15:00:00'), sess('15:00:00'), sess('15:00:00')]), 3)
eq('staggered overlap peak is 2',peakConcurrent([sess('15:00:00', 90), sess('16:00:00')]), 2)
eq('empty peak is 0',            peakConcurrent([]), 0)
eq('nested overlap peak is 3',   peakConcurrent([sess('15:00:00',180), sess('15:30:00',60), sess('16:00:00',60)]), 3)

// ---- level bucketing
eq('level passthrough',      levelOf({ student: { level: 'middle' } }), 'middle')
eq('null level bucketed',    levelOf({ student: { level: null } }), UNSET_LEVEL.key)
eq('garbage level bucketed', levelOf({ student: { level: 'college' } }), UNSET_LEVEL.key)
eq('missing student bucketed', levelOf({}), UNSET_LEVEL.key)

// ---- instructor colors (real values from the DB)
eq('dark bg gets white text',  readableTextOn('#000000'), '#ffffff')
eq('amber bg gets dark text',  readableTextOn('#F59E0B'), '#0f172a')
eq('brand red gets white text',readableTextOn('#EC3A33'), '#ffffff')
eq('bad hex falls back',       readableTextOn(undefined), '#0f172a')
eq('tint builds rgba',         tint('#EC3A33', 0.07), 'rgba(236, 58, 51, 0.07)')

// ---- v1 grid geometry (v1_reference visual_constants)
eq('weekday hours 14:30-19:30', centerHours('2026-08-10'), { start: 870, end: 1170 })
eq('sunday hours 09:30-13:00',  centerHours('2026-08-09'), { start: 570, end: 780 })
eq('saturday hours 09:30-13:00',centerHours('2026-08-15'), { start: 570, end: 780 })

const axis = buildTimeAxis('2026-08-10', [])
eq('empty weekday axis starts 14:30', axis.start, 870)
eq('empty weekday axis is 10 slots tall', axis.height, 10 * SLOT_HEIGHT)
eq('empty weekday axis has 11 labels', axis.slots.length, 11)

// A 60-min session is exactly two slots tall; top is measured from axis start.
// 14:30 axis start -> 15:30 is two 30-min slots down.
eq('15:30 session sits two slots down', sessionGeometry(sess('15:30:00'), axis).top, 2 * SLOT_HEIGHT)
eq('axis-start session sits at top', sessionGeometry(sess('14:30:00'), axis).top, 0)
eq('60-min session is two slots tall', sessionGeometry(sess('15:30:00'), axis).height, 2 * SLOT_HEIGHT)
eq('90-min session is three slots tall', sessionGeometry(sess('15:30:00', 90), axis).height, 3 * SLOT_HEIGHT)

// Axis must stretch for anything booked outside center hours, never clip it.
const late = buildTimeAxis('2026-08-10', [sess('19:00:00', 90)])
eq('axis stretches past closing', late.end, 20 * 60 + 30)
const early = buildTimeAxis('2026-08-10', [sess('13:15:00', 60)])
eq('axis stretches before opening', early.start, 13 * 60)

// ---- v1 greedy sub-column packing
const seq = packSubColumns([sess('15:00:00'), sess('16:00:00'), sess('17:00:00')])
eq('back-to-back share one sub-column', seq.count, 1)

const trio = packSubColumns([sess('15:00:00',60,'a'), sess('15:00:00',60,'b'), sess('15:00:00',60,'c')])
eq('three concurrent need three sub-columns', trio.count, 3)
eq('third concurrent lands in sub-column 2', trio.indexById.get('c'), 2)

// A long session blocks column 0; the two short ones fill 1, then reuse 1.
const mixed = packSubColumns([sess('15:00:00',180,'long'), sess('15:30:00',60,'x'), sess('16:30:00',60,'y')])
eq('long session holds sub-column 0', mixed.indexById.get('long'), 0)
eq('overlapping short opens sub-column 1', mixed.indexById.get('x'), 1)
eq('later short reuses sub-column 1', mixed.indexById.get('y'), 1)
eq('mixed needs two sub-columns', mixed.count, 2)

eq('empty column still has width 1', packSubColumns([]).count, 1)
eq('single column width is 95', columnWidth(1), 95)
eq('three columns width includes gaps', columnWidth(3), 3 * 95 + 2 * 4)
eq('sub-column 2 left offset', subColumnLeft(2), 2 * 99)

// ---- per-slot load: v1 getSessionsAtTime / getInstructorLoadByTime
const st = (start, duration, status, instructor_id, id = `${start}/${instructor_id}`) =>
  ({ id, start_time: start, duration, status, instructor_id })

// A session counts in every slot it overlaps: slot >= start AND slot < end.
const oneHour = [st('16:00:00', 60, 'scheduled', 'i1')]
eq('slot at session start counts',  studentsAtSlot(oneHour, 16 * 60), 1)
eq('slot inside session counts',    studentsAtSlot(oneHour, 16 * 60 + 30), 1)
eq('slot at session end excluded',  studentsAtSlot(oneHour, 17 * 60), 0)
eq('slot before session excluded',  studentsAtSlot(oneHour, 15 * 60 + 30), 0)

// Cancelled and no-show free the capacity they were holding.
const mixedStatus = [
  st('16:00:00', 60, 'scheduled', 'i1', 'a'),
  st('16:00:00', 60, 'cancelled', 'i1', 'b'),
  st('16:00:00', 60, 'no_show',   'i1', 'c'),
  st('16:00:00', 60, 'completed', 'i2', 'd'),
]
eq('cancelled and no_show excluded from slot count', studentsAtSlot(mixedStatus, 16 * 60), 2)
eq('completed still occupies the floor', occupiesFloor(st('16:00:00',60,'completed','i1')), true)
eq('cancelled does not occupy the floor', occupiesFloor(st('16:00:00',60,'cancelled','i1')), false)

// Instructor load per slot, across a 3-slot axis.
const axisSlots = [15 * 60 + 30, 16 * 60, 16 * 60 + 30]
const loaded = [
  st('15:30:00', 60, 'scheduled', 'i1', 'p'),
  st('15:30:00', 60, 'scheduled', 'i1', 'q'),
  st('16:00:00', 60, 'scheduled', 'i1', 'r'),
  st('15:30:00', 60, 'scheduled', 'i2', 's'),
  st('15:30:00', 60, 'cancelled', 'i1', 't'),
]
eq('instructor load by slot', instructorLoadBySlot(loaded, 'i1', axisSlots), [2, 3, 1])
eq('other instructor load by slot', instructorLoadBySlot(loaded, 'i2', axisSlots), [1, 1, 0])
eq('day total excludes cancelled', instructorTotalCount(loaded, 'i1'), 3)
eq('current count at 16:00', instructorCurrentCount(loaded, 'i1', 16 * 60), 3)
eq('current count is null off today', instructorCurrentCount(loaded, 'i1', null), null)

// On-shift capacity at a slot.
const shifts = [shift('15:00:00','19:00:00'), shift('15:30:00','17:00:00')]
eq('two on shift at 16:00', instructorsOnShiftAtSlot(shifts, 16 * 60), 2)
eq('one on shift at 17:00', instructorsOnShiftAtSlot(shifts, 17 * 60), 1)
eq('shift end is exclusive', instructorsOnShiftAtSlot([shift('15:00:00','17:00:00')], 17 * 60), 0)

// Pressure: 3 is the normal ratio, 4 the stretch cap.
eq('at ratio 3 is ok',            slotPressure(6, 2), 'ok')
eq('one over ratio 3 is over',    slotPressure(7, 2), 'over')
eq('at stretch cap is over',      slotPressure(8, 2), 'over')
eq('past stretch cap',            slotPressure(9, 2), 'over_stretch')
eq('students with nobody on shift', slotPressure(1, 0), 'uncovered')
eq('empty slot',                  slotPressure(0, 0), 'empty')

const stats = buildSlotStats([16 * 60], mixedStatus, [shift('15:00:00','19:00:00')])
eq('slot stats shape', stats[0], {
  minutes: 960, students: 2, onShift: 1, capacity: 3, stretchCapacity: 4, pressure: 'ok',
})

// Gauge intensity: 0 empty, 1-2 light, 3 solid, 4+ red at cap.
eq('load 0 cell is empty',   loadCellColor(0, '#1E88E5'), '#E2E8F0')
eq('load 1 cell is light',   loadCellColor(1, '#1E88E5'), 'rgba(30, 136, 229, 0.3)')
eq('load 2 cell is mid',     loadCellColor(2, '#1E88E5'), 'rgba(30, 136, 229, 0.55)')
eq('load 3 cell is solid',   loadCellColor(3, '#1E88E5'), 'rgba(30, 136, 229, 1)')
eq('load 4 cell is red',     loadCellColor(4, '#1E88E5'), '#DC2626')
eq('load 9 cell is red',     loadCellColor(9, '#1E88E5'), '#DC2626')

// ---- transposed orientation geometry and student grouping
const tAxis = buildTimeAxis('2026-08-10', [])
eq('axis width spans the day', axisWidth(tAxis), 10 * SLOT_WIDTH)
eq('15:30 bar starts two slots in', sessionSpan(sess('15:30:00'), tAxis).left, 2 * SLOT_WIDTH)
eq('60-min bar is two slots wide',  sessionSpan(sess('15:30:00'), tAxis).width, 2 * SLOT_WIDTH)
eq('30-min bar is one slot wide',   sessionSpan(sess('15:30:00', 30), tAxis).width, SLOT_WIDTH)
eq('axis-start bar sits at zero',   sessionSpan(sess('14:30:00'), tAxis).left, 0)

// One row per student, however many sessions they have that afternoon.
const withStudent = (name, id, start, duration = 60) => ({
  id: `${id}-${start}`, student_id: id, student: { name }, start_time: start, duration,
  status: 'scheduled',
})
const rows = groupByStudent([
  withStudent('Zoe Harper', 'z', '16:30:00'),
  withStudent('Ava Bennett', 'a', '15:30:00'),
  withStudent('Ava Bennett', 'a', '17:30:00'),
])
eq('two students produce two rows', rows.length, 2)
eq('a student\'s sessions share one row', rows[0].sessions.length, 2)
eq('rows sort by first session time', rows.map(r => r.student.name), ['Ava Bennett', 'Zoe Harper'])
eq('sessions within a row are time-ordered',
   rows[0].sessions.map(s => s.start_time), ['15:30:00', '17:30:00'])
eq('no sessions, no rows', groupByStudent([]).length, 0)

// ---- role pinning (app_metadata is service-role-only, so it is trustworthy)
const admin = { app_metadata: { role: 'admin' } }
const floorMv = { app_metadata: { role: 'floor', center_code: 'mv' } }
const floorById = { app_metadata: { role: 'floor', center_id: 'uuid-bb' } }
const legacy = { app_metadata: {} }

eq('explicit admin', getRole(admin), 'admin')
eq('floor role', getRole(floorMv), 'floor')
eq('absent role stays unrestricted', getRole(legacy), 'admin')
eq('no user at all', getRole(undefined), 'admin')
eq('unknown role is not floor', getRole({ app_metadata: { role: 'wat' } }), 'admin')

eq('admins are not pinned', getPinnedCenter(admin), null)
eq('floor pin by code is upper-cased', getPinnedCenter(floorMv), { id: null, code: 'MV' })
eq('floor pin by id', getPinnedCenter(floorById), { id: 'uuid-bb', code: null })
eq('floor with no center is not pinned', getPinnedCenter({ app_metadata: { role: 'floor' } }), null)

const mv = { id: 'uuid-mv', short_code: 'MV' }
const bb = { id: 'uuid-bb', short_code: 'BB' }
eq('no pin matches everything', centerMatchesPin(mv, null), true)
eq('code pin matches its center', centerMatchesPin(mv, { id: null, code: 'MV' }), true)
eq('code pin rejects the other',  centerMatchesPin(bb, { id: null, code: 'MV' }), false)
eq('id pin matches its center',   centerMatchesPin(bb, { id: 'uuid-bb', code: null }), true)
eq('id pin rejects the other',    centerMatchesPin(mv, { id: 'uuid-bb', code: null }), false)
// An id pin must not be satisfied by a code coincidence.
eq('id pin ignores short_code',   centerMatchesPin({ id: 'x', short_code: 'BB' }, { id: 'uuid-bb', code: null }), false)

// ---- roster fields
// level and performance carry check constraints that reject '' — a cleared
// <select> has to become NULL or the update fails.
eq('empty string becomes null', emptyToNull(''), null)
eq('undefined becomes null',    emptyToNull(undefined), null)
eq('value passes through',      emptyToNull('middle'), 'middle')
eq('zero is not emptied',       emptyToNull(0), 0)
eq('false is not emptied',      emptyToNull(false), false)

const complete = { level: 'middle', grade: '7', performance: 'behind', slot_certainty: 'fixed' }
eq('complete student has nothing missing', missingAttributes(complete), [])
eq('bare student is missing all four', missingAttributes({}),
   ['level', 'grade', 'performance', 'slot certainty'])
eq('one gap is reported', missingAttributes({ ...complete, performance: null }), ['performance'])

// ---- dates: always America/New_York, never toISOString
// 9pm ET on Aug 9 is already Aug 10 in UTC. v1 showed tomorrow after 8pm.
eq('9pm ET stays same day',  toCenterISODate(new Date('2026-08-10T01:30:00Z')), '2026-08-09')
eq('12:30am ET is next day', toCenterISODate(new Date('2026-08-10T04:30:00Z')), '2026-08-10')

// DST boundaries: spring forward Mar 8 2026, fall back Nov 1 2026.
eq('addDays over spring fwd', addDays('2026-03-07', 2), '2026-03-09')
eq('addDays over fall back',  addDays('2026-11-01', 1), '2026-11-02')
eq('addDays backwards',       addDays('2026-01-01', -1), '2025-12-31')
eq('addDays 14 (materializer window)', addDays('2026-08-09', 14), '2026-08-23')

eq('dayOfWeek Sunday',       dayOfWeek('2026-08-09'), 0)
eq('dayOfWeek Saturday',     dayOfWeek('2026-08-15'), 6)
eq('startOfWeek from Wed',   startOfWeek('2026-08-12'), '2026-08-09')
eq('startOfWeek idempotent', startOfWeek('2026-08-09'), '2026-08-09')

eq('formatDateLong',         formatDateLong('2026-08-09'), 'Sunday, August 9, 2026')
eq('formatTime on the hour', formatTime('15:00:00'), '3')
eq('formatTime half past',   formatTime('15:30:00'), '3:30')
eq('formatTime noon',        formatTime('12:00:00'), '12')
eq('formatTimeMeridiem am',  formatTimeMeridiem('09:30:00'), '9:30am')
eq('formatTimeMeridiem pm',  formatTimeMeridiem('18:30:00'), '6:30pm')
eq('timeToMinutes',          timeToMinutes('18:30:00'), 1110)
eq('minutesToTime roundtrip',minutesToTime(timeToMinutes('18:30:00')), '18:30:00')

let failed = 0
for (const [label, got, want, ok] of checks) {
  if (!ok) { failed++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
console.log(failed === 0 ? `all ${checks.length} checks passed` : `${failed}/${checks.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)

