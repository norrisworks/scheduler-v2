import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import {
  ACADEMIC_OPTIONS,
  CERTAINTY_OPTIONS,
  ENROLLMENT_OPTIONS,
  GENDER_OPTIONS,
  LEVEL_OPTIONS,
  emptyToNull,
} from './studentFields'

const TEXT_DEBOUNCE_MS = 500

const FIELDS = [
  'name', 'grade', 'level', 'school', 'gender', 'radius_account',
  'academic_status', 'slot_certainty', 'default_duration', 'needs_schoolwork',
  'first_day', 'active', 'enrollment_status',
]

function toForm(student) {
  const form = {}
  for (const key of FIELDS) form[key] = student[key] ?? (typeof student[key] === 'boolean' ? false : '')
  form.needs_schoolwork = Boolean(student.needs_schoolwork)
  form.first_day = Boolean(student.first_day)
  form.active = student.active !== false
  return form
}

/** One field's form value -> the value the row stores. */
function normalizeField(key, value) {
  if (key === 'name') return value.trim()
  if (key === 'default_duration') return value === '' ? null : Number(value)
  if (typeof value === 'boolean') return value
  return emptyToNull(typeof value === 'string' ? value.trim() : value)
}

/**
 * No Save button — the same rule as the instructor form and the rankings
 * cells. Selects and checkboxes write on change; free text debounces half a
 * second; anything still pending flushes when the drawer closes or switches
 * to another student.
 */
export default function StudentAttributes({ student, saving, onSave }) {
  // Instructor-role accounts read student details; only admins edit them.
  const { isAdmin } = useAuth()
  const [form, setForm] = useState(() => toForm(student))
  // key -> {timer, write} so unmount can FLUSH pending text, not discard it.
  const pending = useRef(new Map())

  // Reset only when a DIFFERENT student is opened. Same-student refetches
  // (each autosave triggers one) must not stomp fields still being typed in.
  useEffect(() => {
    setForm(toForm(student))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id])

  useEffect(() => {
    const bag = pending.current
    return () => {
      for (const { timer, write } of bag.values()) {
        clearTimeout(timer)
        write()
      }
      bag.clear()
    }
  }, [student.id])

  function set(key, value, { text = false } = {}) {
    setForm((prev) => ({ ...prev, [key]: value }))

    const write = () => {
      pending.current.delete(key)
      // A blank name is never written — the field stays editable, the row
      // keeps its last real name.
      if (key === 'name' && !value.trim()) return
      onSave({ [key]: normalizeField(key, value) })
    }

    const existing = pending.current.get(key)
    if (existing) clearTimeout(existing.timer)
    if (text) {
      pending.current.set(key, { write, timer: setTimeout(write, TEXT_DEBOUNCE_MS) })
    } else {
      write()
    }
  }

  return (
    <fieldset disabled={!isAdmin} className="space-y-3">
      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value, { text: true })}
          required
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Grade">
          <input
            value={form.grade}
            onChange={(e) => set('grade', e.target.value, { text: true })}
            className={inputClass}
          />
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
          <input
            value={form.school}
            onChange={(e) => set('school', e.target.value, { text: true })}
            className={inputClass}
          />
        </Field>
        <Field label="Default duration (min)">
          <input
            type="number"
            min="15"
            step="15"
            value={form.default_duration}
            onChange={(e) => set('default_duration', e.target.value, { text: true })}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Radius account" hint="Used to match rows on the Radius import">
        <input
          value={form.radius_account}
          onChange={(e) => set('radius_account', e.target.value, { text: true })}
          className={inputClass}
        />
      </Field>

      <Field
        label="Enrollment status"
        hint="Comes from the Radius Students export. Enrolled and Pre-enrolled are schedulable."
      >
        <Select
          value={form.enrollment_status}
          onChange={(v) => set('enrollment_status', v)}
          options={ENROLLMENT_OPTIONS}
        />
      </Field>

      <div className="flex flex-wrap gap-4 pt-1">
        <Check label="Needs schoolwork (Supp)" checked={form.needs_schoolwork} onChange={(v) => set('needs_schoolwork', v)} />
        <Check label="First day" checked={form.first_day} onChange={(v) => set('first_day', v)} />
        <Check label="Active" checked={form.active} onChange={(v) => set('active', v)} />
      </div>

      <p className="text-right text-[11px] text-zinc-400">
        {!isAdmin ? 'Read-only — instructor accounts cannot edit students.' : saving ? 'Saving…' : 'Every change saves as you make it.'}
      </p>
    </fieldset>
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
