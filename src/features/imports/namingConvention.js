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
 * A Radius FULL name, stripped to the parts that make a display name:
 * parenthetical nicknames and generational suffixes go. 'Royce (RJ) Barnes,
 * Jr.' -> 'Royce Barnes' — without this, the surname initial was taken from
 * the nickname and the display name came out as 'Royce ('.
 *
 * For FULL names only, never display names: rule-3 display names carry a
 * grade parenthetical ('Aryan P (2)') that must survive. The suffix strip
 * backs off when it would leave fewer than two words — a real surname that
 * happens to look like a suffix must not be eaten.
 */
export function cleanPersonName(fullName) {
  const noNickname = normalize(String(fullName ?? '').replace(/\([^)]*\)/g, ' '))
  const noSuffix = normalize(noNickname.replace(/,?\s+(jr|sr|ii|iii|iv|v)\.?$/i, ''))
  return noSuffix.split(' ').length >= 2 ? noSuffix : noNickname
}

/**
 * Radius hands over first names in whatever case the front desk typed —
 * 'LILY', 'himanshu' — and display names carried it verbatim. Title-cased per
 * hyphen-separated segment, with two deliberate exceptions:
 *   - short ALL-CAPS stays ('JJ' is initials, not shouting)
 *   - mixed case stays ('McKenna', 'DiFulgo' are deliberate)
 */
export function titleCaseName(name) {
  return String(name ?? '')
    .split(/([\s-])/)
    .map((seg) => {
      if (!/[a-zA-Z]/.test(seg)) return seg
      if (seg === seg.toLowerCase()) return seg[0].toUpperCase() + seg.slice(1)
      if (seg === seg.toUpperCase() && seg.length >= 3) {
        return seg[0] + seg.slice(1).toLowerCase()
      }
      return seg
    })
    .join('')
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
  const { first, last } = splitName(cleanPersonName(fullName))
  if (!first) return { name: '', needsReview: true, reason: 'no name in the file' }
  // The DISPLAY name gets title case ('LILY' -> 'Lily'); collision checks stay
  // on the raw value, which nameKey lowercases anyway.
  const displayFirst = titleCaseName(first)
  if (!last) {
    const solo = displayFirst
    return taken.has(nameKey(solo))
      ? { name: solo, needsReview: true, reason: 'name collides and the file has no last name' }
      : { name: solo, needsReview: false, reason: null }
  }

  const oneInitial = `${displayFirst} ${last[0].toUpperCase()}`

  // Rule 2 triggers on a shared FIRST NAME, not on a display-name collision:
  // 'Micah C' and 'Micah H' do not collide, but the convention still wants
  // 'Micah Ch' and 'Micah Ho' so the two are told apart at a glance.
  const firstNameShared =
    options.sharesFirstName ??
    takenNames.some((n) => splitName(n).first.toLowerCase() === first.toLowerCase())

  if (!firstNameShared && !taken.has(nameKey(oneInitial))) {
    return { name: oneInitial, needsReview: false, reason: null }
  }

  const twoLetters = `${displayFirst} ${last[0].toUpperCase()}${(last[1] ?? '').toLowerCase()}`
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
 * The shape a display name and the full name it came from have in common:
 * first name plus the last name's initial. 'Danielle S', 'Danielle Sh' and
 * 'Danielle Shaw' all reduce to `danielle|s`.
 *
 * This is how an importer recognises a student it already has. A display name
 * never carries the full last name, so an export's 'Danielle Shaw' can never
 * equal the stored 'Danielle S' — without this, every roster row without a
 * Radius account looks new and gets duplicated.
 *
 * Deliberately lossy: it is a candidate key, never proof. Callers must only
 * accept it when it picks out exactly one student on each side.
 */
export function displayNameShape(name) {
  // Drop the rule-3 grade parenthetical and any '#2' disambiguator so the
  // stored name and the raw file name reduce alike.
  const bare = normalize(name)
    .replace(/\((\w+)\)\s*$/, '')
    .replace(/#\d+\s*$/, '')
  const { first, last } = splitName(bare)
  if (!first || !last) return null
  return `${first.toLowerCase()}|${last[0].toLowerCase()}`
}

/**
 * A name nobody has. Radius carries training and template records — 'First
 * Last', 'Test Student' — and they arrive in the export looking like anyone
 * else. Flagged rather than dropped: the caller surfaces it for a person to
 * decide, the same way a suspicious Last-Modified-By is surfaced.
 */
const PLACEHOLDER_WORDS = new Set([
  'first', 'last', 'test', 'tester', 'testing', 'sample', 'demo', 'example',
  'student', 'name', 'unknown', 'none', 'na', 'placeholder', 'dummy', 'xxx',
])
/**
 * The stock names training records are filed under. These ARE names real
 * people have, so this list only ever withholds a row from CREATION and shows
 * it for review — an actual John Smith is one click away, whereas a template
 * record quietly added to the roster is a phantom student on the schedule.
 */
const PLACEHOLDER_FULL_NAMES = new Set([
  'john smith', 'jane smith', 'john doe', 'jane doe', 'joe bloggs', 'first last',
])

export function isPlaceholderName(fullName) {
  const cleaned = normalize(fullName).toLowerCase()
  if (PLACEHOLDER_FULL_NAMES.has(cleaned)) return true
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length === 0) return false
  // Every part has to be a filler word, so a real 'Grace First' is left alone.
  return parts.every((p) => PLACEHOLDER_WORDS.has(p.replace(/[^a-z]/g, '')))
}

/**
 * True when two first names are one typo apart — 'Charis'/'Chariss',
 * 'Hazik'/'Haziq'. Real cases from the Montgomeryville roster, where the
 * stored spelling was keyed by hand and the export's is Radius's.
 *
 * Used only to WARN. A one-letter difference is as likely to be two siblings
 * ('Alan'/'Alana') as a typo, so nothing is merged on this evidence.
 */
export function nearlySameFirstName(a, b) {
  const x = (a ?? '').toLowerCase()
  const y = (b ?? '').toLowerCase()
  if (!x || !y || x === y) return false
  if (Math.abs(x.length - y.length) > 1) return false
  if (x[0] !== y[0]) return false

  // One edit: substitution when the lengths match, otherwise insertion.
  if (x.length === y.length) {
    let diffs = 0
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) diffs += 1
    return diffs === 1
  }
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  let i = 0
  let j = 0
  let skipped = false
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1
      j += 1
    } else if (skipped) {
      return false
    } else {
      skipped = true
      j += 1
    }
  }
  return true
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
