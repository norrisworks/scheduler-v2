import { timeToMinutes } from '../../lib/dates'
import { isFallbackOnly } from './rankings'
import {
  RANK_TIEBREAK,
  RANK_GATED_CAP,
  CAP_RELAX_TOP_N,
  NEW_STUDENT_PREFERENCE,
  NEW_STUDENT_TOP_N,
  NEW_STUDENT_RANK_MARGIN,
} from './algorithmFlags'

/**
 * Ported verbatim from v1 (v1_reference algo_helpers / algo_balanced /
 * algo_bestmatch). instructor_rankings (the per-student lists) is the SOLE
 * primary input: candidates and their order come from it and nothing else.
 *
 * The optional instructor_rank additions (see algorithmFlags.js) only touch
 * tie-breaks, cap-4 eligibility, and the new-student preference. With every
 * flag off, `rankSeq` and `newStudentIds` are never read and the behavior is
 * exactly the pre-instructor-rank algorithm — the check suite proves it.
 */

export const CAP_NORMAL = 3
export const CAP_STRETCH = 4
export const MAX_RANK = 10

const DEFAULT_FLAGS = {
  tiebreak: RANK_TIEBREAK,
  gatedCap: RANK_GATED_CAP,
  newPref: NEW_STUDENT_PREFERENCE,
}

/** Position in the center's instructor_rank order, or "unranked = last". */
const seqOf = (rankSeq, instructorId) => rankSeq?.get(instructorId) ?? Number.MAX_SAFE_INTEGER

/** v1 getSessionTimeSlots: 30-min slots covering [start, start + duration). */
export function sessionTimeSlots(session) {
  const slots = []
  const start = timeToMinutes(session.start_time)
  const end = start + (session.duration ?? 60)
  for (let m = start; m < end; m += 30) {
    const h = Math.floor(m / 60)
    const mins = m % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`)
  }
  return slots
}

function buildHelpers(sessions, assignmentOf, { flags, rankSeq } = {}) {
  const slotsBySession = new Map(sessions.map((s) => [s.id, sessionTimeSlots(s)]))

  const getLoadAtSlot = (instructorId, slot) => {
    let load = 0
    for (const s of sessions) {
      if (assignmentOf.get(s.id) === instructorId && slotsBySession.get(s.id).includes(slot)) {
        load++
      }
    }
    return load
  }

  // Flag B: the cap-4 stretch is EARNED. Anyone outside the top
  // CAP_RELAX_TOP_N by instructor_rank keeps the normal cap in every phase.
  const capFor = (instructorId, cap) => {
    if (!flags?.gatedCap) return cap
    if (cap <= CAP_NORMAL) return cap
    return seqOf(rankSeq, instructorId) <= CAP_RELAX_TOP_N ? cap : CAP_NORMAL
  }

  const canAssign = (instructorId, session, cap) => {
    const limit = capFor(instructorId, cap)
    for (const slot of slotsBySession.get(session.id)) {
      if (getLoadAtSlot(instructorId, slot) >= limit) return false
    }
    return true
  }

  const maxLoadDuringSession = (instructorId, session) => {
    let max = 0
    for (const slot of slotsBySession.get(session.id)) {
      const load = getLoadAtSlot(instructorId, slot)
      if (load > max) max = load
    }
    return max
  }

  return { canAssign, maxLoadDuringSession }
}

function splitByLastResort(instructors) {
  return {
    regular: instructors.filter((i) => !isFallbackOnly(i)),
    lastResort: instructors.filter((i) => isFallbackOnly(i)),
  }
}

/**
 * ALGORITHM C-FIXED: BALANCED. Scarcity-first — each iteration assigns the
 * student with the FEWEST viable options. Best rank wins, tie-break on lowest
 * peak load. Phases: regular cap 3 -> regular cap 4 -> last-resort cap 4.
 * No unranked fallback.
 */
export function autoAssignBalanced({
  sessions,
  unassigned,
  instructors,
  rankIndex,
  existing,
  rankSeq,
  newStudentIds,
  flags = DEFAULT_FLAGS,
}) {
  const assignmentOf = new Map(existing)
  const { canAssign, maxLoadDuringSession } = buildHelpers(sessions, assignmentOf, { flags, rankSeq })
  const { regular, lastResort } = splitByLastResort(instructors)

  const rankOf = (session, instructorId) => rankIndex.get(session.id)?.get(instructorId) ?? null

  // v1 tie-broke on concurrent load alone, which equalises how busy someone is
  // at a moment but says nothing about their day. Over a full afternoon that
  // let the longest-shift instructor accumulate three times another's total.
  // Day total is a third-level tie-break: rank still wins, then peak load.
  const dayTotal = (instructorId) => {
    let n = 0
    for (const [, iid] of assignmentOf) if (iid === instructorId) n++
    return n
  }

  const findOptions = (session, instList, cap) => {
    const out = []
    for (const inst of instList) {
      const r = rankOf(session, inst.id)
      if (r === null) continue
      if (!canAssign(inst.id, session, cap)) continue
      out.push({
        rank: r,
        load: maxLoadDuringSession(inst.id, session),
        total: dayTotal(inst.id),
        iid: inst.id,
      })
    }
    return out
  }

  // Flag A: after student-ranking, load and day total all tie, break by
  // instructor_rank instead of arbitrary row order. Fires only on exact ties.
  const compare = (a, b) =>
    a.rank - b.rank ||
    a.load - b.load ||
    a.total - b.total ||
    (flags.tiebreak ? seqOf(rankSeq, a.iid) - seqOf(rankSeq, b.iid) : 0)

  const pickBest = (opts, session) => {
    opts.sort(compare)
    const best = opts[0]

    // Flag C: a NEW student prefers a top-ranked instructor when one is
    // within NEW_STUDENT_RANK_MARGIN of the best available student-ranking.
    // The margin bound means an explicit rank-1 can never be overridden by
    // more than that margin, by construction.
    if (flags.newPref && newStudentIds?.has(session.student_id)) {
      const pool = opts.filter(
        (o) =>
          o.rank <= best.rank + NEW_STUDENT_RANK_MARGIN &&
          seqOf(rankSeq, o.iid) <= NEW_STUDENT_TOP_N,
      )
      if (pool.length > 0) return pool[0]
    }
    return best
  }

  let remaining = [...unassigned]
  const made = []

  const phase = (instList, cap) => {
    while (remaining.length > 0) {
      const cands = []
      for (const session of remaining) {
        const opts = findOptions(session, instList, cap)
        if (opts.length > 0) cands.push({ session, opts, count: opts.length })
      }
      if (cands.length === 0) break
      cands.sort((a, b) => a.count - b.count)
      const winner = cands[0]
      const best = pickBest(winner.opts, winner.session)
      assignmentOf.set(winner.session.id, best.iid)
      made.push({ sessionId: winner.session.id, instructorId: best.iid, rank: best.rank })
      remaining = remaining.filter((s) => s.id !== winner.session.id)
    }
  }

  phase(regular, CAP_NORMAL)
  phase(regular, CAP_STRETCH)
  phase(lastResort, CAP_STRETCH)

  return summarise(made, remaining)
}

/**
 * ALGORITHM D: BEST MATCH. Tier-by-tier round-robin — rank 1 is processed
 * fully, then rank 2, and so on. Within a tier instructors take turns, each
 * picking their most-constrained matching student (fewest ranked options).
 * Phases: regular cap 3 -> regular cap 4 -> last-resort cap 4.
 */
export function autoAssignBestMatch({
  sessions,
  unassigned,
  instructors,
  rankIndex,
  existing,
  rankSeq,
  flags = DEFAULT_FLAGS,
}) {
  const assignmentOf = new Map(existing)
  const { canAssign } = buildHelpers(sessions, assignmentOf, { flags, rankSeq })
  // Flag A's analog here: within a rank tier instructors take turns in list
  // order, which was arbitrary (name order). With the tie-break on, the
  // turn order becomes instructor_rank.
  const orderedInstructors = flags.tiebreak
    ? [...instructors].sort((a, b) => seqOf(rankSeq, a.id) - seqOf(rankSeq, b.id))
    : instructors
  const { regular, lastResort } = splitByLastResort(orderedInstructors)

  const rankOf = (session, instructorId) => rankIndex.get(session.id)?.get(instructorId) ?? null
  const optionCount = (session, instList) =>
    instList.filter((i) => rankOf(session, i.id) !== null).length

  let remaining = [...unassigned]
  const made = []

  const runPhase = (instList, cap, maxRank = MAX_RANK) => {
    for (let rank = 1; rank <= maxRank; rank++) {
      let madeProgress = true
      while (madeProgress) {
        madeProgress = false
        for (const inst of instList) {
          const candidates = remaining.filter((s) => {
            if (rankOf(s, inst.id) !== rank) return false
            if (!canAssign(inst.id, s, cap)) return false
            return true
          })
          if (candidates.length === 0) continue
          candidates.sort((a, b) => optionCount(a, instList) - optionCount(b, instList))
          const pick = candidates[0]
          assignmentOf.set(pick.id, inst.id)
          made.push({ sessionId: pick.id, instructorId: inst.id, rank })
          remaining = remaining.filter((s) => s.id !== pick.id)
          madeProgress = true
        }
      }
    }
  }

  runPhase(regular, CAP_NORMAL)
  runPhase(regular, CAP_STRETCH)
  runPhase(lastResort, CAP_STRETCH)

  return summarise(made, remaining)
}

function summarise(made, remaining) {
  return {
    made,
    unassignable: remaining,
    assigned: made.length,
    worstRank: made.reduce((worst, m) => Math.max(worst, m.rank), 0),
    couldNotAssign: remaining.length,
  }
}

/** v1's post-run alert (v1_reference visual_constants), verbatim. */
export function summaryMessage(result) {
  if (!result) return ''
  const base = `Assigned ${result.assigned} students! Worst match rank: ${result.worstRank}`
  return result.couldNotAssign > 0
    ? `${base} (${result.couldNotAssign} could not be assigned)`
    : base
}

export const ALGORITHMS = [
  { key: 'balanced', label: 'Balanced', run: autoAssignBalanced,
    hint: 'Scarcity-first: the most-constrained student is placed first each round.' },
  { key: 'bestmatch', label: 'Best match', run: autoAssignBestMatch,
    hint: 'Tier-by-tier: every rank-1 match is placed before any rank-2 match.' },
]
