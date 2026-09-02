/**
 * Database invariant checks — the half of the rules `npm run check` cannot see.
 *
 * checks.mjs bundles under node with no Supabase client, so every schema-level
 * rule (triggers, policies, grants, column locks) is invisible to it: someone
 * could drop the binder reset trigger, or hand instructor_rank back to the
 * client, and the suite would stay green. This closes that.
 *
 * The database returns FACTS ONLY (public.db_schema_facts). Every expectation
 * lives here, in version control, so dropping a trigger changes the facts and
 * fails an assertion in this file. A checker that graded itself inside the
 * database could simply be edited to say everything is fine.
 *
 *   npm run check:db
 *
 * Credentials, in order of preference:
 *   SUPABASE_SERVICE_ROLE_KEY  — env or .env.local. Best for CI: no login.
 *   SCHEDULER_ADMIN_EMAIL + SCHEDULER_ADMIN_PASSWORD — signs in with the anon
 *   key. db_schema_facts is admin-gated, so an instructor login gets nothing.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------- expectations

/** Tables whose policy set is pinned exactly: everyone reads, only admin writes. */
const ADMIN_WRITE = [
  'admin_write|ALL|jwt_is_admin()|jwt_is_admin()',
  'read_all|SELECT|true|',
]
const BINDER_CARVE_OUT =
  'instructor_binder_update|UPDATE|jwt_is_instructor()|jwt_is_instructor()'

const EXPECTED_POLICIES = {
  instructors: ADMIN_WRITE,
  instructor_rankings: ADMIN_WRITE,
  assignments: ADMIN_WRITE,
  recurring_slots: ADMIN_WRITE,
  student_notes: ADMIN_WRITE,
  // Binder prep is the one thing an instructor account may write.
  students: [...ADMIN_WRITE, BINDER_CARVE_OUT].sort(),
  // sessions keeps its carve-out until the deployed bundle stops writing
  // binder columns there — see the binder cleanup open item in HANDOFF.
  sessions: [...ADMIN_WRITE, BINDER_CARVE_OUT].sort(),
}

/**
 * Tables KNOWINGLY left on a permissive ALL/true policy. Listing them here is
 * the point: a table that drifts open shows up as an unexpected failure, and
 * these stay visible instead of being forgotten. Each is a decision the owner
 * has not made yet, not an endorsement.
 */
const PERMISSIVE_ALLOWED = {
  centers: 'two rows, no secrets',
  import_runs: 'append-only audit log',
  instructor_shifts: 'REVIEW: staffing drives auto-assign eligibility',
  session_conflict_dismissals: 'operational dismissals',
  session_cross_day_dismissals: 'operational dismissals',
  v1_reference: 'read-only v1 excerpts',
  assignment_overrides: 'SELECT true + INSERT true, not ALL/true',
}

/** table | trigger | function — all must exist and be enabled. */
const EXPECTED_TRIGGERS = [
  'instructors|instructors_assign_rank|assign_instructor_rank',
  'sessions|sessions_instructor_binder_only|enforce_instructor_binder_only',
  'students|students_default_duration_propagation|propagate_default_duration',
  // Must sort BEFORE students_instructor_binder_only: BEFORE triggers fire in
  // name order, and the carve-out has to compare the already-stamped row.
  'students|students_binder_stamp|stamp_binder_status_set_at',
  'students|students_instructor_binder_only|enforce_instructor_binder_only_students',
]

/**
 * Triggers that must NOT exist. Attendance is the sole binder reset signal, so
 * the session-status route is gone; if it comes back, two sources race to
 * clear the same flag and a no-show silently wastes prep again.
 */
const FORBIDDEN_TRIGGERS = [
  'sessions_reset_binder_on_attendance_ins',
  'sessions_reset_binder_on_attendance_upd',
]

/**
 * Functions that MUST be SECURITY DEFINER, with why — each reads or writes
 * something the calling role cannot reach on its own. A definer function
 * without a pinned search_path is a privilege-escalation path, so both are
 * checked together.
 */
const MUST_BE_DEFINER = {
  assign_instructor_rank: 'reads max(instructor_rank), revoked from authenticated',
  db_schema_facts: 'reads pg_catalog on behalf of an admin JWT',
}

/**
 * Functions where INVOKER rights are the security gate: they write
 * instructor_rankings and rely on the admin_write policy to refuse instructor
 * JWTs. Flipping one to SECURITY DEFINER would let any authenticated JWT bulk-
 * edit rankings. bulk_remove_ranking also self-verifies its delete count,
 * because under an instructor JWT the capture READS rows the delete cannot
 * touch — the first cut reported "removed 96" having removed nothing.
 */
const MUST_BE_INVOKER = {
  bulk_insert_ranking: 'writes rankings; RLS is the gate',
  bulk_remove_ranking: 'writes rankings; RLS is the gate',
  bulk_restore_ranking: 'writes rankings; RLS is the gate',
  // Read-only, but definer would be gratuitous surface: it only reads tables
  // every role can already read. Its EXISTENCE matters most — the day view's
  // first-day border is derived through it, and the manual flag is gone.
  first_day_session_ids: 'derives the first-day border; the manual flag is dead',
}

/** Columns no client role may see or write, whatever the policies say. */
const LOCKED_COLUMNS = [
  ['instructors', 'instructor_rank', "the owner's private ranking"],
]

/** Columns the binder carve-out depends on being writable by authenticated. */
const BINDER_COLUMNS = [
  ['students', 'binder_status'],
  ['students', 'binder_note'],
]

/**
 * Columns that must simply exist. binder_status_set_at is what makes the
 * attendance reset decidable — without it there is no way to tell prep done
 * BEFORE a visit (consumed) from prep done after it (keep). radius_lead_id is
 * the only id the attendance export can be matched on.
 */
const REQUIRED_COLUMNS = [
  ['students', 'binder_status_set_at'],
  // BOTH halves of the attendance bridge. Lead Id is family-level — siblings
  // share one — so the first name is what makes the pair identify a child.
  ['students', 'radius_lead_id'],
  ['students', 'radius_first_name'],
  // Online sessions on the day view; written by the Radius import, defaulted
  // for materialized standing slots.
  ['sessions', 'delivery_method'],
  // Three-state first-day override: null derives, true forces, false hides.
  ['sessions', 'first_day_override'],
]

// --------------------------------------------------------------------- runner

const results = []
const check = (label, ok, detail = '') => results.push({ label, ok, detail })

function readEnvLocal() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const out = {}
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

async function connect() {
  const env = { ...readEnvLocal(), ...process.env }
  const url = env.VITE_SUPABASE_URL
  if (!url) throw new Error('VITE_SUPABASE_URL missing from .env.local and the environment')

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey) {
    return { client: createClient(url, serviceKey), how: 'service role key' }
  }

  const { SCHEDULER_ADMIN_EMAIL: email, SCHEDULER_ADMIN_PASSWORD: password } = env
  const anon = env.VITE_SUPABASE_ANON_KEY
  if (email && password && anon) {
    const client = createClient(url, anon, { auth: { persistSession: false } })
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`sign in as ${email} failed: ${error.message}`)
    return { client, how: `admin login (${email})` }
  }

  throw new Error(
    'No credentials. Set SUPABASE_SERVICE_ROLE_KEY (preferred), or\n' +
      '  SCHEDULER_ADMIN_EMAIL and SCHEDULER_ADMIN_PASSWORD, in .env.local or the environment.\n' +
      '  db_schema_facts is admin-gated, so an instructor login will not work.',
  )
}

function assertFacts(facts) {
  // ---- RLS is on everywhere. A table with it off is readable and writable by
  // anyone holding the anon key, which is shipped in the browser bundle.
  const rlsOff = Object.entries(facts.rls ?? {})
    .filter(([, on]) => !on)
    .map(([t]) => t)
  check('every public table has RLS enabled', rlsOff.length === 0, rlsOff.join(', '))

  // ---- policy shape, table by table
  const byTable = new Map()
  for (const p of facts.policies ?? []) {
    if (!byTable.has(p.table)) byTable.set(p.table, [])
    byTable.get(p.table).push(`${p.name}|${p.cmd}|${p.using ?? ''}|${p.check ?? ''}`)
  }

  for (const [table, expected] of Object.entries(EXPECTED_POLICIES)) {
    const got = (byTable.get(table) ?? []).sort()
    const want = [...expected].sort()
    check(
      `${table}: everyone reads, only admin writes`,
      JSON.stringify(got) === JSON.stringify(want),
      got.length === 0 ? 'no policies at all' : `got ${JSON.stringify(got)}`,
    )
  }

  // ---- no table drifts open without being written down above
  const permissive = (facts.policies ?? [])
    .filter((p) => p.cmd === 'ALL' && p.using === 'true')
    .map((p) => p.table)
  const undeclared = [...new Set(permissive)].filter(
    (t) => !(t in PERMISSIVE_ALLOWED) && !(t in EXPECTED_POLICIES),
  )
  check(
    'no undeclared table carries a permissive ALL/true policy',
    undeclared.length === 0,
    undeclared.join(', '),
  )
  // And a pinned table must never regress INTO one.
  const pinnedButOpen = [...new Set(permissive)].filter((t) => t in EXPECTED_POLICIES)
  check(
    'no admin-write table has an ALL/true policy',
    pinnedButOpen.length === 0,
    pinnedButOpen.join(', '),
  )

  // ---- triggers exist and are enabled ('O' = enabled for origin traffic)
  const triggers = new Map(
    (facts.triggers ?? []).map((t) => [`${t.table}|${t.name}|${t.function}`, t.enabled]),
  )
  for (const key of EXPECTED_TRIGGERS) {
    const enabled = triggers.get(key)
    check(
      `trigger ${key.split('|')[1]}`,
      enabled === 'O',
      enabled === undefined ? 'MISSING' : `tgenabled=${enabled}`,
    )
  }

  const names = new Set((facts.triggers ?? []).map((t) => t.name))
  const revived = FORBIDDEN_TRIGGERS.filter((n) => names.has(n))
  check(
    'the session-driven binder reset stays retired',
    revived.length === 0,
    revived.join(', '),
  )

  // ---- privileged functions
  for (const [name, why] of Object.entries(MUST_BE_DEFINER)) {
    const fn = (facts.functions ?? {})[name]
    check(`${name} exists`, Boolean(fn), why)
    if (!fn) continue
    check(`${name} is SECURITY DEFINER`, fn.security_definer === true, why)
    const pinned = (fn.config ?? []).some((c) => String(c).startsWith('search_path='))
    check(`${name} pins its search_path`, pinned, 'definer without a pinned path is escalation')
  }

  for (const [name, why] of Object.entries(MUST_BE_INVOKER)) {
    const fn = (facts.functions ?? {})[name]
    check(`${name} exists`, Boolean(fn), why)
    if (!fn) continue
    check(`${name} is INVOKER rights`, fn.security_definer === false, why)
    const pinned = (fn.config ?? []).some((c) => String(c).startsWith('search_path='))
    check(`${name} pins its search_path`, pinned, 'unpinned path in a writer')
  }

  // ---- column locks
  const columns = new Map(
    (facts.columns ?? []).map((c) => [`${c.table}.${c.column}`, c]),
  )
  for (const [table, column, why] of LOCKED_COLUMNS) {
    const c = columns.get(`${table}.${column}`)
    check(`${table}.${column} exists`, Boolean(c), why)
    if (!c) continue
    const exposed = ['anon_select', 'auth_select', 'auth_insert', 'auth_update'].filter(
      (k) => c[k],
    )
    check(`${table}.${column} is revoked from every client role`, exposed.length === 0,
      exposed.join(', '))

    // The reason instructors_assign_rank has to exist: a NOT NULL column with
    // no default that no client may write is uninsertable without it.
    if (!c.nullable && !c.has_default) {
      const covered = [...triggers.keys()].some((k) => k.startsWith(`${table}|`))
      check(
        `${table}.${column} is NOT NULL with no default, so a trigger must fill it`,
        covered,
        'no insert trigger on this table — creating a row is impossible',
      )
    }
  }

  for (const [table, column] of BINDER_COLUMNS) {
    const c = columns.get(`${table}.${column}`)
    check(`${table}.${column} is writable by authenticated`, Boolean(c?.auth_update),
      'the instructor binder carve-out depends on this')
  }

  for (const [table, column] of REQUIRED_COLUMNS) {
    check(`${table}.${column} exists`, columns.has(`${table}.${column}`), 'missing')
  }
}

/**
 * DB_CHECK_FACTS_FILE reads a saved db_schema_facts payload instead of
 * connecting. The assertions above are the valuable part and this lets them be
 * exercised — and mutation-tested — without handing this script a service role
 * key. Capture a payload with:
 *   select public.db_schema_facts();   -- as an admin JWT
 */
async function loadFacts() {
  const factsFile = process.env.DB_CHECK_FACTS_FILE
  if (factsFile) {
    console.log(`db-check: reading facts from ${factsFile} (offline)`)
    return JSON.parse(readFileSync(factsFile, 'utf8'))
  }

  const { client, how } = await connect()
  console.log(`db-check: connected via ${how}`)

  const { data, error } = await client.rpc('db_schema_facts')
  if (error) {
    throw new Error(
      `could not read schema facts — ${error.message}\n` +
        '  (db_schema_facts is admin-gated; an instructor login is refused by design)',
    )
  }
  return data
}

try {
  assertFacts(await loadFacts())

  let failed = 0
  for (const { label, ok, detail } of results) {
    if (!ok) {
      failed++
      console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
    }
  }
  console.log(
    failed === 0
      ? `all ${results.length} database checks passed`
      : `${failed}/${results.length} FAILED`,
  )
  process.exitCode = failed === 0 ? 0 : 1
} catch (err) {
  // A missing key or a refused login is a normal outcome to report, not a
  // stack trace to decode.
  console.error(`db-check: ${err.message}`)
  process.exitCode = 1
}

// The Supabase client leaves a keepalive handle open. process.exit() while it
// is closing trips a libuv assertion on Windows, so let the loop drain and
// only force the issue if something is still holding it.
setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref()
