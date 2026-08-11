import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import { parseTableFile } from './parseTable'
import { planStudentImport, STUDENT_FIELDS } from './studentImport'

/**
 * Student roster importer. Preview first, commit second — never the other way
 * round, and never a rename of an existing student.
 */
export default function StudentImportView() {
  const { centerId, center } = useCenter()
  const { user } = useAuth()
  const [fileName, setFileName] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setDone(null)
    setFileName(file.name)

    try {
      const { rows, headers } = await parseTableFile(file)
      const { data, error } = await supabase
        .from('students')
        .select('id, name, radius_account, grade, level, school, gender, slot_certainty, performance, needs_schoolwork, default_duration, active')
        .eq('center_id', centerId)
      if (error) throw new Error(error.message)

      const next = planStudentImport(rows, data ?? [])
      setPlan({ ...next, headers, rowCount: rows.length })
    } catch (err) {
      setError(err.message)
      setPlan(null)
    }
    setBusy(false)
    e.target.value = ''
  }

  async function commit() {
    if (!plan) return
    setBusy(true)
    setError(null)

    try {
      if (plan.created.length > 0) {
        const { error } = await supabase.from('students').insert(
          plan.created.map((c) => ({ center_id: centerId, name: c.name, ...c.values })),
        )
        if (error) throw new Error(error.message)
      }
      for (const row of plan.updated) {
        const { error } = await supabase
          .from('students')
          .update({ ...row.patch, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw new Error(error.message)
      }

      await supabase.from('import_runs').insert({
        center_id: centerId,
        kind: 'student_roster',
        filename: fileName,
        rows_total: plan.rowCount,
        rows_created: plan.created.length,
        rows_updated: plan.updated.length,
        rows_flagged: plan.problems.length + plan.created.filter((c) => c.needsReview).length,
        ran_by: user?.id ?? null,
      })

      setDone({ created: plan.created.length, updated: plan.updated.length })
      setPlan(null)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-base font-semibold text-zinc-900">Student roster import</h1>
      <p className="mt-1 text-sm text-zinc-500">
        CSV or XLSX into <span className="font-medium">{center?.name}</span>. Matches on Radius
        account, then on display name. Existing students are updated in place and never renamed.
      </p>

      <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600"
        />
        <p className="mt-2 text-xs text-zinc-400">
          Columns read: name, radius account, {STUDENT_FIELDS.map((f) => f.key.replace(/_/g, ' ')).join(', ')}.
          Anything else is ignored.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {done && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported — {done.created} created, {done.updated} updated.
        </p>
      )}

      {plan && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Stat label="New" value={plan.created.length} tone="emerald" />
            <Stat label="Changed" value={plan.updated.length} tone="amber" />
            <Stat label="Already correct" value={plan.unchanged.length} tone="zinc" />
            <Stat label="Not in file" value={plan.absent.length} tone="zinc" />
            {plan.problems.length > 0 && (
              <Stat label="Need attention" value={plan.problems.length} tone="red" />
            )}
          </div>

          {plan.created.length > 0 && (
            <Section title={`New students (${plan.created.length})`}>
              <ul className="divide-y divide-zinc-100">
                {plan.created.map((c) => (
                  <li key={c.rowNumber} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="font-medium text-zinc-900">{c.name}</span>
                    <span className="truncate text-xs text-zinc-400">from “{c.fullName}”</span>
                    {c.needsReview && (
                      <span
                        className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
                        title={c.reviewReason}
                      >
                        review name
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan.updated.length > 0 && (
            <Section title={`Changed (${plan.updated.length})`}>
              <ul className="divide-y divide-zinc-100">
                {plan.updated.map((u) => (
                  <li key={u.id} className="px-3 py-1.5 text-sm">
                    <span className="font-medium text-zinc-900">{u.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {Object.entries(u.patch)
                        .map(([k, v]) => `${k.replace(/_/g, ' ')} → ${String(v)}`)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan.problems.length > 0 && (
            <Section title={`Need attention (${plan.problems.length})`}>
              <ul className="divide-y divide-zinc-100">
                {plan.problems.map((p) => (
                  <li key={p.rowNumber} className="px-3 py-1.5 text-sm text-red-700">
                    Row {p.rowNumber}: “{p.fullName}” — {p.reason}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan.absent.length > 0 && (
            <Section title={`On the roster but not in this file (${plan.absent.length})`}>
              <p className="px-3 py-2 text-xs text-zinc-500">
                Left untouched. A roster export may legitimately be partial, so absence is never
                treated as a deletion.
              </p>
            </Section>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={busy || (plan.created.length === 0 && plan.updated.length === 0)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {busy
                ? 'Importing…'
                : `Import ${plan.created.length} new, ${plan.updated.length} changed`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    zinc: 'bg-zinc-100 text-zinc-600',
  }
  return (
    <span className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${tones[tone]}`}>
      {value} {label}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600">
        {title}
      </p>
      <div className="max-h-64 overflow-auto">{children}</div>
    </div>
  )
}
