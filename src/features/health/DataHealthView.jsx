import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import Spinner from '../../components/Spinner'
import Modal from '../../components/Modal'
import StudentDrawer from '../roster/StudentDrawer'
import InstructorForm from '../instructors/InstructorForm'
import { useDataHealth } from './useDataHealth'

const SEVERITY = {
  blocking: { label: 'Blocking', chip: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
  high: { label: 'High', chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  medium: { label: 'Medium', chip: 'bg-yellow-100 text-yellow-800', bar: 'bg-yellow-400' },
  low: { label: 'Low', chip: 'bg-zinc-200 text-zinc-700', bar: 'bg-zinc-400' },
}

export default function DataHealthView() {
  const { center, centerId } = useCenter()
  const { isAdmin } = useAuth()
  const { checks, students, instructors, loading, error, refetch, patchInstructor } =
    useDataHealth(centerId)
  const [open, setOpen] = useState(() => new Set())
  // A flagged row opens its editor right here; closing re-runs the checks in
  // place, so a fixed item drops off the list without a reload. The
  // INSTRUCTOR editor is admin-only: it carries the tier field, which is the
  // owner's private evaluation.
  const [editing, setEditing] = useState(null) // { entity, id }
  const [editingTier, setEditingTier] = useState(null)

  const editingInstructor =
    editing?.entity === 'instructor' && isAdmin
      ? instructors.find((i) => i.id === editing.id)
      : null

  // tier lives behind the admin-only view, not on the health list's rows.
  useEffect(() => {
    setEditingTier(null)
    if (!editingInstructor) return
    supabase
      .from('instructor_tiers')
      .select('tier')
      .eq('instructor_id', editingInstructor.id)
      .maybeSingle()
      .then(({ data }) => setEditingTier(data?.tier ?? null))
  }, [editingInstructor])

  const canEdit = (entity) => entity === 'student' || (entity === 'instructor' && isAdmin)

  async function closeEditor() {
    setEditing(null)
    await refetch()
  }

  function toggle(key) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-900">Data health</h1>
          <p className="text-xs text-zinc-500">
            {center?.name} · {students.length} active students · {instructors.length} active
            instructors
          </p>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={loading}
          className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && checks.length === 0 ? (
          <Spinner label="Checking…" />
        ) : checks.length === 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">
            Nothing to fix — every active student is ranked and every attribute is set.
          </p>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-3">
            {checks.map((check) => {
              const severity = SEVERITY[check.severity] ?? SEVERITY.low
              const expanded = open.has(check.key)
              return (
                <li
                  key={check.key}
                  className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
                >
                  <div className="flex items-start gap-3 p-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${severity.bar}`} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">{check.title}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${severity.chip}`}>
                          {severity.label}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">{check.detail}</p>
                    </div>
                    {check.items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggle(check.key)}
                        aria-expanded={expanded}
                        className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        {expanded ? 'Hide' : `Show ${check.items.length}`}
                      </button>
                    )}
                  </div>

                  {expanded && (
                    <ul className="max-h-64 divide-y divide-zinc-100 overflow-auto border-t border-zinc-200 bg-zinc-50">
                      {check.items.map((item) => (
                        <li key={item.id}>
                          {canEdit(check.entity) ? (
                            <button
                              type="button"
                              onClick={() => setEditing({ entity: check.entity, id: item.id })}
                              title={`Open ${item.label} to fix this`}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white"
                            >
                              <span className="min-w-0 flex-1 truncate text-zinc-800 underline decoration-zinc-300 underline-offset-2">
                                {item.label}
                              </span>
                              <span className="shrink-0 text-xs text-zinc-500">{item.note}</span>
                            </button>
                          ) : (
                            <span className="flex items-center gap-2 px-3 py-1.5 text-sm">
                              <span className="min-w-0 flex-1 truncate text-zinc-800">
                                {item.label}
                              </span>
                              <span className="shrink-0 text-xs text-zinc-500">{item.note}</span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {editing?.entity === 'student' && (
        <Modal side="right" label="Student editor" onClose={closeEditor}>
          <StudentDrawer key={editing.id} studentId={editing.id} onClose={closeEditor} onChanged={refetch} />
        </Modal>
      )}

      {editingInstructor && (
        <Modal label={`Edit ${editingInstructor.name}`} onClose={closeEditor}>
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">{editingInstructor.name}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Every change saves as you make it.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <InstructorForm
              key={`${editingInstructor.id}:${editingTier ?? ''}`}
              instructor={editingTier ? { ...editingInstructor, tier: editingTier } : editingInstructor}
              onPatch={(patch) => patchInstructor(editingInstructor.id, patch)}
              onCancel={closeEditor}
            />
          </div>
          <div className="flex justify-end border-t border-zinc-200 px-4 py-2.5">
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
