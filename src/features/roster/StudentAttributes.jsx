import { useEffect, useState } from 'react'
import {
  ACADEMIC_OPTIONS,
  CERTAINTY_OPTIONS,
  GENDER_OPTIONS,
  LEVEL_OPTIONS,
  emptyToNull,
} from './studentFields'

const FIELDS = [
  'name', 'grade', 'level', 'school', 'gender', 'radius_account',
  'academic_status', 'slot_certainty', 'default_duration', 'needs_schoolwork',
  'first_day', 'active',
]

function toForm(student) {
  const form = {}
  for (const key of FIELDS) form[key] = student[key] ?? (typeof student[key] === 'boolean' ? false : '')
  form.needs_schoolwork = Boolean(student.needs_schoolwork)
  form.first_day = Boolean(student.first_day)
  form.active = student.active !== false
  return form
}

export default function StudentAttributes({ student, saving, onSave }) {
  const [form, setForm] = useState(() => toForm(student))
  const [dirty, setDirty] = useState(false)

  // Reset when a different student is opened, or the record is refetched.
  useEffect(() => {
    setForm(toForm(student))
    setDirty(false)
  }, [student])

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  async function submit(e) {
    e.preventDefault()
    const ok = await onSave({
      name: form.name.trim(),
      grade: emptyToNull(form.grade),
      level: emptyToNull(form.level),
      school: emptyToNull(form.school),
      gender: emptyToNull(form.gender),
      radius_account: emptyToNull(form.radius_account),
      academic_status: emptyToNull(form.academic_status),
      slot_certainty: emptyToNull(form.slot_certainty),
      default_duration: form.default_duration === '' ? null : Number(form.default_duration),
      needs_schoolwork: form.needs_schoolwork,
      first_day: form.first_day,
      active: form.active,
    })
    if (ok) setDirty(false)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Grade">
          <input value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Level">
          <Select value={form.level} onChange={(v) => set('level', v)} options={LEVEL_OPTIONS} />
        </Field>
        <Field label="Academic status">
          <Select
            value={form.academic_status}
            onChange={(v) => set('academic_status', v)}
            options={ACADEMIC_OPTIONS}
          />
        </Field>
        <Field label="Slot certainty">
          <Select
            value={form.slot_certainty}
            onChange={(v) => set('slot_certainty', v)}
            options={CERTAINTY_OPTIONS}
          />
        </Field>
        <Field label="Gender">
          <Select value={form.gender} onChange={(v) => set('gender', v)} options={GENDER_OPTIONS} />
        </Field>
        <Field label="School">
          <input value={form.school} onChange={(e) => set('school', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Default duration (min)">
          <input
            type="number"
            min="15"
            step="15"
            value={form.default_duration}
            onChange={(e) => set('default_duration', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Radius account" hint="Used to match rows on the Radius import">
        <input
          value={form.radius_account}
          onChange={(e) => set('radius_account', e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap gap-4 pt-1">
        <Check label="Needs schoolwork (Supp)" checked={form.needs_schoolwork} onChange={(v) => set('needs_schoolwork', v)} />
        <Check label="First day" checked={form.first_day} onChange={(v) => set('first_day', v)} />
        <Check label="Active" checked={form.active} onChange={(v) => set('active', v)} />
      </div>

      <button
        type="submit"
        disabled={!dirty || saving}
        className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-brand-500"
      />
      {label}
    </label>
  )
}
