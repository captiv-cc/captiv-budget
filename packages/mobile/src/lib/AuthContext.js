// ════════════════════════════════════════════════════════════════════════════
// AuthContext — état global session utilisateur
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper React Context qui :
// 1. Récupère la session Supabase au démarrage (depuis SecureStore)
// 2. S'abonne aux changements (login/logout/refresh)
// 3. Expose user, session, loading, signIn(), signOut()
//
// Utilisation :
//   <AuthProvider>
//     <App />
//   </AuthProvider>
//
//   const { user, signIn } = useAuth()
//
// ════════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

import { supabase } from './supabase.js'

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  signUp: async () => {},
})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 1. Tente de récupérer la session existante (depuis SecureStore)
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[Auth] getSession error', err?.message)
      })
      .finally(() => setLoading(false))

    // 2. S'abonne aux changements de session
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription?.unsubscribe()
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }, [])

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  }
  return ctx
}
