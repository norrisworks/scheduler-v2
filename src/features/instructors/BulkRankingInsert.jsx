import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { LEVEL_OPTIONS } from '../roster/studentFields'

const POSITIONS = [
  { value: 'top', label: 'Top', hint: 'Rank 1, everyone else shifts down' },
  { value: 'middle', label: 'Middle', hint: 'Halfway down each list' },
  { value: 'bottom', label: 'Bottom', hint: 'After everyone already ranked' },
]

/**
 * A new instructor starts unranked for every student, which is exactly how v1
 * decayed. This drops them into every eligible student's list in one action.
 * Students who already rank them are untouched.
 */
export default function BulkRankingInsert({ instructor, centerId, onDone }) {
  const [position, setPosition] = useState('bottom')
  const [level, setLevel] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)

    const { data, error } = await supabase.rpc('bulk_insert_ranking', {
      p_center_id: centerId,
      p_instructor_id: instructor.id,
      p_position: position,
      p_level: level || null,
    })

    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setResult(row)
    await onDone?.()
  }

  return (
    <section className="space-y-2 border-t border-zinc-200 pt-4">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Add to student rankings
      </h3>
      <p className="text-[11px] leading-snug text-zinc-500">
        Inserts {instructor.name} into every eligible student's ranking. Students who already rank
        them are skipped, and levels they cannot teach are never touched.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Position</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          >
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Level</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="">All levels</option>
            {LEVEL_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
        >
          {busy ? 'Inserting…' : 'Insert'}
        </button>
      </div>

      <p className="text-[11px] text-zinc-400">
        {POSITIONS.find((p) => p.value === position)?.hint}
      </p>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {result && (
        <p className="rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
          {result.rows_written === 0
            ? 'Nothing to do — every eligible student already ranks them.'
            : `Added to ${result.students_affected} student ranking${result.students_affected === 1 ? '' : 's'}.`}
        </p>
      )}
    </section>
  )
}
