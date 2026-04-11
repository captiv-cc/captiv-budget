import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [profile, setProfile] = useState(null)
  const [org, setOrg]       = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (prof) {
      setProfile(prof)
      if (prof.org_id) {
        const { data: orgData } = await supabase
          .from('organisations')
          .select('*')
          .eq('id', prof.org_id)
          .single()
        if (orgData) setOrg(orgData)
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else { setProfile(null); setOrg(null) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setOrg(null)
  }

  async function createOrg(name, siret, email) {
    if (!user) return { error: 'Not authenticated' }

    const { data: newOrg, error: orgErr } = await supabase
      .from('organisations')
      .insert({ name, siret, email })
      .select()
      .single()

    if (orgErr) return { error: orgErr.message }

    // Insert default cotisation taux
    await supabase.from('cotisation_config').insert([
      { org_id: newOrg.id, key: 'Intermittent Technicien', value: 0.67, label: 'Taux charges patronales IT' },
      { org_id: newOrg.id, key: 'Intermittent Artiste',    value: 0.67, label: 'Taux charges patronales IA' },
      { org_id: newOrg.id, key: 'Salarié CDD',             value: 0.45, label: 'Taux charges patronales CDD' },
      { org_id: newOrg.id, key: 'Auto-entrepreneur',       value: 0,    label: 'Pas de charges côté client' },
      { org_id: newOrg.id, key: 'Prestation facturée',     value: 0,    label: 'Prestation externe HT' },
    ])

    // Update profile
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ org_id: newOrg.id, role: 'admin' })
      .eq('id', user.id)

    if (profErr) return { error: profErr.message }

    setOrg(newOrg)
    await loadProfile(user.id)
    return { org: newOrg }
  }

  // ── Helpers rôles ─────────────────────────────────────────────────────────
  const role             = profile?.role || 'coordinateur'
  const canSeeFinance    = ['admin', 'charge_prod'].includes(role)
  const canSeeCrewBudget = ['admin', 'charge_prod', 'coordinateur'].includes(role)
  const isAdmin          = role === 'admin'

  return (
    <AuthContext.Provider value={{
      user, profile, org, loading,
      role, canSeeFinance, canSeeCrewBudget, isAdmin,
      signIn, signUp, signOut, createOrg,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
