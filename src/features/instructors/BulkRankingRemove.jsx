import { useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * The inverse of BulkRankingInsert, for the rename-instead-of-create mistake:
 * renaming an instructor record hands the "new" person every ranking the old
 * one had (93, the day this was built), with no way to clear them short of
 * opening 93 student drawers.
 *
 * Preview-first: nothing is written until the count is on screen and clicked.
 * The RPC removes and renumbers every affected list contiguously in ONE
 * transaction, and returns the removed (student, rank) pairs — which is what
 * makes Undo exact: each pair goes back at its original rank, shifting the
 * rest down, so every list is restored bit-for-bit.
 *
 * The undo lives in component state, so it survives exactly as long as the
 * panel stays open. That is the deal: this is an undo button, not a history.
 */
export default function BulkRankingRemove({ instructor, centerId, onDone }) {
  // idle -> counted (preview showing) -> done (undo available)
  const [preview, setPreview] = useState(null)
  const [undoState, setUndoState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function loadPreview() {
    setBusy(true)
    setError(null)
    setMessage(null)
    // Count only — the write happens in the RPC, atomically, on confirm.
    const { count, error } = await supabase
      .from('instructor_rankings')
      .select('id', { count: 'exact', head: true })
      .eq('instructor_id', instructor.id)
    setBusy(false)
    if (error) setError(error.message)
    else setPreview(count ?? 0)
  }

  async function commit() {
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('bulk_remove_ranking', {
      p_center_id: centerId,
      p_instructor_id: instructor.id,
    })
    setBusy(false)
    setPreview(null)
    if (error) {
      setError(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setUndoState(row?.removed ?? [])
    setMessage(
      row?.students_affected === 0
        ? 'Nothing to remove — no student ranks them.'
        : `Removed from ${row.students_affected} student ranking${row.students_affected === 1 ? '' : 's'}. Every list renumbered.`,
    )
    await onDone?.()
  }

  async function undo() {
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('bulk_restore_ranking', {
      p_instructor_id: instructor.id,
      p_entries: undoState,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setUndoState(null)
    setMessage(
      `Restored ${row?.students_restored ?? 0} ranking${row?.students_restored === 1 ? '' : 's'} at their original positions.`,
    )
    await onDone?.()
  }

  return (
    <section className="space-y-2 border-t border-zinc-200 pt-4">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Remove from all rankings
      </h3>
      <p className="text-[11px] leading-snug text-zinc-500">
        Removes {instructor.name} from every student's ranking and renumbers each list. For when a
        record was renamed instead of created and the new person inherited rankings that belong to
        nobody.
      </p>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">{message}</p>
      )}

      {preview === null ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPreview}
            disabled={busy}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
          >
            {busy ? 'Counting…' : 'Remove…'}
          </button>
          {undoState && (
            <button
              type="button"
              onClick={undo}
              disabled={busy}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
            >
              Undo — restore {undoState.length} ranking{undoState.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      ) : (
        // The preview IS the confirmation: the destructive button carries the
        // real number, inline, same as auto-assign's Clear all.
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={commit}
            disabled={busy || preview === 0}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {busy
              ? 'Removing…'
              : preview === 0
                ? 'No rankings to remove'
                : `Remove from ${preview} student ranking${preview === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={() => setPreview(null)}
            disabled={busy}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
        </div>
      )}

      {undoState && preview === null && (
        <p className="text-[11px] text-zinc-400">
          Undo restores every ranking at its original position. It lasts until this panel closes.
        </p>
      )}
    </section>
  )
}
