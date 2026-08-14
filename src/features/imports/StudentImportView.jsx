import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import { parseTableFile } from './parseTable'
import { nameKey } from './namingConvention'
import { planStudentImportByCenter, SKIP_REASONS, STUDENT_FIELDS } from './studentImport'

/**
 * Student roster importer. Preview first, commit second — never the other way
 * round, never a rename of an existing student, and never a row written into
 * a center the file did not name.
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
      const { rows } = await parseTableFile(file)

      // Students are loaded for EVERY center, because the file decides where
      // each row belongs — not whichever center happens to be selected.
      const [centerRes, studentRes] = await Promise.all([
        supabase.from('centers').select('id, name, short_code'),
        supabase
          .from('students')
          .select(
            'id, name, radius_account, grade, level, school, gender, slot_certainty, academic_status, enrollment_status, needs_schoolwork, default_duration, active, center_id',
          ),
      ])
      if (centerRes.error) throw new Error(centerRes.error.message)
      if (studentRes.error) throw new Error(studentRes.error.message)

      const studentsByCenter = new Map()
      for (const s of studentRes.data ?? []) {
        const list = studentsByCenter.get(s.center_id) ?? []
        list.push(s)
        studentsByCenter.set(s.center_id, list)
      }

      setPlan(
        planStudentImportByCenter(rows, {
          centersByName: new Map((centerRes.data ?? []).map((c) => [nameKey(c.name), c])),
          studentsByCenter,
          fallbackCenter: (centerRes.data ?? []).find((c) => c.id === centerId) ?? null,
        }),
      )
    } catch (err) {
      setError(err.message)
      setPlan(null)
    }
    setBusy(false)
    e.target.value = ''
  }

  const totals = plan
    ? plan.centers.reduce(
        (acc, { plan: p }) => ({
          created: acc.created + p.created.length,
          updated: acc.updated + p.updated.length,
        }),
        { created: 0, updated: 0 },
      )
    : { created: 0, updated: 0 }

  async function commit() {
    if (!plan) return
    setBusy(true)
    setError(null)

    try {
      let created = 0
      let updated = 0
      let flagged = 0

      for (const { center: target, plan: p } of plan.centers) {
        if (p.created.length > 0) {
          const { error } = await supabase.from('students').insert(
            // Each row goes to the center the FILE named, never the selected one.
            p.created.map((c) => ({ center_id: target.id, name: c.name, ...c.values })),
          )
          if (error) throw new Error(error.message)
        }
        for (const row of p.updated) {
          const { error } = await supabase
            .from('students')
            .update({ ...row.patch, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          if (error) throw new Error(error.message)
        }
        created += p.created.length
        updated += p.updated.length
        flagged += p.problems.length + p.created.filter((c) => c.needsReview).length
      }

      await supabase.from('import_runs').insert({
        center_id: plan.centers[0]?.center.id ?? centerId,
        kind: 'student_roster',
        filename: fileName,
        rows_total: plan.totalRows,
        rows_created: created,
        rows_updated: updated,
        rows_flagged: flagged,
        ran_by: user?.id ?? null,
      })

      setDone({ created, updated })
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
        CSV or XLSX. Rows are split by the file&apos;s <span className="font-medium">Center</span>{' '}
        column when it has one, so a Blue Bell export can never land in Montgomeryville; a file
        without that column goes to <span className="font-medium">{center?.name}</span>. Matches on
        Radius account plus name, then on display name. Existing students are updated in place and
        never renamed.
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
          Columns read: name (or first/last/preferred), radius account,{' '}
          {STUDENT_FIELDS.map((f) => f.key.replace(/_/g, ' ')).join(', ')}. Anything else is ignored.
        </p>
      </div>

      <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] leading-snug text-zinc-600">
        <span className="font-semibold">Enrollment status comes from Radius, not inference.</span>{' '}
        Enrolled and Pre-enrolled switch a student on for scheduling; On hold and Inactive switch
        them off. <span className="font-medium">New</span> is a lead rather than an enrollment, so
        it records the status but never activates anyone.
      </p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {done && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported — {done.created} created, {done.updated} updated.
        </p>
      )}

      {plan && (
        <div className="mt-5 space-y-6">
          {plan.unknownCenter.length > 0 && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {plan.unknownCenter.length} rows name a center that does not exist here. Not imported.
            </p>
          )}

          {plan.centers.map(({ center: target, plan: p, fromColumn }) => (
            <div key={target.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2">
                <span className="text-sm font-semibold text-zinc-900">{target.name}</span>
                <span className="text-[11px] text-zinc-400">
                  {fromColumn
                    ? "from the file's Center column"
                    : 'no Center column — using the selected center'}
                </span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <Stat label="New" value={p.created.length} tone="emerald" />
                  <Stat label="Changed" value={p.updated.length} tone="amber" />
                  <Stat label="Already correct" value={p.unchanged.length} tone="zinc" />
                  <Stat label="Not in file" value={p.absent.length} tone="zinc" />
                  {p.skipped.length > 0 && (
                    <Stat label="Left in Radius" value={p.skipped.length} tone="zinc" />
                  )}
                  {p.problems.length > 0 && (
                    <Stat label="Need attention" value={p.problems.length} tone="red" />
                  )}
                </span>
              </div>

              {p.created.length > 0 && (
                <Section title={`New students (${p.created.length})`}>
                  <ul className="divide-y divide-zinc-100">
                    {p.created.map((c) => (
                      <li key={c.rowNumber} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="font-medium text-zinc-900">{c.name}</span>
                        <span className="truncate text-xs text-zinc-400">from {c.fullName}</span>
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

              {p.updated.length > 0 && (
                <Section title={`Changed (${p.updated.length})`}>
                  <ul className="divide-y divide-zinc-100">
                    {p.updated.map((u) => (
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

              {p.problems.length > 0 && (
                <Section title={`Need attention (${p.problems.length})`}>
                  <ul className="divide-y divide-zinc-100">
                    {p.problems.map((pr) => (
                      <li key={pr.rowNumber} className="px-3 py-1.5 text-sm text-red-700">
                        Row {pr.rowNumber}: {pr.fullName} — {pr.reason}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {p.skipped.length > 0 && (
                <Section title={`Left in Radius (${p.skipped.length})`}>
                  <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500">
                    Rows that would have created someone the roster has no business carrying. A
                    student already here is still updated by the same file — this only governs
                    who gets invented.
                  </p>
                  <ul className="divide-y divide-zinc-100">
                    {Object.entries(
                      p.skipped.reduce((acc, s) => {
                        acc[s.reason] = [...(acc[s.reason] ?? []), s]
                        return acc
                      }, {}),
                    ).map(([reason, list]) => (
                      <li key={reason} className="px-3 py-1.5 text-sm">
                        <span className="text-zinc-700">
                          {SKIP_REASONS[reason] ?? reason} — {list.length}
                        </span>
                        {/* Named only when the list is short enough to act on;
                            438 former students is a number, not a to-do list. */}
                        {list.length <= 8 && (
                          <span className="ml-2 text-xs text-zinc-400">
                            {list.map((s) => s.fullName).join(', ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {p.absent.length > 0 && (
                <Section title={`On the roster but not in this file (${p.absent.length})`}>
                  <p className="px-3 py-2 text-xs text-zinc-500">
                    Left untouched. A roster export may legitimately be partial, so absence is never
                    treated as a deletion.
                  </p>
                </Section>
              )}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-zinc-500">
              {plan.totalRows} rows across {plan.centers.length} center
              {plan.centers.length === 1 ? '' : 's'}.
            </span>
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
              disabled={busy || (totals.created === 0 && totals.updated === 0)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {busy ? 'Importing…' : `Import ${totals.created} new, ${totals.updated} changed`}
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
    <span className={`rounded-lg px-2 py-1 text-xs font-medium ${tones[tone]}`}>
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
