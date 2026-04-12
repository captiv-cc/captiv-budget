/**
 * StatusBadge — badge coloré indiquant le statut d'un devis.
 *
 * Statuts : brouillon, envoye, accepte, refuse.
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

const CLASS_MAP = {
  brouillon: 'badge-gray',
  envoye: 'badge-blue',
  accepte: 'badge-green',
  refuse: 'badge-red',
}

const LABEL_MAP = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`badge ${CLASS_MAP[status] || 'badge-gray'}`}>
      {LABEL_MAP[status] || status}
    </span>
  )
}
