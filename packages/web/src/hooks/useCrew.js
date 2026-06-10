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
  fetchProjectSessions,
  fetchOrgContacts,
  createProjectMember,
  updateProjectMember,
  deleteProjectMember,
  bulkUpdateProjectMembers,
  attachProjectMember,
  detachProjectMember,
  createContactQuick,
  createSession,
  joinSession,
  updateSession,
  deleteSession,
  syncMembreFromSessions,
  groupByPerson,
  listTechlistRows,
  partitionByCategory,
  listCategories,
  personaKey,
  PERSONA_LEVEL_FIELDS,
  SESSION_LEVEL_FIELDS,
} from '../lib/crew'
import { aggregateSessionsToMembre, groupSessionsByMembre } from '../lib/sessions'

export function useCrew(projectId) {
  const { org } = useAuth()
  const [members, setMembers] = useState([])
  const [contacts, setContacts] = useState([])
  // Sessions Phase 0a : on charge les sessions des membres en parallèle.
  // Pour l'instant elles sont juste exposées en lecture (sessionsByMembre).
  // Source de vérité reste sur projet_membres jusqu'à la bascule Phase 0b.
  const [sessions, setSessions] = useState([])
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
  // Audit 2026-05-06 — sessionsRef synchronisée avec setSessions pour
  // éviter les closures stale dans les callbacks (cf. updateMemberSession,
  // joinExistingSession, removeSession, addSession). Sans cette ref, deux
  // mutations rapides (toggle 2 jours dans la même fenêtre de debounce)
  // pouvaient agréger des dates incohérentes parce que le 2e callback
  // utilisait le `sessions` capturé au render précédent. La ref est mise
  // à jour à chaque setSessions via un wrapper.
  const sessionsRef = useRef([])
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
      setSessions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [m, c, s] = await Promise.all([
        fetchProjectMembers(projectId),
        fetchOrgContacts(),
        fetchProjectSessions(projectId),
      ])
      if (!aliveRef.current) return
      setMembers(m)
      setContacts(c)
      setSessions(s)
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
      // Sessions Phase A : nouveau modèle (session globale + participation).
      // On écoute les 2 tables pour rafraîchir dès qu'une session ou une
      // participation change. RLS filtre côté serveur ce que l'utilisateur
      // est autorisé à voir, donc pas de bruit cross-projets.
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_sessions',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_session_membres',
          // Audit fix 2026-05-06 : project_id est désormais dénormalisé
          // sur projet_session_membres (cf. migration 20260506) → on peut
          // filtrer côté serveur. Avant ce fix, le channel recevait les
          // events de TOUS les projets, ce qui spammait debouncedReload
          // et réveille des reload inutiles sur projets cousins.
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

  // Sessions regroupées par membre_id pour lookup rapide depuis les composants
  // qui rendent une row (chips colorées, grille présence colorée…).
  // Map<membre_id, sessions[]>. Trie par sort_order assuré par le helper.
  const sessionsByMembre = useMemo(() => groupSessionsByMembre(sessions), [sessions])

  // Sync sessionsRef avec sessions (cf. déclaration plus haut). Hooké
  // après le setSessions pour que les callbacks lisent toujours la version
  // la plus récente plutôt que la version capturée dans la closure.
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

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

  // ─── Sessions (multi-séjours par membre) — Phase 0b ────────────────────
  //
  // Conventions :
  //   - Le drawer attache les sessions au PRINCIPAL row de la persona
  //     (= row sans parent_membre_id). Les rows enfants n'ont pas de
  //     sessions propres ; on lit le principal comme source.
  //   - Après chaque mutation on re-agrège les sessions + on synchronise
  //     `projet_membres.{arrival_date, departure_date, presence_days}`
  //     sur TOUTES les rows de la persona (= principal + enfants), via
  //     `syncMembreFromSessions(personaIds, sessions)`. C'est ce qui
  //     permet au reste de l'app (techlist, share, grille présence) de
  //     continuer à fonctionner sans changement.
  //
  // En cas d'erreur on reload tout (rollback simple).

  /** Helper interne : retourne tous les projet_membres.id de la persona à
   * laquelle appartient `membreId`. Inclut le passed-in id. */
  const getPersonaIds = useCallback((membreId) => {
    const target = members.find((m) => m.id === membreId)
    if (!target) return [membreId]
    const key = personaKey(target)
    return members.filter((m) => personaKey(m) === key).map((m) => m.id)
  }, [members])

  /** Helper interne : applique l'agrégat des sessions de `principalId` aux
   * rows persona (state local), pour que les composants qui lisent encore
   * `projet_membres.presence_days` voient la valeur immédiatement. */
  const applyAggregateToMembersState = useCallback((personaIds, sessionsForPrincipal) => {
    const agg = aggregateSessionsToMembre(sessionsForPrincipal)
    setMembers((prev) =>
      prev.map((m) => (personaIds.includes(m.id) ? { ...m, ...agg } : m)),
    )
  }, [])

  /**
   * Crée une nouvelle session pour le membre principal. `principalMembreId`
   * est l'ID du projet_membres principal (pas un enfant) — le drawer le
   * passe explicitement. `payload` contient label / dates / lieu / etc.
   *
   * sort_order est calculé automatiquement = MAX(existing) + 1.
   */
  const addSession = useCallback(async (principalMembreId, payload = {}) => {
    if (!principalMembreId) throw new Error('addSession: principalMembreId manquant')
    markLocal()
    // sessionsRef au lieu du closure `sessions` : si l'admin enchaîne
    // 2 ajouts rapides, le 2e callback voit déjà le 1er ajouté.
    const existing = sessionsRef.current.filter((s) => s.membre_id === principalMembreId)
    try {
      // sort_order est désormais calculé côté serveur par createSession
      // (avec retry sur conflit 23505). Le payload.sort_order n'est plus
      // utilisé — on le retire pour éviter le faux-sentiment qu'il est honoré.
      const created = await createSession(principalMembreId, payload)
      setSessions((prev) => [...prev, created])
      const updated = [...existing, created]
      const personaIds = getPersonaIds(principalMembreId)
      applyAggregateToMembersState(personaIds, updated)
      await syncMembreFromSessions(personaIds, updated)
      return created
    } catch (e) {
      console.error('[useCrew] addSession error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal, getPersonaIds, applyAggregateToMembersState])

  /**
   * Phase A/3 — fait rejoindre un membre à une session existante du
   * projet (= ajoute juste une participation, pas de nouvelle session
   * globale). Utilisé par les boutons "+ Template" en faible opacité
   * et par la confirmation "Rejoindre" du form "+ Nouvelle".
   *
   * `sessionId` est l'id de la session globale (= participation.session_id
   * dans le shape unifié).
   */
  const joinExistingSession = useCallback(async (principalMembreId, sessionId, payload = {}) => {
    if (!principalMembreId) throw new Error('joinExistingSession: principalMembreId manquant')
    if (!sessionId) throw new Error('joinExistingSession: sessionId manquant')
    markLocal()
    try {
      const created = await joinSession(principalMembreId, sessionId, payload)
      setSessions((prev) => [...prev, created])
      const personaIds = getPersonaIds(principalMembreId)
      // sessionsRef pour éviter la closure stale (cf. addSession).
      const principalSessions = sessionsRef.current.filter(
        (s) => s.membre_id === principalMembreId,
      )
      const updated = [...principalSessions, created]
      applyAggregateToMembersState(personaIds, updated)
      await syncMembreFromSessions(personaIds, updated)
      return created
    } catch (e) {
      console.error('[useCrew] joinExistingSession error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal, getPersonaIds, applyAggregateToMembersState])

  /**
   * Update une session (label, dates, lieu, couleur, statut, notes…).
   * Si des champs date/presence changent, on re-agrège et on sync les
   * rows persona derrière.
   *
   * Phase A/3 — propagation des SESSION-LEVEL fields : modifier le
   * label, lieu, couleur ou sort_order touche la SESSION GLOBALE
   * partagée → toutes les participations qui pointent vers la même
   * session_id voient le changement (côté DB c'est fait par split
   * dans lib/crew.js, côté state local on doit le propager pour
   * éviter d'attendre le Realtime ~2s).
   */
  // NB sur le naming : `participationId` reflète la sémantique réelle
  // (= projet_session_membres.id, l'`id` du shape unifié). L'ancien nom
  // `sessionId` était trompeur — c'est jamais l'id de la session globale.
  const updateMemberSession = useCallback(async (participationId, fields) => {
    if (!participationId) throw new Error('updateMemberSession: participationId manquant')
    const target = sessionsRef.current.find((s) => s.id === participationId)
    if (!target) {
      console.warn('[useCrew] updateMemberSession: participation introuvable', participationId)
      return null
    }
    markLocal()
    // Détermine quels SESSION-LEVEL fields sont touchés. Source unique :
    // SESSION_LEVEL_FIELDS importé depuis lib/crew.js — empêche le drift
    // crew.js (split DB) ↔ useCrew.js (propagation locale optimistic).
    const sessionLevelOverrides = {}
    for (const k of SESSION_LEVEL_FIELDS) {
      if (k in fields) sessionLevelOverrides[k] = fields[k]
    }
    const hasSessionLevel = Object.keys(sessionLevelOverrides).length > 0
    const sharedSessionId = target.session_id || null

    // Optimistic — propage SESSION-LEVEL aux participations partageant
    // la même session globale, persona-level fields restant locaux à
    // la participation cible.
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === participationId) return { ...s, ...fields }
        if (
          hasSessionLevel &&
          sharedSessionId &&
          s.session_id === sharedSessionId
        ) {
          return { ...s, ...sessionLevelOverrides }
        }
        return s
      }),
    )
    try {
      const updated = await updateSession(participationId, fields)
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === participationId) return updated
          // Re-applique sessionLevelOverrides aux autres participations
          // (le serveur a confirmé la valeur, on push la mise à jour
          // confirmée).
          if (
            hasSessionLevel &&
            sharedSessionId &&
            s.session_id === sharedSessionId
          ) {
            return { ...s, ...sessionLevelOverrides }
          }
          return s
        }),
      )
      // Re-agrège seulement si une date/presence a bougé (sinon inutile).
      const dateFieldsTouched =
        'arrival_date' in fields ||
        'departure_date' in fields ||
        'presence_days' in fields
      if (dateFieldsTouched) {
        const principalId = updated.membre_id
        const personaIds = getPersonaIds(principalId)
        // sessionsRef pour la version la plus fraîche (cf. note plus haut).
        const principalSessions = sessionsRef.current
          .filter((s) => s.membre_id === principalId)
          .map((s) => (s.id === participationId ? updated : s))
        if (!principalSessions.some((s) => s.id === participationId)) {
          principalSessions.push(updated)
        }
        applyAggregateToMembersState(personaIds, principalSessions)
        await syncMembreFromSessions(personaIds, principalSessions)
      }
      return updated
    } catch (e) {
      console.error('[useCrew] updateMemberSession error:', e)
      await reload()
      throw e
    }
  }, [reload, markLocal, getPersonaIds, applyAggregateToMembersState])

  /**
   * Supprime une session. Phase A : un membre peut désormais avoir 0
   * sessions sans casser quoi que ce soit (l'UI gère naturellement
   * l'état "aucune date saisie", cf. crew list qui affiche
   * "Cliquer pour configurer la présence" + drawer qui affiche
   * "+ Ajouter une session" en mode vide).
   *
   * L'ancienne garde "au moins 1 session par membre" était un héritage
   * du modèle Phase 0a et a été levée le 2026-05-07 — un membre sans
   * session = membre sans présence saisie, état parfaitement valide.
   */
  const removeSession = useCallback(async (participationId) => {
    if (!participationId) throw new Error('removeSession: participationId manquant')
    // sessionsRef : reflète l'état le plus frais (cf. note sessionsRef).
    const currentSessions = sessionsRef.current
    const target = currentSessions.find((s) => s.id === participationId)
    if (!target) return
    const principalId = target.membre_id
    const principalSessions = currentSessions.filter((s) => s.membre_id === principalId)
    markLocal()
    const snapshot = currentSessions
    setSessions((prev) => prev.filter((s) => s.id !== participationId))
    try {
      await deleteSession(participationId)
      const remaining = principalSessions.filter((s) => s.id !== participationId)
      const personaIds = getPersonaIds(principalId)
      applyAggregateToMembersState(personaIds, remaining)
      await syncMembreFromSessions(personaIds, remaining)
    } catch (e) {
      console.error('[useCrew] removeSession error:', e)
      setSessions(snapshot)
      await reload()
      throw e
    }
  }, [reload, markLocal, getPersonaIds, applyAggregateToMembersState])

  return {
    // data brut
    members,
    contacts,
    sessions,
    // dérivés
    personae,
    techlistRows,
    uncategorized,
    byCategory,
    categories,
    contactsById,
    sessionsByMembre,
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
    // Sessions (Phase 0b + A)
    addSession,
    joinExistingSession,
    updateMemberSession,
    removeSession,
  }
}
