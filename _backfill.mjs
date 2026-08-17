import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { headerKey } from './src/features/imports/parseTable.js'
import { planStudentImportByCenter } from './src/features/imports/studentImport.js'
import { nameKey } from './src/features/imports/namingConvention.js'

const book = XLSX.read(fs.readFileSync(process.argv[2]), { type: 'buffer', cellDates: true })
const grid = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
  header: 1, blankrows: false, defval: '', raw: false })
const keys = grid[0].map(headerKey)
const rows = grid.slice(1).map((cells, i) => {
  const row = { __row: i + 2 }
  keys.forEach((k, c) => { if (k) row[k] = String(cells[c] ?? '').trim() })
  return row
}).filter((r) => Object.entries(r).some(([k, v]) => k !== '__row' && v !== ''))

console.log('file has enrollment_start_date column:', keys.includes('enrollment_start_date'))

const { centers, students } = JSON.parse(fs.readFileSync('./_roster.json'))
const studentsByCenter = new Map()
for (const s of students) studentsByCenter.set(s.center_id, [...(studentsByCenter.get(s.center_id) ?? []), s])
const plan = planStudentImportByCenter(rows, {
  centersByName: new Map(centers.map((c) => [nameKey(c.name), c])),
  studentsByCenter,
  fallbackCenter: centers.find((c) => c.name === 'Montgomeryville'),
})

const nullSet = new Set(students.filter((s) => !s.enrollment_start_date).map((s) => s.id))
let backfilled = []
for (const { center, plan: p } of plan.centers) {
  for (const u of p.updated) {
    if (u.patch.enrollment_start_date && nullSet.has(u.id)) backfilled.push(u.name)
  }
}
console.log('currently-null students that a fresh import would BACKFILL:', backfilled.length)
console.log(' ', backfilled.sort().join(', '))
const activeNull = students.filter((s) => !s.enrollment_start_date && s.active)
console.log('active null students NOT covered:',
  activeNull.filter((s) => !backfilled.includes(s.name)).map((s) => s.name).join(', ') || 'none')
