// ════════════════════════════════════════════════════════════════════════════
// useCrew — Hook React pour la tab Équipe / Tech list
// ════════════════════════════════════════════════════════════════════════════
//
// Encapsule le chargement + les mutations sur projet_membres pour un
// projet donné. Expose :
//   - data brut : members, contacts
//   - dérivés Tech list (P1.5) : techlistRows, uncategorized, byCategory,
//     categories, personae, contactsById
//   - actions : addMember, updateMember, removeMember, updatePersona,
//     attachMember, detachMember, addContact, reload
//
// Pattern aligné sur useLivrables / useMateriel : optimistic updates côté
// state, reload final si échec. La RLS DB gère le scoping (org × projet).
//
// Modèle de données (cf. lib/crew.js) :
//   - PER-ROW : category, sort_order, devis_line_id, specialite, regime,
//     cout_estime, parent_membre_id, movinmotion_statut, budget_convenu
//   - PERSONA-LEVEL (synchronisé entre rows de la même personne via
//     bulkUpdate) : secteur, hebergement, chauffeur, presence_days, couleur
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fetchProjectMembers,
  fetchOrgContacts,
  createProjectMember,
  updateProjectMember,
  deleteProjectMember,
  bulkUpdateProjectMembers,
  attachProjectMember,
  detachProjectMember,
  createContactQuick,
  groupByPerson,
  listTechlistRows,
  partitionByCategory,
  listCategories,
  personaKey,
  PERSONA_LEVEL_FIELDS,
} from '../lib/crew'

export function useCrew(projectId) {
  const { org } = useAuth()
  const [members, setMembers] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ─── Refs cycle de vie + collab Realtime ────────────────────────────────
  // aliveRef : garde-fou pour les setState après unmount.
  // lastLocalActivityRef : timestamp de la dernière mutation locale (cf.
  // markLocal). Sert à muter le self-echo Realtime : si on vient juste de
  // déclencher une UPDATE depuis CET onglet, le postgres_changes que
  // Supabase nous renvoie n'a pas besoin de provoquer un refetch (notre
  // state est déjà à jour grâce à l'optimistic update).
  const aliveRef = useRef(true)
  const lastLocalActivityRef = useRef(0)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  const markLocal = useCallback(() => {
    lastLocalActivityRef.current = Date.now()
  }, [])

  // ─── Chargement initial + reload manuel ──────────────────────────────────
  const reload = useCallback(async () => {
    if (!projectId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [m, c] = await Promise.all([
        fetchProjectMembers(projectId),
        fetchOrgContacts(),
      ])
      if (!aliveRef.current) return
      setMembers(m)
      setContacts(c)
    } catch (e) {
      console.error('[useCrew] reload error:', e)
      if (aliveRef.current) setError(e)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    reload()
  }, [reload])

  // ─── Collab temps réel (EQUIPE-RT, pattern MAT-9B) ──────────────────────
  // Abonnement Supabase Realtime sur projet_membres (filtré server-side
  // sur project_id) pour pousser un refetch dès qu'un autre admin (ou le
  // même sur un autre onglet) modifie l'équipe du projet.
  //
  // Stratégie identique à useMateriel.js :
  //   - 1 seul channel par projet : `equipe-collab:${projectId}`
  //   - filter postgres_changes server-side sur project_id pour ne pas
  //     recevoir le bruit des autres projets
  //   - debounce 400ms pour coalescer les rafales (ex : reorderCategory
  //     qui fait N UPDATE en parallèle)
  //   - mute self-echo : si une mutation locale a été déclenchée <1500ms
  //     avant l'arrivée de l'event, on skip — soit c'est notre propre
  //     echo, soit c'est un autre user dont l'event sera de toute façon
  //     reflété par notre propre refetch programmé.
  //   - cleanup propre (removeChannel + clearTimeout) au unmount /
  //     changement de projectId.
  //
  // Note : on n'écoute PAS la table `contacts` (org-level, peu de churn
  // pendant une session de projet, et la création se fait via addContact
  // déjà optimistic). Si besoin plus tard, ajouter un .on() ici.
  useEffect(() => {
    if (!projectId) return undefined
    let timer = null
    function debouncedReload() {
      if (Date.now() - lastLocalActivityRef.current < 1500) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (aliveRef.current) reload()
      }, 400)
    }
    const channel = supabase
      .channel(`equipe-collab:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_membres',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [projectId, reload])

  // ─── Maps dérivées ────────────────────────────────────────────────────────
  const personae = useMemo(() => groupByPerson(members), [members])
  const techlistRows = useMemo(() => listTechlistRows(members), [members])
  const { uncategorized, byCategory } = useMemo(
    () => partitionByCategory(techlistRows),
    [techlistRows],
  )
  const categories = useMemo(() => listCategories(techlistRows), [techlistRows])
  const contactsById = useMemo(() => {
    const m = new Map()
    for (const c of contacts) m.set(c.id, c)
    return m
  }, [contacts])

  // ─── Mutations projet_membres (optimistic) ────────────────────────────────

  /**
   * Crée une attribution pour ce projet. Le payload doit contenir au
   * minimum les champs spécifiques (contact_id, devis_line_id, regime,
   * specialite, …). project_id est ajouté automatiquement. Si `category`
   * n'est pas dans le payload, l'attribution arrive dans la boîte "À trier"
   * de la techlist (category = NULL côté DB).
   */
  const addMember = useCallback(async (payload) => {
    if (!projectId) throw new Error('addMember: projectId manquant')
    markLocal()
    const created = await createProjectMember({ project_id: projectId, ...payload })
    setMembers((prev) => [...prev, created])
    return created
  }, [projectId, markLocal])

  /**
   * Update une attribution (per-row). Optimistic.
   * Pour les attributs persona-level, utiliser updatePersona à la place.
   */
  const updateMember = useCallback(async (id, fields) => {
    markLocal()
    // Optimistic
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)))
    try {
      const updated = await updateProjectMember(id, fields)
      // Réintégration de l'objet complet (avec joins)
      setMembers((prev) => prev.map((m) => (m.id === id ? updated : m)))
      return updated
    } catch (e) {
      // Rollback : reload complet si l'update échoue
      console.error('[useCrew] updateMember error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal])

  /**
   * Supprime une attribution. Hard delete.
   * Si la row est un parent qui a des enfants rattachés (parent_membre_id),
   * la FK ON DELETE SET NULL côté DB libère les enfants automatiquement
   * (ils redeviennent principaux).
   */
  const removeMember = useCallback(async (id) => {
    markLocal()
    const snapshot = members
    // Optimistic : retire la row + détache les enfants côté state
    setMembers((prev) =>
      prev
        .filter((m) => m.id !== id)
        .map((m) => (m.parent_membre_id === id ? { ...m, parent_membre_id: null } : m)),
    )
    try {
      await deleteProjectMember(id)
    } catch (e) {
      console.error('[useCrew] removeMember error:', e)
      setMembers(snapshot)
      throw e
    }
  }, [members, markLocal])

  /**
   * Update les attributs PERSONA-LEVEL (secteur, hebergement, chauffeur,
   * presence_days, couleur) sur TOUTES les rows de la même personne. Filtre
   * automatiquement les champs autres que persona-level (sécurité : si on
   * passe `category` ou `movinmotion_statut`, ils ne seront PAS bulkupdatés).
   *
   * @param {string} key - persona key (cf. personaKey() in lib/crew.js)
   * @param {Object} fields - champs à update sur toutes les rows
   */
  const updatePersona = useCallback(async (key, fields) => {
    const ids = members.filter((m) => personaKey(m) === key).map((m) => m.id)
    if (!ids.length) return
    // Filtre : ne propage QUE les champs persona-level
    const safe = {}
    for (const f of PERSONA_LEVEL_FIELDS) {
      if (f in fields) safe[f] = fields[f]
    }
    if (Object.keys(safe).length === 0) {
      console.warn('[useCrew] updatePersona: aucun champ persona-level dans', fields)
      return
    }
    markLocal()
    // Optimistic
    setMembers((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, ...safe } : m)),
    )
    try {
      await bulkUpdateProjectMembers(ids, safe)
    } catch (e) {
      console.error('[useCrew] updatePersona error:', e)
      await reload()
      throw e
    }
  }, [members, reload, markLocal])

  /**
   * Renomme une catégorie : bulk update toutes les rows ayant
   * `category = oldName` vers `category = newName`. Utile pour adapter
   * les libellés par défaut (PRODUCTION → PRODUCTION ZA, etc.).
   *
   * Si oldName === newName ou si pas de rows → no-op.
   * @param {string} oldName
   * @param {string} newName
   */
  const renameCategory = useCallback(async (oldName, newName) => {
    const trimmed = (newName || '').trim()
    if (!trimmed || trimmed === oldName) return
    const ids = members
      .filter((m) => (m.category || null) === oldName)
      .map((m) => m.id)
    if (!ids.length) return
    markLocal()
    setMembers((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, category: trimmed } : m)),
    )
    try {
      await bulkUpdateProjectMembers(ids, { category: trimmed })
    } catch (e) {
      console.error('[useCrew] renameCategory error:', e)
      await reload()
      throw e
    }
  }, [members, reload, markLocal])

  /**
   * Réordonne les rows d'une catégorie. Reçoit un Array d'IDs dans le
   * nouvel ordre, et update `sort_order` de chaque row pour refléter
   * cet ordre (sort_order = 0, 1, 2, ...).
   *
   * Optionnellement, peut aussi changer la category des rows (utile quand
   * on déplace une row depuis une autre catégorie vers une position précise).
   */
  const reorderCategory = useCallback(async (orderedIds, targetCategory = undefined) => {
    if (!orderedIds?.length) return
    markLocal()
    // Optimistic
    setMembers((prev) =>
      prev.map((m) => {
        const idx = orderedIds.indexOf(m.id)
        if (idx === -1) return m
        const next = { ...m, sort_order: idx }
        if (targetCategory !== undefined) next.category = targetCategory
        return next
      }),
    )
    try {
      // N updates en parallèle. Acceptable jusqu'à ~30 rows ; au-delà
      // on basculerait sur un upsert RPC dédié.
      await Promise.all(
        orderedIds.map((id, idx) => {
          const fields = { sort_order: idx }
          if (targetCategory !== undefined) fields.category = targetCategory
          return updateProjectMember(id, fields)
        }),
      )
    } catch (e) {
      console.error('[useCrew] reorderCategory error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal])

  /**
   * Rattache une attribution à une autre (= "fusion" sur la techlist).
   * `childId` ne sera plus visible comme ligne principale ; il sera listé
   * en "rattaché" sous `parentId`.
   */
  const attachMember = useCallback(async (childId, parentId) => {
    markLocal()
    setMembers((prev) =>
      prev.map((m) => (m.id === childId ? { ...m, parent_membre_id: parentId } : m)),
    )
    try {
      const updated = await attachProjectMember(childId, parentId)
      setMembers((prev) => prev.map((m) => (m.id === childId ? updated : m)))
      return updated
    } catch (e) {
      console.error('[useCrew] attachMember error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal])

  /**
   * Détache une attribution rattachée → elle redevient une ligne principale.
   */
  const detachMember = useCallback(async (childId) => {
    markLocal()
    setMembers((prev) =>
      prev.map((m) => (m.id === childId ? { ...m, parent_membre_id: null } : m)),
    )
    try {
      const updated = await detachProjectMember(childId)
      setMembers((prev) => prev.map((m) => (m.id === childId ? updated : m)))
      return updated
    } catch (e) {
      console.error('[useCrew] detachMember error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal])

  // ─── Création contact à la volée (depuis ContactPicker) ───────────────────

  /**
   * Crée un nouveau contact dans l'annuaire de l'org et le rend disponible
   * immédiatement dans `contacts`. Retourne le contact créé pour qu'on
   * puisse l'utiliser comme contact_id sur la foulée.
   */
  const addContact = useCallback(async (payload) => {
    if (!org?.id) throw new Error('addContact: org manquante')
    const created = await createContactQuick(org.id, payload)
    setContacts((prev) => [...prev, created])
    return created
  }, [org?.id])

  return {
    // data brut
    members,
    contacts,
    // dérivés
    personae,
    techlistRows,
    uncategorized,
    byCategory,
    categories,
    contactsById,
    // état
    loading,
    error,
    // actions
    reload,
    addMember,
    updateMember,
    removeMember,
    updatePersona,
    renameCategory,
    reorderCategory,
    attachMember,
    detachMember,
    addContact,
  }
}
