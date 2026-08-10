import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { centerMatchesPin } from '../auth/roles'

const CenterContext = createContext(null)
const STORAGE_KEY = 'scheduler.activeCenterId'

/**
 * Loads the center list once per session and holds the active center.
 * Every data hook in the app scopes its queries to `center.id`, so this
 * provider sits above the router and below auth.
 */
export function CenterProvider({ children }) {
  const { pinnedCenter } = useAuth()
  const [allCenters, setAllCenters] = useState([])
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
        if (error) setError(error.message)
        else setAllCenters(data ?? [])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // A floor account only ever sees the center in its app_metadata.
  const centers = useMemo(
    () => allCenters.filter((c) => centerMatchesPin(c, pinnedCenter)),
    [allCenters, pinnedCenter],
  )

  // Resolve the active center during render so a pinned user can never be
  // pointed at a center they aren't allowed to see, not even for a frame.
  const center = centers.find((c) => c.id === activeId) ?? centers[0] ?? null

  useEffect(() => {
    if (center && center.id !== activeId) setActiveId(center.id)
  }, [center, activeId])

  useEffect(() => {
    // Remembering the choice is only meaningful when there is a choice.
    if (center && !pinnedCenter) localStorage.setItem(STORAGE_KEY, center.id)
  }, [center, pinnedCenter])

  const value = {
    centers,
    center,
    centerId: center?.id ?? null,
    setCenterId: setActiveId,
    canSwitch: !pinnedCenter && centers.length > 1,
    pinned: Boolean(pinnedCenter),
    // A pinned account whose app_metadata names a center that doesn't exist
    // must not silently fall through to somebody else's center.
    misconfigured: Boolean(pinnedCenter) && !loading && centers.length === 0,
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
