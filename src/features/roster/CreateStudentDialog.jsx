import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { readableTextOn } from '../../lib/colors'
import { moveEntry, renumber } from '../assign/proposeRanking'
import { fetchProposedOrder } from '../instructors/rankAccess'
import {
  ACADEMIC_OPTIONS,
  CERTAINTY_OPTIONS,
  DURATION_OPTIONS,
  GENDER_OPTIONS,
  LEVEL_OPTIONS,
} from './studentFields'
import { violatesNamingConvention } from '../imports/namingConvention'

const inputClass =
  'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

const BLANK = {
  name: '', grade: '', level: '', school: '', gender: '',
  slot_certainty: '', academic_status: '', needs_schoolwork: 'no', default_duration: '60',
}

/** Every attribute is required — a half-filled student is what decayed v1. */
const REQUIRED = [
  ['name', 'Name'], ['grade', 'Grade'], ['level', 'Level'], ['school', 'School'],
  ['gender', 'Gender'], ['slot_certainty', 'Slot certainty'],
  ['academic_status', 'Academic status'], ['default_duration', 'Default duration'],
]

export default function CreateStudentDialog({ centerId, instructors, onClose, onCreated }) {
  const [step, setStep] = useState('details')
  const [form, setForm] = useState(BLANK)
  const [entries, setEntries] = useState([])
  const [touched, setTouched] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const missing = REQUIRED.filter(([key]) => !String(form[key] ?? '').trim()).map(([, label]) => label)
  const nameWarning = form.name.trim() && violatesNamingConvention(form.name)

  // The proposal is ordered SERVER-side: instructor_rank shapes it — that is
  // what the ranking exists for — but the value itself is admin-only and
  // never reaches this dialog. Only the resulting sequence does.
  const byId = useMemo(() => new Map(instructors.map((i) => [i.id, i])), [instructors])
  useEffect(() => {
    if (touched) return
    let cancelled = false
    fetchProposedOrder(centerId, { level: form.level || null, gender: form.gender || null })
      .then((order) => {
        if (cancelled) return
        setEntries(
          order
            .filter((o) => byId.has(o.instructorId))
            .map((o, i) => ({
              instructor: byId.get(o.instructorId),
              instructorId: o.instructorId,
              rank: i + 1,
              reasons: [
                ...(o.sameGender ? ['same gender'] : []),
                ...(o.fallbackOnly ? ['fallback only'] : []),
              ],
            })),
        )
      })
      .catch((err) => setError(err.message))
    return () => {
      cancelled = true
    }
  }, [centerId, form.level, form.gender, byId, touched])

  async function create() {
    setSaving(true)
    setError(null)

    const { data, error } = await supabase
      .from('students')
      .insert({
        center_id: centerId,
        name: form.name.trim(),
        grade: form.grade.trim(),
        level: form.level,
        school: form.school.trim(),
        gender: form.gender,
        slot_certainty: form.slot_certainty,
        academic_status: form.academic_status,
        needs_schoolwork: form.needs_schoolwork === 'yes',
        default_duration: Number(form.default_duration),
        active: true,
      })
      .select('id')
      .single()

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    const ranked = renumber(entries)
    if (ranked.length > 0) {
      const { error: rankError } = await supabase.from('instructor_rankings').insert(
        ranked.map((e) => ({
          student_id: data.id,
          instructor_id: e.instructorId,
          rank: e.rank,
        })),
      )
      if (rankError) {
        // The student exists but is unranked — say so rather than pretending.
        setError(`Student created, but rankings failed: ${rankError.message}`)
        setSaving(false)
        await onCreated(data.id)
        return
      }
    }

    setSaving(false)
    await onCreated(data.id)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Add student"
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[32rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-200 bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-zinc-900">
            Add student — {step === 'details' ? '1. Details' : '2. Rankings'}
          </h2>
          <span className="text-[11px] text-zinc-400">
            {step === 'details' ? 'all fields required' : 'a student cannot be created unranked'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {step === 'details' ? (
            <div className="space-y-3">
              <Field label="Name">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="First name + last initial"
                  className={inputClass}
                />
                {nameWarning && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Display names never carry a full last name — use “{form.name.trim().split(/\s+/)[0]}{' '}
                    {form.name.trim().split(/\s+/)[1]?.[0]?.toUpperCase() ?? ''}”.
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Grade">
                  <input
                    value={form.grade}
                    onChange={(e) => setForm({ ...form, grade: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Level">
                  <Select
                    value={form.level}
                    onChange={(v) => { setForm({ ...form, level: v }); setTouched(false) }}
                    options={LEVEL_OPTIONS}
                  />
                </Field>
                <Field label="Gender">
                  <Select
                    value={form.gender}
                    onChange={(v) => { setForm({ ...form, gender: v }); setTouched(false) }}
                    options={GENDER_OPTIONS}
                  />
                </Field>
                <Field label="Slot certainty">
                  <Select
                    value={form.slot_certainty}
                    onChange={(v) => setForm({ ...form, slot_certainty: v })}
                    options={CERTAINTY_OPTIONS}
                  />
                </Field>
                <Field label="Academic status">
                  <Select
                    value={form.academic_status}
                    onChange={(v) => setForm({ ...form, academic_status: v })}
                    options={ACADEMIC_OPTIONS}
                  />
                </Field>
                <Field label="Needs schoolwork">
                  <Select
                    value={form.needs_schoolwork}
                    onChange={(v) => setForm({ ...form, needs_schoolwork: v })}
                    options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
                  />
                </Field>
                <Field label="School">
                  <input
                    value={form.school}
                    onChange={(e) => setForm({ ...form, school: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Default duration">
                  <Select
                    value={form.default_duration}
                    onChange={(v) => setForm({ ...form, default_duration: v })}
                    options={DURATION_OPTIONS.map((d) => ({ value: String(d), label: `${d} min` }))}
                  />
                </Field>
              </div>

              {missing.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                  Still needed: {missing.join(', ')}.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-500">
                Best-fit order, same gender as {form.name.trim() || 'the student'} preferred. Drag or
                type a number to change it.
              </p>
              {entries.length === 0 ? (
                <p className="py-6 text-center text-xs text-amber-700">
                  No active instructor here can teach {form.level}. Set capability flags on the
                  Instructors page first.
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
                      className={
                        'flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 ' +
                        (dragIndex === index ? 'border-brand-400 bg-brand-50' : 'border-zinc-200')
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
                              <span key={r} className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-600">
                                {r}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3">
          {step === 'rankings' && (
            <button
              type="button"
              onClick={() => setStep('details')}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          {step === 'details' ? (
            <button
              type="button"
              onClick={() => setStep('rankings')}
              disabled={missing.length > 0}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Next: rankings
            </button>
          ) : (
            <button
              type="button"
              onClick={create}
              disabled={saving || entries.length === 0}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {saving ? 'Creating…' : `Create with ${entries.length} rankings`}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
