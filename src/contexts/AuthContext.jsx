import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  ROLES,
  INTERNAL_ROLES,
  buildPermissions,
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
  const [permissions, setPermissions] = useState({}) // { outil_key: { can_read, can_comment, can_edit } }
  const [loading, setLoading]       = useState(true)

  // ─── Chargement du profil + permissions ───────────────────────────────────
  const loadProfile = useCallback(async (userId) => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!prof) {
      setProfile(null)
      setOrg(null)
      setPermissions({})
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

    // Permissions : seulement pertinentes pour les prestataires externes.
    // Les rôles internes (admin/charge_prod/coordinateur) bypassent le moteur,
    // donc on ne charge rien pour eux (économie de requêtes réseau).
    if (prof.role === ROLES.PRESTATAIRE && prof.metier_template_id) {
      const [{ data: templateRows }, { data: overrideRows }] = await Promise.all([
        supabase
          .from('metier_template_permissions')
          .select('outil_key, can_read, can_comment, can_edit')
          .eq('template_id', prof.metier_template_id),
        supabase
          .from('prestataire_outils')
          .select('outil_key, can_read, can_comment, can_edit')
          .eq('user_id', userId),
      ])

      setPermissions(buildPermissions(templateRows || [], overrideRows || []))
    } else {
      setPermissions({}) // vide : bypass internes OU prestataire sans template
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
        setPermissions({})
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
    setUser(null); setProfile(null); setOrg(null); setPermissions({})
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

  // ─── API de permissions stable (mémoïsée) ─────────────────────────────────
  // On mémoïse le ctx pour éviter que can/canSee ne se recréent à chaque render.
  const permCtx = useMemo(() => ({ role, permissions }), [role, permissions])

  const can        = useCallback((outil, action) => canFn(permCtx, outil, action), [permCtx])
  const canSee     = useCallback((outil)          => canSeeFn(permCtx, outil),      [permCtx])
  const hasRole    = useCallback((roles)          => hasRoleFn(permCtx, roles),     [permCtx])

  // ─── Dérivés legacy (compatibilité ascendante avec le code existant) ─────
  const canSeeFinance    = INTERNAL_ROLES.includes(role) && (role === 'admin' || role === 'charge_prod')
  const canSeeCrewBudget = INTERNAL_ROLES.includes(role)
  const isAdmin          = role === ROLES.ADMIN
  const isInternal       = isInternalFn(permCtx)
  const isPrestataire    = isPrestataireFn(permCtx)

  return (
    <AuthContext.Provider value={{
      // État
      user, profile, org, loading, permissions,
      // Rôle
      role, isAdmin, isInternal, isPrestataire,
      // API permissions
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
