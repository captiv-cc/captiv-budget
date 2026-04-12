/**
 * AdditifRow — ligne d'additif (dépense hors-devis) dans le Budget Réel.
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { X } from 'lucide-react'
import { InlineInput, InlineNumberInput, StatusToggle } from './atoms'

export default function AdditifRow({ entry: a, odd, onChange, onDelete }) {
  return (
    <tr
      style={{
        background: odd ? 'rgba(255,174,0,.04)' : 'rgba(255,174,0,.02)',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      <td className="px-3 py-1.5">
        <InlineInput
          value={a.fournisseur || ''}
          placeholder="Fournisseur"
          onChange={(v) => onChange({ fournisseur: v })}
          style={{ color: 'var(--txt)', fontWeight: 500, fontSize: 12 }}
        />
      </td>
      <td className="px-3 py-1.5" colSpan={2}>
        <InlineInput
          value={a.description || ''}
          placeholder="Description de la dépense"
          onChange={(v) => onChange({ description: v })}
          style={{ color: 'var(--txt-3)', fontSize: 12 }}
        />
      </td>
      <td className="px-3 py-1.5 text-right">
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <span style={{ color: 'var(--txt-3)', fontSize: 10, fontStyle: 'italic' }}>
            hors devis
          </span>
          <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
          <InlineNumberInput
            value={a.montant_ht || 0}
            onChange={(v) => onChange({ montant_ht: v })}
            style={{
              color: a.montant_ht > 0 ? 'var(--red)' : 'var(--txt-3)',
              fontWeight: 600,
              fontSize: 12,
            }}
          />
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <StatusToggle
            isEstime={!a.montant_ht || a.montant_ht === 0}
            valide={Boolean(a.valide)}
            paye={Boolean(a.paye)}
            onConfirmAtPrevu={null}
            onTogglePaye={() => onChange({ paye: !a.paye })}
          />
          <button
            onClick={onDelete}
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}
