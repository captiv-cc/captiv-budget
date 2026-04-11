/**
 * Constantes partagées de la feature Projets.
 *
 * Première extraction lors du chantier refonte ProjetTab —
 * STATUS_OPTIONS était dupliqué entre Projets.jsx et ProjetTab.jsx,
 * on le centralise ici pour garantir un seul source of truth.
 */

// ─── Statut d'un projet (4 états) ────────────────────────────────────────────
export const STATUS_OPTIONS = [
  { value: 'prospect', label: 'Prospect', cls: 'badge-amber' },
  { value: 'en_cours', label: 'En cours', cls: 'badge-blue' },
  { value: 'termine',  label: 'Terminé',  cls: 'badge-green' },
  { value: 'annule',   label: 'Annulé',   cls: 'badge-gray' },
]

export function getStatusOption(value) {
  return STATUS_OPTIONS.find(s => s.value === value)
      || { value, label: value || '—', cls: 'badge-gray' }
}
