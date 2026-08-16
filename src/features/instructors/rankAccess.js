import { supabase } from '../../lib/supabase'

/**
 * instructor_rank is the owner's private ordinal ranking of staff (1 = best,
 * unique per center), inheriting tier's confidentiality exactly: the column
 * carries no client grant, so any select naming it fails for every role.
 *
 *   reads    — the instructor_ranks view: full rows for admin JWTs, ZERO
 *              rows for instructor JWTs. Merging an empty map is a no-op,
 *              so one code path serves both roles.
 *   writes   — set_instructor_rank_order, which takes the center's COMPLETE
 *              order and renumbers 1..N; rejected for instructor JWTs.
 *   ordering — proposed_instructor_order (proposals) and
 *              instructor_rank_sequence (algorithms): both expose only the
 *              resulting sequence, never a payload a client can query.
 */

/** Every instructors column a client may select — all of them but the private ones. */
export const INSTRUCTOR_COLUMNS =
  'id, center_id, name, color, workstream_id, email, gender, ' +
  'can_teach_elementary, can_teach_middle, can_teach_high, active, created_at, assignability'

/** instructor_id -> instructor_rank. Empty for instructor-role sessions, by design. */
export async function loadRanks() {
  const { data, error } = await supabase
    .from('instructor_ranks')
    .select('instructor_id, instructor_rank')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((row) => [row.instructor_id, row.instructor_rank]))
}

export function mergeRanks(instructors, ranks) {
  return instructors.map((i) => {
    const rank = ranks.get(i.id)
    return rank ? { ...i, instructor_rank: rank } : i
  })
}

/** Writes the whole center's order, 1..N in array position. Admin-only. */
export async function saveRankOrder(centerId, orderedInstructorIds) {
  const { error } = await supabase.rpc('set_instructor_rank_order', {
    p_center_id: centerId,
    p_instructor_ids: orderedInstructorIds,
  })
  return { error }
}

/**
 * Server-ordered proposal for one student: instructor_rank first, then same
 * gender, then name, fallback-only last. Only the sequence leaves the
 * database.
 */
export async function fetchProposedOrder(centerId, student) {
  const { data, error } = await supabase.rpc('proposed_instructor_order', {
    p_center_id: centerId,
    p_level: student?.level ?? null,
    p_gender: student?.gender ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    instructorId: row.instructor_id,
    sameGender: row.same_gender,
    fallbackOnly: row.fallback_only,
  }))
}

/**
 * instructor_id -> position in the center's rank order (1 = best), active
 * instructors only. Available to every role — it is how the auto-assign
 * tie-breaks see the ORDER without any role reading the column.
 */
export async function fetchRankSequence(centerId) {
  const { data, error } = await supabase.rpc('instructor_rank_sequence', {
    p_center_id: centerId,
  })
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((row) => [row.instructor_id, row.seq]))
}
