// ════════════════════════════════════════════════════════════════════════════
// creneauTypes.js — Helpers pour les types de créneaux V2
//                   (CORE universel + custom par projet)
// ════════════════════════════════════════════════════════════════════════════
//
// Le set CORE est défini dans lib/deroule.js (CRENEAU_TYPES + LABELS + COLORS).
// Les types CUSTOM sont stockés dans projects.creneau_types (JSONB) :
//
//   [
//     { key: 'pyro_test', libelle: 'Pyrotechnie test', couleur: '#FF5500', sort_order: 0 },
//     { key: 'maquillage', libelle: 'Maquillage', couleur: '#D946EF', sort_order: 1 },
//     ...
//   ]
//
// Décisions Hugo (validées) :
//   - Suppression d'un type custom utilisé → BLOQUÉ avec alerte
//   - Renommage : libellé change, key reste (créneaux suivent)
//   - Color picker libre
//   - Limit 20 types custom par projet
//   - Templates : copier types depuis un autre projet (dès V1)
//   - Pas d'icône pour V1
//   - Import IA : Claude reçoit seulement le core
//
// Le `type` sur un créneau est un text simple — peut matcher une key core
// OU une key custom du projet. Le frontend est responsable de la cohérence
// (pas de CHECK constraint en BDD).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import {
  CRENEAU_TYPES,
  CRENEAU_TYPE_LABELS,
  CRENEAU_TYPE_COLORS,
} from './deroule'

/** Limite stricte côté front. Pas de CHECK BDD pour rester souple. */
export const MAX_CUSTOM_TYPES = 20

/**
 * Schéma normalisé d'un type CORE pour l'unifier avec les types custom
 * dans le picker UI : { key, libelle, couleur, isCustom: false }.
 */
function coreTypesNormalized() {
  return CRENEAU_TYPES.map((key, idx) => ({
    key,
    libelle: CRENEAU_TYPE_LABELS[key] || key,
    couleur: CRENEAU_TYPE_COLORS[key],
    sort_order: idx,
    isCustom: false,
  }))
}

/**
 * Retourne la liste effective des types disponibles pour un projet :
 *   - tous les types CORE (toujours)
 *   - + les types custom du projet (projects.creneau_types)
 *
 * Ordre : core dans l'ordre défini, puis custom par sort_order.
 *
 * @param {object|null} project - le projet avec son champ creneau_types
 * @returns {Array<{key, libelle, couleur, sort_order, isCustom}>}
 */
export function getProjectCreneauTypes(project) {
  const core = coreTypesNormalized()
  if (!project?.creneau_types) return core
  const custom = Array.isArray(project.creneau_types)
    ? project.creneau_types
    : []
  const normalized = custom
    .filter((t) => t && t.key && t.libelle)
    .map((t) => ({
      key: t.key,
      libelle: t.libelle,
      couleur: t.couleur || CRENEAU_TYPE_COLORS.autre,
      sort_order: typeof t.sort_order === 'number' ? t.sort_order : 999,
      isCustom: true,
    }))
    .sort((a, b) => a.sort_order - b.sort_order)
  return [...core, ...normalized]
}

/**
 * Index par key d'une liste de types. Utile pour lookup O(1) côté composants.
 */
export function indexTypesByKey(types) {
  const m = new Map()
  for (const t of types || []) {
    if (t?.key) m.set(t.key, t)
  }
  return m
}

/**
 * Génère un key unique à partir d'un libellé (lowercase + accents retirés
 * + remplace espaces/symboles par underscores). Suffixe numérique si
 * collision avec un existing (core OU custom).
 *
 * @param {string} libelle - 'Pyrotechnie test 🎆'
 * @param {Array<{key}>} existingTypes - types déjà présents (core + custom)
 * @returns {string} 'pyrotechnie_test'
 */
export function libelleToKey(libelle, existingTypes = []) {
  const base =
    (libelle || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'type'
  const existingKeys = new Set(
    (existingTypes || []).map((t) => t.key).filter(Boolean),
  )
  if (!existingKeys.has(base)) return base
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}_${i}`
    if (!existingKeys.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

/**
 * Vérifie si un type custom est utilisé dans des créneaux du projet.
 * Retourne le nombre de créneaux qui l'utilisent. 0 = libre à supprimer.
 *
 * @param {string} projectId
 * @param {string} typeKey
 * @returns {Promise<number>}
 */
export async function countCreneauxUsingType(projectId, typeKey) {
  if (!projectId || !typeKey) return 0
  // Requête via JOIN sur projet_deroules pour filtrer par projet.
  // On compte les créneaux dont type = typeKey ET dont le déroulé
  // appartient au projet.
  const { count, error } = await supabase
    .from('projet_deroule_creneaux')
    .select('id, projet_deroules!inner(project_id)', {
      count: 'exact',
      head: true,
    })
    .eq('type', typeKey)
    .eq('projet_deroules.project_id', projectId)
  if (error) {
    console.warn('[creneauTypes] countCreneauxUsingType error', error)
    return 0
  }
  return count || 0
}

/**
 * Lit les types custom du projet (frais depuis BDD).
 */
export async function fetchProjectCustomTypes(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projects')
    .select('creneau_types')
    .eq('id', projectId)
    .single()
  if (error) {
    console.warn('[creneauTypes] fetchProjectCustomTypes error', error)
    return []
  }
  return Array.isArray(data?.creneau_types) ? data.creneau_types : []
}

/**
 * Écrit la liste complète des types custom du projet (replace all).
 */
export async function saveProjectCustomTypes(projectId, customTypes) {
  if (!projectId) throw new Error('projectId requis')
  if (!Array.isArray(customTypes)) throw new Error('customTypes doit être un array')
  if (customTypes.length > MAX_CUSTOM_TYPES) {
    throw new Error(`Maximum ${MAX_CUSTOM_TYPES} types personnalisés par projet`)
  }
  const { data, error } = await supabase
    .from('projects')
    .update({ creneau_types: customTypes })
    .eq('id', projectId)
    .select('creneau_types')
    .single()
  if (error) {
    console.warn('[creneauTypes] saveProjectCustomTypes error', error)
    throw error
  }
  return data?.creneau_types || []
}

/**
 * Helpers CRUD pratiques : ajoutent / éditent / suppriment un type custom
 * sur le projet. Toutes async, font un round-trip BDD (read-update-write).
 */

export async function addCustomType(projectId, { libelle, couleur }) {
  if (!libelle?.trim()) throw new Error('Libellé requis')
  if (!couleur) throw new Error('Couleur requise')
  const current = await fetchProjectCustomTypes(projectId)
  if (current.length >= MAX_CUSTOM_TYPES) {
    throw new Error(`Maximum ${MAX_CUSTOM_TYPES} types personnalisés atteint`)
  }
  // Génère un key unique (core + existing custom)
  const allExisting = [...coreTypesNormalized(), ...current]
  const key = libelleToKey(libelle, allExisting)
  const nextSortOrder =
    current.reduce((max, t) => Math.max(max, t.sort_order ?? 0), -1) + 1
  const newType = {
    key,
    libelle: libelle.trim(),
    couleur,
    sort_order: nextSortOrder,
  }
  const next = [...current, newType]
  await saveProjectCustomTypes(projectId, next)
  return newType
}

export async function updateCustomType(projectId, key, { libelle, couleur }) {
  if (!key) throw new Error('key requise')
  const current = await fetchProjectCustomTypes(projectId)
  const idx = current.findIndex((t) => t.key === key)
  if (idx === -1) throw new Error(`Type custom '${key}' introuvable`)
  const updated = { ...current[idx] }
  if (libelle?.trim()) updated.libelle = libelle.trim()
  if (couleur) updated.couleur = couleur
  const next = [...current]
  next[idx] = updated
  await saveProjectCustomTypes(projectId, next)
  return updated
}

/**
 * Supprime un type custom. Bloque si des créneaux l'utilisent (par défaut).
 * Passer { force: true } pour forcer (cas où le user accepte explicitement,
 * non recommandé V1).
 */
export async function removeCustomType(projectId, key, { force = false } = {}) {
  if (!key) throw new Error('key requise')
  if (!force) {
    const usage = await countCreneauxUsingType(projectId, key)
    if (usage > 0) {
      const err = new Error(
        `Ce type est utilisé par ${usage} créneau${usage > 1 ? 'x' : ''}. ` +
          `Supprime ou ré-affecte d'abord ces créneaux.`,
      )
      err.code = 'TYPE_IN_USE'
      err.usage = usage
      throw err
    }
  }
  const current = await fetchProjectCustomTypes(projectId)
  const next = current.filter((t) => t.key !== key)
  await saveProjectCustomTypes(projectId, next)
}

/**
 * Réordonne les types custom selon une liste de keys (les keys absents
 * sont placés à la fin dans leur ordre original).
 */
export async function reorderCustomTypes(projectId, orderedKeys) {
  if (!Array.isArray(orderedKeys)) throw new Error('orderedKeys requis')
  const current = await fetchProjectCustomTypes(projectId)
  const byKey = new Map(current.map((t) => [t.key, t]))
  const next = []
  let i = 0
  for (const k of orderedKeys) {
    const t = byKey.get(k)
    if (!t) continue
    next.push({ ...t, sort_order: i })
    byKey.delete(k)
    i += 1
  }
  // Reste éventuel
  for (const t of byKey.values()) {
    next.push({ ...t, sort_order: i })
    i += 1
  }
  await saveProjectCustomTypes(projectId, next)
  return next
}

/**
 * Copie tous les types custom d'un projet source vers un projet cible.
 * Stratégie : append (les types existants du target ne sont pas écrasés).
 * Si une key du source existe déjà côté target (ou correspond à un type
 * core), elle est régénérée avec suffixe.
 *
 * @returns {Promise<{added: number, skipped: number}>}
 */
export async function copyTypesFromProject(srcProjectId, dstProjectId) {
  if (!srcProjectId || !dstProjectId || srcProjectId === dstProjectId) {
    throw new Error('IDs projet source/cible invalides')
  }
  const srcTypes = await fetchProjectCustomTypes(srcProjectId)
  if (srcTypes.length === 0) return { added: 0, skipped: 0 }

  const dstTypes = await fetchProjectCustomTypes(dstProjectId)
  const room = MAX_CUSTOM_TYPES - dstTypes.length
  if (room <= 0) {
    throw new Error(
      `Le projet cible a déjà ${dstTypes.length}/${MAX_CUSTOM_TYPES} types personnalisés`,
    )
  }

  let nextSortOrder =
    dstTypes.reduce((max, t) => Math.max(max, t.sort_order ?? 0), -1) + 1
  const merged = [...dstTypes]
  let added = 0
  let skipped = 0
  for (const src of srcTypes) {
    if (added >= room) {
      skipped += 1
      continue
    }
    const allExisting = [...coreTypesNormalized(), ...merged]
    // Si la key source matche déjà un core ou un custom target, on régénère
    const collides = allExisting.some((t) => t.key === src.key)
    const key = collides ? libelleToKey(src.libelle, allExisting) : src.key
    merged.push({
      key,
      libelle: src.libelle,
      couleur: src.couleur,
      sort_order: nextSortOrder,
    })
    nextSortOrder += 1
    added += 1
  }
  await saveProjectCustomTypes(dstProjectId, merged)
  return { added, skipped }
}
