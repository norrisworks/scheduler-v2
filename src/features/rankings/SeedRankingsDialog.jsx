import { useEffect, useMemo, useState } from 'react'
import { readableTextOn } from '../../lib/colors'
import { moveEntry, proposeRanking, renumber } from '../assign/proposeRanking'
import { genderLabel } from '../../lib/gender'

/**
 * Proposes a starting ranking list and shows exactly what it would write
 * before writing anything. The order is editable — drag a row or type a
 * number — and every position shows why it is there.
 */
export default function SeedRankingsDialog({ student, instructors, onClose, onSave }) {
  const [useGender, setUseGender] = useState(true)
  const [useRank, setUseRank] = useState(true)
  const [entries, setEntries] = useState([])
  const [dragIndex, setDragIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  const proposed = useMemo(
    () => proposeRanking(student, instructors, { useGender, useRank }),
    [student, instructors, useGender, useRank],
  )

  // Recompute while untouched; once reordered by hand, the list is yours.
  useEffect(() => {
    if (!touched) setEntries(proposed)
  }, [proposed, touched])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    await onSave(renumber(entries))
    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Seed rankings for ${student.name}`}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-200 bg-white shadow-xl"
      >
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Proposed rankings — {student.name}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {student.level ?? 'no level set'}
            {student.gender ? ` · ${genderLabel(student.gender)}` : ' · no gender set'} · nothing
            is written until you save.
          </p>
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
          <span className="text-[11px] font-medium text-zinc-500">Sort by</span>
          <Toggle label="Instructor rank" checked={useRank} onChange={(v) => { setUseRank(v); setTouched(false) }} />
          <Toggle
            label="Same gender"
            checked={useGender}
            onChange={(v) => { setUseGender(v); setTouched(false) }}
          />
          {touched && (
            <button
              type="button"
              onClick={() => setTouched(false)}
              className="ml-auto text-[11px] font-medium text-brand-600 underline"
            >
              Reset order
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">
              No instructor at this center can teach {student.level ?? 'this level'}.
            </p>
          ) : (
            <ol className="space-y-1">
              {entries.map((entry, index) => (
                <li
                  key={entry.instructorId}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) {
                      setEntries((prev) => moveEntry(prev, dragIndex, index))
                      setTouched(true)
                    }
                    setDragIndex(null)
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={
                    'flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 active:cursor-grabbing ' +
                    (dragIndex === index ? 'border-brand-400 bg-brand-50' : 'border-zinc-200 bg-white')
                  }
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={entry.rank}
                    aria-label={`Rank for ${entry.instructor.name}`}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n) || n < 1) return
                      setEntries((prev) => moveEntry(prev, index, Math.min(n, prev.length) - 1))
                      setTouched(true)
                    }}
                    className="w-9 shrink-0 rounded border border-zinc-300 py-0.5 text-center text-xs tabular-nums"
                  />
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: entry.instructor.color,
                      color: readableTextOn(entry.instructor.color),
                    }}
                  >
                    {entry.instructor.name.trim()[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-800">
                      {entry.instructor.name}
                    </span>
                    {entry.reasons.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {entry.reasons.map((r) => (
                          <span
                            key={r}
                            className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-600"
                          >
                            {r}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="shrink-0 text-xs text-zinc-300">⋮⋮</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3">
          <span className="flex-1 text-[11px] text-zinc-500">
            Will write {entries.length} ranking{entries.length === 1 ? '' : 's'}.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || entries.length === 0}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save rankings'}
          </button>
        </div>
      </div>
    </>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 accent-brand-500"
      />
      {label}
    </label>
  )
}
