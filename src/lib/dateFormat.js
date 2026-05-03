/**
 * dateFormat.js — Helpers de formatage de dates côté UI.
 *
 * Centralise les formats utilisés dans plusieurs PDFs et pages share, pour
 * éviter la duplication. Les helpers sont volontairement simples (pas de
 * dépendance externe à date-fns / luxon) pour rester légers.
 */

/**
 * "le 03/05/2026 à 00:18" — utilisé dans les footers de PDF et les hero
 * des pages share ("Mis à jour le …").
 */
export function formatDateTimeFR(isoOrDate) {
  if (!isoOrDate) return ''
  const d = new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `le ${dd}/${mm}/${yyyy} à ${hh}:${min}`
}

/**
 * "03/05/2026" — date courte pour badges et tableaux.
 */
export function formatDateFR(isoOrDate) {
  if (!isoOrDate) return ''
  const d = new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
