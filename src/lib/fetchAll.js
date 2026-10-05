/**
 * PostgREST silently caps every select at 1,000 rows. That cap ate 296 of
 * instructor_rankings' 1,296 rows and the Rankings matrix showed students
 * as unranked — no error, no warning. This helper makes that class of bug
 * impossible at its call sites: it pages with .range() until a page comes
 * back SHORT, so a result that exactly fills a page is treated as possibly
 * truncated and the next page is fetched, never trusted.
 *
 * `buildQuery` must return a FRESH builder on every call (builders are
 * consumed by execution) and MUST carry a stable total order — append
 * `.order('id')` at minimum — or pages can overlap and drop rows.
 *
 * The page budget is a runaway guard, not a feature limit: blowing it is
 * an ERROR, never a silent trim.
 */
export const PAGE_SIZE = 1000

export async function fetchAll(buildQuery, { pageSize = PAGE_SIZE, maxPages = 50 } = {}) {
  const rows = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < pageSize) return { data: rows, error: null }
  }
  return {
    data: null,
    error: {
      message:
        `fetchAll: still receiving full pages after ${maxPages * pageSize} rows — ` +
        'refusing to return a possibly-truncated result. Scope the query or raise maxPages.',
    },
  }
}
