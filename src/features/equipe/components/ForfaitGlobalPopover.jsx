// ════════════════════════════════════════════════════════════════════════════
// ForfaitGlobalPopover — Distribuer un forfait sur N attributions d'une persona
// ════════════════════════════════════════════════════════════════════════════
//
// Quand une personne est attribuée à plusieurs lignes de devis (ex: Samuel
// est Cadreur + Directeur de prod), on négocie souvent un forfait global au
// lieu de tarifs ligne par ligne. Cet assistant prend un montant total et le
// ventile sur les N lignes selon 2 modes :
//
//   - prorata    : chaque ligne reçoit (cout_estime / total_cout_estime) × forfait
//   - equiparti  : chaque ligne reçoit forfait / nb_lignes
//
// La distribution est ensuite appliquée ligne par ligne en updatant
// `budget_convenu` (qui alimente le coût réel dans Budget Réel).
//
// Logique pure dans `lib/crew.js` → `distributeForfait()`.
//
// Usage :
//   <ForfaitGlobalPopover
//     open={open}
//     onClose={...}
//     attributions={[{m, line}, ...]}  // les N attributions de la persona
//     personaName="Samuel CHIBON"
//     onApply={async (lineIdToBudget) => {
//       // Map<lineId, newBudgetConvenu>
//       for (const [lineId, budget] of lineIdToBudget) {
//         await updateMembre(membreIdFromLine[lineId], { budget_convenu: budget })
//       }
//     }}
//   />
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { X, Calculator, CheckCircle, ArrowRight } from 'lucide-react'
import { distributeForfait } from '../../../lib/crew'
import { fmtEur } from '../../../lib/cotisations'
import { notify } from '../../../lib/notify'

export default function ForfaitGlobalPopover({
  open,
  onClose,
  attributions = [], // [{ m: projet_membre, line: devis_line }]
  personaName = '—',
  onApply, // async (Map<lineId, budget_convenu>) => void
}) {
  const [montant, setMontant] = useState('')
  const [mode, setMode] = useState('prorata')
  const [submitting, setSubmitting] = useState(false)

  // Reset à chaque ouverture
  useEffect(() => {
    if (open) {
      setMontant('')
      setMode('prorata')
      setSubmitting(false)
    }
  }, [open])

  // Lignes simplifiées pour distributeForfait (prend juste {id, cout_estime})
  const lines = useMemo(
    () =>
      attributions.map((a) => ({
        id: a.line?.id || a.m?.devis_line_id || a.m?.id,
        cout_estime: Number(a.line?.cout_ht || a.m?.cout_estime || 0),
      })),
    [attributions],
  )

  const totalCout = lines.reduce((s, l) => s + l.cout_estime, 0)
  const numericMontant = Number(montant) || 0
  const distribution = useMemo(
    () => distributeForfait(lines, numericMontant, mode),
    [lines, numericMontant, mode],
  )

  if (!open) return null

  const canSubmit = numericMontant > 0 && !submitting

  async function handleApply() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onApply?.(distribution)
      notify.success(`Forfait de ${fmtEur(numericMontant)} appliqué`)
      onClose?.()
    } catch (err) {
      console.error('[ForfaitGlobalPopover] apply error:', err)
      notify.error('Application échouée : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-lg max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--purple-bg)' }}
          >
            <Calculator className="w-4 h-4" style={{ color: 'var(--purple)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Forfait global
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {personaName} — {attributions.length} attribution
              {attributions.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Montant total */}
          <div>
            <label
              className="block text-xs font-semibold mb-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
              Montant total négocié (HT)
            </label>
            <div className="relative">
              <input
                type="number"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                placeholder="Ex: 5000"
                step="any"
                min="0"
                autoFocus
                className="w-full text-sm px-3 py-2 rounded-md outline-none pr-10"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'var(--txt-3)' }}
              >
                €
              </span>
            </div>
            <p
              className="mt-1 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              Total des coûts estimés actuels :{' '}
              <strong style={{ color: 'var(--txt-2)' }}>{fmtEur(totalCout)}</strong>
            </p>
          </div>

          {/* Mode de répartition */}
          <div>
            <label
              className="block text-xs font-semibold mb-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
              Mode de répartition
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  k: 'prorata',
                  l: 'Au prorata',
                  hint: 'des coûts estimés',
                },
                {
                  k: 'equiparti',
                  l: 'Équiparti',
                  hint: 'parts égales',
                },
              ].map(({ k, l, hint }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className="text-left px-3 py-2 rounded-md transition-all"
                  style={
                    mode === k
                      ? {
                          background: 'var(--purple-bg)',
                          color: 'var(--purple)',
                          border: '1px solid var(--purple)',
                        }
                      : {
                          background: 'var(--bg-elev)',
                          color: 'var(--txt-2)',
                          border: '1px solid var(--brd)',
                        }
                  }
                >
                  <div className="text-xs font-semibold">{l}</div>
                  <div
                    className="text-[10px] mt-0.5"
                    style={{ opacity: 0.75 }}
                  >
                    {hint}
                  </div>
                </button>
              ))}
            </div>
            {mode === 'prorata' && totalCout === 0 && (
              <p
                className="mt-1 text-[10px] italic"
                style={{ color: 'var(--amber)' }}
              >
                Aucun coût estimé sur les lignes — fallback automatique sur équiparti.
              </p>
            )}
          </div>

          {/* Aperçu de la distribution */}
          {numericMontant > 0 && (
            <div
              className="rounded-md p-3"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              <div
                className="flex items-center gap-1.5 text-xs font-semibold mb-2 uppercase tracking-wide"
                style={{ color: 'var(--txt-2)' }}
              >
                <ArrowRight className="w-3 h-3" />
                Aperçu de la distribution
              </div>
              <div className="space-y-1.5">
                {attributions.map((a) => {
                  const lineId = a.line?.id || a.m?.devis_line_id || a.m?.id
                  const newBudget = distribution.get(lineId) ?? 0
                  const oldCout = Number(a.line?.cout_ht || a.m?.cout_estime || 0)
                  return (
                    <div
                      key={lineId}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ color: 'var(--txt)' }}>
                          {a.line?.produit || a.m?.specialite || '—'}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                          {a.line?.regime || a.m?.regime || '—'}
                          {oldCout > 0 ? ` · estimé ${fmtEur(oldCout)}` : ''}
                        </div>
                      </div>
                      <div
                        className="text-sm font-bold tabular-nums shrink-0"
                        style={{ color: 'var(--purple)' }}
                      >
                        {fmtEur(newBudget)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div
                className="flex items-center justify-between gap-3 text-xs mt-3 pt-2"
                style={{ borderTop: '1px solid var(--brd-sub)' }}
              >
                <span
                  className="font-semibold uppercase tracking-wide text-[10px]"
                  style={{ color: 'var(--txt-2)' }}
                >
                  Total
                </span>
                <strong className="text-sm tabular-nums" style={{ color: 'var(--txt)' }}>
                  {fmtEur(numericMontant)}
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-opacity"
            style={{
              background: 'var(--purple)',
              color: '#fff',
              border: '1px solid var(--purple)',
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (canSubmit) e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              if (canSubmit) e.currentTarget.style.opacity = '1'
            }}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {submitting ? 'Application…' : 'Appliquer le forfait'}
          </button>
        </footer>
      </div>
    </div>
  )
}
