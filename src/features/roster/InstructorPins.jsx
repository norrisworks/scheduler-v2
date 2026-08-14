import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readableTextOn } from '../../lib/colors'
import { useCenter } from '../centers/CenterProvider'
import { capabilityString } from '../instructors/instructorFields'
import { isFallbackOnly } from '../assign/rankings'
import {
  ineligibleForStudentReason,
  moveEntry,
  proposalReasons,
  proposeRanking,
} from '../assign/proposeRanking'
import { genderLabel } from '../../lib/gender'

/**
 * This student's rankings — the only thing auto-assign reads. Ranked
 * instructors are tried in rank order; an instructor with no rank here is not
 * a candidate at all, so removing someone IS how you rule them out.
 *
 * The order is editable here, at any time, on any student: drag a row, type a
 * number, add anyone eligible, remove anyone. Seeding is a starting point, not
 * the only moment the list can be built.
 */
export default function InstructorPins({ studentId, student }) {
  const { centerId } = useCenter()
  const [instructors, setInstructors] = useState([])
  const [ranked, setRanked] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dragIndex, setDragIndex] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = async () => {
    const [instRes, rankRes] = await Promise.all([
      supabase
        .from('instructors')
        .select(
          'id, name, color, tier, gender, assignability, active, can_teach_elementary, can_teach_middle, can_teach_high',
        )
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('instructor_rankings')
        .select('instructor_id, rank')
        .eq('student_id', studentId)
        .order('rank'),
    ])
    if (instRes.error || rankRes.error) {
      setError((instRes.error ?? rankRes.error).message)
    } else {
      const byId = new Map((instRes.data ?? []).map((i) => [i.id, i]))
      setInstructors(instRes.data ?? [])
      setRanked(
        (rankRes.data ?? [])
          .map((r) => byId.get(r.instructor_id))
          .filter(Boolean),
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, centerId])

  /**
   * Writes the list as it now stands: every remaining row renumbered 1..N, and
   * anyone dropped deleted outright. Renumbering on every change is what keeps
   * the ranks contiguous no matter how the list was edited.
   */
  async function persist(next) {
    const previous = ranked
    setRanked(next)
    setSaving(true)
    setError(null)

    const nextIds = new Set(next.map((i) => i.id))
    const removed = previous.filter((i) => !nextIds.has(i.id)).map((i) => i.id)

    const writes = []
    if (next.length > 0) {
      writes.push(
        supabase.from('instructor_rankings').upsert(
          next.map((instructor, index) => ({
            student_id: studentId,
            instructor_id: instructor.id,
            rank: index + 1,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'student_id,instructor_id' },
        ),
      )
    }
    if (removed.length > 0) {
      writes.push(
        supabase
          .from('instructor_rankings')
          .delete()
          .eq('student_id', studentId)
          .in('instructor_id', removed),
      )
    }

    const results = await Promise.all(writes)
    const failure = results.find((r) => r.error)
    setSaving(false)
    if (failure) {
      setError(failure.error.message)
      setRanked(previous)
    }
  }

  const rankedIds = useMemo(() => new Set(ranked.map((i) => i.id)), [ranked])
  const rest = instructors.filter((i) => !rankedIds.has(i.id))
  const addable = rest.filter((i) => !ineligibleForStudentReason(student, i))
  const blocked = rest.filter((i) => ineligibleForStudentReason(student, i))

  if (loading) return <p className="py-3 text-center text-xs text-zinc-400">Loading instructors…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] leading-snug text-zinc-500">
          Auto-assign uses this list and nothing else, in this order. Drag to reorder.
        </p>
        {saving && <span className="text-[10px] text-zinc-400">Saving…</span>}
        <button
          type="button"
          disabled={saving}
          onClick={() => persist(proposeRanking(student, instructors).map((e) => e.instructor))}
          className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
          title="Rank every instructor who can teach this student, ordered by tier then same gender"
        >
          {ranked.length === 0 ? 'Rank everyone' : 'Re-propose order'}
        </button>
      </div>

      {ranked.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          No rankings, so auto-assign cannot place this student.
        </p>
      )}

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      <ol className="space-y-1">
        {ranked.map((instructor, index) => (
          <li
            key={instructor.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) {
                persist(moveEntry(ranked, dragIndex, index))
              }
              setDragIndex(null)
            }}
            onDragEnd={() => setDragIndex(null)}
            className={
              'flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 active:cursor-grabbing ' +
              (dragIndex === index ? 'border-brand-400 bg-brand-100' : 'border-brand-200 bg-brand-50')
            }
          >
            <span aria-hidden className="shrink-0 text-xs text-zinc-300">⋮⋮</span>
            <input
              type="number"
              min="1"
              step="1"
              value={index + 1}
              disabled={saving}
              aria-label={`Rank for ${instructor.name}`}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n) || n < 1) return
                persist(moveEntry(ranked, index, Math.min(n, ranked.length) - 1))
              }}
              className="w-11 shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-center text-xs tabular-nums"
            />
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold"
              style={{ backgroundColor: instructor.color, color: readableTextOn(instructor.color) }}
            >
              {instructor.name.trim()[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-zinc-800">{instructor.name}</span>
              <span className="block text-[10px] text-zinc-400">
                {capabilityString(instructor) || 'no levels'} · {instructor.tier} ·{' '}
                {genderLabel(instructor.gender)}
                {isFallbackOnly(instructor) ? ' · fallback only' : ''}
              </span>
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => persist(ranked.filter((i) => i.id !== instructor.id))}
              aria-label={`Remove ${instructor.name}`}
              title="Remove from this student's rankings"
              className="shrink-0 rounded px-1 text-sm text-zinc-400 hover:bg-red-100 hover:text-red-700"
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      {addable.length > 0 &&
        (adding ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-1.5">
            <p className="px-1 pb-1 text-[10px] font-medium text-zinc-500">
              Adds to the end of the list — drag it where it belongs.
            </p>
            <ul className="max-h-44 space-y-0.5 overflow-auto">
              {addable.map((instructor) => (
                <li key={instructor.id}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      persist([...ranked, instructor])
                      setAdding(false)
                    }}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                      style={{
                        backgroundColor: instructor.color,
                        color: readableTextOn(instructor.color),
                      }}
                    >
                      {instructor.name.trim()[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                      {instructor.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">
                      {proposalReasons(student, instructor).join(' · ') || instructor.tier}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-1 w-full rounded px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50"
          >
            + Add an instructor ({addable.length} available)
          </button>
        ))}

      {blocked.length > 0 && (
        <p className="text-[11px] leading-snug text-zinc-400">
          {/* Named explicitly: a greyed-out instructor is a capability gap, and
              at MV that correlates with gender by coincidence, not by rule. */}
          Not rankable for {student?.level ?? 'this level'} —{' '}
          {blocked.map((i) => i.name).join(', ')}. That is level capability, not gender; tick the
          level on their instructor record to make them rankable.
        </p>
      )}

      {ranked.some(isFallbackOnly) && (
        <p className="text-[11px] leading-snug text-zinc-400">
          Fallback-only instructors are tried in the final phase, and only if ranked here.
        </p>
      )}
    </div>
  )
}
