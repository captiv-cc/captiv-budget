/**
 * LineRow — ligne d'un devis dans le Budget Réel.
 * Affiche : produit + tags (régime/description), prestataire ou sélecteur
 * fournisseur, prix vendu, coût prévu→réel éditable inline, statut 3 états.
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { useState, useRef } from 'react'
import { Check, Lock } from 'lucide-react'
import { fmtEur } from '../../../lib/cotisations'
import { RegimeBadge, StatusToggle } from './atoms'
import FournisseurSelect from './FournisseurSelect'

export default function LineRow({
  line,
  prixVenteHT,
  coutPrevu,
  hasConvenu,
  prestataire,
  isIntermittent,
  isHuman,
  entry,
  ecart,
  odd,
  fournisseurId,
  fournisseurs,
  otherEmptyInBloc,
  onSave,
  onClear,
  onConfirmAtPrevu,
  onSelectFournisseur,
  onApplyFournisseurToBloc,
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [hover, setHover] = useState(false)
  const inputRef = useRef(null)

  const coutReel = entry?.montant_ht ?? null
  const valide = entry?.valide ?? false
  const paye = entry?.paye ?? false
  const isEstime = coutReel == null // état #3

  const ecartColor =
    ecart == null
      ? null
      : ecart > 0.005
        ? 'var(--red)'
        : ecart < -0.005
          ? 'var(--green)'
          : 'var(--txt-3)'

  function startEdit() {
    setEditVal(coutReel != null ? String(coutReel) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const trimmed = (editVal ?? '').trim()
    if (trimmed === '') {
      // Vidé → efface l'entrée et revient à "estimé" (coût prévu en italique)
      if (entry) onClear?.()
    } else {
      const val = parseFloat(trimmed)
      if (!isNaN(val)) {
        onSave({
          montant_ht: val,
          valide: entry?.valide ?? false,
          paye: entry?.paye ?? false,
          tva_rate: entry?.tva_rate ?? 20,
        })
      }
    }
    setEditing(false)
  }

  const rowBg = isEstime ? 'rgba(255,174,0,.04)' : odd ? 'var(--bg-elev)' : 'var(--bg-surf)'

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: rowBg,
        borderBottom: '1px solid var(--brd-sub)',
        borderLeft: isEstime ? '2px solid rgba(255,174,0,.45)' : '2px solid transparent',
      }}
    >
      {/* Produit + tags (régime + description) sur ligne unique sous le nom */}
      <td className="px-3 py-2">
        <p
          className="font-medium"
          style={{
            color: 'var(--txt)',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {line.produit || '—'}
        </p>
        {(line.regime || line.description) && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {line.regime && <RegimeBadge regime={line.regime} />}
            {line.description && (
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  letterSpacing: '0.03em',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={line.description}
              >
                {line.description}
              </span>
            )}
          </div>
        )}
      </td>

      {/* Prestataire / Fournisseur */}
      <td className="px-3 py-2">
        {isHuman && prestataire ? (
          /* Ligne humaine avec membre assigné → nom fixe */
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium" style={{ color: 'var(--txt)' }}>
              {prestataire}
            </span>
            {hasConvenu && (
              <Lock
                className="w-3 h-3 shrink-0"
                style={{ color: 'var(--purple)' }}
                title="Tarif convenu (négocié)"
              />
            )}
          </span>
        ) : (
          /* Ligne tech/frais ou sans membre → sélecteur fournisseur */
          <FournisseurSelect
            fournisseurId={fournisseurId}
            fournisseurs={fournisseurs || []}
            otherEmptyInBloc={otherEmptyInBloc}
            onSelect={onSelectFournisseur}
            onApplyToBloc={onApplyFournisseurToBloc}
          />
        )}
      </td>

      {/* Vendu HT */}
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="font-semibold" style={{ color: 'var(--blue)' }}>
          {fmtEur(prixVenteHT)}
        </span>
      </td>

      {/* Coût prévu → réel (colonne fusionnée, éditable au clic) */}
      <td
        className="px-3 py-2 text-right tabular-nums"
        onClick={!editing ? startEdit : undefined}
        style={{ cursor: editing ? 'default' : 'text' }}
      >
        {editing ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className="font-semibold" style={{ color: 'var(--amber)' }}>
              {fmtEur(coutPrevu)}
            </span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <input
              ref={inputRef}
              type="number"
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') setEditing(false)
              }}
              style={{
                width: 80,
                textAlign: 'right',
                background: 'var(--bg-elev)',
                border: '1px solid var(--blue)',
                borderRadius: 6,
                color: 'var(--txt)',
                padding: '2px 6px',
                fontSize: 12,
                outline: 'none',
              }}
              placeholder="0.00"
              step="0.01"
            />
          </span>
        ) : coutReel != null ? (
          /* États #1 et #2 — valeur saisie : prévu → réel + écart sous-ligne */
          <span>
            <span className="inline-flex items-baseline justify-end gap-1.5">
              <span className="font-semibold" style={{ color: 'var(--amber)' }}>
                {fmtEur(coutPrevu)}
              </span>
              <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
              <span className="font-semibold" style={{ color: ecartColor ?? 'var(--txt)' }}>
                {fmtEur(coutReel)}
              </span>
            </span>
            {ecart != null && Math.abs(ecart) > 0.005 ? (
              <span style={{ fontSize: 9, color: ecartColor, display: 'block' }}>
                {ecart > 0 ? '+' : ''}
                {fmtEur(ecart)} ({((ecart / (coutPrevu || 1)) * 100).toFixed(0)} %)
              </span>
            ) : hasConvenu && isIntermittent ? (
              <span style={{ color: 'var(--txt-3)', fontSize: 9, display: 'block' }}>
                brut + charges
              </span>
            ) : null}
          </span>
        ) : (
          /* État #3 — non saisi : prévu en italique + bouton ✓ au survol */
          <span className="inline-flex items-center justify-end gap-1.5" style={{ width: '100%' }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onConfirmAtPrevu?.()
              }}
              title="Confirmer ce montant au coût prévu"
              style={{
                opacity: hover ? 1 : 0,
                transition: 'opacity .15s, background .15s',
                width: 20,
                height: 20,
                borderRadius: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,174,0,.15)',
                border: '1px solid rgba(255,174,0,.5)',
                color: 'var(--amber)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.3)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.15)')}
            >
              <Check className="w-3 h-3" />
            </button>
            <span>
              <span
                className="font-semibold"
                style={{ color: 'var(--amber)', opacity: 0.65, fontStyle: 'italic' }}
              >
                {fmtEur(coutPrevu)}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--txt-3)',
                  opacity: 0.55,
                  display: 'block',
                  fontStyle: 'italic',
                }}
              >
                estimé
              </span>
            </span>
          </span>
        )}
      </td>

      {/* Statut — 3 états : estimé / validé / payé */}
      <td className="px-2 py-2 text-center">
        <StatusToggle
          isEstime={isEstime}
          valide={valide}
          paye={paye}
          onConfirmAtPrevu={onConfirmAtPrevu}
          onTogglePaye={() =>
            onSave({
              paye: !paye,
              montant_ht: entry?.montant_ht ?? 0,
              valide: entry?.valide ?? false,
              tva_rate: entry?.tva_rate ?? 20,
            })
          }
        />
      </td>
    </tr>
  )
}
