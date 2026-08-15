import { supabase } from '../../lib/supabase'

/**
 * Tier is the owner's private evaluation of staff, and the database enforces
 * that: instructors.tier is column-revoked from every client, so any select
 * naming it — or `select('*')` — fails outright. Everything tier-related goes
 * through here instead.
 *
 *   reads   — the instructor_tiers view: full rows for admin JWTs, ZERO rows
 *             for instructor JWTs. Merging an empty map is a no-op, so the
 *             same code path is safe for both roles.
 *   writes  — the set_instructor_tier RPC, which rejects instructor JWTs.
 *   ordering— the proposed_instructor_order RPC, which lets tier shape a
 *             proposal without the value ever leaving the database.
 */

/** Every instructors column a client may select — i.e. all of them but tier. */
export const INSTRUCTOR_COLUMNS =
  'id, center_id, name, color, workstream_id, email, gender, ' +
  'can_teach_elementary, can_teach_middle, can_teach_high, active, created_at, assignability'

/** instructor_id -> tier. Empty for instructor-role sessions, by design. */
export async function loadTiers() {
  const { data, error } = await supabase.from('instructor_tiers').select('instructor_id, tier')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((row) => [row.instructor_id, row.tier]))
}

export function mergeTiers(instructors, tiers) {
  return instructors.map((i) => {
    const tier = tiers.get(i.id)
    return tier ? { ...i, tier } : i
  })
}

export async function saveTier(instructorId, tier) {
  const { error } = await supabase.rpc('set_instructor_tier', {
    p_instructor_id: instructorId,
    p_tier: tier,
  })
  return { error }
}

/** Pulls tier out of a form patch so the caller can route it to the RPC. */
export function splitTierPatch(patch) {
  const { tier, ...rest } = patch
  return { tier: tier ?? null, rest }
}

/**
 * Server-ordered proposal for one student. Returns the center's eligible
 * instructors as [{instructorId, sameGender, fallbackOnly}] in final order —
 * tier-first, then same gender, then name — computed where tier is readable.
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
