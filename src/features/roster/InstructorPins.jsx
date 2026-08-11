import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readableTextOn } from '../../lib/colors'
import { useCenter } from '../centers/CenterProvider'
import { capabilityString } from '../instructors/instructorFields'
import { isFallbackOnly } from '../assign/rankings'

/**
 * This student's rankings — the only thing auto-assign reads. Ranked
 * instructors are tried in rank order; an instructor with no rank here is
 * not a candidate at all, so clearing a rank IS how you rule someone out.
 */
export default function InstructorPins({ studentId }) {
  const { centerId } = useCenter()
  const [instructors, setInstructors] = useState([])
  const [ranks, setRanks] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    const [instRes, rankRes] = await Promise.all([
      supabase
        .from('instructors')
        .select('id, name, color, tier, assignability, can_teach_elementary, can_teach_middle, can_teach_high')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase.from('instructor_rankings').select('instructor_id, rank').eq('student_id', studentId),
    ])
    if (instRes.error || rankRes.error) {
      setError((instRes.error ?? rankRes.error).message)
    } else {
      setInstructors(instRes.data ?? [])
      setRanks(new Map((rankRes.data ?? []).map((p) => [p.instructor_id, p.rank])))
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, centerId])

  async function setRank(instructorId, rank) {
    setSaving(true)
    setError(null)
    const { error } =
      rank === null
        ? await supabase
            .from('instructor_rankings')
            .delete()
            .eq('student_id', studentId)
            .eq('instructor_id', instructorId)
        : await supabase.from('instructor_rankings').upsert(
            {
              student_id: studentId,
              instructor_id: instructorId,
              rank,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'student_id,instructor_id' },
          )
    if (error) setError(error.message)
    else await load()
    setSaving(false)
  }

  if (loading) return <p className="py-3 text-center text-xs text-zinc-400">Loading instructors…</p>

  const rankedCount = [...ranks.values()].filter((r) => r >= 1).length
  const ordered = [...instructors].sort((a, b) => {
    const ra = ranks.get(a.id) ?? Infinity
    const rb = ranks.get(b.id) ?? Infinity
    return ra - rb || a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-zinc-500">
        Auto-assign uses these rankings and nothing else. Instructors are tried in rank order;
        anyone left blank is not a candidate.
      </p>

      {rankedCount === 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          This student has no rankings, so auto-assign cannot place them.
        </p>
      )}

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      <ul className="space-y-1">
        {ordered.map((instructor) => {
          const rank = ranks.get(instructor.id)
          const isRanked = typeof rank === 'number' && rank >= 1

          return (
            <li
              key={instructor.id}
              className={
                'flex items-center gap-2 rounded-lg border px-2 py-1.5 ' +
                (isRanked ? 'border-brand-200 bg-brand-50' : 'border-zinc-200 bg-white')
              }
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-800">{instructor.name}</span>
                <span className="block text-[10px] text-zinc-400">
                  {capabilityString(instructor) || 'no levels'} · {instructor.tier}
                  {isFallbackOnly(instructor) ? ' · fallback only' : ''}
                </span>
              </span>

              <input
                type="number"
                min="1"
                step="1"
                value={isRanked ? rank : ''}
                disabled={saving}
                placeholder="—"
                aria-label={`Rank for ${instructor.name}`}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  const n = Number(v)
                  setRank(instructor.id, v === '' ? null : Number.isFinite(n) && n >= 1 ? n : null)
                }}
                className="w-14 shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-center text-xs text-zinc-800"
              />
            </li>
          )
        })}
      </ul>

      {instructors.some(isFallbackOnly) && (
        <p className="text-[11px] leading-snug text-zinc-400">
          Fallback-only instructors are tried in the final phase, and only if ranked here.
        </p>
      )}
    </div>
  )
}
