import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatTimeMeridiem } from '../../lib/dates'
import { parseTableFile } from './parseTable'
import { nameKey } from './namingConvention'
import { planRadiusImport, radiusKeyOf, confirmationTargets } from './radiusImport'
import { conflictKey, planSourceConflicts, planCrossDayConflicts } from '../day/sourceConflicts'
import { DAYS } from '../roster/studentFields'

/**
 * Radius appointment import. Splits by the file's Center column, previews the
 * full diff per center, and never deletes: sessions absent from the file are
 * flagged, because Radius adoption is partial.
 */
export default function RadiusImportView() {
  const { user } = useAuth()
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState(null)
  const [reference, setReference] = useState(null)
  const [links, setLinks] = useState({})
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
    setFileName(file.name)

    try {
      const { rows: parsed } = await parseTableFile(file)

      const [centerRes, studentRes] = await Promise.all([
        supabase.from('centers').select('id, name, short_code'),
        supabase.from('students').select('id, name, radius_account, center_id').eq('active', true),
      ])
      if (centerRes.error) throw new Error(centerRes.error.message)
      if (studentRes.error) throw new Error(studentRes.error.message)

      // Only load sessions inside the window the file actually covers.
      const dates = parsed
        .map((r) => r.appointment_date)
        .map((d) => {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d ?? '').trim())
          return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
        })
        .filter(Boolean)
        .sort()

      const [sessionRes, dismissRes, slotDayRes, slotRes] = dates.length
        ? await Promise.all([
            supabase
              .from('sessions')
              .select('id, student_id, center_id, date, start_time, duration, status, source')
              .gte('date', dates[0])
              .lte('date', dates[dates.length - 1]),
            supabase
              .from('session_conflict_dismissals')
              .select('student_id, date')
              .gte('date', dates[0])
              .lte('date', dates[dates.length - 1]),
            supabase.from('session_cross_day_dismissals').select('student_id, day_of_week'),
            supabase.from('recurring_slots').select('student_id, effective_until'),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
      if (sessionRes.error) throw new Error(sessionRes.error.message)

      setRows(parsed)
      setReference({
        centers: centerRes.data ?? [],
        students: studentRes.data ?? [],
        sessions: sessionRes.data ?? [],
        dismissals: dismissRes.data ?? [],
        slotDayDismissals: slotDayRes.data ?? [],
        slots: slotRes.data ?? [],
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

    // A manual link is applied by giving the student the file's account name,
    // so the same row matches by account on every future import.
    const students = reference.students.map((s) => {
      const linkedTo = Object.entries(links).find(([, id]) => id === s.id)
      return linkedTo ? { ...s, __linkedName: linkedTo[0] } : s
    })

    const centersByName = new Map(reference.centers.map((c) => [nameKey(c.name), c]))
    const studentsByCenter = new Map()
    for (const s of students) {
      const list = studentsByCenter.get(s.center_id) ?? []
      list.push(s)
      studentsByCenter.set(s.center_id, list)
    }

    const base = planRadiusImport(rows, {
      centersByName,
      centersById: new Map(reference.centers.map((c) => [c.id, c])),
      studentsByCenter,
      existingSessions: reference.sessions,
    })

    // Fold manually linked rows out of `unmatched` and into created/updated.
    return {
      ...base,
      centers: base.centers.map((c) => {
        const stillUnmatched = []
        const linked = []
        for (const row of c.unmatched) {
          const studentId = links[nameKey(row.studentName)]
          const student = studentId && students.find((s) => s.id === studentId)
          if (student) linked.push({ row, student, via: 'manual link' })
          else stillUnmatched.push(row)
        }
        return { ...c, unmatched: stillUnmatched, linked }
      }),
    }
  }, [rows, reference, links])

  // Duplicates this file would cause or keep: the incoming Radius session
  // beside the standing-slot session already in the database. Decided HERE,
  // before commit — nothing is ever auto-cancelled.
  const conflictsByCenter = useMemo(() => {
    if (!plan || !reference) return new Map()
    const dismissed = new Set(
      (reference.dismissals ?? []).map((d) => conflictKey(d.student_id, d.date)),
    )
    const out = new Map()
    for (const center of plan.centers) {
      const withLinked = {
        ...center,
        created: [...center.created, ...center.linked.map((l) => ({ ...l }))],
      }
      const found = planSourceConflicts(
        withLinked,
        reference.sessions.filter((s) => s.center_id === center.center.id),
        dismissed,
      )
      if (found.length > 0) out.set(center.center.id, found)
    }
    return out
  }, [plan, reference])
  // conflict key -> 'cancel' | 'both' | undefined (= decide later, stays
  // flagged on the day view and data health after import).
  const [conflictChoices, setConflictChoices] = useState({})

  // The cross-day NOTICE, shown at import time: a standing-slot session the
  // file skipped while the same student has a file session elsewhere in the
  // week. Information only — the file cannot tell a move from an addition,
  // so nothing is suggested and nothing is written at commit.
  const crossDayByCenter = useMemo(() => {
    if (!plan || !reference) return new Map()
    const dismissedKeys = new Set(
      (reference.dismissals ?? []).map((d) => conflictKey(d.student_id, d.date)),
    )
    const dismissedSlotDays = new Set(
      (reference.slotDayDismissals ?? []).map((d) => `${d.student_id}|${d.day_of_week}`),
    )
    const nameOf = new Map(reference.students.map((s) => [s.id, s.name]))
    const today = new Date().toISOString().slice(0, 10)
    const slotCounts = new Map()
    for (const slot of reference.slots ?? []) {
      if (slot.effective_until && slot.effective_until < today) continue
      slotCounts.set(slot.student_id, (slotCounts.get(slot.student_id) ?? 0) + 1)
    }
    const out = new Map()
    for (const center of plan.centers) {
      const found = planCrossDayConflicts(center, { dismissedKeys, dismissedSlotDays, slotCounts }).map(
        (c) => ({ ...c, name: c.name ?? nameOf.get(c.studentId) ?? 'Unknown' }),
      )
      if (found.length > 0) out.set(center.center.id, found)
    }
    return out
  }, [plan, reference])
  async function commit() {
    if (!plan) return
    setBusy(true)
    setError(null)

    try {
      let created = 0
      let updated = 0
      let flagged = 0
      // One timestamp for the whole commit: every matched row — created,
      // linked, updated, or unchanged — is stamped as seen by this file.
      const seenAt = new Date().toISOString()

      for (const center of plan.centers) {
        const writes = [
          ...center.created.map((c) => ({ ...c, isNew: true })),
          ...center.linked.map((c) => ({ ...c, isNew: true })),
          ...center.updated.map((c) => ({ ...c, isNew: false })),
        ]
        if (writes.length > 0) {
          const { error } = await supabase.from('sessions').upsert(
            writes.map(({ row, student }) => ({
              center_id: center.center.id,
              student_id: student.id,
              date: row.date,
              start_time: row.startTime,
              duration: row.duration,
              status: row.status,
              source: 'radius',
              radius_key: radiusKeyOf(row),
              last_seen_in_radius: seenAt,
            })),
            { onConflict: 'student_id,date,start_time' },
          )
          if (error) throw new Error(error.message)
          created += center.created.length + center.linked.length
          updated += center.updated.length
        }
        flagged += center.flagged.length

        // Matched-UNCHANGED rows: the file listed them, so they must carry
        // the confirmation too — but never through the upsert, which would
        // flip their source. Skipping these is the exact bug that broke the
        // cross-day detector (2026-08-17).
        for (const t of confirmationTargets(center).filter((t) => t.bucket === 'unchanged')) {
          const { error } = await supabase
            .from('sessions')
            .update({ radius_key: t.radiusKey, last_seen_in_radius: seenAt })
            .eq('student_id', t.studentId)
            .eq('date', t.date)
            .eq('start_time', t.startTime)
          if (error) throw new Error(error.message)
        }

        // Apply the duplicate decisions made in the preview. 'Decide later'
        // (no choice) leaves the pair flagged on the day view and data health.
        for (const conflict of conflictsByCenter.get(center.center.id) ?? []) {
          const choice = conflictChoices[conflict.key]
          if (choice === 'cancel') {
            const { error } = await supabase
              .from('sessions')
              .update({ status: 'cancelled', is_modified: true, updated_at: new Date().toISOString() })
              .in('id', conflict.recurring.map((s) => s.id))
            if (error) throw new Error(error.message)
          } else if (choice === 'both') {
            const { error } = await supabase.from('session_conflict_dismissals').upsert(
              {
                student_id: conflict.studentId,
                center_id: center.center.id,
                date: conflict.date,
              },
              { onConflict: 'student_id,date' },
            )
            if (error) throw new Error(error.message)
          }
        }

        // Remember manual links so the next import matches on its own.
        for (const { row, student } of center.linked) {
          if (!student.radius_account && row.accountName) {
            await supabase
              .from('students')
              .update({ radius_account: row.accountName })
              .eq('id', student.id)
          }
        }
      }

      // The file's date range is what makes "not confirmed" meaningful: the
      // detector only mentions dates some committed file actually covered.
      const allDates = plan.centers.flatMap((c) => c.dates)
      await supabase.from('import_runs').insert({
        center_id: plan.centers[0]?.center.id ?? null,
        kind: 'radius_sessions',
        filename: fileName,
        date_from: allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : null,
        date_to: allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : null,
        rows_total: plan.totalRows,
        rows_created: created,
        rows_updated: updated,
        rows_flagged: flagged + plan.centers.reduce((n, c) => n + c.unmatched.length, 0),
        ran_by: user?.id ?? null,
      })

      setDone({ created, updated, flagged })
      setRows(null)
      setReference(null)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const totalWrites = plan
    ? plan.centers.reduce((n, c) => n + c.created.length + c.linked.length + c.updated.length, 0)
    : 0

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-base font-semibold text-zinc-900">Radius sessions import</h1>
      <p className="mt-1 text-sm text-zinc-500">
        XLSX export from Radius scheduling. Rows are split by the file's Center column, so one file
        can safely carry both centers. Sessions already here but absent from the file are flagged,
        never deleted.
      </p>

      <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600"
        />
      </div>

      <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] leading-snug text-zinc-600">
        <span className="font-semibold">Matching is name-based, and it does not have to be.</span>{' '}
        The Appointments export carries no id columns, so rows are matched on account name and the
        student's display name — which is why a name that drifted needs a manual link. The{' '}
        <span className="font-medium">Students export</span> does carry Student Id and Account Id:
        importing one on the Roster tab populates <code>radius_account</code> and makes every future
        appointment import id-stable. Montgomeryville currently has none populated, so all of its
        rows match by name today.
      </p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {done && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported — {done.created} created, {done.updated} updated, {done.flagged} existing
          sessions flagged for review.
        </p>
      )}

      {plan && (
        <div className="mt-5 space-y-4">
          {plan.superseded.length > 0 && (
            <Note tone="zinc" title={`${plan.superseded.length} cancel-and-rebook slots resolved`}>
              <ul className="mt-1 space-y-0.5">
                {plan.superseded.map((s, i) => (
                  <li key={i} className="text-[11px]">
                    <span className="font-medium">{s.winner.studentName}</span>{' '}
                    {s.winner.date} {formatTimeMeridiem(s.winner.startTime)} — kept{' '}
                    <span className="font-medium">{s.winner.status}</span>, dropped{' '}
                    {s.losers.map((l) => l.status).join(', ')}
                  </li>
                ))}
              </ul>
            </Note>
          )}

          {plan.suspicious.length > 0 && (
            <Note tone="amber" title={`${plan.suspicious.length} rows with suspicious metadata`}>
              <p className="text-[11px]">
                Last modified by an account that looks like a placeholder. Check before importing.
              </p>
              <ul className="mt-1 space-y-0.5">
                {plan.suspicious.map((r, i) => (
                  <li key={i} className="text-[11px]">
                    {r.studentName} · {r.date} {formatTimeMeridiem(r.startTime)} ·{' '}
                    <span className="font-medium">{r.lastModifiedBy}</span>
                  </li>
                ))}
              </ul>
            </Note>
          )}

          {plan.unknownCenter.length > 0 && (
            <Note tone="red" title={`${plan.unknownCenter.length} rows with an unrecognised center`}>
              <p className="text-[11px]">
                Not imported — the Center column did not match any center here.
              </p>
            </Note>
          )}

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
                  <Stat n={c.flagged.length} label="flagged" tone="zinc" />
                </span>
              </div>

              {(conflictsByCenter.get(c.center.id) ?? []).length > 0 && (
                <div className="border-b border-orange-200 bg-orange-50 p-3">
                  <p className="text-xs font-semibold text-orange-900">
                    Duplicate sessions this import would keep — decide now or later
                  </p>
                  <p className="mt-0.5 text-[11px] text-orange-800">
                    The file's Radius session lands on a day where the standing slot already made
                    one. Nothing is cancelled unless you choose it; "decide later" leaves the pair
                    flagged on the day view and Data health.
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {(conflictsByCenter.get(c.center.id) ?? []).map((conflict) => (
                      <li
                        key={conflict.key}
                        className="flex flex-wrap items-center gap-2 text-[11px] text-orange-900"
                      >
                        <span className="font-semibold">{conflict.name}</span>
                        <span>{conflict.date}</span>
                        <span>
                          Radius{' '}
                          <span className="font-medium">
                            {conflict.radius.map((s) => formatTimeMeridiem(s.start_time)).join(', ')}
                          </span>
                          {' · '}standing slot{' '}
                          <span className="font-medium">
                            {conflict.recurring.map((s) => formatTimeMeridiem(s.start_time)).join(', ')}
                          </span>
                        </span>
                        <select
                          value={conflictChoices[conflict.key] ?? ''}
                          onChange={(e) =>
                            setConflictChoices((prev) => ({
                              ...prev,
                              [conflict.key]: e.target.value || undefined,
                            }))
                          }
                          aria-label={`Resolution for ${conflict.name} on ${conflict.date}`}
                          className="ml-auto shrink-0 rounded border border-orange-300 bg-white px-1.5 py-0.5 text-[11px]"
                        >
                          <option value="">Decide later</option>
                          <option value="cancel">Keep Radius, cancel the standing-slot session</option>
                          <option value="both">Keep both — genuine double session</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(crossDayByCenter.get(c.center.id) ?? []).length > 0 && (
                <div className="border-b border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700">
                    Standing sessions not listed in this file
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    Most families are not on Radius, so this usually means nothing — a session
                    absent from a Radius file is <span className="font-semibold">not</span>{' '}
                    cancelled. Shown for awareness only; the import writes nothing for these.
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {(crossDayByCenter.get(c.center.id) ?? []).map((conflict) => (
                      <li
                        key={conflict.key}
                        className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700"
                      >
                        <span className="font-semibold">{conflict.name}</span>
                        <span>
                          {DAYS.find((d) => d.value === conflict.dayOfWeek)?.short}{' '}
                          {conflict.date}{' '}
                          {conflict.recurring.map((s) => formatTimeMeridiem(s.start_time)).join(', ')}{' '}
                          is not in the file; the file lists{' '}
                          <span className="font-medium">
                            {conflict.radius
                              .map((s) => `${s.date} ${formatTimeMeridiem(s.start_time)}`)
                              .join(', ')}
                          </span>
                          {' '}that week.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.unmatched.some((r) => r.centerMismatch) && (
                <div className="border-b border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-800">
                    Center mismatch — not imported, and not moved
                  </p>
                  <p className="mt-0.5 text-[11px] text-red-700">
                    The file puts these at {c.center.name}, but they exist at another center. This
                    is always a question, never an assumption: fix it in Radius, or move the student
                    on the Roster.
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {[
                      ...new Map(
                        c.unmatched
                          .filter((r) => r.centerMismatch)
                          .map((r) => [nameKey(r.studentName), r]),
                      ).values(),
                    ].map((row) => (
                      <li key={row.studentName} className="text-[11px] text-red-800">
                        <span className="font-medium">{row.studentName}</span> — {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.unmatched.some((r) => !r.centerMismatch) && (
                <div className="border-b border-zinc-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-zinc-700">
                    Link these names to a student, or leave them to skip
                  </p>
                  <ul className="space-y-1">
                    {[
                      ...new Map(
                        c.unmatched
                          .filter((r) => !r.centerMismatch)
                          .map((r) => [nameKey(r.studentName), r]),
                      ).values(),
                    ].map((row) => (
                      <li key={row.studentName} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-zinc-900">{row.studentName}</span>
                          <span className="ml-1 text-xs text-zinc-400">
                            account “{row.accountName}”
                          </span>
                          {row.suggestions?.length > 0 && (
                            <span className="block text-[11px] text-brand-600">
                              probably{' '}
                              {row.suggestions
                                .map((s) => `${s.student.name} (${s.why})`)
                                .join(' or ')}
                            </span>
                          )}
                        </span>
                        <select
                          value={links[nameKey(row.studentName)] ?? ''}
                          onChange={(e) =>
                            setLinks((prev) => ({
                              ...prev,
                              [nameKey(row.studentName)]: e.target.value || undefined,
                            }))
                          }
                          className="w-52 rounded-lg border border-zinc-300 px-2 py-1 text-xs"
                        >
                          <option value="">Skip</option>
                          {(reference?.students ?? [])
                            .filter((s) => s.center_id === c.center.id)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.updated.length > 0 && (
                <details className="border-b border-zinc-200">
                  <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-zinc-600">
                    {c.updated.length} status or duration changes
                  </summary>
                  <ul className="max-h-52 divide-y divide-zinc-100 overflow-auto">
                    {c.updated.map((u, i) => (
                      <li key={i} className="px-3 py-1 text-xs">
                        <span className="font-medium text-zinc-800">{u.student.name}</span>{' '}
                        {u.row.date} {formatTimeMeridiem(u.row.startTime)} ·{' '}
                        <span className="text-zinc-500">
                          {u.current.status} → {u.target.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {c.flagged.length > 0 && (
                <details>
                  <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-zinc-600">
                    {c.flagged.length} sessions here but absent from the file
                  </summary>
                  <p className="px-3 pb-2 text-[11px] text-zinc-500">
                    Left untouched. Radius adoption is partial, so absence never means cancelled.
                  </p>
                </details>
              )}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-zinc-500">
              {plan.totalRows} rows in file · {totalWrites} sessions will be written.
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
              disabled={busy || totalWrites === 0}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {busy ? 'Importing…' : `Import ${totalWrites} sessions`}
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

function Note({ tone, title, children }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    zinc: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  }
  return (
    <div className={`rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <p className="text-xs font-semibold">{title}</p>
      {children}
    </div>
  )
}
