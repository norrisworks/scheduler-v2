import { TIME_CHOICES, formatTimeMeridiem } from '../lib/dates'

/**
 * The one way a time is picked anywhere in the app: a dropdown of the
 * center's half-hour steps. If a stored value sits off the grid (legacy
 * 15-minute offsets exist in old data), it is kept as an extra option so
 * opening the editor never silently changes it.
 */
export default function TimeSelect({ value, onChange, className, ...rest }) {
  const choices = TIME_CHOICES.includes(value)
    ? TIME_CHOICES
    : [value, ...TIME_CHOICES].filter(Boolean)

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} {...rest}>
      {choices.map((t) => (
        <option key={t} value={t}>
          {formatTimeMeridiem(`${t}:00`)}
        </option>
      ))}
    </select>
  )
}
