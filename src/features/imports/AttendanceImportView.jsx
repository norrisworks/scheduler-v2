import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatDateShort } from '../../lib/dates'
import { parseTableFile } from './parseTable'
import { nameKey } from './namingConvention'
import { planAttendanceImport } from './attendanceImport'
import QueryError from '../../components/QueryError'

/**
 * Student Attendance Report import — the sole binder reset signal.
 *
 * Only students who actually attended appear in the file, which is what makes
 * it the right source: a no-show simply is not here, so their prep survives.
 * Nothing but binder state is written — no session statuses, no roster edits.
 */
export default function AttendanceImportView() {
  const { user, isAdmin } = useAuth()
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState(null)
  const [reference, setReference] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [done, setDone] = useState(null)
  const [showKept, setShowKept] = useState(false)

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setLoadError(null)
    setDone(null)
    setFileName(file.name)

    try {
      const { rows: parsed } = await parseTableFile(file)

      const [centerRes, studentRes] = await Promise.all([
        supabase.from('centers').select('id, name, short_code'),
        supabase
          .from('students')
          .select('id, name, center_id, radius_lead_id, radius_account, binder_status, binder_note, binder_status_set_at'),
      ])
      if (centerRes.error) throw centerRes.error
      if (studentRes.error) throw studentRes.error

      setRows(parsed)
      setReference({ centers: centerRes.data ?? [], students: studentRes.data ?? [] })
    } catch (err) {
      setLoadError(err)
      setRows(null)
      setReference(null)
    }
    setBusy(false)
    e.target.value = ''
  }

  const plan = useMemo(() => {
    if (!rows || !reference) return null
    const centersByName = new Map(reference.centers.map((c) => [nameKey(c.name), c]))
    const studentsByCenter = new Map()
    for (const s of reference.students) {
      const list = studentsByCenter.get(s.center_id) ?? []
      list.push(s)
      studentsByCenter.set(s.center_id, list)
    }
    return planAttendanceImport(rows, { centersByName, studentsByCenter })
  }, [rows, reference])

  const totals = useMemo(() => {
    if (!plan) return null
    const sum = (fn) => plan.centers.reduce((n, c) => n + fn(c), 0)
    return {
      students: sum((c) => c.matched.length + c.unmatched.length),
      matched: sum((c) => c.matched.length),
      unmatched: sum((c) => c.unmatched.length),
      resets: sum((c) => c.resets.length),
      kept: sum((c) => c.kept.length),
    }
  }, [plan])

  async function commit() {
    if (!plan) return
    setBusy(true)
    setError(null)

    try {
      let reset = 0
      for (const center of plan.centers) {
        for (const r of center.resets) {
          // One row at a time, and ONLY the binder columns. binder_status_set_at
          // is stamped by the database; sending it here would be ignored.
          const { error: writeError } = await supabase
            .from('students')
            .update({ binder_status: 'not_started', binder_note: null })
            .eq('id', r.student.id)
          if (writeError) throw writeError
          reset += 1
        }
      }

      const { error: logError } = await supabase.from('import_runs').insert({
        center_id: plan.centers.length === 1 ? plan.centers[0].center.id : null,
        kind: 'radius_attendance',
        filename: fileName,
        date_from: plan.dateFrom,
        date_to: plan.dateTo,
        rows_total: plan.totalRows,
        rows_created: 0,
        rows_updated: reset,
        rows_flagged: totals.unmatched + plan.skipped.length,
        ran_by: user?.id ?? null,
      })
      if (logError) throw logError

      setDone({ reset, unmatched: totals.unmatched })
      setRows(null)
      setReference(null)
    } catch (err) {
      setError(err.message ?? String(err))
    }
    setBusy(false)
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
          Imports are for admin accounts.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-base font-semibold text-zinc-900">Attendance import</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Clears the binder for students who actually turned up. Only attendees appear in this file,
        so a no-show keeps their prep. A binder marked complete{' '}
        <span className="font-medium text-zinc-700">after</span> the student left is treated as
        prep for next time and is left alone. Nothing else is written — no session statuses, no
        roster changes.
      </p>

      <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={onFile}
          disabled={busy}
          aria-label="Student Attendance Report file"
          className="mx-auto block text-sm"
        />
        <p className="mt-2 text-xs text-zinc-400">
          Student Attendance Report export — Lead Id, Attendance Date, Departure Time, Center.
        </p>
      </div>

      {loadError && (
        <div className="mt-4">
          <QueryError error={loadError} onRetry={() => setLoadError(null)} />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {done && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done.reset} binder{done.reset === 1 ? '' : 's'} reset.
          {done.unmatched > 0 ? ` ${done.unmatched} attendee(s) went unmatched and were skipped.` : ''}
        </p>
      )}

      {plan && totals && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg bg-zinc-100 px-2 py-1 font-medium text-zinc-700">
              {plan.totalRows} rows · {totals.students} students
            </span>
            {plan.dateFrom && (
              <span className="rounded-lg bg-zinc-100 px-2 py-1 font-medium text-zinc-700">
                {formatDateShort(plan.dateFrom)} – {formatDateShort(plan.dateTo)}
              </span>
            )}
            <span className="rounded-lg bg-amber-100 px-2 py-1 font-medium text-amber-800">
              {totals.resets} to reset
            </span>
            <span className="rounded-lg bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
              {totals.kept} left alone
            </span>
            {totals.unmatched > 0 && (
              <span className="rounded-lg bg-red-100 px-2 py-1 font-medium text-red-700">
                {totals.unmatched} unmatched
              </span>
            )}
          </div>

          {plan.unknownCenters.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Rows for an unrecognised center were skipped: {plan.unknownCenters.join(', ')}.
            </p>
          )}

          {plan.centers.map((center) => (
            <div key={center.center.id} className="rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
                <h2 className="text-sm font-semibold text-zinc-800">{center.center.name}</h2>
                <span className="text-xs text-zinc-500">
                  {center.rows} rows · {center.resets.length} reset · {center.kept.length} kept ·{' '}
                  {center.unmatched.length} unmatched
                </span>
              </div>

              {center.resets.length > 0 && (
                <ul className="divide-y divide-zinc-100">
                  {center.resets.map((r) => (
                    <li key={r.student.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="w-40 shrink-0 font-medium text-zinc-800">
                        {r.student.name}
                      </span>
                      <span className="w-32 shrink-0 text-zinc-500">{r.row.fullName}</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                        {r.student.binder_status} → not_started
                      </span>
                      <span className="text-zinc-400">
                        left {formatDateShort(r.row.date)} {r.row.departure?.slice(0, 5)} · matched
                        by {r.via}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {center.unmatched.length > 0 && (
                <div className="border-t border-zinc-100 px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold tracking-wide text-red-700 uppercase">
                    Unmatched — skipped, nothing written
                  </p>
                  <ul className="space-y-0.5">
                    {center.unmatched.map((u) => (
                      <li key={u.row.rowNumber} className="text-xs text-zinc-600">
                        {u.row.fullName}{' '}
                        <span className="text-zinc-400">
                          (lead {u.row.leadId || '—'}
                          {u.via ? `, ${u.via}` : ''})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {center.kept.length > 0 && (
                <div className="border-t border-zinc-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowKept((v) => !v)}
                    className="text-[11px] font-medium text-zinc-500 underline"
                  >
                    {showKept ? 'Hide' : 'Show'} {center.kept.length} left alone
                  </button>
                  {showKept && (
                    <ul className="mt-1 space-y-0.5">
                      {center.kept.map((k) => (
                        <li key={k.student.id} className="text-xs text-zinc-500">
                          {k.student.name}{' '}
                          <span className="text-zinc-400">— {k.decision.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}

          {plan.skipped.length > 0 && (
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              {plan.skipped.length} row(s) skipped: {plan.skipped[0].reason}
              {plan.skipped.length > 1 ? ' and others' : ''}.
            </p>
          )}

          <button
            type="button"
            disabled={busy || totals.resets === 0}
            onClick={commit}
            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
          >
            {busy
              ? 'Working…'
              : totals.resets === 0
                ? 'Nothing to reset'
                : `Reset ${totals.resets} binder${totals.resets === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}
