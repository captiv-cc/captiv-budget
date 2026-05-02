// ════════════════════════════════════════════════════════════════════════════
// useCrew — Hook React pour la tab Équipe / Tech list
// ════════════════════════════════════════════════════════════════════════════
//
// Encapsule le chargement + les mutations sur projet_membres pour un
// projet donné. Expose des données dérivées (groupé par persona, par
// catégorie, liste des catégories à afficher).
//
// Pattern aligné sur useLivrables / useMateriel : optimistic updates côté
// state, reload final si échec. La RLS DB gère le scoping (org × projet).
//
// Usage type dans un composant :
//   const {
//     personae, personaeByCategory, categories, contacts, contactsById,
//     loading, error,
//     addMember, updateMember, removeMember, updatePersona, addContact,
//     reload,
//   } = useCrew(projectId)
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
  createContactQuick,
  groupByPerson,
  groupByCategory,
  listCategories,
  personaKey,
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
  const personaeByCategory = useMemo(() => groupByCategory(personae), [personae])
  const categories = useMemo(() => listCategories(personae), [personae])
  const contactsById = useMemo(() => {
    const m = new Map()
    for (const c of contacts) m.set(c.id, c)
    return m
  }, [contacts])

  // ─── Mutations projet_membres (optimistic) ────────────────────────────────

  /**
   * Crée une attribution pour ce projet. Le payload doit contenir au
   * minimum les champs spécifiques (contact_id, devis_line_id, regime,
   * specialite, …). project_id est ajouté automatiquement.
   */
  const addMember = useCallback(async (payload) => {
    if (!projectId) throw new Error('addMember: projectId manquant')
    const created = await createProjectMember({ project_id: projectId, ...payload })
    setMembers((prev) => [...prev, created])
    return created
  }, [projectId])

  /**
   * Update une attribution. Optimistic : on update le state localement
   * avant de rejouer le reload.
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
   */
  const removeMember = useCallback(async (id) => {
    // Optimistic
    const snapshot = members
    setMembers((prev) => prev.filter((m) => m.id !== id))
    try {
      await deleteProjectMember(id)
    } catch (e) {
      console.error('[useCrew] removeMember error:', e)
      setMembers(snapshot)
      throw e
    }
  }, [members])

  /**
   * Update les attributs persona-level (category, sort_order, secteur,
   * chauffeur, hebergement, presence_days, couleur, movinmotion_statut)
   * sur TOUTES les rows de la même personne. Utilisé par la techlist
   * pour garder les rows synchronisées quand une personne a plusieurs
   * lignes attribuées sur le même projet.
   *
   * @param {string} key - persona key (cf. personaKey() in lib/crew.js)
   * @param {Object} fields - champs à update sur toutes les rows
   */
  const updatePersona = useCallback(async (key, fields) => {
    const ids = members.filter((m) => personaKey(m) === key).map((m) => m.id)
    if (!ids.length) return
    // Optimistic
    setMembers((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, ...fields } : m)),
    )
    try {
      await bulkUpdateProjectMembers(ids, fields)
    } catch (e) {
      console.error('[useCrew] updatePersona error:', e)
      await reload()
      throw e
    }
  }, [members, reload])

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
    personaeByCategory,
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
    addContact,
  }
}
