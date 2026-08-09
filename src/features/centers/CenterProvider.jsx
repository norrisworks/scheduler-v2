import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const CenterContext = createContext(null)
const STORAGE_KEY = 'scheduler.activeCenterId'

/**
 * Loads the center list once per session and holds the active center.
 * Every data hook in the app scopes its queries to `center.id`, so this
 * provider sits above the router and below auth.
 */
export function CenterProvider({ children }) {
  const [centers, setCenters] = useState([])
  const [activeId, setActiveId] = useState(() => localStorage.getItem(STORAGE_KEY))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('centers')
      .select('id, name, short_code')
      .order('short_code')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setError(error.message)
        } else {
          setCenters(data ?? [])
          // Fall back to the first center if nothing is stored, or if the
          // stored id no longer exists (center removed, different account).
          setActiveId((current) =>
            data?.some((c) => c.id === current) ? current : (data?.[0]?.id ?? null),
          )
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeId) localStorage.setItem(STORAGE_KEY, activeId)
  }, [activeId])

  const value = {
    centers,
    center: centers.find((c) => c.id === activeId) ?? null,
    centerId: activeId,
    setCenterId: setActiveId,
    loading,
    error,
  }

  return <CenterContext.Provider value={value}>{children}</CenterContext.Provider>
}

export function useCenter() {
  const ctx = useContext(CenterContext)
  if (!ctx) throw new Error('useCenter must be used inside <CenterProvider>')
  return ctx
}
