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

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
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
      setMembers(m)
      setContacts(c)
    } catch (e) {
      console.error('[useCrew] reload error:', e)
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    reload()
  }, [reload])

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
    const created = await createProjectMember({ project_id: projectId, ...payload })
    setMembers((prev) => [...prev, created])
    return created
  }, [projectId])

  /**
   * Update une attribution (per-row). Optimistic.
   * Pour les attributs persona-level, utiliser updatePersona à la place.
   */
  const updateMember = useCallback(async (id, fields) => {
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
  }, [reload])

  /**
   * Supprime une attribution. Hard delete.
   * Si la row est un parent qui a des enfants rattachés (parent_membre_id),
   * la FK ON DELETE SET NULL côté DB libère les enfants automatiquement
   * (ils redeviennent principaux).
   */
  const removeMember = useCallback(async (id) => {
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
  }, [members])

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
  }, [members, reload])

  /**
   * Rattache une attribution à une autre (= "fusion" sur la techlist).
   * `childId` ne sera plus visible comme ligne principale ; il sera listé
   * en "rattaché" sous `parentId`.
   */
  const attachMember = useCallback(async (childId, parentId) => {
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
  }, [reload])

  /**
   * Détache une attribution rattachée → elle redevient une ligne principale.
   */
  const detachMember = useCallback(async (childId) => {
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
  }, [reload])

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
    attachMember,
    detachMember,
    addContact,
  }
}
