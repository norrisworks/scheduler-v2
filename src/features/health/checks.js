import { missingAttributes } from '../roster/studentFields'
import { capabilityString, instructorWarnings } from '../instructors/instructorFields'
import { staleGradeInName } from '../imports/namingConvention'
import { eligibleForStudent } from '../assign/proposeRanking'

/**
 * Pure health checks over a center's roster. Kept free of the Supabase client
 * so they stay directly testable under node.
 */
export function buildChecks(students, instructors, rankings) {
  const studentIds = new Set(students.map((s) => s.id))
  const instructorIds = new Set(instructors.map((i) => i.id))

  const rankedStudents = new Set()
  const rankCountByInstructor = new Map()
  for (const row of rankings) {
    if (!studentIds.has(row.student_id)) continue
    rankedStudents.add(row.student_id)
    if (instructorIds.has(row.instructor_id)) {
      rankCountByInstructor.set(
        row.instructor_id,
        (rankCountByInstructor.get(row.instructor_id) ?? 0) + 1,
      )
    }
  }

  const checks = []

  // The blocking one: a center with students and nobody to rank them against.
  if (students.length > 0 && instructors.length === 0) {
    checks.push({
      key: 'no_instructors',
      severity: 'blocking',
      title: 'No instructors at this center',
      detail:
        `All ${students.length} students here are unrankable until instructors exist. ` +
        'Add them on the Instructors page.',
      items: [],
    })
  }

  const unranked = students.filter((s) => !rankedStudents.has(s.id))
  if (unranked.length > 0) {
    checks.push({
      key: 'unranked_students',
      entity: 'student',
      severity: instructors.length === 0 ? 'blocking' : 'high',
      title: `${unranked.length} active student${unranked.length === 1 ? '' : 's'} with no rankings`,
      detail: 'Auto-assign cannot place them at all. Seed them from the Rankings matrix.',
      items: unranked.map((s) => ({ id: s.id, label: s.name, note: s.level ?? 'no level' })),
    })
  }

  const missing = students
    .map((s) => ({ student: s, gaps: missingAttributes(s) }))
    .filter((r) => r.gaps.length > 0)
  if (missing.length > 0) {
    const byField = new Map()
    for (const { gaps } of missing) {
      for (const gap of gaps) byField.set(gap, (byField.get(gap) ?? 0) + 1)
    }
    checks.push({
      key: 'missing_attributes',
      entity: 'student',
      severity: 'medium',
      title: `${missing.length} student${missing.length === 1 ? '' : 's'} missing attributes`,
      detail:
        [...byField.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([field, n]) => `${n} missing ${field}`)
          .join(' · ') + '.',
      items: missing.map(({ student, gaps }) => ({
        id: student.id,
        label: student.name,
        note: gaps.join(', '),
      })),
    })
  }

  // An instructor absent from most lists will almost never be auto-assigned,
  // which is how a new hire quietly stays idle.
  const thin = instructors
    .map((i) => {
      const eligible = students.filter((s) => eligibleForStudent(s, [i]).length > 0).length
      const ranked = rankCountByInstructor.get(i.id) ?? 0
      return { instructor: i, eligible, ranked }
    })
    .filter((r) => r.eligible > 0 && r.ranked < r.eligible / 2)
  if (thin.length > 0) {
    checks.push({
      key: 'thin_instructors',
      entity: 'instructor',
      severity: 'high',
      title: `${thin.length} instructor${thin.length === 1 ? '' : 's'} missing from most rankings`,
      detail:
        'Ranked for fewer than half the students they could teach. Use "Add to student rankings" ' +
        'on their profile.',
      items: thin.map(({ instructor, eligible, ranked }) => ({
        id: instructor.id,
        label: instructor.name,
        note: `ranked for ${ranked} of ${eligible} eligible`,
      })),
    })
  }

  const noLevels = instructors.filter((i) => instructorWarnings(i).length > 0)
  if (noLevels.length > 0) {
    checks.push({
      key: 'instructors_no_levels',
      entity: 'instructor',
      severity: 'high',
      title: `${noLevels.length} instructor${noLevels.length === 1 ? '' : 's'} with no levels set`,
      detail: 'They can never be auto-assigned. Set can-teach flags on their profile.',
      items: noLevels.map((i) => ({ id: i.id, label: i.name, note: capabilityString(i) || 'none' })),
    })
  }

  const noGender = instructors.filter((i) => !i.gender)
  if (noGender.length > 0) {
    checks.push({
      key: 'instructors_no_gender',
      entity: 'instructor',
      severity: 'low',
      title: `${noGender.length} instructor${noGender.length === 1 ? '' : 's'} with no gender set`,
      detail: 'Same-gender ordering is skipped for them when proposing rankings.',
      items: noGender.map((i) => ({ id: i.id, label: i.name, note: 'no gender' })),
    })
  }

  // Rule-3 display names embed a grade and go stale each August.
  const staleNames = students
    .map((s) => ({ student: s, was: staleGradeInName(s.name, s.grade) }))
    .filter((r) => r.was)
  if (staleNames.length > 0) {
    checks.push({
      key: 'stale_name_grade',
      entity: 'student',
      severity: 'medium',
      title: `${staleNames.length} display name${staleNames.length === 1 ? '' : 's'} with a stale grade`,
      detail: 'The grade in the name no longer matches the student. Rename them on the Roster.',
      items: staleNames.map(({ student, was }) => ({
        id: student.id,
        label: student.name,
        note: `name says ${was}, record says ${student.grade ?? 'unset'}`,
      })),
    })
  }

  return checks
}


