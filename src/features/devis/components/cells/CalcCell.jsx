/**
 * CalcCell — cellule TD en lecture seule pour afficher un montant calculé.
 *
 * Format €, alignée à droite, tabular-nums. Affiche un tiret si le montant
 * est nul. Variante `dim` pour les sous-totaux discrets.
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

import { fmtEur } from '../../../../lib/cotisations'

export default function CalcCell({ val, cls = '', style = {}, dim = false }) {
  return (
    <td
      className={`text-right px-2 py-[3px] tabular-nums ${dim ? 'text-[11px]' : 'text-xs'} ${cls}`}
      style={style}
    >
      {val !== 0 ? fmtEur(val) : <span style={{ color: 'var(--txt-3)' }}>—</span>}
    </td>
  )
}
