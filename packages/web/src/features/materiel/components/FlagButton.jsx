// ════════════════════════════════════════════════════════════════════════════
// FlagButton — bouton 3 états ok/attention/probleme
// ════════════════════════════════════════════════════════════════════════════
//
// Clic cycle : ok → attention → probleme → ok. Rendu d'un cercle coloré
// compact. Désactivé en mode lecture seule (affiche juste la pastille).
// ════════════════════════════════════════════════════════════════════════════

import { MATOS_FLAGS } from '../../../lib/materiel'

const FLAG_CYCLE = ['ok', 'attention', 'probleme']

export default function FlagButton({ flag = 'ok', onChange, canEdit = true, size = 'sm' }) {
  const def = MATOS_FLAGS[flag] || MATOS_FLAGS.ok
  const dim = size === 'sm' ? 14 : size === 'xs' ? 10 : 18

  function handleClick() {
    if (!canEdit || !onChange) return
    const idx = FLAG_CYCLE.indexOf(flag)
    const next = FLAG_CYCLE[(idx + 1) % FLAG_CYCLE.length]
    onChange(next)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canEdit}
      title={def.label}
      aria-label={`Flag: ${def.label}`}
      className="inline-flex items-center justify-center rounded-full transition-all shrink-0"
      style={{
        width: dim + 4,
        height: dim + 4,
        background: def.bg,
        border: `1.5px solid ${def.color}`,
        cursor: canEdit ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          width: dim - 6,
          height: dim - 6,
          borderRadius: '50%',
          background: def.color,
          display: 'block',
        }}
      />
    </button>
  )
}
