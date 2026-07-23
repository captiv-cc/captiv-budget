// ════════════════════════════════════════════════════════════════════════════
// MaterielBulkBar — barre d'actions de la sélection multiple (MAT-OUTILS)
// ════════════════════════════════════════════════════════════════════════════
//
// Flottante en bas de l'écran quand ≥ 1 item sélectionné : définir le
// loueur (remplace), déplacer vers un bloc, poser un flag, supprimer.
// Les selects se réinitialisent après application (valeur = '').
// ════════════════════════════════════════════════════════════════════════════

import { Trash2, X } from 'lucide-react'
import { confirm } from '../../../lib/confirm'

const selectStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

export default function MaterielBulkBar({
  count,
  blocks = [],
  loueurs = [],
  onSetLoueur,
  onMove,
  onSetFlag,
  onDelete,
  onClear,
}) {
  if (!count) return null
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-xl flex-wrap justify-center"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <span className="text-xs font-bold shrink-0" style={{ color: 'var(--txt)' }}>
        {count} sélectionné{count > 1 ? 's' : ''}
      </span>

      <select
        value=""
        onChange={(e) => {
          if (e.target.value === '') return
          onSetLoueur(e.target.value === '__none__' ? null : e.target.value)
        }}
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={selectStyle}
        title="Définir le loueur (remplace les loueurs actuels)"
      >
        <option value="">Loueur…</option>
        <option value="__none__">Retirer les loueurs</option>
        {loueurs.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nom}
          </option>
        ))}
      </select>

      <select
        value=""
        onChange={(e) => e.target.value && onMove(e.target.value)}
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={selectStyle}
        title="Déplacer vers un bloc (en fin de bloc)"
      >
        <option value="">Déplacer vers…</option>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.titre}
          </option>
        ))}
      </select>

      <select
        value=""
        onChange={(e) => e.target.value && onSetFlag(e.target.value)}
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={selectStyle}
        title="Poser un flag sur la sélection"
      >
        <option value="">Flag…</option>
        <option value="ok">OK</option>
        <option value="attention">Attention</option>
        <option value="probleme">Problème</option>
      </select>

      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: `Supprimer ${count} item${count > 1 ? 's' : ''} ?`,
            message: 'Les items sélectionnés (checklists et loueurs compris) seront supprimés.',
            confirmLabel: 'Supprimer',
            danger: true,
          })
          if (ok) onDelete()
        }}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md"
        style={{ color: 'var(--red, #ff4757)', border: '1px solid var(--brd)' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
        Supprimer
      </button>

      <button type="button" onClick={onClear} className="p-1.5" style={{ color: 'var(--txt-3)' }} title="Annuler la sélection">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
