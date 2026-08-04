// ════════════════════════════════════════════════════════════════════════════
// previewVolume — volume global des previews audio du module Musiques
// ════════════════════════════════════════════════════════════════════════════
//
// Retour Hugo : impossible de baisser le son des previews (volume 0.7 en
// dur) — gênant en visio. Un seul réglage global, persisté en localStorage,
// lu par tous les créateurs d'Audio (MusiquesTab + PropositionDetailDrawer).

const KEY = 'musiques.previewVolume'
const DEFAULT = 0.7

export function getPreviewVolume() {
  try {
    const v = parseFloat(localStorage.getItem(KEY))
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  } catch {
    /* SSR / storage indisponible */
  }
  return DEFAULT
}

export function setPreviewVolume(v) {
  const clamped = Math.min(1, Math.max(0, Number(v) || 0))
  try {
    localStorage.setItem(KEY, String(clamped))
  } catch {
    /* ignore */
  }
  return clamped
}
