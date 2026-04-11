import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  ROLES,
  INTERNAL_ROLES,
  can as canFn,
  canSee as canSeeFn,
  hasRole as hasRoleFn,
  isInternal as isInternalFn,
  isPrestataire as isPrestataireFn,
} from '../lib/permissions'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null)
  const [profile, setProfile]       = useState(null)
  const [org, setOrg]               = useState(null)
  const [loading, setLoading]       = useState(true)

  // ─── Chargement du profil ─────────────────────────────────────────────────
  // Depuis chantier 3B, les permissions outil vivent PAR PROJET (project_access
  // + project_access_permissions). On ne charge donc plus rien de global ici —
  // les pages-projet instancient leur propre contexte via useProjectPermissions.
  const loadProfile = useCallback(async (userId) => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!prof) {
      setProfile(null)
      setOrg(null)
      return
    }

    setProfile(prof)

    // Organisation
    if (prof.org_id) {
      const { data: orgData } = await supabase
        .from('organisations')
        .select('*')
        .eq('id', prof.org_id)
        .single()
      if (orgData) setOrg(orgData)
    }
  }, [])

  // ─── Cycle de vie Supabase Auth ───────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else {
        setProfile(null)
        setOrg(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  // ─── API d'authentification (inchangée) ───────────────────────────────────
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

    // Update profile : créateur = admin par défaut
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ org_id: newOrg.id, role: 'admin' })
      .eq('id', user.id)

    if (profErr) return { error: profErr.message }

    setOrg(newOrg)
    await loadProfile(user.id)
    return { org: newOrg }
  }

  // ─── Dérivés rôle ─────────────────────────────────────────────────────────
  const role = profile?.role || ROLES.COORDINATEUR

  // ─── API rôle (globale, stable) ───────────────────────────────────────────
  // On garde un permCtx "léger" (rôle seul) pour les helpers globaux.
  // Les permissions par outil sont résolues PAR PROJET via useProjectPermissions.
  const permCtx = useMemo(() => ({ role, permissions: {} }), [role])

  // hasRole reste global : c'est une simple comparaison de rôle.
  const hasRole = useCallback((roles) => hasRoleFn(permCtx, roles), [permCtx])

  // can/canSee globaux : bypassent pour les internes, renvoient false pour
  // les prestataires (qui doivent passer par useProjectPermissions). Gardés
  // pour la rétro-compat de certains appels sidebar.
  const can    = useCallback((outil, action) => canFn(permCtx, outil, action), [permCtx])
  const canSee = useCallback((outil)         => canSeeFn(permCtx, outil),      [permCtx])

  // ─── Dérivés legacy (compatibilité ascendante avec le code existant) ─────
  const canSeeFinance    = role === 'admin' || role === 'charge_prod'
  const canSeeCrewBudget = INTERNAL_ROLES.includes(role)
  const isAdmin          = role === ROLES.ADMIN
  const isChargeProd     = role === 'charge_prod'
  const isCoordinateur   = role === 'coordinateur'
  const isInternal       = isInternalFn(permCtx)
  const isPrestataire    = isPrestataireFn(permCtx)

  return (
    <AuthContext.Provider value={{
      // État
      user, profile, org, loading,
      // Rôle
      role, isAdmin, isChargeProd, isCoordinateur, isInternal, isPrestataire,
      // API rôle / permissions globales (internes uniquement)
      can, canSee, hasRole,
      // Legacy
      canSeeFinance, canSeeCrewBudget,
      // Auth actions
      signIn, signUp, signOut, createOrg,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
