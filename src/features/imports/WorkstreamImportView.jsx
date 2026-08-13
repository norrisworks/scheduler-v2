import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatDateShort, formatTimeMeridiem } from '../../lib/dates'
import { parseTableFile } from './parseTable'
import { nameKey } from './namingConvention'
import { planWorkstreamImport } from './workstreamImport'

/**
 * Workstream shifts import. The file is authoritative for staffing, so this
 * one deletes — which is why every deletion is listed before commit.
 */
export default function WorkstreamImportView() {
  const { user } = useAuth()
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState(null)
  const [reference, setReference] = useState(null)
  const [links, setLinks] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setDone(null)
    setLinks({})
    setConfirmDelete(false)
    setFileName(file.name)

    try {
      const { rows: parsed } = await parseTableFile(file)

      const [centerRes, instructorRes] = await Promise.all([
        supabase.from('centers').select('id, name, short_code'),
        supabase
          .from('instructors')
          .select('id, name, workstream_id, center_id, color')
          .eq('active', true),
      ])
      if (centerRes.error) throw new Error(centerRes.error.message)
      if (instructorRes.error) throw new Error(instructorRes.error.message)

      const dates = parsed
        .map((r) => r.date)
        .map((d) => {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d ?? '').trim())
          return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
        })
        .filter(Boolean)
        .sort()

      const shiftRes = dates.length
        ? await supabase
            .from('instructor_shifts')
            .select('id, instructor_id, center_id, date, start_time, end_time, source')
            .gte('date', dates[0])
            .lte('date', dates[dates.length - 1])
        : { data: [] }
      if (shiftRes.error) throw new Error(shiftRes.error.message)

      setRows(parsed)
      setReference({
        centers: centerRes.data ?? [],
        instructors: instructorRes.data ?? [],
        shifts: shiftRes.data ?? [],
      })
    } catch (err) {
      setError(err.message)
      setRows(null)
    }
    setBusy(false)
    e.target.value = ''
  }

  const plan = useMemo(() => {
    if (!rows || !reference) return null

    const centersByName = new Map(reference.centers.map((c) => [nameKey(c.name), c]))
    const instructorsByCenter = new Map()
    for (const i of reference.instructors) {
      const list = instructorsByCenter.get(i.center_id) ?? []
      list.push(i)
      instructorsByCenter.set(i.center_id, list)
    }

    const base = planWorkstreamImport(rows, {
      centersByName,
      centersById: new Map(reference.centers.map((c) => [c.id, c])),
      instructorsByCenter,
      existingShifts: reference.shifts,
    })

    return {
      ...base,
      centers: base.centers.map((c) => {
        const stillUnmatched = []
        const linked = []
        for (const row of c.unmatched) {
          const id = links[nameKey(row.employeeName)]
          const instructor = id && reference.instructors.find((i) => i.id === id)
          if (instructor) linked.push({ row, instructor, via: 'manual link' })
          else stillUnmatched.push(row)
        }
        return { ...c, unmatched: stillUnmatched, linked }
      }),
    }
  }, [rows, reference, links])

  const totalDeletes = plan ? plan.centers.reduce((n, c) => n + c.removed.length, 0) : 0
  const totalWrites = plan
    ? plan.centers.reduce((n, c) => n + c.created.length + c.linked.length + c.updated.length, 0)
    : 0

  async function commit() {
    if (!plan) return
    setBusy(true)
    setError(null)

    try {
      let created = 0
      let updated = 0
      let deleted = 0

      for (const center of plan.centers) {
        const writes = [...center.created, ...center.linked, ...center.updated]
        if (writes.length > 0) {
          const { error } = await supabase.from('instructor_shifts').upsert(
            writes.map(({ row, instructor }) => ({
              center_id: center.center.id,
              instructor_id: instructor.id,
              date: row.date,
              start_time: row.startTime,
              end_time: row.endTime,
              role: row.role || null,
              source: 'workstream',
            })),
            { onConflict: 'instructor_id,date,start_time' },
          )
          if (error) throw new Error(error.message)
          created += center.created.length + center.linked.length
          updated += center.updated.length
        }

        if (center.removed.length > 0) {
          const { error } = await supabase
            .from('instructor_shifts')
            .delete()
            .in('id', center.removed.map((r) => r.shift.id))
          if (error) throw new Error(error.message)
          deleted += center.removed.length
        }

        // Remember the id so the next import matches without names.
        for (const { row, instructor } of center.linked) {
          if (!instructor.workstream_id && row.employeeId) {
            await supabase
              .from('instructors')
              .update({ workstream_id: row.employeeId })
              .eq('id', instructor.id)
          }
        }
      }

      await supabase.from('import_runs').insert({
        center_id: plan.centers[0]?.center.id ?? null,
        kind: 'workstream_shifts',
        filename: fileName,
        rows_total: plan.totalRows,
        rows_created: created,
        rows_updated: updated,
        rows_flagged: deleted + plan.centers.reduce((n, c) => n + c.unmatched.length, 0),
        ran_by: user?.id ?? null,
      })

      setDone({ created, updated, deleted })
      setRows(null)
      setReference(null)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-base font-semibold text-zinc-900">Workstream shifts import</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The file is authoritative for staffing: shifts inside its date range that it does not list
        are <span className="font-medium text-zinc-700">deleted</span>. That is the opposite of the
        Radius import, so every deletion is listed below before anything happens.
      </p>

      <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600"
        />
      </div>

      <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] leading-snug text-zinc-600">
        A timesheet export records when people <span className="font-medium">actually clocked in</span>,
        not when they were scheduled. Importing one sets shifts to the hours worked. Employee ID is
        stored on first match, so later imports match on id rather than name.
      </p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {done && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported — {done.created} created, {done.updated} updated, {done.deleted} deleted.
        </p>
      )}

      {plan && (
        <div className="mt-5 space-y-4">
          {plan.centers.map((c) => (
            <div key={c.center.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="text-sm font-semibold text-zinc-900">{c.center.name}</span>
                <span className="text-xs text-zinc-500">
                  {c.dates[0]} – {c.dates[c.dates.length - 1]}
                </span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <Stat n={c.created.length + c.linked.length} label="new" tone="emerald" />
                  <Stat n={c.updated.length} label="updated" tone="amber" />
                  <Stat n={c.unchanged.length} label="unchanged" tone="zinc" />
                  <Stat n={c.unmatched.length} label="unmatched" tone="red" />
                  <Stat n={c.removed.length} label="to delete" tone="red" />
                </span>
              </div>

              {c.removed.length > 0 && (
                <div className="border-b border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-800">
                    {c.removed.length} shifts will be DELETED
                  </p>
                  <p className="mt-0.5 text-[11px] text-red-700">
                    Inside {c.dates[0]}–{c.dates[c.dates.length - 1]} but absent from the file.
                  </p>
                  <ul className="mt-1 max-h-44 space-y-0.5 overflow-auto">
                    {c.removed.map(({ shift, instructorInFile }) => (
                      <li key={shift.id} className="text-[11px] text-red-800">
                        {formatDateShort(shift.date)} {formatTimeMeridiem(shift.start_time)}–
                        {formatTimeMeridiem(shift.end_time)}
                        {!instructorInFile && (
                          <span className="ml-1 font-medium">
                            · this person is not in the file at all
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.unmatched.length > 0 && (
                <div className="border-b border-zinc-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-zinc-700">
                    Link these employees, or leave them to skip
                  </p>
                  <ul className="space-y-1">
                    {[
                      ...new Map(c.unmatched.map((r) => [nameKey(r.employeeName), r])).values(),
                    ].map((row) => (
                      <li key={row.employeeName} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-zinc-900">{row.employeeName}</span>
                          <span className="ml-1 text-xs text-zinc-400">
                            #{row.employeeId} · {row.reason}
                          </span>
                          {row.suggestions?.length > 0 && (
                            <span className="block text-[11px] text-brand-600">
                              probably {row.suggestions.map((s) => s.instructor.name).join(' or ')}
                            </span>
                          )}
                        </span>
                        <select
                          value={links[nameKey(row.employeeName)] ?? ''}
                          onChange={(e) =>
                            setLinks((prev) => ({
                              ...prev,
                              [nameKey(row.employeeName)]: e.target.value || undefined,
                            }))
                          }
                          className="w-52 rounded-lg border border-zinc-300 px-2 py-1 text-xs"
                        >
                          <option value="">Skip</option>
                          {(reference?.instructors ?? [])
                            .filter((i) => i.center_id === c.center.id)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.created.length + c.linked.length > 0 && (
                <details>
                  <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-zinc-600">
                    {c.created.length + c.linked.length} new shifts
                  </summary>
                  <ul className="max-h-52 divide-y divide-zinc-100 overflow-auto">
                    {[...c.created, ...c.linked].map((x, i) => (
                      <li key={i} className="px-3 py-1 text-xs">
                        <span className="font-medium text-zinc-800">{x.instructor.name}</span>{' '}
                        {x.row.date} {formatTimeMeridiem(x.row.startTime)}–
                        {formatTimeMeridiem(x.row.endTime)}
                        <span className="ml-1 text-zinc-400">via {x.via}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}

          {totalDeletes > 0 && (
            <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <input
                type="checkbox"
                checked={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-red-300 accent-red-600"
              />
              <span>
                I have read the {totalDeletes} deletions above and want them removed.
              </span>
            </label>
          )}

          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-zinc-500">
              {plan.totalRows} rows · {totalWrites} shifts written, {totalDeletes} deleted.
            </span>
            <button
              type="button"
              onClick={() => {
                setRows(null)
                setReference(null)
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={
                busy || (totalWrites === 0 && totalDeletes === 0) ||
                (totalDeletes > 0 && !confirmDelete)
              }
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {busy ? 'Importing…' : `Import ${totalWrites}, delete ${totalDeletes}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ n, label, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    zinc: 'bg-zinc-100 text-zinc-600',
  }
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{n} {label}</span>
}
