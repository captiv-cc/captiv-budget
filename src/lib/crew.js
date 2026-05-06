// ════════════════════════════════════════════════════════════════════════════
// crew.js — Data layer pour la tab Équipe / Tech list
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture :
//   projet_membres (par projet)
//     ├ contact_id        → contacts (annuaire org partagé)
//     ├ devis_line_id     → devis_lines (attribution depuis devis, optionnel)
//     └ parent_membre_id  → projet_membres.id (rattachement, optionnel)
//
//   1 personne sur 1 projet = potentiellement N rows projet_membres. Sur la
//   techlist, on n'affiche que les rows "principales" (parent_membre_id IS
//   NULL). Les rows rattachées (parent_membre_id != NULL) restent visibles
//   dans Attribution mais sont masquées de la techlist (cas typique : 1 row
//   "Cadreur" 3j + 1 row "Essais caméra" 1j → la 2ème est rattachée à la
//   1ère, sur la techlist on voit Alexandre une seule fois en "Cadreur"
//   avec un badge "+1 rôle rattaché").
//
// Niveau de données :
//   - PER-ROW (= spécifique à cette attribution) :
//       category, sort_order, devis_line_id, specialite, regime,
//       cout_estime, parent_membre_id, movinmotion_statut, budget_convenu
//   - PERSONA-LEVEL (= synchronisé sur toutes les rows de la même personne) :
//       secteur, hebergement, chauffeur, presence_days, couleur
//     Ces champs sont stockés sur chaque row mais updated en bulk via
//     `bulkUpdateProjectMembers` quand l'admin édite l'un d'eux.
//
//   `category` est PER-ROW (choix UX validé) : drag d'une seule ligne change
//   sa catégorie sans toucher aux autres rows de la même personne.
//
// Principes :
//   - RLS DB (`projet_membres_org`) gère le scoping projet → org.
//   - Helpers purs testés indépendamment dans crew.test.js.
//   - Mutations optimistic côté hook (useCrew) → reload final si erreur.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { aggregateSessionsToMembre } from './sessions'

// ─── Constantes ─────────────────────────────────────────────────────────────

/**
 * Catégories par défaut proposées par le front pour chaque projet.
 * L'utilisateur peut en ajouter (texte libre via UI) — la catégorie est
 * stockée en TEXT sur projet_membres, pas dans une table dédiée.
 */
export const DEFAULT_CATEGORIES = [
  'PRODUCTION',
  'EQUIPE TECHNIQUE',
  'POST PRODUCTION',
]

/**
 * Statuts MovinMotion (intermittent paie). Aligné sur la valeur stockée
 * en BDD (CHECK CONSTRAINT). Le label est ce qu'on affiche dans l'UI.
 *
 * Valeurs DB : non_applicable | a_integrer | integre | contrat_signe |
 * paie_en_cours | paie_terminee. On condense paie_en_cours dans
 * contrat_signe côté UI (cf. STEPS dans EquipeTab.jsx).
 */
export const CREW_STATUTS = [
  { key: 'non_applicable', label: 'À attribuer' },
  { key: 'a_integrer',     label: 'Recherche' },
  { key: 'integre',        label: 'Contacté' },
  { key: 'contrat_signe',  label: 'Validé' },
  { key: 'paie_terminee',  label: 'Réglé' },
]


// ─── Fetch helpers ──────────────────────────────────────────────────────────

/**
 * Charge tous les `projet_membres` d'un projet, avec :
 *   - le contact lié (annuaire org) si attribué
 *   - la ligne de devis liée (si attribution depuis devis)
 *
 * Tri : par category, puis sort_order, puis created_at (déterministe).
 */
export async function fetchProjectMembers(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_membres')
    .select(`
      *,
      contact:contacts(
        id, nom, prenom, email, telephone, ville,
        regime_alimentaire, taille_tshirt, permis, vehicule,
        specialite, tarif_jour_ref, user_id, regime,
        adresse, code_postal, pays, date_naissance
      ),
      devis_line:devis_lines(
        id, devis_id, produit, regime, quantite,
        tarif_ht, cout_ht, sort_order, category_id
      )
    `)
    .eq('project_id', projectId)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// ─── Sessions Phase A : modèle "session globale + participation" ────────────
//
// Le front consomme un shape "session unifié" qui n'a pas changé d'API
// depuis la Phase 0b — l'UI continue à manipuler des "sessions" avec
// les mêmes champs (id, membre_id, sort_order, label, lieu, couleur,
// presence_days, arrival_date, departure_date, statut, notes).
//
// MAIS en interne :
//   - L'`id` du shape unifié = id de la PARTICIPATION (projet_session_membres),
//     pas de la session globale (projet_sessions)
//   - Les champs SESSION-LEVEL (label, lieu, couleur, sort_order) viennent
//     de la session globale partagée → un update touche tous les participants
//   - Les champs PARTICIPATION-LEVEL (presence_days, arrival/departure,
//     statut, notes) sont propres au membre → un update touche que sa
//     participation
//   - Un nouveau champ `session_id` est exposé en plus, qui pointe vers
//     l'id de la session globale (utile pour Phase A/3 — détection
//     partage / fusion)
//
// La table legacy `projet_membres_sessions` a été DROP dans
// 20260506_drop_legacy_projet_membres_sessions.sql après vérification
// d'intégrité (toutes les rows source migrées 1:1 via le seed Phase A).

/** Champs édités côté SESSION GLOBALE (= partagés entre tous les participants).
 *  Exporté pour que useCrew.js réutilise EXACTEMENT la même liste lors de la
 *  propagation optimistic locale (single source of truth). Audit 2026-05-06 :
 *  une recopie locale dans useCrew.js manquait `start_date`/`end_date`, ce qui
 *  aurait provoqué un drift dès qu'on aurait branché ces champs côté UI. */
export const SESSION_LEVEL_FIELDS = [
  'label',
  'lieu_principal_text',
  'lieu_principal_id',
  'couleur',
  'sort_order',
  'start_date',
  'end_date',
]

/** Champs édités côté PARTICIPATION (= propres au membre). */
export const PARTICIPATION_LEVEL_FIELDS = [
  'presence_days',
  'arrival_date',
  'arrival_time',
  'departure_date',
  'departure_time',
  'statut',
  'notes',
]

/**
 * Aplatit une row participation+session en shape "session unifié" pour l'UI.
 * Préserve la compat de l'API existante (les composants ne voient pas la
 * distinction session globale / participation).
 */
export function flattenParticipation(p) {
  if (!p) return null
  const sess = p.session || {}
  return {
    id: p.id, // = participation.id
    membre_id: p.membre_id,
    session_id: p.session_id || sess.id || null,
    // SESSION-LEVEL (shared)
    sort_order: sess.sort_order ?? 1,
    label: sess.label ?? null,
    lieu_principal_text: sess.lieu_principal_text ?? null,
    lieu_principal_id: sess.lieu_principal_id ?? null,
    couleur: sess.couleur ?? null,
    // start_date/end_date sont SESSION-LEVEL : exposés en lecture seule pour
    // que la propagation optimistic locale (cf. useCrew.updateMemberSession)
    // les voie. L'UI Phase A actuelle ne les édite pas — chaque participant
    // pose ses dates persos dans arrival_date/departure_date.
    start_date: sess.start_date ?? null,
    end_date: sess.end_date ?? null,
    // PARTICIPATION-LEVEL (perso)
    presence_days: Array.isArray(p.presence_days) ? p.presence_days : [],
    arrival_date: p.arrival_date || null,
    arrival_time: p.arrival_time || null,
    departure_date: p.departure_date || null,
    departure_time: p.departure_time || null,
    statut: p.statut || 'planifie',
    notes: p.notes || null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

/**
 * Charge toutes les participations sessions des membres d'un projet, jointes
 * avec leur session globale. Renvoie un array dans le shape "session unifié".
 *
 * Filtrage par project_id via la jointure inner sur projet_sessions.
 */
export async function fetchProjectSessions(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_session_membres')
    .select(`
      id, session_id, membre_id,
      presence_days, arrival_date, arrival_time,
      departure_date, departure_time, statut, notes,
      created_at, updated_at,
      session:projet_sessions!inner(
        id, project_id, sort_order, label,
        lieu_principal_text, lieu_principal_id, couleur,
        start_date, end_date, statut, notes
      )
    `)
    .eq('session.project_id', projectId)
  if (error) {
    console.warn('[fetchProjectSessions] could not load sessions:', error?.message)
    return []
  }
  return (data || []).map(flattenParticipation)
}


// ─── CRUD sessions (Phase A — split session globale × participation) ───────

/**
 * Crée une nouvelle session globale + sa participation pour ce membre.
 * Modèle 1:1 — un appel ici crée toujours une session distincte. Pour
 * REJOINDRE une session existante (ex. les boutons "+ Template" en
 * faible opacité dans la modale Présence), voir `joinSession` ci-dessous.
 *
 * Le sort_order de la session globale est calculé en interne (MAX(project)+1)
 * pour respecter l'unique constraint (project_id, sort_order). On ignore
 * un éventuel `sort_order` dans le payload.
 *
 * @param {string} membreId  projet_membres.id du membre principal
 * @param {Object} payload   label, lieu, dates, presence_days, statut, notes
 * @returns {Object} la session unifiée (shape compat UI)
 */
export async function createSession(membreId, payload = {}) {
  if (!membreId) throw new Error('createSession: membreId manquant')

  // 1. Récupérer le project_id du membre (pour la session globale).
  const { data: member, error: e1 } = await supabase
    .from('projet_membres')
    .select('project_id')
    .eq('id', membreId)
    .single()
  if (e1) throw e1

  // 2. Créer la session globale. EQUIPE-AUDIT-FIX-D : on délègue le calcul
  //    de sort_order au trigger BEFORE INSERT côté serveur (migration
  //    20260506_equipe_sessions_phase_a_audit_fixes.sql) qui set
  //    sort_order = MAX+1 quand NULL. Avant : on calculait nextSortOrder
  //    côté client → le trigger se voyait passer une valeur non-NULL et
  //    SKIPPAIT son calcul → la race UNIQUE(project_id, sort_order) entre
  //    2 admins concurrents restait totalement ouverte malgré le retry
  //    (qui retombait sur le même MAX côté client).
  //    Le retry est conservé : le trigger lui-même peut aussi racer si 2
  //    transactions PostgreSQL passent leur SELECT MAX à la même fraction
  //    de seconde — auquel cas la 2e échoue avec 23505 et on relance.
  const presenceDays = Array.isArray(payload.presence_days) ? payload.presence_days : []
  let session = null
  let lastError = null
  for (let attempt = 0; attempt < 3 && !session; attempt++) {
    const { data, error: e2 } = await supabase
      .from('projet_sessions')
      .insert({
        project_id: member.project_id,
        // sort_order absent : le trigger projet_sessions_auto_sort_order
        // côté serveur calcule MAX+1 dans la même transaction.
        label: payload.label ?? null,
        start_date: payload.arrival_date ?? null,
        end_date: payload.departure_date ?? null,
        presence_days: presenceDays,
        lieu_principal_text: payload.lieu_principal_text ?? null,
        lieu_principal_id: payload.lieu_principal_id ?? null,
        couleur: payload.couleur ?? null,
        statut: payload.statut ?? 'planifie',
        notes: payload.notes ?? null,
      })
      .select('*')
      .single()
    if (!e2) {
      session = data
      break
    }
    lastError = e2
    // Code 23505 = unique_violation. On retry ; sinon on remonte l'erreur.
    if (e2.code !== '23505') break
  }
  if (!session) {
    throw new Error(
      `Création session échouée après plusieurs tentatives (race sort_order). ${lastError?.message || ''}`,
    )
  }

  // 3. Créer la participation pour ce membre (mêmes valeurs que session
  //    au début — l'admin pourra les diverger ensuite via updateSession).
  const { data: participation, error: e3 } = await supabase
    .from('projet_session_membres')
    .insert({
      session_id: session.id,
      membre_id: membreId,
      presence_days: presenceDays,
      arrival_date: payload.arrival_date ?? null,
      departure_date: payload.departure_date ?? null,
      statut: payload.statut ?? 'planifie',
      notes: null, // notes globales restent côté session
    })
    .select('*')
    .single()
  if (e3) throw e3

  // 4. Return shape unifié (avec session embarquée pour le flatten).
  return flattenParticipation({
    ...participation,
    session,
  })
}

/**
 * Phase A/3 — fait rejoindre un membre à une session globale EXISTANTE,
 * sans créer de nouvelle session. Crée juste 1 row dans
 * projet_session_membres pointant vers `sessionId`.
 *
 * Les valeurs initiales de la participation sont héritées de la session
 * globale (presence_days, start_date → arrival_date, end_date →
 * departure_date) sauf si le payload les override.
 *
 * UNIQUE (session_id, membre_id) en DB → erreur Postgres si le membre
 * est déjà participant. L'UI doit normalement éviter cet appel via les
 * filtres côté templates, mais si ça arrive l'erreur remonte propre.
 *
 * @param {string} membreId   projet_membres.id du membre à ajouter
 * @param {string} sessionId  projet_sessions.id de la session globale
 * @param {Object} payload    overrides optionnels (presence_days,
 *                            arrival_date, departure_date, statut, notes)
 * @returns {Object} la participation au shape "session unifié"
 */
export async function joinSession(membreId, sessionId, payload = {}) {
  if (!membreId) throw new Error('joinSession: membreId manquant')
  if (!sessionId) throw new Error('joinSession: sessionId manquant')

  // 1. Récupère la session globale pour les valeurs par défaut héritées.
  const { data: session, error: e1 } = await supabase
    .from('projet_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1

  // 2. Crée la participation. Defaults = valeurs de la session globale ;
  //    le payload peut override (ex. participer juste à une partie des
  //    jours, ou avoir un transit perso).
  const fallbackDays = Array.isArray(session.presence_days)
    ? session.presence_days
    : []
  const { data: participation, error: e2 } = await supabase
    .from('projet_session_membres')
    .insert({
      session_id: sessionId,
      membre_id: membreId,
      presence_days: Array.isArray(payload.presence_days)
        ? payload.presence_days
        : fallbackDays,
      arrival_date: payload.arrival_date ?? session.start_date ?? null,
      departure_date: payload.departure_date ?? session.end_date ?? null,
      statut: payload.statut ?? 'planifie',
      notes: payload.notes ?? null,
    })
    .select('*')
    .single()
  if (e2) {
    // Audit 2026-05-06 : UNIQUE(session_id, membre_id) renvoie code 23505
    // si le membre est déjà participant. Cas possible : Realtime out-of-
    // sync entre 2 admins, ou double-clic rapide sur un bouton template.
    // On normalise l'erreur en message lisible plutôt que de laisser
    // remonter le brut SQL "duplicate key value violates unique constraint…".
    if (e2.code === '23505') {
      throw new Error('Ce membre fait déjà partie de cette session.')
    }
    throw e2
  }

  return flattenParticipation({ ...participation, session })
}

/**
 * Update une session unifiée. Split le payload entre session-level et
 * participation-level, puis update les bonnes tables.
 *
 * Important : éditer un champ session-level (label/lieu/couleur) MET À
 * JOUR la session globale → tous les participants voient le changement.
 * C'est intentionnel — c'est le cœur de la Phase A.
 *
 * @param {string} participationId  projet_session_membres.id
 * @param {Object} fields           champs partiels à update
 * @returns {Object} la session unifiée à jour
 */
export async function updateSession(participationId, fields) {
  if (!participationId) throw new Error('updateSession: participationId manquant')

  const sessionFields = {}
  const partFields = {}
  for (const key of Object.keys(fields || {})) {
    if (SESSION_LEVEL_FIELDS.includes(key)) sessionFields[key] = fields[key]
    if (PARTICIPATION_LEVEL_FIELDS.includes(key)) partFields[key] = fields[key]
  }

  // Récupère le session_id si on doit toucher la session globale
  let sessionId = null
  if (Object.keys(sessionFields).length) {
    const { data: p, error } = await supabase
      .from('projet_session_membres')
      .select('session_id')
      .eq('id', participationId)
      .single()
    if (error) throw error
    sessionId = p.session_id
  }

  // Update participation si nécessaire
  if (Object.keys(partFields).length) {
    const { error } = await supabase
      .from('projet_session_membres')
      .update(partFields)
      .eq('id', participationId)
    if (error) throw error
  }

  // Update session globale si nécessaire (= propage à tous les participants)
  if (Object.keys(sessionFields).length && sessionId) {
    const { error } = await supabase
      .from('projet_sessions')
      .update(sessionFields)
      .eq('id', sessionId)
    if (error) throw error
  }

  // Re-fetch et return shape unifié à jour
  const { data: updated, error } = await supabase
    .from('projet_session_membres')
    .select(`
      id, session_id, membre_id,
      presence_days, arrival_date, arrival_time,
      departure_date, departure_time, statut, notes,
      created_at, updated_at,
      session:projet_sessions!inner(
        id, project_id, sort_order, label,
        lieu_principal_text, lieu_principal_id, couleur,
        start_date, end_date, statut, notes
      )
    `)
    .eq('id', participationId)
    .single()
  if (error) throw error
  return flattenParticipation(updated)
}

/**
 * Supprime une participation. Si c'était la dernière participation de la
 * session globale, supprime aussi la session globale (cleanup orphelin).
 *
 * Le caller (useCrew) vérifie côté UI qu'on ne supprime pas la dernière
 * session du MEMBRE (cohérence : un membre = au moins 1 session).
 */
export async function deleteSession(participationId) {
  if (!participationId) throw new Error('deleteSession: participationId manquant')

  // Récupère le session_id avant suppression
  const { data: p, error: e1 } = await supabase
    .from('projet_session_membres')
    .select('session_id')
    .eq('id', participationId)
    .single()
  if (e1) throw e1
  const sessionId = p.session_id

  // Supprime la participation
  const { error: e2 } = await supabase
    .from('projet_session_membres')
    .delete()
    .eq('id', participationId)
  if (e2) throw e2

  // Si plus aucune participation sur cette session globale → cleanup
  const { count, error: e3 } = await supabase
    .from('projet_session_membres')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
  if (e3) throw e3
  if (!count) {
    const { error: e4 } = await supabase
      .from('projet_sessions')
      .delete()
      .eq('id', sessionId)
    if (e4) throw e4
  }
}

/**
 * Re-synchronise `projet_membres.arrival_date / departure_date / presence_days`
 * depuis l'agrégat des sessions. Appelé après chaque create/update/delete de
 * session pour maintenir la rétrocompat (le reste de l'app — techlist, share,
 * grille présence — lit toujours ces colonnes-là).
 *
 * IMPORTANT : ces 3 champs sont persona-level (synchros sur toutes les rows
 * d'une même personne via bulkUpdate). Donc on accepte une LISTE d'IDs : le
 * caller (useCrew) lui passe toutes les rows de la persona — pour qu'on
 * écrive le même agrégat sur toutes (sinon on aurait des incohérences entre
 * la row "Cadreur" et la row "Essais cams" du même Hugo, par exemple).
 *
 * Le calcul se fait via `aggregateSessionsToMembre` (helper pur dans
 * lib/sessions.js) : earliest arrival_date, latest departure_date, union
 * dédoublonnée des presence_days.
 *
 * @param {string|string[]} membreIds projet_membres.id (ou liste — toutes
 *                                    les rows de la persona)
 * @param {Array}  sessions sessions du membre/persona (à jour)
 * @returns {Object} l'agrégat appliqué
 */
export async function syncMembreFromSessions(membreIds, sessions) {
  const ids = Array.isArray(membreIds) ? membreIds.filter(Boolean) : [membreIds].filter(Boolean)
  if (!ids.length) throw new Error('syncMembreFromSessions: membreIds manquant')
  const agg = aggregateSessionsToMembre(sessions)
  const { error } = await supabase
    .from('projet_membres')
    .update({
      arrival_date: agg.arrival_date,
      departure_date: agg.departure_date,
      presence_days: agg.presence_days,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
  if (error) throw error
  return agg
}


/**
 * Liste les contacts de l'org (pour le ContactPicker).
 * Filtre les inactifs côté JS via la colonne `actif` (boolean — true par défaut).
 * Note : la table contacts n'a pas de colonne `archived` ; on utilise `actif`
 * (la même que celle utilisée par la page /contacts pour archiver/restaurer).
 */
export async function fetchOrgContacts() {
  const { data, error } = await supabase
    .from('contacts')
    .select(`
      id, nom, prenom, email, telephone, ville,
      regime, specialite, tarif_jour_ref, actif
    `)
    .order('nom')
    .order('prenom')
  if (error) throw error
  // actif = false → contact désactivé/archivé, on l'exclut du picker.
  // actif null/undefined (legacy) → on l'inclut par défaut.
  return (data || []).filter((c) => c.actif !== false)
}


// ─── CRUD projet_membres ────────────────────────────────────────────────────

/**
 * Crée une attribution projet_membres. Le payload doit contenir au minimum
 * `project_id`. `category` est nullable : si absent, l'attribution apparaît
 * dans la boîte "À trier" de la techlist.
 */
export async function createProjectMember(payload) {
  const { data, error } = await supabase
    .from('projet_membres')
    .insert(payload)
    .select(`
      *,
      contact:contacts(*),
      devis_line:devis_lines(*)
    `)
    .single()
  if (error) throw error
  return data
}

/**
 * Update une attribution projet_membres. `fields` est un objet partiel.
 */
export async function updateProjectMember(id, fields) {
  const { data, error } = await supabase
    .from('projet_membres')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(`
      *,
      contact:contacts(*),
      devis_line:devis_lines(*)
    `)
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une attribution. Hard delete (pas de soft delete sur
 * projet_membres pour l'instant).
 */
export async function deleteProjectMember(id) {
  const { error } = await supabase
    .from('projet_membres')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Update plusieurs projet_membres en parallèle (même set de fields).
 * Utilisé pour synchroniser les attributs PERSONA-LEVEL sur toutes les
 * rows d'une même personne : secteur, hebergement, chauffeur, presence_days,
 * couleur. Les autres champs (category, sort_order, statut, etc.) sont
 * per-row et ne devraient pas passer par ce helper.
 */
export async function bulkUpdateProjectMembers(ids, fields) {
  if (!ids?.length) return
  const { error } = await supabase
    .from('projet_membres')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

/**
 * Champs persona-level (= synchronisés sur toutes les rows d'une même
 * personne sur le projet). Utilisé par useCrew.updatePersona pour ne
 * propager que les bons champs via bulkUpdate.
 *
 * P1.6 : ajout des champs arrivée + notes logistique.
 * P1.7 : ajout des champs retour (departure_date, departure_time).
 */
export const PERSONA_LEVEL_FIELDS = Object.freeze([
  'secteur',
  'hebergement',
  'chauffeur',
  'presence_days',
  'couleur',
  'arrival_date',
  'arrival_time',
  'departure_date',
  'departure_time',
  'logistique_notes',
  // P4.3 — Identité ad-hoc (contact_id IS NULL) : prenom/nom/email/telephone
  // sont stockés directement sur projet_membres. On les propage à toutes
  // les rows de la persona quand l'admin les édite via le drawer.
  // Pour les rows annuaire, ces champs sont normalement vides (la source
  // de vérité est contacts.*), donc bulkUpdate ne change rien d'observable.
  'prenom',
  'nom',
  'email',
  'telephone',
])

/**
 * Rattache une attribution à une autre (= "fusion" sur la techlist).
 * `childId` n'apparaîtra plus comme ligne principale ; il sera listé en
 * sous-élément de `parentId` dans la techlist + Attribution. Le parent doit
 * appartenir à la MÊME persona côté UI ; ici on reste naïf et on se fie à
 * l'admin (le front filtre la liste de parents possibles).
 */
export async function attachProjectMember(childId, parentId) {
  if (childId === parentId) {
    throw new Error('attachProjectMember: une row ne peut pas être son propre parent')
  }
  return updateProjectMember(childId, { parent_membre_id: parentId })
}

/**
 * Détache une attribution rattachée → elle redevient une ligne principale.
 */
export async function detachProjectMember(childId) {
  return updateProjectMember(childId, { parent_membre_id: null })
}


// ─── Création contact à la volée (depuis ContactPicker) ─────────────────────

/**
 * Crée un nouveau contact dans l'annuaire de l'org. Utilisé quand l'admin
 * ajoute une personne à la techlist mais qu'elle n'est pas encore dans
 * `contacts`. Le contact créé est immédiatement réutilisable sur d'autres
 * projets de la même org.
 *
 * Champs minimums : prenom + nom. Email/telephone optionnels.
 */
export async function createContactQuick(orgId, { prenom, nom, email, telephone }) {
  if (!orgId) throw new Error('createContactQuick: orgId manquant')
  if (!prenom?.trim() && !nom?.trim()) {
    throw new Error('createContactQuick: au moins prenom ou nom requis')
  }
  const payload = {
    org_id: orgId,
    prenom: prenom?.trim() || null,
    nom: nom?.trim() || null,
    email: email?.trim().toLowerCase() || null,
    telephone: telephone?.trim() || null,
  }
  const { data, error } = await supabase
    .from('contacts')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}


// ─── Helpers purs (testables indépendamment) ────────────────────────────────

/**
 * Clé d'identification d'une persona dans un projet.
 *
 * Si `contact_id` est renseigné → on utilise l'ID contact (cas normal).
 * Sinon → on retombe sur 'name:prenom|nom' (cas legacy / hors-BDD).
 *
 * Permet de regrouper les rows projet_membres qui pointent vers la même
 * personne, même quand elles n'ont pas encore de contact_id.
 */
export function personaKey(member) {
  if (member?.contact_id) return member.contact_id
  const prenom = (member?.prenom || '').trim()
  const nom = (member?.nom || '').trim()
  return `name:${prenom}|${nom}`
}

/**
 * Groupe une liste de projet_membres par persona (= 1 personne sur le projet,
 * qui peut avoir N rows attribuées). Utilisé pour les attributs persona-level
 * (secteur, hebergement, chauffeur, presence_days, couleur) qui sont stockés
 * sur chaque row mais représentent la personne.
 *
 * Retourne un Array de personae, chacune avec :
 *   - key             : l'identifiant pour les updates persona-level
 *   - contact_id      : si la personne est dans l'annuaire
 *   - contact         : l'objet contact joint (ou null)
 *   - secteur, chauffeur, hebergement, presence_days, couleur :
 *       valeurs prises depuis la 1ère row (les rows d'une même personne ont
 *       normalement les mêmes valeurs grâce à bulkUpdateProjectMembers)
 *   - members         : Array de toutes les rows projet_membres de la personne
 *
 * NOTE : depuis la P1.5, `category`, `sort_order` et `movinmotion_statut`
 * sont PER-ROW (= ne sont plus persona-level). On ne les expose plus sur la
 * persona — ils sont à lire directement sur chaque row.
 */
export function groupByPerson(members = []) {
  const personae = []
  const byKey = new Map()
  for (const m of members) {
    const key = personaKey(m)
    if (byKey.has(key)) {
      byKey.get(key).members.push(m)
    } else {
      const persona = {
        key,
        contact_id: m.contact_id || null,
        contact: m.contact || null,
        // Attributs persona-level (pris depuis la 1ère row, synchronisés
        // sur toutes les autres rows de la même personne par convention).
        secteur: m.secteur || null,
        chauffeur: Boolean(m.chauffeur),
        hebergement: m.hebergement || null,
        presence_days: m.presence_days || [],
        couleur: m.couleur || null,
        // Logistique (P1.6 + P1.7)
        arrival_date: m.arrival_date || null,
        arrival_time: m.arrival_time || null,
        departure_date: m.departure_date || null,
        departure_time: m.departure_time || null,
        logistique_notes: m.logistique_notes || null,
        // Toutes les rows de la persona (utiles pour bulkUpdate +
        // pour le drawer "Vue par membre").
        members: [m],
      }
      byKey.set(key, persona)
      personae.push(persona)
    }
  }
  return personae
}

/**
 * Construit la liste des "rows techlist" affichées dans la Tech list :
 *   1. Filtre les rows principales (parent_membre_id IS NULL).
 *   2. Pour chacune, attache la liste de ses rattachées (children) +
 *      les attributs persona-level dérivés (depuis n'importe quelle row de
 *      la persona — typiquement la 1ère).
 *   3. Trie par (category — null en premier pour "À trier"), puis sort_order,
 *      puis created_at.
 *
 * Chaque row retournée a la forme :
 *   { ...projet_membre, persona: { secteur, chauffeur, ...}, attached: [...] }
 *
 * Ne mute pas les inputs.
 */
export function listTechlistRows(members = []) {
  if (!members?.length) return []

  // Index des rows principales par id (pour rattacher les children)
  const principals = []
  const childrenByParent = new Map()
  for (const m of members) {
    if (m.parent_membre_id) {
      const arr = childrenByParent.get(m.parent_membre_id) || []
      arr.push(m)
      childrenByParent.set(m.parent_membre_id, arr)
    } else {
      principals.push(m)
    }
  }

  // Map persona-level depuis la 1ère row de chaque persona
  const personae = groupByPerson(members)
  const personaByKey = new Map(personae.map((p) => [p.key, p]))

  // Enrichissement
  const rows = principals.map((m) => {
    const pkey = personaKey(m)
    const persona = personaByKey.get(pkey) || null
    return {
      ...m,
      persona,            // attributs persona-level (secteur, ...)
      persona_key: pkey,  // pour les updates persona-level
      attached: childrenByParent.get(m.id) || [], // rows rattachées
    }
  })

  // Tri stable : category (null en premier), puis sort_order, puis created_at
  rows.sort((a, b) => {
    const ca = a.category ?? ''
    const cb = b.category ?? ''
    if (ca !== cb) {
      // null/'' vient avant les autres
      if (!ca) return -1
      if (!cb) return 1
      return ca.localeCompare(cb, 'fr')
    }
    const sa = a.sort_order ?? 0
    const sb = b.sort_order ?? 0
    if (sa !== sb) return sa - sb
    return (a.created_at || '').localeCompare(b.created_at || '')
  })

  return rows
}

/**
 * Partitionne une liste de rows techlist en :
 *   - uncategorized : rows avec category IS NULL ou '' (= "À trier")
 *   - byCategory    : { categoryName: Row[] } pour les autres
 *
 * Les catégories vides ne sont PAS dans byCategory ; à compléter côté UI
 * avec `listCategories`.
 */
export function partitionByCategory(rows = []) {
  const uncategorized = []
  const byCategory = {}
  for (const r of rows) {
    const cat = r.category || null
    if (!cat) {
      uncategorized.push(r)
    } else {
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(r)
    }
  }
  return { uncategorized, byCategory }
}

/**
 * Liste les catégories à afficher dans la techlist :
 *   1. Les 3 catégories par défaut (toujours, même vides)
 *   2. + les catégories custom utilisées (triées alpha)
 *
 * Permet d'avoir des sections vides "PRODUCTION" / "EQUIPE TECHNIQUE" /
 * "POST PRODUCTION" prêtes à recevoir des drops dès le premier render.
 *
 * Accepte soit un Array de personae, soit un Array de rows enrichies (les
 * deux ont une `category` lisible directement).
 */
export function listCategories(items = []) {
  const used = new Set()
  for (const item of items) {
    if (item?.category) used.add(item.category)
  }
  const custom = [...used]
    .filter((c) => !DEFAULT_CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, 'fr'))
  return [...DEFAULT_CATEGORIES, ...custom]
}

/**
 * Backwards compat : groupe les personae par catégorie. Conservé pour les
 * tests existants ; le nouveau flux passe par listTechlistRows + partitionByCategory.
 */
export function groupByCategory(personae = []) {
  const map = {}
  for (const p of personae) {
    const cat = p.category || 'PRODUCTION'
    if (!map[cat]) map[cat] = []
    map[cat].push(p)
  }
  return map
}

/**
 * Groupe les rows de techlist par catégorie pour les vues read-only :
 *   - Vue seule (EquipePreviewModal)
 *   - Export PDF (equipeTechlistPdfExport)
 *   - Page partage publique (EquipeShareSession)
 *
 * Ordre des sections :
 *   1. "À TRIER" (rows sans category) toujours en premier, si présent
 *   2. Les catégories listées dans `categoryOrder` (dans l'ordre fourni),
 *      uniquement celles qui ont au moins une row
 *   3. Les catégories restantes (présentes dans les rows mais hors
 *      categoryOrder) : DEFAULT_CATEGORIES en premier (PRODUCTION / EQUIPE
 *      TECHNIQUE / POST PRODUCTION) puis les custom dans l'ordre d'apparition
 *
 * Si `categoryOrder` est vide ou null, on retombe sur l'ancien
 * comportement (À TRIER → DEFAULT_CATEGORIES → custom).
 *
 * @param {Array<{ category: string|null }>} membres
 * @param {Array<string>=} categoryOrder
 * @returns {Array<{ key: string, label: string, rows: Array, isUncategorized: boolean }>}
 */
export function groupTechlistByCategory(membres = [], categoryOrder = []) {
  const A_TRIER = '__a_trier__'
  const buckets = new Map()
  for (const m of membres || []) {
    const cat = m?.category || A_TRIER
    if (!buckets.has(cat)) buckets.set(cat, [])
    buckets.get(cat).push(m)
  }

  const out = []
  const seen = new Set()

  // 1. À TRIER toujours en premier
  if (buckets.has(A_TRIER)) {
    out.push({
      key: A_TRIER,
      label: 'À TRIER',
      rows: buckets.get(A_TRIER),
      isUncategorized: true,
    })
    seen.add(A_TRIER)
  }

  // 2. Ordre custom (cf. localStorage equipe.categoryOrder + project.metadata)
  const order = Array.isArray(categoryOrder) ? categoryOrder : []
  for (const cat of order) {
    if (cat && buckets.has(cat) && !seen.has(cat)) {
      out.push({
        key: cat,
        label: cat,
        rows: buckets.get(cat),
        isUncategorized: false,
      })
      seen.add(cat)
    }
  }

  // 3. Reste : DEFAULT_CATEGORIES en priorité, puis custom dans l'ordre
  //    d'apparition dans les rows. On évite de doublonner les catégories
  //    déjà placées par categoryOrder.
  for (const cat of DEFAULT_CATEGORIES) {
    if (buckets.has(cat) && !seen.has(cat)) {
      out.push({
        key: cat,
        label: cat,
        rows: buckets.get(cat),
        isUncategorized: false,
      })
      seen.add(cat)
    }
  }
  for (const [cat, rows] of buckets.entries()) {
    if (cat === A_TRIER || seen.has(cat)) continue
    out.push({
      key: cat,
      label: cat,
      rows,
      isUncategorized: false,
    })
    seen.add(cat)
  }

  return out
}

/**
 * Condense une liste de jours ISO ('YYYY-MM-DD') en plages consécutives
 * pour l'affichage compact dans la techlist.
 *
 * Exemples :
 *   ['2026-04-08', '2026-04-09', '2026-04-10']           → '08-10/04'
 *   ['2026-04-08', '2026-04-12']                          → '08/04, 12/04'
 *   ['2026-04-08', '2026-04-09', '2026-04-12']            → '08-09/04, 12/04'
 *   ['2026-04-29', '2026-04-30', '2026-05-01']            → '29/04-01/05'
 *
 * Sécurise les inputs : trie + filtre les dates malformées.
 */
// ─── Logistique : helpers arrival_date / departure_date ─────────────────────
// Compare un ISO YYYY-MM-DD à un membre / persona pour savoir si c'est son
// jour d'arrivée (= il atterrit ce jour-là sur le projet) ou de retour (= il
// repart ce jour-là vers chez lui). Tolère les nullables et les formats
// inattendus — retourne false dans le doute.
//
// Usage :
//   isArrivalDay(membre, '2026-05-13')   → true si membre.arrival_date === '2026-05-13'
//   isDepartureDay(membre, '2026-05-17') → true si membre.departure_date === '2026-05-17'
//
// Utilisé pour overlay les icônes plane dans les grilles de présence
// (EquipePreviewModal, EquipeShareSession, PDF export).
export function isArrivalDay(persona, iso) {
  if (!persona || !iso) return false
  return persona.arrival_date === iso
}
export function isDepartureDay(persona, iso) {
  if (!persona || !iso) return false
  return persona.departure_date === iso
}

// ─── Calcul de la grille présence ──────────────────────────────────────────
// Construit la liste de jours à afficher dans la grille de présence d'une
// techlist (+ identifie ceux qui sont des "jours de transit"). Algorithme :
//
//   1. Collecte presence_days de tous les membres → tournageSet
//   2. Si quelqu'un a arrival_date ou departure_date HORS plage tournage,
//      on étend la plage contiguë pour inclure ces jours.
//   3. Les jours hors plage tournage (ajoutés à cause du transit) sont
//      marqués dans transitSet — la UI les rend différemment (italique +
//      opacité + pictogramme ✈).
//
// Résultat : grille minimale par défaut (= juste les jours de tournage), mais
// qui s'étend automatiquement pour montrer les arrivées avant le shoot ou
// les retours après. Les jours intermédiaires entre transit lointain et
// tournage figurent aussi (cellules vides) pour préserver la lecture
// chronologique. Cas typique : quelqu'un arrive J-1, repart J+1 → on ajoute
// 2 colonnes de transit (1 avant, 1 après).
//
// @param {Array<{presence_days?, arrival_date?, departure_date?}>} members
// @param {{ extraTournageDays?: string[] }} [opts]
//   - extraTournageDays : ISO additionnels à compter comme jours de tournage
//     même si aucun membre n'a `presence_days` dessus (ex. dates de tournage
//     du projet remontées par useEvents). Utile pour s'assurer que le shoot
//     full apparaît dans la grille même si certains jours sont off.
// @returns {{ days: string[], transitSet: Set<string> }}
//   - days : array d'ISO YYYY-MM-DD, plage contiguë triée
//   - transitSet : Set des ISO qui sont du transit pur (hors tournage)
export function computePresenceColumns(members = [], { extraTournageDays = [] } = {}) {
  const tournageSet = new Set()
  for (const d of extraTournageDays) {
    if (typeof d === 'string') tournageSet.add(d)
  }
  for (const m of members) {
    for (const d of m?.presence_days || []) {
      if (typeof d === 'string') tournageSet.add(d)
    }
  }
  // Pas de présence du tout → on retombe juste sur les transits, sans plage
  // contiguë (on ne peut pas étendre autour de "rien").
  if (tournageSet.size === 0) {
    const onlyTransits = new Set()
    for (const m of members) {
      if (m?.arrival_date) onlyTransits.add(m.arrival_date)
      if (m?.departure_date) onlyTransits.add(m.departure_date)
    }
    const sorted = [...onlyTransits].sort()
    return { days: sorted, transitSet: onlyTransits }
  }

  const tournageSorted = [...tournageSet].sort()
  const minTournage = tournageSorted[0]
  const maxTournage = tournageSorted[tournageSorted.length - 1]

  // Étend la plage avec les arrival/departure hors tournage.
  let minOverall = minTournage
  let maxOverall = maxTournage
  for (const m of members) {
    if (m?.arrival_date && m.arrival_date < minOverall) minOverall = m.arrival_date
    if (m?.arrival_date && m.arrival_date > maxOverall) maxOverall = m.arrival_date
    if (m?.departure_date && m.departure_date < minOverall) minOverall = m.departure_date
    if (m?.departure_date && m.departure_date > maxOverall) maxOverall = m.departure_date
  }

  // Génère la plage contiguë min..max (jour par jour, en local time pour
  // éviter les décalages UTC).
  const parse = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
  }
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = parse(minOverall)
  const end = parse(maxOverall)
  const days = []
  if (start && end) {
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      days.push(fmt(new Date(t)))
    }
  } else {
    // Fallback : ISO mal formé → juste retourner le tournage trié
    days.push(...tournageSorted)
  }

  // transitSet : tout ce qui est dans `days` mais < minTournage ou > maxTournage
  // (on ne marque PAS comme transit les jours off au milieu du tournage).
  const transitSet = new Set()
  for (const d of days) {
    if (d < minTournage || d > maxTournage) transitSet.add(d)
  }

  return { days, transitSet }
}

export function condensePresenceDays(days = []) {
  if (!days?.length) return ''
  const parsed = [...days]
    .map((d) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
      return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), iso: d } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.iso.localeCompare(b.iso))

  if (!parsed.length) return ''

  const ranges = []
  let start = parsed[0]
  let end = parsed[0]
  for (let i = 1; i < parsed.length; i += 1) {
    const cur = parsed[i]
    const prev = new Date(end.y, end.mo - 1, end.d)
    const curD = new Date(cur.y, cur.mo - 1, cur.d)
    const diff = Math.round((curD - prev) / 86400000)
    if (diff === 1) {
      end = cur
    } else {
      ranges.push([start, end])
      start = cur
      end = cur
    }
  }
  ranges.push([start, end])

  return ranges
    .map(([s, e]) => {
      if (s.iso === e.iso) {
        return `${pad2(s.d)}/${pad2(s.mo)}`
      }
      if (s.mo === e.mo && s.y === e.y) {
        return `${pad2(s.d)}-${pad2(e.d)}/${pad2(s.mo)}`
      }
      return `${pad2(s.d)}/${pad2(s.mo)}-${pad2(e.d)}/${pad2(e.mo)}`
    })
    .join(', ')
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Calcule la ventilation d'un forfait global sur les lignes attribuées
 * à une personne. Utilisé par l'assistant "Forfait global" dans la vue
 * Attribution.
 *
 * @param {Array<{id, cout_estime}>} lines - lignes attribuées à la personne
 * @param {number} totalForfait - montant total négocié
 * @param {'prorata'|'equiparti'} mode - stratégie de répartition (default: prorata)
 * @returns {Map<lineId, newBudgetConvenu>} - Map id → nouveau budget_convenu
 *
 * Mode 'prorata' : chaque ligne reçoit (cout_estime / total_cout_estime) × forfait
 * Mode 'equiparti' : chaque ligne reçoit forfait / nb_lignes
 *
 * Arrondi à 2 décimales. La dernière ligne absorbe le reste pour que la
 * somme exacte = forfait (évite les centimes perdus aux arrondis).
 *
 * Cas dégénérés :
 *   - lines vide ou totalForfait nul → Map vide
 *   - en mode prorata, total_cout_estime = 0 → fallback automatique sur
 *     equiparti (sinon on diviserait par 0)
 */
export function distributeForfait(lines = [], totalForfait = 0, mode = 'prorata') {
  if (!lines?.length || !totalForfait) return new Map()
  const result = new Map()

  const totalCout = lines.reduce((s, l) => s + (Number(l.cout_estime) || 0), 0)
  const useEquiparti = mode === 'equiparti' || totalCout === 0

  let acc = 0
  lines.forEach((l, i) => {
    const isLast = i === lines.length - 1
    let v
    if (useEquiparti) {
      v = isLast ? round2(totalForfait - acc) : round2(totalForfait / lines.length)
    } else {
      const ratio = (Number(l.cout_estime) || 0) / totalCout
      v = isLast ? round2(totalForfait - acc) : round2(totalForfait * ratio)
    }
    result.set(l.id, v)
    acc += v
  })
  return result
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Helper d'affichage : nom complet d'une persona.
 * Priorise contact joint, fallback sur les champs locaux du projet_membre.
 */
export function fullNameFromPersona(persona) {
  const c = persona?.contact
  const prenom = c?.prenom || persona?.members?.[0]?.prenom || ''
  const nom = c?.nom || persona?.members?.[0]?.nom || ''
  return `${prenom} ${nom}`.trim() || '—'
}

/**
 * Helper d'affichage : initiales pour avatar (2 lettres max, uppercase).
 */
export function initialsFromPersona(persona) {
  const c = persona?.contact
  const prenom = c?.prenom || persona?.members?.[0]?.prenom || ''
  const nom = c?.nom || persona?.members?.[0]?.nom || ''
  const i = ((prenom[0] || '') + (nom[0] || '')).toUpperCase()
  return i || '?'
}

/**
 * Helper d'affichage : ville (= secteur effectif). Ordre de priorité :
 *   1. crew_members.secteur (override projet-spécifique)
 *   2. contacts.ville (annuaire org)
 */
export function effectiveSecteur(persona) {
  if (persona?.secteur) return persona.secteur
  return persona?.contact?.ville || null
}
