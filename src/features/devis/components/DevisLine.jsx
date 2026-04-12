/**
 * DevisLine — ligne de devis (un <tr>) éditable + drag&drop.
 *
 * Affiche : checkbox use, autocomplete produit, description, sélecteur de
 * régime, nb/quantité/unité, tarif vente, coût (selon régime), remise
 * optionnelle, prix calculé, colonnes d'analyse (marge, charges) et actions.
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { GripVertical, Copy, Trash2 } from 'lucide-react'
import { calcLine, fmtEur, fmtPct, REGIMES_SALARIES, UNITES } from '../../../lib/cotisations'
import ProduitAutocomplete from '../../../components/ProduitAutocomplete'
import { normalizeRegime } from '../constants'
import RegimeSelect from './RegimeSelect'
import PriceCell from './cells/PriceCell'
import CalcCell from './cells/CalcCell'

export default function DevisLine({
  line,
  index = 0,
  taux,
  bdd,
  accentColor,
  onChange,
  onChangeBatch,
  onDelete,
  onDuplicate,
  showAnalyse = false,
  remiseVisible = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const c = calcLine(line, taux)
  const inactive = !line.use_line
  // Zebra striping subtil pour aérer le tableau dense
  const zebraBg = index % 2 === 1 ? 'rgba(255,255,255,.018)' : 'var(--bg-surf)'

  function handleSelectProduit(p) {
    const updates = { produit: p.produit }
    if (p.regime) updates.regime = normalizeRegime(p.regime)
    if (p.tarif_defaut) updates.tarif_ht = Number(p.tarif_defaut)
    if (p.unite) updates.unite = p.unite
    if (p.description) updates.description = p.description
    onChangeBatch(updates)
  }

  return (
    <tr
      className={`devis-line group${inactive ? ' opacity-40' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver?.()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      onDragEnd={onDragEnd}
      style={{
        background: isDragOver ? 'rgba(255,255,255,.04)' : zebraBg,
        outline: isDragOver ? `2px solid ${accentColor}60` : 'none',
        transition: 'outline 80ms, background 80ms',
      }}
    >
      <td
        className="text-center"
        style={{ color: 'var(--txt-3)', borderLeft: `3px solid ${accentColor}`, cursor: 'grab' }}
      >
        <GripVertical className="w-3 h-3 mx-auto opacity-40" />
      </td>
      {/* ✓ USE */}
      <td className="text-center">
        <input
          type="checkbox"
          className="toggle"
          checked={Boolean(line.use_line)}
          onChange={(e) => onChange('use_line', e.target.checked)}
        />
      </td>
      {/* Produit avec autocomplete BDD — colonne principale */}
      <td className="produit-cell">
        <ProduitAutocomplete
          value={line.produit || ''}
          bdd={bdd}
          onChange={(val) => onChange('produit', val)}
          onSelect={handleSelectProduit}
        />
      </td>
      {/* Description — textarea multilignes, auto-resize */}
      <td className="align-top">
        <textarea
          className="input-cell w-full"
          style={{
            resize: 'none',
            overflow: 'hidden',
            lineHeight: '1.4',
            minHeight: '22px',
          }}
          rows={1}
          value={line.description || ''}
          placeholder="Description…"
          ref={(el) => {
            if (el) {
              el.style.height = 'auto'
              el.style.height = el.scrollHeight + 'px'
            }
          }}
          onChange={(e) => {
            onChange('description', e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const sel =
                'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
              const all = [...document.querySelectorAll(sel)]
              const idx = all.indexOf(e.currentTarget)
              const next = e.shiftKey ? all[idx - 1] : all[idx + 1]
              if (next) next.focus()
            }
          }}
        />
      </td>
      <td>
        <RegimeSelect value={line.regime} onChange={(val) => onChange('regime', val)} />
      </td>
      {/* Nb — unités physiques (caméras, micros…) */}
      <td style={{ padding: 0 }}>
        <input
          type="number"
          className="input-cell w-full text-right"
          value={line.nb ?? 1}
          onChange={(e) => onChange('nb', parseFloat(e.target.value) || 1)}
          min={1}
          step={1}
          title="Nombre d'unités (ex : 2 caméras)"
        />
      </td>
      {/* Qté + Unité — fusionnés en une seule cellule (ex: "2 J") */}
      <td style={{ padding: 0 }}>
        <div className="flex items-center w-full">
          <input
            type="number"
            className="input-cell text-right flex-1 min-w-0"
            value={line.quantite || ''}
            onChange={(e) => onChange('quantite', parseFloat(e.target.value) || 0)}
            min={0}
            step={0.5}
            title="Quantité (ex : 2 jours)"
            style={{ paddingRight: '2px' }}
          />
          <select
            className="text-xs border-0 cursor-pointer rounded shrink-0"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              paddingLeft: '2px',
              paddingRight: '4px',
            }}
            value={line.unite || 'F'}
            onChange={(e) => onChange('unite', e.target.value)}
            title="Unité"
          >
            {UNITES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </td>
      {/* Tarif vente HT */}
      <td>
        <PriceCell value={line.tarif_ht} onChange={(v) => onChange('tarif_ht', v)} />
      </td>
      {/* Coût unitaire — fixe pour salariés, saisissable sinon (vide = coût égal vente) */}
      <td>
        {REGIMES_SALARIES.includes(line.regime) ? (
          /* Intermittents purs : coût = salaire brut = tarif, non éditable */
          <div
            className="text-right px-2 tabular-nums text-xs"
            style={{ color: 'var(--txt-3)' }}
            title="Coût = tarif brut (régime intermittent)"
          >
            {fmtEur(line.tarif_ht)}
          </div>
        ) : (
          /* Tous les autres (Ext. Intermittent, Externe, Interne, Technique, Frais) : coût saisissable */
          <div className="flex flex-col items-end">
            <PriceCell
              value={line.cout_ht}
              onChange={(v) => onChange('cout_ht', v)}
              placeholder={
                line.regime === 'Ext. Intermittent' ? (
                  'brut'
                ) : (
                  <span className="tabular-nums">= {fmtEur(line.tarif_ht || 0)}</span>
                )
              }
              nullable
              style={{
                color:
                  line.regime === 'Ext. Intermittent' ? 'var(--purple, #7c3aed)' : 'var(--orange)',
              }}
              title={
                line.regime === 'Ext. Intermittent'
                  ? 'Salaire brut intermittent (base cotisations 67%)'
                  : 'Vide = coût égal au prix de vente'
              }
            />
            {line.regime === 'Ext. Intermittent' && c.chargesPat > 0 && (
              <div
                className="text-[9px] tabular-nums leading-none whitespace-nowrap pr-2"
                style={{ color: 'var(--purple, #7c3aed)', opacity: 0.7 }}
                title="Cotisations patronales estimées (67% × brut)"
              >
                +{fmtEur(c.chargesPat)} charg.
              </div>
            )}
          </div>
        )}
      </td>
      {/* Remise % — visible seulement si remiseVisible */}
      {remiseVisible && (
        <td>
          <div className="relative">
            <input
              type="number"
              className="input-cell w-full text-right pr-5"
              value={line.remise_pct || ''}
              onChange={(e) => onChange('remise_pct', parseFloat(e.target.value) || 0)}
              min={0}
              max={100}
              step={1}
              placeholder="0"
            />
            <span
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              %
            </span>
          </div>
        </td>
      )}
      {!remiseVisible && <td className="w-5" />}
      {/* Colonne clé — Prix vente HT, toujours visible */}
      <CalcCell val={c.prixVenteHT} style={{ color: 'var(--blue)', fontWeight: 600 }} />
      {/* Colonnes analyse — conditionnelles */}
      {(() => {
        // Interne sans coût renseigné → marge non significative
        const isInterneNonValuee =
          line.regime === 'Interne' && (line.cout_ht === null || line.cout_ht === undefined)
        return showAnalyse ? (
          <>
            <CalcCell
              val={line.regime === 'Ext. Intermittent' ? c.coutCharge : c.coutReelHT}
              dim
              style={{ color: 'var(--txt-3)' }}
              title={
                line.regime === 'Ext. Intermittent' ? 'Coût chargé (brut + cotisations)' : undefined
              }
            />
            <td className="text-right px-2 py-[3px]">
              {isInterneNonValuee ? (
                <div
                  className="text-[10px] italic"
                  style={{ color: 'var(--purple)', opacity: 0.7 }}
                  title="Ressource interne sans coût renseigné"
                >
                  interne
                </div>
              ) : (
                <>
                  <div
                    className="text-[11px] tabular-nums"
                    style={{ color: c.margeHT < 0 ? 'var(--red)' : 'var(--txt-3)' }}
                  >
                    {c.margeHT !== 0 ? fmtEur(c.margeHT) : '—'}
                  </div>
                  <div
                    className="text-[10px] tabular-nums leading-tight"
                    style={{ color: c.pctMarge < 0 ? 'var(--red)' : 'var(--txt-3)' }}
                  >
                    {fmtPct(c.pctMarge)}
                  </div>
                </>
              )}
            </td>
            <CalcCell val={c.chargesPat} dim style={{ color: 'var(--txt-3)' }} />
            <CalcCell val={c.coutCharge} dim style={{ color: 'var(--txt-3)' }} />
          </>
        ) : (
          <td className="text-right px-2 py-[3px]">
            {isInterneNonValuee ? (
              <span
                className="text-[10px] italic"
                style={{ color: 'var(--purple)', opacity: 0.7 }}
                title="Ressource interne sans coût renseigné"
              >
                int.
              </span>
            ) : (
              <span
                className="text-[11px] tabular-nums font-medium"
                style={{
                  color:
                    c.pctMarge < 0
                      ? 'var(--red)'
                      : c.pctMarge > 0.15
                        ? 'var(--green)'
                        : 'var(--txt-3)',
                  // Marge nulle → grisée : ne capte pas l'œil dans un tableau dense
                  opacity: c.pctMarge === 0 ? 0.35 : 1,
                }}
              >
                {fmtPct(c.pctMarge)}
              </span>
            )}
          </td>
        )
      })()}
      {/* Actions — apparaissent au hover de la ligne uniquement */}
      <td className="text-center" style={{ borderRight: `1px solid ${accentColor}18` }}>
        <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-100">
          <button
            onClick={onDuplicate}
            className="transition-colors"
            title="Dupliquer la ligne"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="transition-colors"
            title="Supprimer la ligne"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}
