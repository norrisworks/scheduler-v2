import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLE_ADMIN, getPinnedCenter, getRole } from './roles'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const user = session?.user ?? null
  const role = useMemo(() => getRole(user), [user])
  const pinnedCenter = useMemo(() => getPinnedCenter(user), [user])

  const value = {
    session,
    user,
    role,
    isAdmin: role === ROLE_ADMIN,
    pinnedCenter,
    loading,
    signIn: (email, password) =>
      supabase.auth.signInWithPassword({ email: email.trim(), password }),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
