import * as XLSX from 'xlsx'

/** Header text -> a stable key, so 'Slot Certainty' and 'slot_certainty' match. */
export function headerKey(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Reads the first sheet of a csv or xlsx into plain objects keyed by
 * normalised header. Values arrive as trimmed strings; blank cells become ''.
 */
export async function parseTableFile(file) {
  const buffer = await file.arrayBuffer()
  const book = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = book.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }

  const grid = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: '',
    raw: false,
  })
  if (grid.length === 0) return { headers: [], rows: [] }

  const headers = grid[0].map((h) => String(h ?? '').trim())
  const keys = headers.map(headerKey)

  const rows = grid.slice(1).map((cells, i) => {
    const row = { __row: i + 2 }
    keys.forEach((key, c) => {
      if (!key) return
      row[key] = String(cells[c] ?? '').trim()
    })
    return row
  })

  // Drop rows that are entirely blank — trailing rows are common in exports.
  return {
    headers,
    rows: rows.filter((r) => Object.entries(r).some(([k, v]) => k !== '__row' && v !== '')),
  }
}

/** First present value among several possible header spellings. */
export function pick(row, ...keys) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== '') return value
  }
  return ''
}
