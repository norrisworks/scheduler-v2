/**
 * The three instructor_rank algorithm changes, individually toggleable.
 *
 * ALL THREE OFF reproduces the pre-instructor-rank behavior exactly — the
 * check suite proves it by running the algorithms with a rank sequence
 * supplied and flags off, asserting the output is identical to running with
 * no rank sequence at all. Tag `pre-instructor-rank-20260816` marks the
 * commit with none of this code, for a full return.
 *
 * instructor_rankings (the per-student lists) remains the PRIMARY input to
 * auto-assign in every configuration. instructor_rank only ever affects
 * tie-breaks, cap-4 eligibility, and the new-student preference below.
 */

/**
 * A: when two candidates tie on student-ranking, concurrent load AND day
 * total, break the tie by instructor_rank instead of arbitrary row order.
 * Fires only on exact ties, so match quality is never traded away.
 */
export const RANK_TIEBREAK = false

/**
 * B: phase 2's cap raise (3 -> 4) is EARNED — only the top CAP_RELAX_TOP_N
 * instructors by instructor_rank may hold four students at once; everyone
 * else stays capped at 3 in every phase.
 */
export const RANK_GATED_CAP = false
export const CAP_RELAX_TOP_N = 6

/**
 * C: a student whose enrollment_start_date is within NEW_STUDENT_WINDOW_DAYS
 * is "new". Among candidates whose student-ranking is within
 * NEW_STUDENT_RANK_MARGIN of the best available, prefer a top
 * NEW_STUDENT_TOP_N instructor by instructor_rank. An explicit rank-1 is
 * never overridden by more than that margin, by construction.
 */
export const NEW_STUDENT_PREFERENCE = false
export const NEW_STUDENT_WINDOW_DAYS = 45
export const NEW_STUDENT_TOP_N = 5
export const NEW_STUDENT_RANK_MARGIN = 1
