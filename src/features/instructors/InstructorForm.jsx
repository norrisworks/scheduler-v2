import { useEffect, useState } from 'react'
import { readableTextOn } from '../../lib/colors'
import { emptyToNull } from '../roster/studentFields'
import {
  ASSIGNABILITY_OPTIONS,
  GENDER_OPTIONS,
  INSTRUCTOR_PALETTE,
  LEVEL_FLAGS,
  TIER_OPTIONS,
  instructorWarnings,
} from './instructorFields'

const inputClass =
  'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

const BLANK = {
  name: '',
  color: INSTRUCTOR_PALETTE[0],
  email: '',
  workstream_id: '',
  gender: '',
  assignability: 'normal',
  tier: 'solid',
  // Capability is deliberately opt-in for a new instructor: guessing it would
  // silently make them assignable to levels nobody has vouched for.
  can_teach_elementary: false,
  can_teach_middle: false,
  can_teach_high: false,
  active: true,
}

function toForm(instructor) {
  if (!instructor) return { ...BLANK }
  return {
    ...BLANK,
    ...instructor,
    email: instructor.email ?? '',
    workstream_id: instructor.workstream_id ?? '',
    gender: instructor.gender ?? '',
    assignability: instructor.assignability ?? 'normal',
    tier: instructor.tier ?? 'solid',
  }
}

/** Create or edit one instructor. Fields map 1:1 onto `instructors`. */
export default function InstructorForm({ instructor, defaultColor, saving, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => toForm(instructor))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setForm(() => {
      const next = toForm(instructor)
      if (!instructor && defaultColor) next.color = defaultColor
      return next
    })
    setDirty(false)
  }, [instructor, defaultColor])

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const warnings = instructorWarnings(form)

  async function submit(e) {
    e.preventDefault()
    const ok = await onSubmit({
      name: form.name.trim(),
      color: form.color,
      email: emptyToNull(form.email.trim()),
      workstream_id: emptyToNull(form.workstream_id.trim()),
      gender: emptyToNull(form.gender),
      assignability: form.assignability,
      tier: form.tier,
      can_teach_elementary: form.can_teach_elementary,
      can_teach_middle: form.can_teach_middle,
      can_teach_high: form.can_teach_high,
      active: form.active,
    })
    if (ok) setDirty(false)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600">Name</span>
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
          className={inputClass}
        />
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-600">Color</span>
        <div className="flex flex-wrap gap-1">
          {INSTRUCTOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set('color', c)}
              aria-label={`Color ${c}`}
              aria-pressed={form.color?.toUpperCase() === c.toUpperCase()}
              className={
                'h-7 w-7 rounded text-[10px] font-bold transition ' +
                (form.color?.toUpperCase() === c.toUpperCase()
                  ? 'ring-2 ring-zinc-900 ring-offset-1'
                  : 'hover:scale-110')
              }
              style={{ backgroundColor: c, color: readableTextOn(c) }}
            >
              {form.color?.toUpperCase() === c.toUpperCase() ? '✓' : ''}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-600">Can teach</span>
        <div className="flex gap-3">
          {LEVEL_FLAGS.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={Boolean(form[f.key])}
                onChange={(e) => set(f.key, e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 accent-brand-500"
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">Tier</span>
          <select
            value={form.tier}
            onChange={(e) => set('tier', e.target.value)}
            className={inputClass}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">Gender</span>
          <select
            value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
            className={inputClass}
          >
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className={inputClass}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">Workstream ID</span>
          <input
            value={form.workstream_id}
            onChange={(e) => set('workstream_id', e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-2 border-t border-zinc-200 pt-3">
        <span className="block text-xs font-medium text-zinc-600">Assignability</span>
        {ASSIGNABILITY_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="radio"
              name="assignability"
              checked={form.assignability === o.value}
              onChange={() => set('assignability', o.value)}
              className="mt-0.5 h-4 w-4 border-zinc-300 accent-brand-500"
            />
            <span>
              {o.label}
              <span className="block text-[11px] text-zinc-400">{o.hint}</span>
            </span>
          </label>
        ))}

        <div className="border-t border-zinc-200 pt-2">
          <Check
            label="Active"
            hint="Inactive staff keep their history but leave the day view"
            checked={form.active}
            onChange={(v) => set('active', v)}
          />
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          {warnings.map((w) => (
            <li key={w}>⚠ {form.name || 'This instructor'} {w}.</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving || (instructor && !dirty) || !form.name.trim()}
          className="ml-auto rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
        >
          {saving ? 'Saving…' : instructor ? (dirty ? 'Save changes' : 'Saved') : 'Add instructor'}
        </button>
      </div>
    </form>
  )
}

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-brand-500"
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-zinc-400">{hint}</span>}
      </span>
    </label>
  )
}
