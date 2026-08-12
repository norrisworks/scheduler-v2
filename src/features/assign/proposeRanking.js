import { CAPABILITY_FLAG } from '../day/levels'
import { TIER_ORDER } from '../instructors/instructorFields'
import { isFallbackOnly } from './rankings'

/**
 * Proposes a STARTING ORDER for a student's rankings. This is never a score
 * and never runs behind your back: it produces a visible, editable list where
 * every position carries the reason it is there, and the whole thing is meant
 * to be overridden before saving.
 *
 * The sort inputs, in priority order:
 *   1. tier      — strong before solid before developing
 *   2. gender    — same gender as the student sorts higher
 *   3. name      — so the result is stable and reproducible
 * Fallback-only instructors sort last regardless, matching how they are used.
 */
export const PROPOSAL_SORTS = [
  { key: 'tier', label: 'Tier', hint: 'Strong first' },
  { key: 'gender', label: 'Same gender', hint: 'Matches the student' },
]

const tierRank = (instructor) => TIER_ORDER[instructor.tier] ?? TIER_ORDER.solid

export function sameGender(student, instructor) {
  const a = student?.gender?.trim().toLowerCase()
  const b = instructor?.gender?.trim().toLowerCase()
  return Boolean(a && b && a === b)
}

/** Instructors who could teach this student at all. */
export function eligibleForStudent(student, instructors) {
  const flag = CAPABILITY_FLAG[student?.level]
  return instructors.filter((i) => i.active !== false && (!flag || i[flag]))
}

/**
 * Why this instructor sits where it does — rendered next to the row so the
 * ordering is always explicable.
 */
export function proposalReasons(student, instructor, { useGender = true } = {}) {
  const reasons = []
  if (instructor.tier && instructor.tier !== 'solid') reasons.push(instructor.tier)
  if (useGender && sameGender(student, instructor)) {
    reasons.push(`same gender (${instructor.gender.toUpperCase()})`)
  }
  if (isFallbackOnly(instructor)) reasons.push('fallback only')
  return reasons
}

export function proposeRanking(student, instructors, { useGender = true, useTier = true } = {}) {
  const eligible = eligibleForStudent(student, instructors)

  const sorted = [...eligible].sort((a, b) => {
    // Fallback-only always sinks: they are a last phase, not a preference.
    const fa = isFallbackOnly(a) ? 1 : 0
    const fb = isFallbackOnly(b) ? 1 : 0
    if (fa !== fb) return fa - fb

    if (useTier) {
      const t = tierRank(a) - tierRank(b)
      if (t !== 0) return t
    }
    if (useGender) {
      const ga = sameGender(student, a) ? 0 : 1
      const gb = sameGender(student, b) ? 0 : 1
      if (ga !== gb) return ga - gb
    }
    return a.name.localeCompare(b.name)
  })

  return sorted.map((instructor, i) => ({
    instructor,
    instructorId: instructor.id,
    rank: i + 1,
    reasons: proposalReasons(student, instructor, { useGender }),
  }))
}

/** Renumber a hand-reordered list back to a clean 1..N. */
export function renumber(entries) {
  return entries.map((entry, i) => ({ ...entry, rank: i + 1 }))
}

/** Move an entry to a new index, then renumber. Used by the drag reorder. */
export function moveEntry(entries, from, to) {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return entries
  }
  const next = [...entries]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return renumber(next)
}
