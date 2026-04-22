// ════════════════════════════════════════════════════════════════════════════
// ChecklistCells — triple checklist pré / post / prod
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche les trois checkboxes d'un item matos et gère leur toggle. Chaque
// case a une couleur distincte pour le scan visuel (vert, bleu, amber) et
// porte un tooltip "Pré validé · 20/04/2026 14:32" quand elle est cochée.
//
// Utilisé en mode détaillé (toggle global "Détails") ou plus simplement dans
// le pop-up d'édition d'une ligne. En mode compressé il n'apparaît pas —
// c'est l'ItemRow qui décide si oui/non il nous rend.
//
// Props :
//   - item : matos_item
//   - onToggle(type) : handler de toggle (type ∈ 'pre'|'post'|'prod')
//   - canEdit : boolean
//   - size : 'sm' | 'md' (défaut 'sm')
// ════════════════════════════════════════════════════════════════════════════

import { CheckSquare, Square } from 'lucide-react'
import { MATOS_CHECK_TYPES } from '../../../lib/materiel'

const CHECK_LABELS = {
  pre: 'Pré',
  post: 'Post',
  prod: 'Prod',
}

function checkColor(type) {
  //   pré  = vert  (matos prêt avant shoot)
  //   post = bleu  (matos vérifié au retour)
  //   prod = amber (matos utilisé en production)
  if (type === 'pre') return 'var(--green)'
  if (type === 'post') return 'var(--blue)'
  return 'var(--amber, #f59e0b)'
}

function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

export default function ChecklistCells({ item, onToggle, canEdit = true, size = 'sm' }) {
  const dim = size === 'md' ? 18 : 14
  return (
    <div className="flex items-center gap-1">
      {MATOS_CHECK_TYPES.map((type) => {
        const at = item[`${type}_check_at`]
        const checked = Boolean(at)
        const Icon = checked ? CheckSquare : Square
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle && onToggle(type)}
            disabled={!canEdit}
            className="inline-flex items-center justify-center rounded transition-all p-0.5"
            style={{
              color: checked ? checkColor(type) : 'var(--txt-3)',
              cursor: canEdit ? 'pointer' : 'default',
              opacity: canEdit ? 1 : 0.7,
            }}
            title={
              checked
                ? `${CHECK_LABELS[type]} validé · ${fmtDateTime(at)}`
                : `Marquer ${CHECK_LABELS[type]}`
            }
            aria-label={CHECK_LABELS[type]}
          >
            <Icon style={{ width: dim, height: dim }} />
          </button>
        )
      })}
    </div>
  )
}
