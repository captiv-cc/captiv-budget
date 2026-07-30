/**
 * DevisMobileView — éditeur de devis en mobile web (< 640px)
 *
 * Remplace la table dense (min-width 910px) par une UX adaptée au téléphone :
 *   - blocs en cartes repliables (accent couleur, total, nb de lignes) ;
 *   - lignes en cartes compactes (produit, nb×qté, prix de vente) ;
 *   - édition COMPLÈTE dans une bottom sheet (produit avec BDD, régime,
 *     nb/qté/unité, tarif, coût, remise, description, dupliquer/supprimer).
 *
 * Toute la logique vient de useDevis (mêmes handlers que la table desktop) :
 * ce composant est du rendu pur. Sert aussi de plan UX pour la future app.
 * Si le devis est verrouillé (envoyé/accepté), la sheet s'ouvre en lecture
 * seule (le bandeau de déverrouillage est géré par l'éditeur parent).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Trash2, Plus, X } from 'lucide-react'
import { calcLine, fmtEur, REGIMES_SALARIES, UNITES } from '../../../lib/cotisations'
import { confirm } from '../../../lib/confirm'
import { regimeFromProduit } from '../constants'
import ProduitAutocomplete from '../../../components/ProduitAutocomplete'
import RegimeSelect from './RegimeSelect'

export default function DevisMobileView({
  sorted, // computeSortedCategories(categories) : [{ cat, info, num }]
  taux,
  bdd,
  collapsed,
  setCollapsed,
  editLocked,
  insertLine, // (catId, lineData) → tempId ; la sheet s'ouvre sur la nouvelle ligne
  updateLine,
  updateLineBatch,
  deleteLine,
  duplicateLine,
}) {
  // Sélection de la ligne éditée : on garde des CLÉS (pas l'objet) pour que la
  // sheet reflète l'état live (autosave, realtime, remplacement _tempId → id).
  const [sheet, setSheet] = useState(null) // { catId, lineId, tempId } | null

  const current = (() => {
    if (!sheet) return null
    const entry = sorted.find(({ cat }) => cat.id === sheet.catId)
    if (!entry) return null
    const line = entry.cat.lines.find((l) =>
      sheet.lineId ? l.id === sheet.lineId : l._tempId === sheet.tempId,
    )
    return line ? { line, cat: entry.cat, info: entry.info } : null
  })()

  return (
    <div className="flex flex-col gap-3 p-3">
      {sorted.map(({ cat, info, num }) => {
        const accent = info.color || 'var(--blue)'
        const isCollapsed = Boolean(collapsed[cat.id])
        const activeLines = cat.lines.filter((l) => l.use_line)
        const total = activeLines.reduce((sum, l) => sum + calcLine(l, taux).prixVenteHT, 0)
        return (
          <div
            key={cat.id}
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              borderLeft: `3px solid ${accent}`,
            }}
          >
            {/* ── En-tête bloc ─────────────────────────────────────────────── */}
            <button
              onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
              data-lock-allow
              className="w-full flex items-center gap-2 px-3 py-2.5"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              )}
              {num != null && (
                <span className="text-[10px] font-bold tabular-nums" style={{ color: `${accent}88` }}>
                  {num}
                </span>
              )}
              <span
                className={`text-[11px] font-bold tracking-widest truncate ${info.isCanonical ? 'uppercase' : ''}`}
                style={{ color: accent }}
              >
                {info.isCanonical ? info.label : cat.name}
              </span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                {cat.lines.length}
              </span>
              <span
                className="ml-auto text-xs font-bold tabular-nums shrink-0"
                style={{ color: accent }}
              >
                {fmtEur(total)}
              </span>
            </button>

            {/* ── Lignes ───────────────────────────────────────────────────── */}
            {!isCollapsed && (
              <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
                {cat.lines.length === 0 && (
                  <p className="px-3 py-3 text-[11px] italic" style={{ color: 'var(--txt-3)' }}>
                    Aucune ligne.
                  </p>
                )}
                {cat.lines.map((line) => {
                  const c = calcLine(line, taux)
                  const qtyLabel = `${line.nb ?? 1} × ${line.quantite || 0} ${line.unite || 'F'}`
                  return (
                    <div
                      key={line.id || line._tempId}
                      onClick={() =>
                        setSheet({ catId: cat.id, lineId: line.id || null, tempId: line._tempId || null })
                      }
                      className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
                      style={{
                        borderBottom: '1px solid var(--brd-sub)',
                        opacity: line.use_line ? 1 : 0.4,
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
                          {line.produit || <span style={{ color: 'var(--txt-3)' }}>Sans nom</span>}
                        </p>
                        <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                          {qtyLabel} · {fmtEur(line.tarif_ht || 0)}
                          {line.remise_pct > 0 && ` · -${line.remise_pct}%`}
                        </p>
                      </div>
                      <span
                        className="text-xs font-bold tabular-nums shrink-0"
                        style={{ color: 'var(--blue)' }}
                      >
                        {fmtEur(c.prixVenteHT)}
                      </span>
                    </div>
                  )
                })}
                {!editLocked && (
                  <button
                    onClick={() => {
                      // Crée la ligne (régime par défaut du bloc) et ouvre la
                      // sheet : le champ produit y propose l'autocomplete BDD
                      // (tarif/régime/unité pré-remplis à la sélection).
                      const tempId = insertLine(cat.id, {
                        regime: info.defaultRegime || undefined,
                      })
                      setSheet({ catId: cat.id, lineId: null, tempId })
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Ajouter une ligne
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Bottom sheet d'édition ──────────────────────────────────────────── */}
      {current && (
        <LineSheet
          line={current.line}
          catId={current.cat.id}
          taux={taux}
          bdd={bdd}
          readOnly={editLocked}
          onClose={() => setSheet(null)}
          updateLine={updateLine}
          updateLineBatch={updateLineBatch}
          onDuplicate={() => {
            duplicateLine(current.cat.id, current.line.id || null, current.line._tempId || null)
            setSheet(null)
          }}
          onDelete={async () => {
            const ok = await confirm({
              title: 'Supprimer la ligne',
              message: `« ${current.line.produit || 'Sans nom'} » sera supprimée définitivement.`,
              confirmLabel: 'Supprimer',
              danger: true,
            })
            if (!ok) return
            deleteLine(current.cat.id, current.line.id || null, current.line._tempId || null)
            setSheet(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Bottom sheet : édition complète d'une ligne ──────────────────────────────

function Field({ label, children, span = 1 }) {
  return (
    <label className="flex flex-col gap-1" style={{ gridColumn: `span ${span}` }}>
      <span
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  background: 'rgba(255,255,255,.05)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function LineSheet({
  line,
  catId,
  taux,
  bdd,
  readOnly,
  onClose,
  updateLine,
  updateLineBatch,
  onDuplicate,
  onDelete,
}) {
  const c = calcLine(line, taux)
  const isSalarie = REGIMES_SALARIES.includes(line.regime)
  const set = (field, value) => {
    if (readOnly) return
    updateLine(catId, line.id || null, line._tempId || null, field, value)
  }

  function handleSelectProduit(p) {
    if (readOnly) return
    const updates = { produit: p.produit }
    updates.regime = regimeFromProduit(p)
    if (p.tarif_defaut) updates.tarif_ht = Number(p.tarif_defaut)
    if (p.unite) updates.unite = p.unite
    if (p.description) updates.description = p.description
    updateLineBatch(catId, line.id || null, line._tempId || null, updates)
  }

  return (
    <div
      className="fixed inset-0 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,.55)', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl px-4 pt-3 pb-6 overflow-y-auto"
        style={{
          background: 'var(--bg-surf)',
          borderTop: '1px solid var(--brd)',
          maxHeight: '88vh',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Poignée + fermer */}
        <div className="flex items-center justify-center relative mb-3">
          <span
            className="w-9 h-1 rounded-full"
            style={{ background: 'rgba(255,255,255,.18)' }}
          />
          <button
            onClick={onClose}
            className="absolute right-0 top-0 p-1"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {readOnly && (
          <p
            className="text-[11px] mb-3 px-2.5 py-1.5 rounded-lg"
            style={{
              color: 'var(--txt-2)',
              background: 'rgba(255,255,255,.05)',
              border: '1px solid var(--brd)',
            }}
          >
            Devis verrouillé : consultation seule. Déverrouillez depuis le bandeau pour modifier.
          </p>
        )}

        <div
          className="grid grid-cols-2 gap-3"
          style={readOnly ? { pointerEvents: 'none', opacity: 0.75 } : undefined}
        >
          {/* Produit (autocomplete BDD) + toggle use */}
          <Field label="Produit / poste" span={2}>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 rounded-lg px-2 py-1.5 text-sm"
                style={inputStyle}
              >
                <ProduitAutocomplete
                  value={line.produit || ''}
                  bdd={bdd}
                  onChange={(val) => set('produit', val)}
                  onSelect={handleSelectProduit}
                />
              </div>
              <label className="flex items-center gap-1.5 shrink-0 text-[10px]" style={{ color: 'var(--txt-3)' }}>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={Boolean(line.use_line)}
                  onChange={(e) => set('use_line', e.target.checked)}
                />
                Actif
              </label>
            </div>
          </Field>

          <Field label="Régime" span={2}>
            <div className="rounded-lg px-2 py-1.5" style={inputStyle}>
              <RegimeSelect value={line.regime} onChange={(val) => set('regime', val)} />
            </div>
          </Field>

          <Field label="Description" span={2}>
            <textarea
              value={line.description || ''}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="Description…"
              className="rounded-lg px-2.5 py-2 text-sm outline-none resize-none"
              style={{ ...inputStyle, lineHeight: 1.4 }}
            />
          </Field>

          <Field label="Nb">
            <input
              type="number"
              inputMode="decimal"
              min={1}
              value={line.nb ?? 1}
              onChange={(e) => set('nb', parseFloat(e.target.value) || 1)}
              className="rounded-lg px-2.5 py-2 text-sm outline-none text-right tabular-nums"
              style={inputStyle}
            />
          </Field>

          <Field label="Quantité">
            <div className="flex gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                value={line.quantite || ''}
                onChange={(e) => set('quantite', parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg px-2.5 py-2 text-sm outline-none text-right tabular-nums"
                style={inputStyle}
              />
              <select
                value={line.unite || 'F'}
                onChange={(e) => set('unite', e.target.value)}
                className="rounded-lg px-1.5 py-2 text-sm outline-none shrink-0"
                style={inputStyle}
              >
                {UNITES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Tarif HT">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={line.tarif_ht ?? ''}
              onChange={(e) => set('tarif_ht', parseFloat(e.target.value) || 0)}
              className="rounded-lg px-2.5 py-2 text-sm outline-none text-right tabular-nums"
              style={inputStyle}
            />
          </Field>

          <Field label={isSalarie ? 'Coût (= tarif)' : 'Coût HT'}>
            {isSalarie ? (
              <div
                className="rounded-lg px-2.5 py-2 text-sm text-right tabular-nums"
                style={{ ...inputStyle, color: 'var(--txt-3)' }}
              >
                {fmtEur(line.tarif_ht || 0)}
              </div>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={line.cout_ht ?? ''}
                placeholder="= vente"
                onChange={(e) =>
                  set('cout_ht', e.target.value === '' ? null : parseFloat(e.target.value) || 0)
                }
                className="rounded-lg px-2.5 py-2 text-sm outline-none text-right tabular-nums"
                style={inputStyle}
              />
            )}
          </Field>

          <Field label="Remise %">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={line.remise_pct || ''}
              placeholder="0"
              onChange={(e) => set('remise_pct', parseFloat(e.target.value) || 0)}
              className="rounded-lg px-2.5 py-2 text-sm outline-none text-right tabular-nums"
              style={inputStyle}
            />
          </Field>

          <Field label="Prix de vente">
            <div
              className="rounded-lg px-2.5 py-2 text-sm font-bold text-right tabular-nums"
              style={{ ...inputStyle, color: 'var(--blue)' }}
            >
              {fmtEur(c.prixVenteHT)}
            </div>
          </Field>
        </div>

        {/* Actions */}
        {!readOnly && (
          <div className="flex items-center gap-2 mt-4">
            <button onClick={onDuplicate} className="btn-secondary btn-sm flex-1 justify-center">
              <Copy className="w-3.5 h-3.5" />
              Dupliquer
            </button>
            <button
              onClick={onDelete}
              className="btn-secondary btn-sm flex-1 justify-center"
              style={{ color: 'var(--red)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
            <button onClick={onClose} className="btn-primary btn-sm flex-1 justify-center">
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
