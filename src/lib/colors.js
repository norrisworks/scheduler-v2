/**
 * Instructor colors are arbitrary hex from the DB (some are near-black, some
 * are bright amber), so text placed on them has to pick its own contrast.
 */
export function readableTextOn(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#0f172a'
  // Rec. 709 relative luminance — good enough for a two-way light/dark choice.
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return luminance > 0.6 ? '#0f172a' : '#ffffff'
}

export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Same hue at low opacity, for card tints. Falls back to transparent. */
export function tint(hex, alpha = 0.12) {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : 'transparent'
}
