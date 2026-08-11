import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readableTextOn } from '../../lib/colors'
import { useCenter } from '../centers/CenterProvider'
import { BLOCK_RANK, isBlockingPin } from '../assign/scoring'
import { capabilityString } from '../instructors/instructorFields'

/**
 * Exceptions only. Auto-assign scores every pair by default, so this list is
 * for the two cases scoring can't know: pin an instructor this student should
 * get, or block one they shouldn't. Everything unpinned is still considered.
 */
export default function InstructorPins({ studentId }) {
  const { centerId } = useCenter()
  const [instructors, setInstructors] = useState([])
  const [pins, setPins] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    const [instRes, pinRes] = await Promise.all([
      supabase
        .from('instructors')
        .select('id, name, color, last_resort, can_teach_elementary, can_teach_middle, can_teach_high')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase.from('instructor_rankings').select('instructor_id, rank').eq('student_id', studentId),
    ])
    if (instRes.error || pinRes.error) {
      setError((instRes.error ?? pinRes.error).message)
    } else {
      setInstructors(instRes.data ?? [])
      setPins(new Map((pinRes.data ?? []).map((p) => [p.instructor_id, p.rank])))
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, centerId])

  async function setPin(instructorId, rank) {
    setSaving(true)
    setError(null)
    const { error } =
      rank === null
        ? await supabase
            .from('instructor_rankings')
            .delete()
            .eq('student_id', studentId)
            .eq('instructor_id', instructorId)
        : await supabase
            .from('instructor_rankings')
            .upsert(
              { student_id: studentId, instructor_id: instructorId, rank, updated_at: new Date().toISOString() },
              { onConflict: 'student_id,instructor_id' },
            )
    if (error) setError(error.message)
    else await load()
    setSaving(false)
  }

  if (loading) return <p className="py-3 text-center text-xs text-zinc-400">Loading instructors…</p>

  const pinned = instructors.filter((i) => pins.has(i.id))

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-zinc-500">
        Auto-assign already scores every instructor. Pin one to force them to the front, or block
        one to rule them out. {pinned.length === 0 ? 'Nothing is pinned — scoring decides.' : null}
      </p>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      <ul className="space-y-1">
        {instructors.map((instructor) => {
          const rank = pins.get(instructor.id)
          const blocked = isBlockingPin(rank)
          const isPinned = typeof rank === 'number' && !blocked

          return (
            <li
              key={instructor.id}
              className={
                'flex items-center gap-2 rounded-lg border px-2 py-1.5 ' +
                (blocked
                  ? 'border-red-200 bg-red-50'
                  : isPinned
                    ? 'border-brand-200 bg-brand-50'
                    : 'border-zinc-200 bg-white')
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
                <span className={'block truncate text-sm ' + (blocked ? 'text-red-800 line-through' : 'text-zinc-800')}>
                  {instructor.name}
                </span>
                <span className="block text-[10px] text-zinc-400">
                  {capabilityString(instructor) || 'no levels'}
                  {instructor.last_resort ? ' · last resort' : ''}
                </span>
              </span>

              <select
                value={blocked ? 'block' : isPinned ? String(rank) : ''}
                disabled={saving}
                onChange={(e) => {
                  const v = e.target.value
                  setPin(instructor.id, v === '' ? null : v === 'block' ? BLOCK_RANK : Number(v))
                }}
                aria-label={`Pin for ${instructor.name}`}
                className="shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700"
              >
                <option value="">Auto</option>
                <option value="1">Pin 1st</option>
                <option value="2">Pin 2nd</option>
                <option value="3">Pin 3rd</option>
                <option value="block">Block</option>
              </select>
            </li>
          )
        })}
      </ul>

      {instructors.some((i) => i.last_resort) && (
        <p className="text-[11px] leading-snug text-zinc-400">
          Last-resort instructors are only ever used for this student if pinned here.
        </p>
      )}
    </div>
  )
}
