import { shiftCoversSession, coverageWarning, peakConcurrent, sessionEndMinutes } from '../src/features/day/shiftCoverage.js'
import { levelOf, UNSET_LEVEL } from '../src/features/day/levels.js'
import { readableTextOn, tint } from '../src/lib/colors.js'
import { centerHours, buildTimeAxis, sessionGeometry, packSubColumns, columnWidth, subColumnLeft, SLOT_HEIGHT, SLOT_WIDTH, sessionSpan, axisWidth, groupByStudent } from '../src/features/day/timeGrid.js'
import { getRole, getPinnedCenter, centerMatchesPin, resolveCenterAccess } from '../src/features/auth/roles.js'
import { emptyToNull, missingAttributes, GENDER_OPTIONS, normalizeEnrollmentStatus, activeFromEnrollment } from '../src/features/roster/studentFields.js'
import { capabilityString, instructorWarnings, nextColor, INSTRUCTOR_PALETTE, TIER_OPTIONS, TIER_ORDER, ASSIGNABILITY_OPTIONS, GENDER_OPTIONS as INSTRUCTOR_GENDER_OPTIONS } from '../src/features/instructors/instructorFields.js'
import { weekDays, validateShift, shiftHours, totalHours, planCopyWeek, indexShifts, suggestTimes } from '../src/features/shifts/weekShifts.js'
import { ineligibleReason, buildCandidates, isFallbackOnly, unrankedStudents, explainUnplaced } from '../src/features/assign/rankings.js'
import { placeAtRank } from '../src/features/assign/rankOrder.js'
import { rescheduleRows, validateReschedule } from '../src/features/day/reschedule.js'
import { sessionTimeSlots, autoAssignBalanced, autoAssignBestMatch, summaryMessage } from '../src/features/assign/algorithms.js'
import { buildGroups } from '../src/features/day/TransposedGrid.jsx'
import { proposeRanking, ineligibleForStudentReason, proposalReasons, sameGender, eligibleForStudent, moveEntry } from '../src/features/assign/proposeRanking.js'
import { describeMaterialize, materializeChanged } from '../src/features/materializer/materializeResult.js'
import { generateDisplayName, violatesNamingConvention, staleGradeInName, displayNameShape, nearlySameFirstName, isPlaceholderName } from '../src/features/imports/namingConvention.js'
import { isDataRow, readWorkstreamRow, matchInstructor, planWorkstreamImport } from '../src/features/imports/workstreamImport.js'
import { displayKeyFromGuardian, suggestStudents, parseRadiusDate, parseRadiusTime, mapStatus, accountKey, displayKeyFromFullName, isSuspiciousActor, resolveRebookings, matchStudent } from '../src/features/imports/radiusImport.js'
import { planStudentImport, planStudentImportByCenter } from '../src/features/imports/studentImport.js'
import { buildChecks } from '../src/features/health/checks.js'
import { toCenterISODate, addDays, dayOfWeek, startOfWeek, formatDateLong, formatTime, formatTimeMeridiem, timeToMinutes, minutesToTime } from '../src/lib/dates.js'
import { occupiesFloor, studentsAtSlot, instructorsOnShiftAtSlot, instructorLoadBySlot, instructorCurrentCount, instructorTotalCount, slotPressure, buildSlotStats, gaugeCellClass, slotChipClass } from '../src/features/day/load.js'
import { genderLabel, normalizeGender as normalizeGenderValue } from '../src/lib/gender.js'

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

// Gauge bands per the owner override: 3:1 is the working TARGET, so 3 is the
// good state (full green), 4 is the stretch cap, 5+ is over.
eq('gauge 0 is gray',        gaugeCellClass(0), 'bg-zinc-200 text-zinc-400')
eq('gauge 1 has room',       gaugeCellClass(1), 'bg-green-50 text-green-600')
eq('gauge 2 has room',       gaugeCellClass(2), 'bg-green-50 text-green-600')
eq('gauge 3 is AT TARGET',   gaugeCellClass(3), 'bg-green-200 text-green-800')
eq('gauge 4 is stretch cap', gaugeCellClass(4), 'bg-yellow-100 text-yellow-700')
eq('gauge 5 is over cap',    gaugeCellClass(5), 'bg-red-100 text-red-700')
eq('gauge 9 is over cap',    gaugeCellClass(9), 'bg-red-100 text-red-700')
// 3 must never read as a warning colour again.
eq('gauge 3 is not yellow',  gaugeCellClass(3).includes('yellow'), false)

// v1's fixed axis-chip bands, plus the one addition: students with zero
// instructors on shift is solid red, a case v1 could not detect.
eq('chip 0',   slotChipClass(0, 5), 'text-zinc-300')
eq('chip 1',   slotChipClass(1, 5), 'bg-green-100 text-green-700')
eq('chip 5',   slotChipClass(5, 5), 'bg-green-100 text-green-700')
eq('chip 6',   slotChipClass(6, 5), 'bg-yellow-100 text-yellow-700')
eq('chip 8',   slotChipClass(8, 5), 'bg-yellow-100 text-yellow-700')
eq('chip 9',   slotChipClass(9, 5), 'bg-orange-100 text-orange-700')
eq('chip 10',  slotChipClass(10, 5), 'bg-orange-100 text-orange-700')
eq('chip 11',  slotChipClass(11, 5), 'bg-red-100 text-red-700')
eq('chip 23',  slotChipClass(23, 6), 'bg-red-100 text-red-700')
// Thresholds are absolute now — staffing level must not shift the band.
eq('chip band ignores headcount', slotChipClass(5, 1), 'bg-green-100 text-green-700')
eq('students with nobody on shift is solid red', slotChipClass(1, 0), 'bg-red-500 text-white')
eq('empty slot with nobody on shift is not an error', slotChipClass(0, 0), 'text-zinc-300')

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
const instrMv = { app_metadata: { role: 'instructor', center_code: 'mv' } }
const instrById = { app_metadata: { role: 'instructor', center_id: 'uuid-bb' } }
const legacy = { app_metadata: {} }

// Least privilege: ONLY an explicit admin claim is admin. Anything else — a
// missing claim, an unknown value, a retired one — is a restricted login. An
// account created without metadata must never be a silent admin.
eq('explicit admin', getRole(admin), 'admin')
eq('instructor role', getRole(instrMv), 'instructor')
eq('absent role is least-privileged', getRole(legacy), 'instructor')
eq('no user at all is least-privileged', getRole(undefined), 'instructor')
eq('unknown role is least-privileged', getRole({ app_metadata: { role: 'wat' } }), 'instructor')
eq('retired "floor" value is least-privileged',
   getRole({ app_metadata: { role: 'floor' } }), 'instructor')

eq('admins are not pinned', getPinnedCenter(admin), null)
eq('pin by code is upper-cased', getPinnedCenter(instrMv), { id: null, code: 'MV' })
eq('pin by id', getPinnedCenter(instrById), { id: 'uuid-bb', code: null })
eq('instructor with no center is not pinned',
   getPinnedCenter({ app_metadata: { role: 'instructor' } }), null)

const mv = { id: 'uuid-mv', short_code: 'MV' }
const bb = { id: 'uuid-bb', short_code: 'BB' }
eq('no pin matches everything', centerMatchesPin(mv, null), true)
eq('code pin matches its center', centerMatchesPin(mv, { id: null, code: 'MV' }), true)
eq('code pin rejects the other',  centerMatchesPin(bb, { id: null, code: 'MV' }), false)
eq('id pin matches its center',   centerMatchesPin(bb, { id: 'uuid-bb', code: null }), true)
eq('id pin rejects the other',    centerMatchesPin(mv, { id: 'uuid-bb', code: null }), false)
// An id pin must not be satisfied by a code coincidence.
eq('id pin ignores short_code',   centerMatchesPin({ id: 'x', short_code: 'BB' }, { id: 'uuid-bb', code: null }), false)

// The access decision, run against the app_metadata actually stored on the
// three live accounts and the two real centers. This is what decides whether
// the switcher renders.
const REAL_CENTERS = [
  { id: 'd0d702a3-3e8a-4913-a54d-167d4cdb0f8c', name: 'Blue Bell', short_code: 'BB' },
  { id: 'e620f538-01b1-4963-8342-41d43ad2c3fd', name: 'Montgomeryville', short_code: 'MV' },
]
const LIVE = {
  // will@ carries an explicit admin role now — required since an absent
  // claim resolves to instructor.
  owner: { app_metadata: { role: 'admin', provider: 'email', providers: ['email'] } },
  mv: { app_metadata: { role: 'instructor', provider: 'email', providers: ['email'],
        center_id: 'e620f538-01b1-4963-8342-41d43ad2c3fd', center_code: 'MV' } },
  bb: { app_metadata: { role: 'instructor', provider: 'email', providers: ['email'],
        center_id: 'd0d702a3-3e8a-4913-a54d-167d4cdb0f8c', center_code: 'BB' } },
}

const ownerAccess = resolveCenterAccess(LIVE.owner, REAL_CENTERS)
eq('owner sees both centers', ownerAccess.centers.map(c => c.short_code), ['BB', 'MV'])
eq('owner gets the switcher', ownerAccess.canSwitch, true)
eq('owner is not pinned', ownerAccess.pinned, false)

const mvAccess = resolveCenterAccess(LIVE.mv, REAL_CENTERS)
eq('instructor-mv sees only MV', mvAccess.centers.map(c => c.short_code), ['MV'])
eq('instructor-mv gets NO switcher', mvAccess.canSwitch, false)
eq('instructor-mv is pinned', mvAccess.pinned, true)

const bbAccess = resolveCenterAccess(LIVE.bb, REAL_CENTERS)
eq('instructor-bb sees only BB', bbAccess.centers.map(c => c.short_code), ['BB'])
eq('instructor-bb gets NO switcher', bbAccess.canSwitch, false)

// A pin naming a center that does not exist must yield nothing, never a
// fallback to somebody else's center.
const orphan = resolveCenterAccess(
  { app_metadata: { role: 'instructor', center_code: 'ZZ' } }, REAL_CENTERS)
eq('orphaned pin sees no centers', orphan.centers.length, 0)
eq('orphaned pin still cannot switch', orphan.canSwitch, false)

// ---- roster fields
// level and performance carry check constraints that reject '' — a cleared
// <select> has to become NULL or the update fails.
eq('empty string becomes null', emptyToNull(''), null)
eq('undefined becomes null',    emptyToNull(undefined), null)
eq('value passes through',      emptyToNull('middle'), 'middle')
eq('zero is not emptied',       emptyToNull(0), 0)
eq('false is not emptied',      emptyToNull(false), false)

const complete = {
  level: 'middle', grade: '7', academic_status: 'behind', slot_certainty: 'fixed', gender: 'f',
}
eq('complete student has nothing missing', missingAttributes(complete), [])
eq('bare student is missing all five', missingAttributes({}),
   ['level', 'grade', 'academic status', 'slot certainty', 'gender'])
eq('one gap is reported', missingAttributes({ ...complete, academic_status: null }),
   ['academic status'])
// gender is a ranking input now, so its absence is a real gap.
eq('missing gender is reported', missingAttributes({ ...complete, gender: null }), ['gender'])

// ---- materializer result reporting
eq('no change reads as null', describeMaterialize({ created: 0, updated: 0, removed: 0 }), null)
eq('null result reads as null', describeMaterialize(null), null)
eq('created only', describeMaterialize({ created: 12, updated: 0, removed: 0 }), '12 created')
eq('all three', describeMaterialize({ created: 2, updated: 1, removed: 3 }),
   '2 created, 1 updated, 3 removed')
eq('removal alone still reports', describeMaterialize({ created: 0, updated: 0, removed: 1 }),
   '1 removed')
eq('nothing changed', materializeChanged({ created: 0, updated: 0, removed: 0 }), false)
eq('something changed', materializeChanged({ created: 0, updated: 0, removed: 1 }), true)

// ---- instructor configuration
const teacher = (over = {}) => ({
  name: 'Test', color: '#1E88E5', assignability: 'normal', tier: 'solid',
  can_teach_elementary: true, can_teach_middle: true, can_teach_high: true, ...over,
})
eq('all three levels', capabilityString(teacher()), 'EMH')
eq('elementary only', capabilityString(teacher({ can_teach_middle: false, can_teach_high: false })), 'E')
eq('middle and high', capabilityString(teacher({ can_teach_elementary: false })), 'MH')
eq('no levels', capabilityString(teacher({
  can_teach_elementary: false, can_teach_middle: false, can_teach_high: false })), '')

// Config that would quietly make someone unassignable in step 6.
eq('healthy instructor has no warnings', instructorWarnings(teacher()), [])
eq('no levels warns', instructorWarnings(teacher({
  can_teach_elementary: false, can_teach_middle: false, can_teach_high: false })),
  ['cannot teach any level, so will never be auto-assigned'])
// assignability is a clean axis now — fallback_only is a valid setting, not
// a contradiction to warn about.
eq('fallback_only is not a warning',
  instructorWarnings(teacher({ assignability: 'fallback_only' })), [])

// Both tables now carry a CHECK constraint accepting only 'male'/'female', so
// these are the only values the app may ever send. 'm'/'f' would be rejected
// by Postgres outright.
eq('student gender options match the check constraint',
   GENDER_OPTIONS.map(o => o.value), ['', 'female', 'male'])
eq('instructor gender options match it too',
   INSTRUCTOR_GENDER_OPTIONS.map(o => o.value), ['', 'female', 'male'])
eq('both forms share one definition', GENDER_OPTIONS, INSTRUCTOR_GENDER_OPTIONS)
// Displayed short, stored long.
eq('female shows as F', genderLabel('female'), 'F')
eq('male shows as M', genderLabel('male'), 'M')
eq('unset shows as a dash', genderLabel(null), '–')
// A re-import of an older export must not fail on the legacy spelling.
eq('legacy f normalizes', normalizeGenderValue('F'), 'female')
eq('legacy m normalizes', normalizeGenderValue('m'), 'male')
eq('a value we do not model is left unset', normalizeGenderValue('nonbinary'), null)
eq('blank is left unset', normalizeGenderValue(''), null)
eq('tier options', TIER_OPTIONS.map(o => o.value), ['strong', 'solid', 'developing'])
eq('assignability options', ASSIGNABILITY_OPTIONS.map(o => o.value), ['normal', 'fallback_only'])
eq('tier sorts strong first', TIER_ORDER.strong < TIER_ORDER.solid, true)
eq('tier sorts developing last', TIER_ORDER.developing > TIER_ORDER.solid, true)

// New instructors take the first unused palette colour so they stay distinct.
eq('first colour when none taken', nextColor([]), '#E53935')
eq('skips taken colours', nextColor([{ color: '#E53935' }, { color: '#1E88E5' }]), '#43A047')
eq('matching is case-insensitive', nextColor([{ color: '#e53935' }]), '#1E88E5')
eq('falls back when palette exhausted',
  nextColor(INSTRUCTOR_PALETTE.map((c) => ({ color: c }))), '#E53935')

// ---- shifts week editor
eq('week is seven days', weekDays('2026-08-16').length, 7)
eq('week runs Sunday to Saturday', [weekDays('2026-08-16')[0], weekDays('2026-08-16')[6]],
   ['2026-08-16', '2026-08-22'])
// The real test week the owner will enter.
eq('week of 8/17 starts Sunday 8/16', startOfWeek('2026-08-17'), '2026-08-16')

eq('end after start is valid', validateShift('15:00', '19:00'), null)
eq('end equal to start is not', validateShift('15:00', '15:00'), 'The end time must be after the start.')
eq('end before start is not', validateShift('19:00', '15:00'), 'The end time must be after the start.')
eq('missing end is not', validateShift('15:00', ''), 'Both a start and an end time are needed.')

eq('four hour shift', shiftHours({ start_time: '15:00:00', end_time: '19:00:00' }), 4)
eq('half hour counts', shiftHours({ start_time: '15:00:00', end_time: '15:30:00' }), 0.5)
eq('missing times are zero', shiftHours({}), 0)
eq('week hours sum', totalHours([
  { start_time: '15:00:00', end_time: '19:00:00' },
  { start_time: '14:00:00', end_time: '19:00:00' },
]), 9)

// Copy-last-week shifts dates forward by 7 and must never overwrite.
const src = [
  { center_id: 'c', instructor_id: 'i1', date: '2026-08-10', start_time: '15:00:00', end_time: '19:00:00', role: 'Instructor', source: 'workstream' },
  { center_id: 'c', instructor_id: 'i2', date: '2026-08-11', start_time: '14:00:00', end_time: '19:00:00', role: null, source: 'workstream' },
]
const fresh = planCopyWeek(src, [])
eq('copies both shifts', fresh.rows.length, 2)
eq('nothing skipped on an empty week', fresh.skipped, 0)
eq('dates move forward a week', fresh.rows.map(r => r.date), ['2026-08-17', '2026-08-18'])
eq('times are preserved', fresh.rows[0].start_time, '15:00:00')
eq('copies are hand-entered, not imported', fresh.rows[0].source, 'manual')

// A shift already entered on the target week wins.
const partial = planCopyWeek(src, [
  { instructor_id: 'i1', date: '2026-08-17', start_time: '15:00:00' },
])
eq('existing shift is not overwritten', partial.rows.length, 1)
eq('the collision is reported', partial.skipped, 1)
eq('only the free slot is copied', partial.rows[0].instructor_id, 'i2')
// A different start time on the same day is a split shift, not a collision.
const split = planCopyWeek(src, [
  { instructor_id: 'i1', date: '2026-08-17', start_time: '09:00:00' },
])
eq('a different start time is not a collision', split.rows.length, 2)

// Cells group by instructor and date, time-ordered within a day.
const idx = indexShifts([
  { instructor_id: 'i1', date: '2026-08-17', start_time: '18:00:00' },
  { instructor_id: 'i1', date: '2026-08-17', start_time: '09:00:00' },
  { instructor_id: 'i2', date: '2026-08-17', start_time: '15:00:00' },
])
eq('split shifts share a cell', idx.get('i1|2026-08-17').length, 2)
eq('cell is time-ordered', idx.get('i1|2026-08-17').map(s => s.start_time), ['09:00:00', '18:00:00'])
eq('other instructor is separate', idx.get('i2|2026-08-17').length, 1)

eq('new shift defaults', suggestTimes([]), { start: '15:00', end: '19:00' })
eq('new shift reuses the week', suggestTimes([{ start_time: '14:30:00', end_time: '18:30:00' }]),
   { start: '14:30', end: '18:30' })

// ---- auto-assign: rankings are the SOLE input
const inst = (over = {}) => ({
  id: 'i1', name: 'I', active: true, assignability: 'normal', tier: 'solid',
  can_teach_elementary: true, can_teach_middle: true, can_teach_high: true, ...over,
})
const stu = (over = {}) => ({ level: 'middle', academic_status: 'at_level', ...over })
const aSess = (over = {}) => ({
  id: 's1', student_id: 'st1', start_time: '16:00:00', duration: 60,
  status: 'scheduled', student: stu(), ...over,
})
const cover = shift('15:00:00', '19:00:00')
const ranks = (pairs) => new Map(pairs)

// Hard filters sit above the ranking: physical facts, not preferences.
eq('eligible when covered', ineligibleReason(aSess(), inst(), cover), null)
eq('inactive excludes', ineligibleReason(aSess(), inst({ active: false }), cover), 'inactive')
eq('capability gate', ineligibleReason(aSess(), inst({ can_teach_middle: false }), cover),
   'cannot teach level')
eq('no level set is not gated',
   ineligibleReason(aSess({ student: stu({ level: null }) }), inst({ can_teach_middle: false }), cover), null)
eq('no shift excludes', ineligibleReason(aSess(), inst(), null), 'not on shift')
// The v1 bug: shift ends 19:00, session 18:30-19:30.
eq('partial coverage excludes',
   ineligibleReason(aSess({ start_time: '18:30:00' }), inst(), cover),
   'shift does not cover the session')

const three = [inst({ id: 'a', name: 'A' }), inst({ id: 'b', name: 'B' }), inst({ id: 'c', name: 'C' })]
const shifts3 = new Map([['a', cover], ['b', cover], ['c', cover]])

// Candidates are ranked instructors in rank order. Nothing else.
eq('rank order is followed exactly',
   buildCandidates(aSess(), three, shifts3, ranks([['c', 1], ['a', 2], ['b', 3]]))
     .map(c => c.instructorId), ['c', 'a', 'b'])
eq('ranks are carried through, not renumbered',
   buildCandidates(aSess(), three, shifts3, ranks([['b', 4], ['a', 9]]))
     .map(c => c.rank), [4, 9])

// Unranked is NOT "ranked last" — it is not a candidate.
eq('unranked instructors are excluded',
   buildCandidates(aSess(), three, shifts3, ranks([['a', 1]])).map(c => c.instructorId), ['a'])
eq('no rankings means no candidates', buildCandidates(aSess(), three, shifts3, ranks([])).length, 0)
eq('missing rankings map means no candidates',
   buildCandidates(aSess(), three, shifts3, undefined).length, 0)
eq('rank 0 is not a ranking',
   buildCandidates(aSess(), three, shifts3, ranks([['a', 0], ['b', 1]])).map(c => c.instructorId), ['b'])

// Hard filters still veto a ranked instructor.
eq('a ranked instructor off shift is still excluded',
   buildCandidates(aSess(), three, new Map([['a', cover]]), ranks([['a', 1], ['b', 2]]))
     .map(c => c.instructorId), ['a'])
eq('a ranked instructor who cannot teach the level is excluded',
   buildCandidates(aSess(), [inst({ id: 'a', can_teach_middle: false }), inst({ id: 'b' })],
     shifts3, ranks([['a', 1], ['b', 2]])).map(c => c.instructorId), ['b'])

// The candidate layer TOLERATES equal ranks defensively (old data may carry
// them), even though the editors can no longer produce them.
eq('tied ranks are preserved',
   buildCandidates(aSess(), three, shifts3, ranks([['a', 1], ['b', 1], ['c', 2]]))
     .map(c => `${c.instructorId}:${c.rank}`), ['a:1', 'b:1', 'c:2'])

// ---- one placement rule for every editor
// The real bug: Kieran ranked 1 for Danny C, Alavi's cell set to 1, and the
// matrix wrote the lone cell — two instructors sharing rank 1. Rank N is an
// INSERTION at position N, never an independent number.
const dannyC = [{ instructorId: 'kieran', rank: 1 }]
eq('setting rank 1 shifts the incumbent down',
   placeAtRank(dannyC, 'alavi', 1),
   [{ instructorId: 'alavi', rank: 1 }, { instructorId: 'kieran', rank: 2 }])
eq('inserting mid-list shifts everyone at or below',
   placeAtRank([{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 2 },
                { instructorId: 'c', rank: 3 }], 'x', 2)
     .map(e => `${e.instructorId}:${e.rank}`), ['a:1', 'x:2', 'b:3', 'c:4'])
eq('moving an existing instructor renumbers, never duplicates',
   placeAtRank([{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 2 },
                { instructorId: 'c', rank: 3 }], 'c', 1)
     .map(e => `${e.instructorId}:${e.rank}`), ['c:1', 'a:2', 'b:3'])
eq('clearing closes the gap',
   placeAtRank([{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 2 },
                { instructorId: 'c', rank: 3 }], 'b', null)
     .map(e => `${e.instructorId}:${e.rank}`), ['a:1', 'c:2'])
eq('a rank past the end appends',
   placeAtRank([{ instructorId: 'a', rank: 1 }], 'z', 99),
   [{ instructorId: 'a', rank: 1 }, { instructorId: 'z', rank: 2 }])
eq('rank 0 clamps to the top',
   placeAtRank([{ instructorId: 'a', rank: 1 }], 'z', 0)[0].instructorId, 'z')
eq('an empty list accepts its first entry',
   placeAtRank([], 'a', 1), [{ instructorId: 'a', rank: 1 }])
eq('clearing the only entry empties the list', placeAtRank(dannyC, 'kieran', null), [])
// Any edit repairs the list it touches: bad old data comes out contiguous.
eq('duplicated and gapped input comes out contiguous',
   placeAtRank([{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 1 },
                { instructorId: 'c', rank: 7 }], 'd', 2)
     .map(e => `${e.instructorId}:${e.rank}`), ['a:1', 'd:2', 'b:3', 'c:4'])

// The two editors must produce identical results: the drawer's drag of an
// existing row (moveEntry) and the matrix's typed rank agree.
const dragged = moveEntry(
  [{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 2 }, { instructorId: 'c', rank: 3 }],
  2, 0)
const typed = placeAtRank(
  [{ instructorId: 'a', rank: 1 }, { instructorId: 'b', rank: 2 }, { instructorId: 'c', rank: 3 }],
  'c', 1)
eq('drag-to-top and typing 1 agree',
   dragged.map(e => `${e.instructorId}:${e.rank}`), typed.map(e => `${e.instructorId}:${e.rank}`))

eq('fallback_only is recognised', isFallbackOnly(inst({ assignability: 'fallback_only' })), true)
eq('normal is not fallback', isFallbackOnly(inst()), false)

// ---- reschedule: a cancel plus a create, never an edit
const moving = {
  id: 'sess-1', center_id: 'c1', student_id: 'st1', date: '2026-08-14',
  start_time: '16:00:00', duration: 90, notes: 'bring packet',
}
const moved = rescheduleRows(moving, '2026-08-20', '17:30')
eq('the original is cancelled, not deleted',
   moved.cancel, { id: 'sess-1', patch: { status: 'cancelled', is_modified: true } })
eq('the new row is a real scheduled session',
   moved.create, {
     center_id: 'c1', student_id: 'st1', date: '2026-08-20', start_time: '17:30:00',
     duration: 90, status: 'scheduled', source: 'manual', notes: 'bring packet',
   })
eq('a full hh:mm:ss time is not double-suffixed',
   rescheduleRows(moving, '2026-08-20', '17:30:00').create.start_time, '17:30:00')
eq('duration defaults to an hour',
   rescheduleRows({ ...moving, duration: null }, '2026-08-20', '17:30').create.duration, 60)
eq('a past date is refused', validateReschedule('2026-08-01', '16:00', '2026-08-14'),
   'the new date is in the past')
eq('today is allowed', validateReschedule('2026-08-14', '16:00', '2026-08-14'), null)
eq('a missing time is refused', validateReschedule('2026-08-20', '', '2026-08-14'), 'pick a time')

// ---- the unplaced report explains itself
// Keira D's real Thursday: 4 rankings, all four instructors off shift. The
// old banner said "1 could not be assigned" and nothing else; the answer had
// to come from a database query, which a daily tool cannot require.
const keiraLike = explainUnplaced(
  aSess(), three, new Map(), ranks([['a', 1], ['b', 2], ['c', 3]]),
)
eq('off-shift rankings get the off-shift headline',
   keiraLike.headline, 'no ranked instructor is on shift for this session')
eq('and every ranked instructor is listed with a reason',
   keiraLike.details.map((d) => `${d.name}#${d.rank}:${d.reason}`),
   ['A#1:not on shift', 'B#2:not on shift', 'C#3:not on shift'])

eq('no rankings says so, and where to fix it',
   explainUnplaced(aSess(), three, shifts3, ranks([])).headline,
   'no rankings — rank instructors in the student drawer or the matrix')
eq('a missing rankings map reads the same',
   explainUnplaced(aSess(), three, shifts3, undefined).headline,
   'no rankings — rank instructors in the student drawer or the matrix')

// A survivor of the hard filters can only mean the caps stopped placement —
// otherwise the algorithms would have placed the student.
eq('an eligible-but-unplaced ranking means capacity',
   explainUnplaced(aSess(), three, shifts3, ranks([['a', 1]])).headline,
   'every available ranked instructor was at capacity')
eq('capability-only blocks get the level headline',
   explainUnplaced(aSess(), [inst({ id: 'a', name: 'A', can_teach_middle: false })],
     shifts3, ranks([['a', 1]])).headline,
   'no ranked instructor can teach middle')
eq('details sort by rank',
   explainUnplaced(aSess(), three, new Map([['a', cover]]), ranks([['c', 3], ['a', 1], ['b', 2]]))
     .details.map((d) => d.rank), [1, 2, 3])

eq('students with no rankings are reported',
   unrankedStudents([aSess()], new Map()).map(u => u.studentId), ['st1'])
eq('ranked students are not reported',
   unrankedStudents([aSess()], new Map([['st1', ranks([['a', 1]])]])).length, 0)

// ---- ported algorithms
eq('60-min session covers two slots', sessionTimeSlots(aSess()), ['16:00', '16:30'])
eq('90-min session covers three', sessionTimeSlots(aSess({ duration: 90 })), ['16:00', '16:30', '17:00'])

// Cap 3 is respected: a fourth concurrent student cannot go to the same person.
const four = Array.from({ length: 4 }, (_, i) =>
  aSess({ id: `s${i}`, student_id: `st${i}` }))
const onlyOne = [inst({ id: 'a' })]
const rank1 = new Map(four.map(s => [s.id, new Map([['a', 1]])]))
const capped = autoAssignBalanced({
  sessions: four, unassigned: four, instructors: onlyOne, rankIndex: rank1, existing: new Map() })
// Phase 1 fills to 3, phase 2 relaxes to 4, so all four land.
eq('two phases fill to the stretch cap', capped.assigned, 4)

const five = Array.from({ length: 5 }, (_, i) => aSess({ id: `s${i}`, student_id: `st${i}` }))
const rank1of5 = new Map(five.map(s => [s.id, new Map([['a', 1]])]))
const overCap = autoAssignBalanced({
  sessions: five, unassigned: five, instructors: onlyOne, rankIndex: rank1of5, existing: new Map() })
eq('the fifth exceeds the stretch cap', overCap.assigned, 4)
eq('and is reported unassignable', overCap.couldNotAssign, 1)

// No unranked fallback: an empty rank index assigns nobody.
const noRanks = autoAssignBalanced({
  sessions: four, unassigned: four, instructors: onlyOne,
  rankIndex: new Map(four.map(s => [s.id, new Map()])), existing: new Map() })
eq('unranked pairs are never used', noRanks.assigned, 0)

// Last-resort instructors are held to the final phase.
const lastResortOnly = [inst({ id: 'lr', assignability: 'fallback_only' })]
const oneSession = [aSess()]
const lrRank = new Map([['s1', new Map([['lr', 1]])]])
eq('a pinned last-resort still gets used in phase 3',
   autoAssignBalanced({ sessions: oneSession, unassigned: oneSession, instructors: lastResortOnly,
     rankIndex: lrRank, existing: new Map() }).assigned, 1)

// Best match works tier-by-tier, so it differs from balanced here.
const twoSessions = [aSess({ id: 'x', student_id: 'sx' }), aSess({ id: 'y', student_id: 'sy' })]
const twoInst = [inst({ id: 'a' }), inst({ id: 'b' })]
const tiered = new Map([
  ['x', new Map([['a', 1], ['b', 2]])],
  ['y', new Map([['a', 2], ['b', 1]])],
])
const bm = autoAssignBestMatch({
  sessions: twoSessions, unassigned: twoSessions, instructors: twoInst, rankIndex: tiered, existing: new Map() })
eq('best match places both at rank 1', bm.assigned, 2)
eq('best match worst rank is 1', bm.worstRank, 1)
eq('each takes their own first choice',
   bm.made.map(m => `${m.sessionId}->${m.instructorId}`).sort(), ['x->a', 'y->b'])

// Existing assignments count toward load rather than being overwritten.
const withExisting = autoAssignBalanced({
  sessions: five, unassigned: five.slice(1), instructors: onlyOne, rankIndex: rank1of5,
  existing: new Map([['s0', 'a']]) })
eq('existing assignment is not re-made', withExisting.made.some(m => m.sessionId === 's0'), false)
eq('existing load still counts against the cap', withExisting.assigned, 3)

// v1's post-run alert, verbatim.
eq('summary with leftovers',
   summaryMessage({ assigned: 12, worstRank: 3, couldNotAssign: 2 }),
   'Assigned 12 students! Worst match rank: 3 (2 could not be assigned)')
eq('summary with none left over',
   summaryMessage({ assigned: 5, worstRank: 1, couldNotAssign: 0 }),
   'Assigned 5 students! Worst match rank: 1')

// ---- student display names (v1_reference naming_convention)
eq('default is first name plus last initial',
   generateDisplayName('Keira Donnelly', '5', []).name, 'Keira D')
eq('shared first name escalates to two letters',
   generateDisplayName('Micah Howard', '4', ['Micah C']).name, 'Micah Ho')
eq('first two letters keep their case',
   generateDisplayName('Micah chen', '4', ['Micah C']).name, 'Micah Ch')
eq('same first and last adds the grade',
   generateDisplayName('Aryan Patel', '2', ['Aryan P', 'Aryan Pa']).name, 'Aryan P (2)')
eq('same first, last AND grade is never invented',
   generateDisplayName('Aryan Patel', '2', ['Aryan P', 'Aryan Pa', 'Aryan P (2)']).needsReview, true)
eq('a single-word name passes through', generateDisplayName('Cher', '', []).name, 'Cher')
eq('collision detection ignores case',
   generateDisplayName('Micah Howard', '4', ['micah c']).name, 'Micah Ho')

// Full last names must never reach students.name.
eq('full last name is a violation', violatesNamingConvention('Keira Donnelly'), true)
eq('last initial is fine', violatesNamingConvention('Keira D'), false)
eq('two letters is fine', violatesNamingConvention('Micah Ho'), false)
eq('grade parenthetical is fine', violatesNamingConvention('Aryan P (2)'), false)

// Rule-3 names embed a grade and go stale each August.
eq('matching grade is not stale', staleGradeInName('Aryan P (2)', '2'), null)
eq('bumped grade is stale', staleGradeInName('Aryan P (2)', '3'), '2')
eq('plain names are never stale', staleGradeInName('Keira D', '5'), null)

// ---- student roster import planning
const existing = [
  { id: 'e1', name: 'Keira D', radius_account: 'ACC-1', grade: '5', level: 'middle',
    academic_status: null, needs_schoolwork: false, active: true },
  { id: 'e2', name: 'Noah C', radius_account: null, grade: '3', level: 'elementary',
    academic_status: 'behind', needs_schoolwork: false, active: true },
]
const plan = planStudentImport([
  // matched on radius account, one real change. A 'performance' column in the
  // file lands in academic_status now.
  { __row: 2, name: 'Keira Donnelly', radius_account: 'ACC-1', grade: '5', performance: 'Behind' },
  // matched on display name, nothing to change
  { __row: 3, name: 'Noah C', grade: '3', level: 'Elementary', academic_status: 'behind' },
  // brand new
  { __row: 4, name: 'Priya Raman', grade: '7', level: 'Middle', supp: 'yes' },
], existing)

eq('one new student', plan.created.length, 1)
eq('new student gets a convention name', plan.created[0].name, 'Priya R')
// `active: false` is explicit: this row carried no enrollment status, and a
// student is never assumed onto the schedule.
eq('unknown columns are ignored, known ones normalised',
   plan.created[0].values,
   { grade: '7', level: 'middle', needs_schoolwork: true, active: false })
eq('one changed student', plan.updated.map(u => u.name), ['Keira D'])
eq('a performance column lands in academic_status',
   plan.updated[0].patch, { academic_status: 'behind' })
eq('one already correct', plan.unchanged.map(u => u.name), ['Noah C'])
eq('nothing absent when every student appears', plan.absent.length, 0)

// A matched student is never renamed, however the file spells them.
eq('matched student keeps its display name',
   Object.keys(plan.updated[0].patch).includes('name'), false)

// A partial file must not look like deletions.
const partialRoster = planStudentImport(
  [{ __row: 2, name: 'Keira Donnelly', radius_account: 'ACC-1' }], existing)
eq('students absent from the file are reported, not removed',
   partialRoster.absent.map(s => s.name), ['Noah C'])

// Two new students sharing a first name cannot collide with each other.
const collide = planStudentImport([
  { __row: 2, name: 'Micah Chen', grade: '4' },
  { __row: 3, name: 'Micah Howard', grade: '6' },
], [])
// Both get two letters — the convention says each does, and neither exists
// yet, so neither is being renamed.
eq('within-file collisions escalate', collide.created.map(c => c.name), ['Micah Ch', 'Micah Ho'])

// ---- ranking proposal: a visible ordering, never a hidden score
const pInst = (over = {}) => ({
  id: 'p1', name: 'P', active: true, assignability: 'normal', tier: 'solid', gender: null,
  can_teach_elementary: true, can_teach_middle: true, can_teach_high: true, ...over,
})
const pStu = (over = {}) => ({ level: 'middle', gender: 'female', ...over })

eq('same gender detected', sameGender(pStu(), pInst({ gender: 'F' })), true)
eq('different gender', sameGender(pStu(), pInst({ gender: 'm' })), false)
eq('unset gender never matches', sameGender(pStu({ gender: null }), pInst({ gender: 'f' })), false)

// Capability is a hard filter on who can appear at all.
eq('ineligible instructors are not proposed',
   eligibleForStudent(pStu(), [pInst({ id: 'a' }), pInst({ id: 'b', can_teach_middle: false })])
     .map(i => i.id), ['a'])
eq('a student with no level is not filtered',
   eligibleForStudent(pStu({ level: null }), [pInst({ can_teach_middle: false })]).length, 1)

// Tier first, then same gender, then name.
// Names are chosen so the male instructor sorts FIRST alphabetically. Any
// change in order is therefore attributable to gender, not to the name
// tie-break underneath it.
const pool = [
  pInst({ id: 'solidM', name: 'Aaron M', tier: 'solid', gender: 'm' }),
  pInst({ id: 'solidF', name: 'Zoe F', tier: 'solid', gender: 'f' }),
  pInst({ id: 'strongM', name: 'Strong M', tier: 'strong', gender: 'm' }),
  pInst({ id: 'devF', name: 'Dev F', tier: 'developing', gender: 'f' }),
]
eq('tier outranks gender',
   proposeRanking(pStu(), pool).map(e => e.instructorId),
   ['strongM', 'solidF', 'solidM', 'devF'])
eq('ranks are 1..N', proposeRanking(pStu(), pool).map(e => e.rank), [1, 2, 3, 4])
eq('gender lifts the same-gender instructor over an earlier name',
   proposeRanking(pStu(), pool).map(e => e.instructorId).slice(1, 3), ['solidF', 'solidM'])
eq('turning gender off falls back to name',
   proposeRanking(pStu(), pool, { useGender: false }).map(e => e.instructorId).slice(1, 3),
   ['solidM', 'solidF'])

// Fallback-only always sinks, whatever its tier.
eq('fallback_only sorts last',
   proposeRanking(pStu(), [
     pInst({ id: 'fb', name: 'FB', tier: 'strong', assignability: 'fallback_only' }),
     pInst({ id: 'ok', name: 'OK', tier: 'developing' }),
   ]).map(e => e.instructorId), ['ok', 'fb'])

// Gender ORDERS a proposal and never restricts one. Locked down because a
// gender-shaped block was reported: the real cause is level capability, which
// at Montgomeryville happens to correlate with gender.
const femaleStudent = pStu({ level: 'high', gender: 'female' })
const mixedGenders = [
  pInst({ id: 'm1', name: 'Male A', gender: 'male', can_teach_high: true }),
  pInst({ id: 'f1', name: 'Female A', gender: 'female', can_teach_high: true }),
]
eq('an opposite-gender instructor is still eligible',
   eligibleForStudent(femaleStudent, mixedGenders).map(i => i.id).sort(), ['f1', 'm1'])
eq('and still appears in the proposal',
   proposeRanking(femaleStudent, mixedGenders).map(e => e.instructorId).sort(), ['f1', 'm1'])
eq('same gender only changes the ORDER',
   proposeRanking(femaleStudent, mixedGenders).map(e => e.instructorId), ['f1', 'm1'])
eq('nothing blocks an opposite-gender ranking',
   ineligibleForStudentReason(femaleStudent, mixedGenders[0]), null)
// Capability is the one attribute that does block, and it says so plainly.
eq('a missing level capability blocks and names itself',
   ineligibleForStudentReason(femaleStudent, pInst({ gender: 'female', can_teach_high: false })),
   'not marked for high')

// Every position explains itself.
eq('reasons name the gender match',
   proposalReasons(pStu(), pInst({ gender: 'female' })), ['same gender (F)'])
eq('reasons name a non-default tier',
   proposalReasons(pStu(), pInst({ tier: 'strong' })), ['strong'])
eq('solid tier is not noise', proposalReasons(pStu(), pInst()), [])
eq('fallback is stated',
   proposalReasons(pStu(), pInst({ assignability: 'fallback_only' })), ['fallback only'])

// Hand reordering renumbers cleanly.
const order = proposeRanking(pStu(), pool)
eq('moving to the top renumbers',
   moveEntry(order, 3, 0).map(e => `${e.instructorId}:${e.rank}`),
   ['devF:1', 'strongM:2', 'solidF:3', 'solidM:4'])
eq('moving down renumbers',
   moveEntry(order, 0, 2).map(e => e.instructorId), ['solidF', 'solidM', 'strongM', 'devF'])
eq('a no-op move is a no-op', moveEntry(order, 1, 1).map(e => e.instructorId),
   order.map(e => e.instructorId))
eq('out-of-range moves are ignored', moveEntry(order, 0, 99).length, 4)

// ---- data health checks
const hStu = (over = {}) => ({
  id: 's1', name: 'S One', grade: '6', level: 'middle', gender: 'f',
  slot_certainty: 'fixed', academic_status: 'at_level', active: true, ...over,
})
const hInst = (over = {}) => ({
  id: 'i1', name: 'I One', tier: 'solid', assignability: 'normal', gender: 'f', active: true,
  can_teach_elementary: true, can_teach_middle: true, can_teach_high: true, ...over,
})
const keys = (cs) => cs.map(c => c.key)

// A center with students and no instructors is the blocking case (Blue Bell).
const noInstructors = buildChecks([hStu()], [], [])
eq('no instructors is flagged', keys(noInstructors).includes('no_instructors'), true)
eq('no instructors is blocking',
   noInstructors.find(c => c.key === 'no_instructors').severity, 'blocking')
eq('and its students read as blocking too',
   noInstructors.find(c => c.key === 'unranked_students').severity, 'blocking')
eq('an empty center raises nothing', buildChecks([], [], []).length, 0)

// Every check that lists entities says WHICH KIND, so the health screen can
// open the right editor — student drawer or instructor form — in place.
eq('every itemised check carries its entity type',
   buildChecks(
     [hStu({ gender: null, name: 'S One (4)', grade: '5' })],
     [hInst({ gender: null, can_teach_elementary: false, can_teach_middle: false, can_teach_high: false })],
     [],
   ).filter((c) => c.items.length > 0).every((c) => c.entity === 'student' || c.entity === 'instructor'),
   true)
eq('student checks say student',
   buildChecks([hStu()], [hInst()], []).find((c) => c.key === 'unranked_students').entity, 'student')
eq('instructor checks say instructor',
   buildChecks([hStu()], [hInst({ gender: null })],
     [{ student_id: 's1', instructor_id: 'i1' }]).find((c) => c.key === 'instructors_no_gender').entity,
   'instructor')

// Unranked students.
eq('unranked students are listed',
   buildChecks([hStu()], [hInst()], []).find(c => c.key === 'unranked_students').items
     .map(i => i.label), ['S One'])
eq('a ranked student is not flagged',
   keys(buildChecks([hStu()], [hInst()], [{ student_id: 's1', instructor_id: 'i1' }]))
     .includes('unranked_students'), false)

// Missing attributes, aggregated by field.
const gaps = buildChecks([hStu({ gender: null, grade: null })], [hInst()],
  [{ student_id: 's1', instructor_id: 'i1' }])
eq('attribute gaps are flagged', keys(gaps).includes('missing_attributes'), true)
eq('the gaps are named', gaps.find(c => c.key === 'missing_attributes').items[0].note,
   'grade, gender')

// An instructor ranked for under half the students they could teach.
const roster = [hStu({ id: 'a' }), hStu({ id: 'b' }), hStu({ id: 'c' }), hStu({ id: 'd' })]
const thin = buildChecks(roster, [hInst()], [{ student_id: 'a', instructor_id: 'i1' }])
eq('a thinly-ranked instructor is flagged', keys(thin).includes('thin_instructors'), true)
eq('the shortfall is quantified',
   thin.find(c => c.key === 'thin_instructors').items[0].note, 'ranked for 1 of 4 eligible')
const wide = buildChecks(roster, [hInst()],
  roster.map(s => ({ student_id: s.id, instructor_id: 'i1' })))
eq('a fully-ranked instructor is not flagged', keys(wide).includes('thin_instructors'), false)
// Capability limits what "eligible" means, so an ES-only instructor is not
// judged against middle-school students.
eq('ineligible students do not count against an instructor',
   keys(buildChecks(roster, [hInst({ can_teach_middle: false })], [])).includes('thin_instructors'),
   false)

eq('an instructor with no levels is flagged',
   keys(buildChecks([hStu()], [hInst({ can_teach_elementary: false, can_teach_middle: false,
     can_teach_high: false })], [])).includes('instructors_no_levels'), true)
eq('an instructor with no gender is flagged',
   keys(buildChecks([hStu()], [hInst({ gender: null })], [])).includes('instructors_no_gender'),
   true)

// Rule-3 names embed a grade and go stale each August.
eq('a stale grade in a name is flagged',
   buildChecks([hStu({ name: 'Aryan P (2)', grade: '3' })], [hInst()],
     [{ student_id: 's1', instructor_id: 'i1' }])
     .find(c => c.key === 'stale_name_grade').items[0].note,
   'name says 2, record says 3')
eq('a matching grade is not flagged',
   keys(buildChecks([hStu({ name: 'Aryan P (2)', grade: '2' })], [hInst()],
     [{ student_id: 's1', instructor_id: 'i1' }])).includes('stale_name_grade'), false)

// ---- Rows view grouping
const gSess = (id, studentId, name, start, duration, level, instructorId) => ({
  id, student_id: studentId, start_time: start, duration, instructor_id: instructorId,
  student: { name, level }, status: 'scheduled',
})
const byId = new Map([
  ['i1', { id: 'i1', name: 'Kieran', color: '#E53935' }],
  ['i2', { id: 'i2', name: 'Alavi', color: '#1E88E5' }],
])
const gSessions = [
  gSess('s1', 'a', 'Late A', '17:00:00', 60, 'middle', 'i1'),
  gSess('s2', 'b', 'Early B', '15:00:00', 60, 'middle', 'i2'),
  gSess('s3', 'b', 'Early B', '17:30:00', 30, 'middle', 'i1'),
  gSess('s4', 'c', 'Elem C', '16:00:00', 90, 'elementary', null),
]

const byLevel = buildGroups(gSessions, 'level', byId)
eq('level groups are level-ordered', byLevel.map(g => g.label), ['Elementary', 'Middle'])
// Rows cascade: earliest first session at the top.
eq('rows sort by first session',
   byLevel.find(g => g.label === 'Middle').rows.map(r => r.student.name), ['Early B', 'Late A'])
eq('a student appears once per level group',
   byLevel.find(g => g.label === 'Middle').rows.length, 2)
eq('their sessions are collected on one row',
   byLevel.find(g => g.label === 'Middle').rows[0].sessions.map(s => s.id), ['s2', 's3'])
eq('row minutes sum the sessions',
   byLevel.find(g => g.label === 'Middle').rows[0].minutes, 90)
eq('group totals roll up',
   [byLevel.find(g => g.label === 'Middle').totalSessions,
    byLevel.find(g => g.label === 'Middle').totalMinutes], [3, 150])

// Grouping by instructor turns the same data into one band each.
const byInstructor = buildGroups(gSessions, 'instructor', byId)
eq('instructor bands, unassigned last',
   byInstructor.map(g => g.label), ['Alavi', 'Kieran', 'Unassigned'])
eq('a band carries the instructor colour',
   byInstructor.find(g => g.label === 'Kieran').color, '#E53935')
// Early B works with both instructors, so she appears in both bands — but
// only with the sessions belonging to that band.
eq('a student split across instructors appears in both bands',
   byInstructor.filter(g => g.rows.some(r => r.student.name === 'Early B')).map(g => g.label),
   ['Alavi', 'Kieran'])
eq('each band only holds its own sessions',
   byInstructor.find(g => g.label === 'Kieran').rows
     .flatMap(r => r.sessions.map(s => s.id)).sort(), ['s1', 's3'])
eq('unassigned sessions get their own band',
   byInstructor.find(g => g.label === 'Unassigned').rows.map(r => r.student.name), ['Elem C'])
eq('no sessions, no groups', buildGroups([], 'level', byId).length, 0)

// ---- Radius import
eq('M/D/YYYY parses', parseRadiusDate('8/10/2026'), '2026-08-10')
eq('single digits pad', parseRadiusDate('1/5/2026'), '2026-01-05')
eq('ISO input is rejected, not misread', parseRadiusDate('2026-08-10'), null)
eq('blank date', parseRadiusDate(''), null)

eq('afternoon time', parseRadiusTime('3:00 PM'), '15:00:00')
eq('morning time', parseRadiusTime('9:30 AM'), '09:30:00')
eq('noon is 12', parseRadiusTime('12:00 PM'), '12:00:00')
eq('midnight is 00', parseRadiusTime('12:30 AM'), '00:30:00')
eq('junk time', parseRadiusTime('later'), null)

eq('Scheduled maps', mapStatus('Scheduled'), 'scheduled')
eq('Attended maps to completed', mapStatus('Attended'), 'completed')
eq('Cancelled maps', mapStatus('Cancelled'), 'cancelled')
eq('Late cancelled maps to cancelled', mapStatus('Late cancelled'), 'cancelled')
eq('No show maps', mapStatus('No show'), 'no_show')
eq('unknown status is not guessed', mapStatus('Pending'), null)

// v2 stores 'Last, First | id'; the export writes 'First Last'.
eq('account key from v2 format', accountKey('Fenstermacher, Vanessa | 2802862'),
   'vanessa fenstermacher')
eq('account key from export format', accountKey('Vanessa Fenstermacher'), 'vanessa fenstermacher')
eq('both formats agree',
   accountKey('Abdullah, Katrina | 2806600') === accountKey('Katrina Abdullah'), true)
eq('blank account', accountKey(''), '')

eq('full name to display key', displayKeyFromFullName('Landon Russell'), 'landon r')
eq('single-word name', displayKeyFromFullName('Cher'), 'cher')

eq('test test is suspicious', isSuspiciousActor('test test'), true)
eq('a repeated word is suspicious', isSuspiciousActor('demo demo'), true)
eq('a real name is not', isSuspiciousActor('William.Griffin'), false)
eq('System is not', isSuspiciousActor('System'), false)
eq('blank is not', isSuspiciousActor(''), false)

// Cancel-and-rebook. A live row proves the slot is live, whatever the order
// or the timestamps — cancelling in Radius flips a row rather than adding one.
const rr = (studentName, status, bookedOn, rowNumber) => ({
  studentName, date: '2026-08-12', startTime: '18:00:00', status, bookedOn, rowNumber,
})
eq('a live row beats a cancellation',
   resolveRebookings([rr('A', 'cancelled', '2026-07-29', 2), rr('A', 'scheduled', '2026-08-10', 3)])
     .kept.map(r => r.status), ['scheduled'])
// Order-independent: the same pair the other way round resolves identically.
eq('order does not matter',
   resolveRebookings([rr('A', 'scheduled', '2026-08-10', 2), rr('A', 'cancelled', '2026-07-29', 3)])
     .kept.map(r => r.status), ['scheduled'])
// The real Fenstermacher case: booked dates differ but an older booking is
// the live one would still resolve, because status decides first.
eq('an older live booking still wins',
   resolveRebookings([rr('A', 'cancelled', '2026-08-10', 2), rr('A', 'scheduled', '2026-07-29', 3)])
     .kept.map(r => r.status), ['scheduled'])
eq('Attended counts as live',
   resolveRebookings([rr('A', 'cancelled', '2026-07-31', 2), rr('A', 'completed', '2026-06-06', 3)])
     .kept.map(r => r.status), ['completed'])
eq('all cancelled stays cancelled',
   resolveRebookings([rr('A', 'cancelled', '2026-07-29', 2), rr('A', 'cancelled', '2026-08-10', 3)])
     .kept.map(r => r.status), ['cancelled'])
eq('newest booking wins among two live rows',
   resolveRebookings([rr('A', 'scheduled', '2026-07-01', 2), rr('A', 'scheduled', '2026-08-10', 3)])
     .kept.map(r => r.bookedOn), ['2026-08-10'])
eq('a no-show outranks a cancellation',
   resolveRebookings([rr('A', 'cancelled', '2026-08-10', 2), rr('A', 'no_show', '2026-07-01', 3)])
     .kept.map(r => r.status), ['no_show'])
eq('different students do not collide',
   resolveRebookings([rr('A', 'scheduled', '2026-08-10', 2), rr('B', 'cancelled', '2026-08-10', 3)])
     .kept.length, 2)
eq('a lone row is never reported as superseded',
   resolveRebookings([rr('A', 'scheduled', '2026-08-10', 2)]).superseded.length, 0)

// Matching is center-scoped and needs the student's own name, because
// siblings share an account.
const rStudents = [
  { id: 'v', name: 'Victoria F', radius_account: 'Fenstermacher, Vanessa | 1' },
  { id: 'm', name: 'Matthias F', radius_account: 'Fenstermacher, Vanessa | 2' },
  { id: 'l', name: 'Landon R', radius_account: null },
]
eq('account plus name picks the right sibling',
   matchStudent({ studentName: 'Victoria Fenstermacher', accountName: 'Vanessa Fenstermacher' },
     rStudents).student.id, 'v')
eq('the other sibling on the same account',
   matchStudent({ studentName: 'Matthias Fenstermacher', accountName: 'Vanessa Fenstermacher' },
     rStudents).student.id, 'm')
eq('falls back to display name when there is no account',
   matchStudent({ studentName: 'Landon Russell', accountName: '' }, rStudents).student.id, 'l')
eq('the fallback is reported',
   matchStudent({ studentName: 'Landon Russell', accountName: '' }, rStudents).via, 'name')
// A differing initial with no guardian to explain it stays unmatched.
eq('a differing last initial does not match',
   matchStudent({ studentName: 'Audie Prykowski', accountName: '' },
     [{ id: 'k', name: 'Audie K', radius_account: null }]).student, null)
eq('an unknown student does not match',
   matchStudent({ studentName: 'Nobody Here', accountName: '' }, rStudents).student, null)

// ---- Radius: guardian surname and suggestions
// v1 sometimes used the GUARDIAN's surname: 'Audie Prykowski' on account
// 'Joy Keller' was entered as 'Audie K'.
eq('guardian key', displayKeyFromGuardian('Audie Prykowski', 'Joy Keller'), 'audie k')
eq('guardian key strips the radius id',
   displayKeyFromGuardian('Audie Prykowski', 'Keller, Joy | 123'), 'audie k')
eq('no guardian, no key', displayKeyFromGuardian('Audie Prykowski', ''), '')
eq('the guardian surname matches where the student surname does not',
   matchStudent({ studentName: 'Audie Prykowski', accountName: 'Joy Keller' },
     [{ id: 'k', name: 'Audie K', radius_account: null }]).via, "guardian's surname")

// Suggestions are offered, never applied.
eq('a first-name spelling variant is suggested',
   suggestStudents({ studentName: 'Charis Effraim' },
     [{ id: 'c', name: 'Chariss E' }]).map(s => s.student.name), ['Chariss E'])
eq('a different initial on the same first name is suggested',
   suggestStudents({ studentName: 'Anvit Arun' },
     [{ id: 'a', name: 'Anvit S' }])[0].why, 'same first name, initial S')
eq('an unrelated student is not suggested',
   suggestStudents({ studentName: 'Anvit Arun' }, [{ id: 'z', name: 'Zoe H' }]).length, 0)

// ---- Workstream shifts
const wsRow = (over = {}) => ({
  __row: 2, employee_name: 'Tanvi Raman', employee_id: '151013', date: '7/14/2026',
  time_in: '3:03 PM', time_out: '6:38 PM', center: 'Blue Bell',
  duration_minutes: '216', ...over,
})
eq('a data row is data', isDataRow(wsRow()), true)
// The real export introduces each employee with a bare name row and closes
// them with a Total row. Neither is data.
eq('a group header is not data', isDataRow({ __EMPTY: 'Roy Eisenhandler (I)' }), false)
eq('a total row is not data',
   isDataRow({ date: '', time_in: '', duration_minutes: 'Total: 648' }), false)
eq('a row without a clock-in is not data', isDataRow(wsRow({ time_in: '' })), false)

const ws = readWorkstreamRow(wsRow())
eq('date parsed', ws.date, '2026-07-14')
eq('clock in parsed', ws.startTime, '15:03:00')
eq('clock out parsed', ws.endTime, '18:38:00')

const wsInstructors = [
  { id: 't', name: 'Tanvi Raman', workstream_id: null },
  { id: 'r', name: 'Roy', workstream_id: null },
  { id: 'b', name: 'Bob', workstream_id: '149434' },
]
eq('full name matches', matchInstructor(ws, wsInstructors).instructor.id, 't')
// v2 holds several instructors by first name only.
eq('a lone first name matches',
   matchInstructor(readWorkstreamRow(wsRow({ employee_name: 'Roy Eisenhandler', employee_id: '' })),
     wsInstructors).via, 'first name')
// workstream_id wins outright — 'Robert Luisi' would never match 'Bob' by name.
eq('the workstream id beats the name',
   matchInstructor(readWorkstreamRow(wsRow({ employee_name: 'Robert Luisi', employee_id: '149434' })),
     wsInstructors).instructor.id, 'b')
eq('an unknown employee does not match',
   matchInstructor(readWorkstreamRow(wsRow({ employee_name: 'Yeogyeong Gim', employee_id: '154945' })),
     wsInstructors).instructor, null)

// The deletion rule, which is the opposite of Radius.
const wsCenters = new Map([['blue bell', { id: 'bb', name: 'Blue Bell' }]])
const wsByCenter = new Map([['bb', wsInstructors]])
const wsPlan = planWorkstreamImport([wsRow()], {
  centersByName: wsCenters,
  instructorsByCenter: wsByCenter,
  existingShifts: [
    // same slot, different end -> update
    { id: 's1', instructor_id: 't', center_id: 'bb', date: '2026-07-14', start_time: '15:03:00', end_time: '17:00:00' },
    // same day, absent from the file -> delete
    { id: 's2', instructor_id: 'r', center_id: 'bb', date: '2026-07-14', start_time: '09:00:00', end_time: '12:00:00' },
    // outside the file's window -> untouched
    { id: 's3', instructor_id: 'r', center_id: 'bb', date: '2026-08-01', start_time: '09:00:00', end_time: '12:00:00' },
  ],
})
const wsBB = wsPlan.centers[0]
eq('an end-time change is an update', wsBB.updated.map(u => u.current.id), ['s1'])
eq('a shift absent from the file is deleted', wsBB.removed.map(r => r.shift.id), ['s2'])
eq('a shift outside the window is untouched', wsBB.removed.some(r => r.shift.id === 's3'), false)
eq('deleting someone the file never mentions is called out',
   wsBB.removed[0].instructorInFile, false)

// ---- enrollment status
eq('Enrolled', normalizeEnrollmentStatus('Enrolled'), 'enrolled')
eq('On Hold', normalizeEnrollmentStatus('On Hold'), 'on_hold')
eq('Pre-Enrolled', normalizeEnrollmentStatus('Pre-Enrolled'), 'pre_enrolled')
eq('New', normalizeEnrollmentStatus('New'), 'new')
eq('Inactive', normalizeEnrollmentStatus('Inactive'), 'inactive')
eq('blank is unset', normalizeEnrollmentStatus(''), null)
// An unrecognised Radius value is left unset rather than guessed at.
eq('unknown status is not guessed', normalizeEnrollmentStatus('Withdrawn'), null)

eq('enrolled is schedulable', activeFromEnrollment('enrolled'), true)
eq('pre-enrolled is schedulable', activeFromEnrollment('pre_enrolled'), true)
eq('on hold is not', activeFromEnrollment('on_hold'), false)
eq('inactive is not', activeFromEnrollment('inactive'), false)
// The important one: New is a lead, not an enrollment. It must carry no
// opinion, so it can never switch a student on.
eq('New carries no opinion', activeFromEnrollment('new'), null)
eq('unset carries no opinion', activeFromEnrollment(null), null)

// The importer applies that rule.
const enrollExisting = [
  { id: 'a', name: 'Ada T', radius_account: 'ACC-A', active: false, enrollment_status: null },
  { id: 'b', name: 'Bo R', radius_account: 'ACC-B', active: true, enrollment_status: null },
  { id: 'c', name: 'Cy N', radius_account: 'ACC-C', active: false, enrollment_status: null },
]
const enrollPlan = planStudentImport([
  { __row: 2, name: 'Ada Tran', radius_account: 'ACC-A', enrollment_status: 'Enrolled' },
  { __row: 3, name: 'Bo Rivers', radius_account: 'ACC-B', enrollment_status: 'On Hold' },
  { __row: 4, name: 'Cy Nolan', radius_account: 'ACC-C', enrollment_status: 'New' },
], enrollExisting)

const patchFor = (name) => enrollPlan.updated.find((u) => u.name === name)?.patch ?? {}
eq('Enrolled reactivates a switched-off student',
   patchFor('Ada T'), { enrollment_status: 'enrolled', active: true })
eq('On Hold deactivates', patchFor('Bo R'), { enrollment_status: 'on_hold', active: false })
// Cy stays inactive: the status is recorded, but `active` is untouched.
eq('New records the status without activating',
   patchFor('Cy N'), { enrollment_status: 'new' })

// A newcomer the file does enroll arrives active.
const newcomers = planStudentImport([
  { __row: 2, name: 'Dee Park', enrollment_status: 'Enrolled' },
  { __row: 3, name: 'Ivo Tarr', enrollment_status: 'On Hold' },
], [])
eq('an enrolled newcomer is active',
   newcomers.created.find((c) => c.name === 'Dee P').values.active, true)
eq('an on-hold newcomer is created, switched off',
   newcomers.created.find((c) => c.name === 'Ivo T').values.active, false)

// ---- creation is gated on enrollment status
// A Radius export carries a center's whole history. Only a real enrollment
// makes a student: Inactive is someone who left and New is a lead who has not
// enrolled, so neither may invent one.
const historical = planStudentImport([
  { __row: 2, name: 'Gus Ives',  enrollment_status: 'Inactive' },
  { __row: 3, name: 'Hana Roy',  enrollment_status: 'Enrolled' },
  { __row: 4, name: 'Ivo Tarr',  enrollment_status: 'On Hold' },
  { __row: 5, name: 'Jo Wilde',  enrollment_status: 'New' },
  { __row: 6, name: 'Kit Ames',  enrollment_status: 'Pre-Enrolled' },
  { __row: 7, name: 'Lena Bly' },
], [])
eq('only a real enrollment creates a student',
   historical.created.map((c) => c.name).sort(), ['Hana R', 'Ivo T', 'Kit A'])
eq('and every refusal is counted, with its reason',
   historical.skipped.map((s) => [s.fullName, s.reason]).sort(),
   [['Gus Ives', 'inactive'], ['Jo Wilde', 'new'], ['Lena Bly', 'no_status']])

// A file with no enrollment column at all is a different thing from a file
// that has one and left it blank. Reading absence as evidence would break
// every hand-made roster CSV.
const noStatusColumn = planStudentImport(
  [{ __row: 2, name: 'Lena Bly', grade: '5' }, { __row: 3, name: 'Moe Kaur', grade: '7' }], [],
)
eq('a CSV without the column still imports',
   noStatusColumn.created.map((c) => c.name), ['Lena B', 'Moe K'])
eq('and nothing is withheld', noStatusColumn.skipped.length, 0)

// The gate is about creation only — someone already here still goes inactive.
const departing = planStudentImport(
  [{ __row: 2, name: 'Gus Ives', enrollment_status: 'Inactive' }],
  [{ id: 'g', name: 'Gus I', active: true }],
)
eq('an existing student is still marked inactive',
   departing.updated[0].patch, { enrollment_status: 'inactive', active: false })
eq('and nothing is skipped', departing.skipped.length, 0)

// ---- near-miss spellings and placeholder records
// Both real: the roster says 'Chariss E' and 'Hazik H', Radius says 'Charis
// Effraim' and 'Haziq Hassan'. Warned about, never merged — one letter apart
// is also what sibling names look like.
eq('one substitution is a near miss',  nearlySameFirstName('Hazik', 'Haziq'), true)
eq('one insertion is too',             nearlySameFirstName('Charis', 'Chariss'), true)
eq('identical names are not a warning', nearlySameFirstName('Ana', 'Ana'), false)
eq('a different initial is a different name', nearlySameFirstName('Dan', 'Ian'), false)
eq('two edits is a different name',    nearlySameFirstName('Katie', 'Kacey'), false)

// Both real rows from Students Export 8_12_2026. The account pins the family,
// so a one-letter miss inside it is the same child, not a new one.
const effraim = planStudentImport([
  { __row: 2, first_name: 'Charis', last_name: 'Effraim', account: 'Effraim, Seyi', enrollment_status: 'Enrolled' },
  { __row: 3, first_name: 'Evan',   last_name: 'Effraim', account: 'Effraim, Seyi', enrollment_status: 'Enrolled' },
  { __row: 4, first_name: 'First',  last_name: 'Last',    account: 'Effraim, Seyi', enrollment_status: 'New' },
], [{ id: 'c', name: 'Chariss E', radius_account: 'Effraim, Seyi | 3149943', active: true }])
eq("'Charis' finds the roster's 'Chariss' on the shared account",
   effraim.updated.map((u) => u.name), ['Chariss E'])
eq('the real sibling is created', effraim.created.map((c) => c.name), ['Evan E'])
eq('and the template record on that account is not', effraim.skipped.map((s) => s.reason), ['placeholder'])

// Two children on one account, one exact and one a letter off.
const hassan = planStudentImport([
  { __row: 2, first_name: 'Hayat', last_name: 'Hassan', account: 'Hassan, Kanon', enrollment_status: 'Enrolled' },
  { __row: 3, first_name: 'Haziq', last_name: 'Hassan', account: 'Hassan, Kanon', enrollment_status: 'Enrolled' },
], [
  { id: 'h1', name: 'Hayat H', radius_account: 'Hassan, Kanon | 3245690', active: true },
  { id: 'h2', name: 'Hazik H', radius_account: 'Hassan, Kanon | 3245690', active: true },
])
eq('the exact sibling and the near miss each find their own record',
   hassan.updated.map((u) => u.name).sort(), ['Hayat H', 'Hazik H'])
eq('and nobody is duplicated', hassan.created.length, 0)

// Ambiguity inside an account is still a guess, so it is refused.
const twins = planStudentImport(
  [{ __row: 2, first_name: 'Alan', last_name: 'Roy', account: 'Roy, P', enrollment_status: 'Enrolled' }],
  [{ id: '1', name: 'Alana R', radius_account: 'Roy, P | 9', active: true },
   { id: '2', name: 'Alani R', radius_account: 'Roy, P | 9', active: true }],
)
eq('two near misses on one account match neither', twins.updated.length, 0)

// Without a shared account there is nothing to pin the guess to, so a
// near-miss is only ever a warning on a newly created student.
const lookalike = planStudentImport(
  [{ __row: 2, first_name: 'Charis', last_name: 'Effraim', enrollment_status: 'Enrolled' }],
  [{ id: 'c', name: 'Chariss E', active: true }],
)
eq('a near-miss spelling with no account is still created', lookalike.created.length, 1)
eq('but flagged for review', lookalike.created[0].needsReview, true)
eq('naming the student it resembles',
   lookalike.created[0].reviewReason.includes('Chariss E'), true)

eq('a template record is a placeholder', isPlaceholderName('First Last'), true)
eq('so is a test record',               isPlaceholderName('Test Student'), true)
eq('and so is the stock fake name',     isPlaceholderName('John Smith'), true)
eq('a real name that contains one is not', isPlaceholderName('Grace First'), false)
eq('and a real surname is not',            isPlaceholderName('Ada Smith'), false)

// Enrolled, so only the name keeps it out. 'John Smith' is a name real people
// have, which is why this withholds from creation and says so rather than
// discarding the row.
const template = planStudentImport(
  [{ __row: 2, first_name: 'John', last_name: 'Smith', enrollment_status: 'Enrolled' }], [],
)
eq('a stock fake name never becomes a student', template.created.length, 0)
eq('and the reason is recorded', template.skipped.map((s) => s.reason), ['placeholder'])

// ---- matching: siblings share a Radius account
// Real data: 'Yorgey, Suzanne' carries three children. With only one of them
// on the roster, all three rows used to collapse onto that one student and the
// last row won — silently overwriting their grade, school and status.
eq('a display name reduces to first + last initial', displayNameShape('Danielle Shaw'), 'danielle|s')
eq('and the stored short form reduces the same way', displayNameShape('Danielle S'), 'danielle|s')
eq('two-letter forms too', displayNameShape('Charlotte Yo'), 'charlotte|y')
eq('the grade parenthetical is ignored', displayNameShape('Micah C (7)'), 'micah|c')
eq('a lone first name has no shape', displayNameShape('Madonna'), null)

const siblings = planStudentImport([
  { __row: 2, first_name: 'Max',  last_name: 'Yorgey', account: 'Yorgey, Suzanne', grade: '5' },
  { __row: 3, first_name: 'Ivy',  last_name: 'Yorgey', account: 'Yorgey, Suzanne', grade: '8' },
  { __row: 4, first_name: 'Theo', last_name: 'Yorgey', account: 'Yorgey, Suzanne', grade: '2' },
], [{ id: 'max', name: 'Max Y', radius_account: 'Yorgey, Suzanne | 1516689', grade: '4', active: true }])
eq('a sibling row never lands on the wrong child', siblings.updated.length, 1)
eq('and it lands on the right one', siblings.updated[0].name, 'Max Y')
eq("Max keeps his own grade", siblings.updated[0].patch.grade, '5')
eq('the other two siblings are created', siblings.created.map((c) => c.name).sort(), ['Ivy Y', 'Theo Y'])

// The lone-holder shortcut still has to work, or a stored nickname never
// matches the legal name in the export.
const nickname = planStudentImport(
  [{ __row: 2, first_name: 'Alexander', last_name: 'Patel', account: 'Patel, Komal', grade: '6' }],
  [{ id: 'a', name: 'Alex P', radius_account: 'Patel, Komal | 2700733', grade: '5', active: true }],
)
eq('one student and one row on an account match despite the name',
   nickname.updated.map((u) => u.name), ['Alex P'])

// ---- matching: the display-name convention
// A stored name never carries a full last name, so nothing matches by string.
const shaped = planStudentImport(
  [{ __row: 2, first_name: 'Danielle', last_name: 'Shaw', grade: '9' }],
  [{ id: 'd', name: 'Danielle S', grade: '8', active: true }],
)
eq('a full name in the file finds the short name on the roster',
   shaped.updated.map((u) => u.name), ['Danielle S'])
eq('and creates nobody', shaped.created.length, 0)

// Ambiguity on either side makes the shape a guess, so it is refused.
const twoOnRoster = planStudentImport(
  [{ __row: 2, first_name: 'Micah', last_name: 'Cohen' }],
  [{ id: '1', name: 'Micah Ch', active: true }, { id: '2', name: 'Micah Co', active: true }],
)
eq('two roster students of the same shape block the match', twoOnRoster.updated.length, 0)
const twoInFile = planStudentImport(
  [{ __row: 2, first_name: 'Micah', last_name: 'Cohen' },
   { __row: 3, first_name: 'Micah', last_name: 'Chen' }],
  [{ id: '1', name: 'Micah C', active: true }],
)
eq('two file rows of the same shape block it too', twoInFile.updated.length, 0)

// Whatever the tier, a second row must never patch over the first.
const doubled = planStudentImport(
  [{ __row: 2, first_name: 'Rex', last_name: 'Ford', account: 'Ford, A', grade: '3' },
   { __row: 3, first_name: 'Rex', last_name: 'Ford', account: 'Ford, A', grade: '9' }],
  [{ id: 'r', name: 'Rex F', radius_account: 'Ford, A | 1', grade: '3', active: true }],
)
eq('a duplicated export row is flagged, not applied', doubled.problems.length, 1)
eq('and the student is untouched', doubled.updated.length, 0)

// ---- one file, two centers
// A Blue Bell export selected while looking at Montgomeryville must not create
// Blue Bell students inside Montgomeryville.
const mvCenter = { id: 'mvCenter', name: 'Montgomeryville' }
const bbCenter = { id: 'bbCenter', name: 'Blue Bell' }
const centerSplit = planStudentImportByCenter([
  { __row: 2, first_name: 'Ana', last_name: 'Reyes', center: 'Blue Bell' },
  { __row: 3, first_name: 'Ben', last_name: 'Ortiz', center: 'Montgomeryville' },
  { __row: 4, first_name: 'Cal', last_name: 'Vance', center: 'Blue Bell' },
  { __row: 5, first_name: 'Dot', last_name: 'Kim',   center: 'Warrington' },
], {
  centersByName: new Map([['montgomeryville', mvCenter], ['blue bell', bbCenter]]),
  studentsByCenter: new Map(),
  fallbackCenter: mvCenter,
})
eq('rows are centerSplit by the file, not by the selected center',
   centerSplit.centers.map((c) => [c.center.name, c.plan.created.length]),
   [['Blue Bell', 2], ['Montgomeryville', 1]])
eq('a center the app does not have is never guessed at', centerSplit.unknownCenter.length, 1)
eq('every row is accounted for', centerSplit.totalRows, 4)
eq('the centerSplit is marked as coming from the file', centerSplit.centers[0].fromColumn, true)

// A hand-made CSV has no Center column; those rows go where you are looking.
const noColumn = planStudentImportByCenter(
  [{ __row: 2, first_name: 'Eve', last_name: 'Lang' }],
  { centersByName: new Map([['blue bell', bbCenter]]), studentsByCenter: new Map(), fallbackCenter: mvCenter },
)
eq('a file without a Center column falls back to the selected center',
   noColumn.centers.map((c) => c.center.name), ['Montgomeryville'])
eq('and says so', noColumn.centers[0].fromColumn, false)

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
// 12-hour, no leading zero, minutes always shown. Never 24-hour in the UI.
eq('formatTime on the hour', formatTime('15:00:00'), '3:00')
eq('formatTime half past',   formatTime('15:30:00'), '3:30')
eq('formatTime noon',        formatTime('12:00:00'), '12:00')
eq('formatTime midnight',    formatTime('00:30:00'), '12:30')
eq('formatTime morning',     formatTime('09:15:00'), '9:15')
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







