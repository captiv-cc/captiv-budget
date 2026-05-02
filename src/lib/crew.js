// ════════════════════════════════════════════════════════════════════════════
// crew.js — Data layer pour la tab Équipe / Tech list
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture :
//   projet_membres (par projet, déjà existant)
//     ├ contact_id  → contacts (annuaire org partagé)
//     └ devis_line_id → devis_lines (attribution depuis devis, optionnel)
//
//   1 personne sur 1 projet = potentiellement plusieurs rows projet_membres
//   (une row par ligne de devis attribuée). Les attributs persona-level
//   (category, sort_order, secteur, chauffeur, hebergement, presence_days,
//   couleur) sont stockés sur chaque row mais SYNCHRONISÉS par convention :
//   quand on update l'un d'entre eux, on update toutes les rows de la
//   personne en même temps via `bulkUpdateProjectMembers`.
//
// Principes :
//   - RLS DB (`projet_membres_org`) gère le scoping projet → org. On reste
//     naïf côté lib.
//   - Helpers purs (groupByPerson, condensePresenceDays, distributeForfait)
//     testés indépendamment dans crew.test.js.
//   - Mutations optimistic côté hook (useCrew) → reload final si erreur.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

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

/**
 * Liste les contacts de l'org (pour le ContactPicker).
 * Filtre les archivés côté JS (la table contacts a un champ `archived`).
 */
export async function fetchOrgContacts() {
  const { data, error } = await supabase
    .from('contacts')
    .select(`
      id, nom, prenom, email, telephone, ville,
      regime, specialite, tarif_jour_ref, archived
    `)
    .order('nom')
    .order('prenom')
  if (error) throw error
  return (data || []).filter((c) => !c.archived)
}


// ─── CRUD projet_membres ────────────────────────────────────────────────────

/**
 * Crée une attribution projet_membres. Le payload doit contenir au minimum
 * `project_id`. Toutes les autres colonnes ont des defaults (category =
 * 'PRODUCTION', sort_order = 0, presence_days = '{}', etc.).
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
 * Utilisé pour synchroniser les attributs persona-level sur toutes les
 * rows d'une même personne (category, sort_order, presence_days, etc.).
 */
export async function bulkUpdateProjectMembers(ids, fields) {
  if (!ids?.length) return
  const { error } = await supabase
    .from('projet_membres')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
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
 * Groupe une liste de projet_membres par persona (= 1 personne sur le
 * projet, qui peut avoir N rows attribuées).
 *
 * Retourne un Array de personae, chacune avec :
 *   - key             : l'identifiant pour les updates persona-level
 *   - contact_id      : si la personne est dans l'annuaire
 *   - contact         : l'objet contact joint (ou null)
 *   - category, sort_order, secteur, chauffeur, hebergement, presence_days,
 *     couleur, movinmotion_statut : valeurs prises depuis la 1ère row
 *     (les rows d'une même personne ont normalement les mêmes valeurs
 *     grâce à `bulkUpdateProjectMembers`)
 *   - members         : Array de toutes les rows projet_membres de la personne
 *
 * L'ordre est préservé : les personae apparaissent dans l'ordre de la 1ère
 * row qui les introduit.
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
        // Attributs persona-level (pris depuis la 1ère row)
        category: m.category || 'PRODUCTION',
        sort_order: m.sort_order ?? 0,
        secteur: m.secteur || null,
        chauffeur: Boolean(m.chauffeur),
        hebergement: m.hebergement || null,
        presence_days: m.presence_days || [],
        couleur: m.couleur || null,
        movinmotion_statut: m.movinmotion_statut || 'non_applicable',
        // Toutes les rows de la persona (pour le détail Attribution)
        members: [m],
      }
      byKey.set(key, persona)
      personae.push(persona)
    }
  }
  return personae
}

/**
 * Groupe les personae par catégorie.
 * Retourne `{ categoryName: Persona[] }`. Les catégories vides ne sont
 * PAS dans le résultat (à compléter côté UI avec `listCategories`).
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
 * Liste les catégories à afficher dans la techlist :
 *   1. Les 3 catégories par défaut (toujours, même vides)
 *   2. + les catégories custom utilisées (triées alpha)
 *
 * Permet d'avoir des sections vides "PRODUCTION" / "EQUIPE TECHNIQUE" /
 * "POST PRODUCTION" prêtes à recevoir des drops dès le premier render.
 */
export function listCategories(personae = []) {
  const used = new Set()
  for (const p of personae) {
    if (p.category) used.add(p.category)
  }
  const custom = [...used]
    .filter((c) => !DEFAULT_CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, 'fr'))
  return [...DEFAULT_CATEGORIES, ...custom]
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
