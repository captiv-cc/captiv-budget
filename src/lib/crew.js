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
 * P1.6 : ajout des champs logistique (arrival_date, arrival_time,
 * logistique_notes) — tous persona-level car une personne a un seul jour
 * d'arrivée / un seul transport, indépendamment de ses N rôles.
 */
export const PERSONA_LEVEL_FIELDS = Object.freeze([
  'secteur',
  'hebergement',
  'chauffeur',
  'presence_days',
  'couleur',
  'arrival_date',
  'arrival_time',
  'logistique_notes',
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
        // Logistique (P1.6)
        arrival_date: m.arrival_date || null,
        arrival_time: m.arrival_time || null,
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
