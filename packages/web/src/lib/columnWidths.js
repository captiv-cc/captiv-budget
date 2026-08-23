// ════════════════════════════════════════════════════════════════════════════
// columnWidths — largeurs de colonnes réglables et mémorisées
// ════════════════════════════════════════════════════════════════════════════
//
// Les tableaux denses (autorisations musiques, livrables) ne conviennent pas
// à tout le monde de la même façon : selon l'écran et le travail du moment,
// on veut voir les titres en entier ou au contraire dégager la colonne des
// contacts. Chacun règle donc ses largeurs, gardées dans son navigateur.
//
// Logique pure ici (bornes, fusion, lecture/écriture), le hook et la poignée
// de redimensionnement vivent dans hooks/useColumnWidths.js.
// ════════════════════════════════════════════════════════════════════════════

const PREFIX = 'captiv.colw.'

// Une colonne trop étroite devient illisible, trop large elle chasse les
// autres hors de l'écran.
export const MIN_COL_WIDTH = 48
export const MAX_COL_WIDTH = 900

export function clampWidth(px) {
  const n = Math.round(Number(px) || 0)
  if (!Number.isFinite(n)) return MIN_COL_WIDTH
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, n))
}

/**
 * Largeurs effectives : les valeurs enregistrées priment sur les défauts,
 * mais une clé inconnue (colonne supprimée depuis) est ignorée — sinon un
 * ancien réglage figerait une colonne qui n'existe plus.
 */
export function mergeWidths(defaults = {}, stored = null) {
  const out = { ...defaults }
  if (!stored || typeof stored !== 'object') return out
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in defaults)) continue
    if (value == null) continue
    out[key] = clampWidth(value)
  }
  return out
}

export function readStoredWidths(storageKey) {
  if (!storageKey || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFIX + storageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Réglage corrompu : on repart des défauts plutôt que de casser la page.
    return null
  }
}

export function writeStoredWidths(storageKey, widths) {
  if (!storageKey || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREFIX + storageKey, JSON.stringify(widths || {}))
  } catch {
    /* quota plein ou navigation privée : le réglage vaut pour la session */
  }
}

export function clearStoredWidths(storageKey) {
  if (!storageKey || typeof localStorage === 'undefined') return
  localStorage.removeItem(PREFIX + storageKey)
}

// ─── Store partagé par clé ──────────────────────────────────────────────────
//
// Une page affiche souvent PLUSIEURS tableaux de même nature (un bloc de
// livrables par catégorie). Ils partagent la même clé, donc les mêmes
// largeurs — mais chaque composant a son propre état React : redimensionner
// dans un bloc laissait les autres en arrière jusqu'au rechargement, et les
// colonnes se désalignaient d'un bloc à l'autre.
//
// On tient donc les largeurs dans un petit store par clé, auquel toutes les
// instances s'abonnent : un geste dans un tableau déplace tous les autres.

const stores = new Map()

function ensureStore(storageKey, defaults) {
  let store = stores.get(storageKey)
  if (!store) {
    store = {
      widths: mergeWidths(defaults, readStoredWidths(storageKey)),
      listeners: new Set(),
    }
    stores.set(storageKey, store)
  }
  return store
}

export function subscribeWidths(storageKey, listener) {
  const store = ensureStore(storageKey, {})
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

/**
 * Référence STABLE tant que rien ne change : useSyncExternalStore boucle
 * indéfiniment si on lui rend un nouvel objet à chaque lecture.
 */
export function getWidths(storageKey, defaults) {
  return ensureStore(storageKey, defaults).widths
}

export function updateWidths(storageKey, updater) {
  const store = ensureStore(storageKey, {})
  const next = updater(store.widths)
  if (next === store.widths) return
  store.widths = next
  for (const listener of store.listeners) listener()
}

/** Réinitialise la clé (utilisé par « rétablir les largeurs » et les tests). */
export function resetWidthsStore(storageKey, defaults) {
  const store = ensureStore(storageKey, defaults)
  store.widths = { ...defaults }
  for (const listener of store.listeners) listener()
}
