/**
 * Student display-name rules (v1_reference naming_convention). Display names
 * NEVER contain a full last name. These bind both the roster UI and every
 * importer: an import may generate a name for a student it has never seen,
 * but must never rename one that already exists.
 */

const normalize = (name) => (name ?? '').trim().replace(/\s+/g, ' ')
export const nameKey = (name) => normalize(name).toLowerCase()

export function splitName(fullName) {
  const parts = normalize(fullName).split(' ')
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

/**
 * A display name violates the convention when a second word is longer than
 * two characters and isn't a parenthetical grade — i.e. a full last name.
 */
export function violatesNamingConvention(displayName) {
  const parts = normalize(displayName).split(' ')
  return parts.slice(1).some((part) => !part.startsWith('(') && part.replace(/\./g, '').length > 2)
}

/**
 * A display name for a student the importer has not seen before, escalating
 * exactly as the convention says: first initial, then two letters, then the
 * grade parenthetical. Returns needsReview when even that collides — the
 * convention is explicit that no tiebreak may be invented.
 */
export function generateDisplayName(fullName, grade, takenNames = [], options = {}) {
  const taken = new Set(takenNames.map(nameKey))
  const { first, last } = splitName(fullName)
  if (!first) return { name: '', needsReview: true, reason: 'no name in the file' }
  if (!last) {
    const solo = first
    return taken.has(nameKey(solo))
      ? { name: solo, needsReview: true, reason: 'name collides and the file has no last name' }
      : { name: solo, needsReview: false, reason: null }
  }

  const oneInitial = `${first} ${last[0].toUpperCase()}`

  // Rule 2 triggers on a shared FIRST NAME, not on a display-name collision:
  // 'Micah C' and 'Micah H' do not collide, but the convention still wants
  // 'Micah Ch' and 'Micah Ho' so the two are told apart at a glance.
  const firstNameShared =
    options.sharesFirstName ??
    takenNames.some((n) => splitName(n).first.toLowerCase() === first.toLowerCase())

  if (!firstNameShared && !taken.has(nameKey(oneInitial))) {
    return { name: oneInitial, needsReview: false, reason: null }
  }

  const twoLetters = `${first} ${last[0].toUpperCase()}${(last[1] ?? '').toLowerCase()}`
  if (twoLetters !== oneInitial && !taken.has(nameKey(twoLetters))) {
    return { name: twoLetters, needsReview: false, reason: null }
  }

  // Rule 3: same first AND last -> add the grade in parentheses.
  if (grade) {
    const withGrade = `${oneInitial} (${grade})`
    if (!taken.has(nameKey(withGrade))) return { name: withGrade, needsReview: false, reason: null }
  }

  return {
    name: oneInitial,
    needsReview: true,
    reason: 'same first and last name, and same grade — needs manual resolution',
  }
}

/**
 * Rule-3 names embed a grade, so they go stale every August when grades bump.
 * Returns the embedded grade when it no longer matches the student's.
 */
export function staleGradeInName(displayName, grade) {
  const match = /\((\w+)\)\s*$/.exec(normalize(displayName))
  if (!match) return null
  return String(grade ?? '') === match[1] ? null : match[1]
}
