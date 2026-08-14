/**
 * Gender, in one place because two tables carry it and both are now guarded by
 * a CHECK constraint that accepts only 'male' and 'female'. The app used to
 * write 'm' and 'f', which the database rejects outright — every value that
 * reaches Postgres has to come from here.
 *
 * Stored long, displayed short: 'M' and 'F' are what fit a matrix column
 * header and a roster chip.
 */
export const GENDERS = [
  { value: 'female', label: 'F', long: 'Female' },
  { value: 'male', label: 'M', long: 'Male' },
]

export const GENDER_OPTIONS = [{ value: '', label: 'Not set' }, ...GENDERS]

const BY_VALUE = new Map(GENDERS.map((g) => [g.value, g]))

/** 'F' / 'M' for the compact places, or a dash when unset. */
export function genderLabel(value, fallback = '–') {
  return BY_VALUE.get(value)?.label ?? fallback
}

/** 'Female' / 'Male' where there is room to spell it. */
export function genderLong(value, fallback = 'not set') {
  return BY_VALUE.get(value)?.long ?? fallback
}

/**
 * Anything a file or an old row might carry, mapped onto the two allowed
 * values. Accepts the legacy 'm'/'f' so a re-import of an older export does
 * not fail, and returns null for everything else rather than guessing.
 */
export function normalizeGender(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return null
  if (v.startsWith('f') || v === 'girl' || v === 'w') return 'female'
  if (v.startsWith('m') || v === 'boy') return 'male'
  return null
}

/** True when both sides are set and equal. Used to ORDER proposals, never to filter. */
export function sameGender(a, b) {
  const x = normalizeGender(a?.gender)
  const y = normalizeGender(b?.gender)
  return Boolean(x && y && x === y)
}
