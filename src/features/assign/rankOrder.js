/**
 * The one placement rule every rankings editor shares. A ranking list is an
 * ORDERING, not a set of independent numbers: setting someone to rank N means
 * "insert at position N", everyone at or below shifts down one, and the list
 * always reads contiguously 1..N. Clearing closes the gap.
 *
 * The matrix used to write the single cell it was handed, which is how two
 * instructors ended up sharing rank 1 for the same student. Both the matrix
 * and the drawer now come through here, so the two editors cannot disagree.
 */

/**
 * entries: the student's current list, in display order (rank asc). Ranks may
 * arrive duplicated or gapped from bad old writes — the output is contiguous
 * regardless, so any edit also repairs the list it touches.
 *
 * rank: 1-based target position, clamped into the list; null removes.
 * Returns [{instructorId, rank}] renumbered 1..N.
 */
export function placeAtRank(entries, instructorId, rank) {
  const kept = entries.filter((e) => e.instructorId !== instructorId)
  if (rank !== null && rank !== undefined) {
    const index = Math.min(Math.max(1, Math.round(rank)), kept.length + 1) - 1
    kept.splice(index, 0, { instructorId })
  }
  return kept.map((e, i) => ({ instructorId: e.instructorId, rank: i + 1 }))
}
