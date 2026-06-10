/**
 * SynthBar — bandeau récapitulatif flottant en bas du DevisEditor.
 *
 * Affiche les métriques clé (Total HT/TTC, marge) et ouvre un tiroir vers le
 * haut avec les ajustements globaux (Mg+Fg, assurance, remise), le détail
 * des totaux et l'échéancier (acompte/solde + notes).
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Percent, ShieldCheck, Tag } from 'lucide-react'
import { fmtEur, fmtPct } from '../../../lib/cotisations'
import AdjRow from './AdjRow'
import SynthRow from './SynthRow'
import BarMetric from './BarMetric'

export default function SynthBar({ synth, devis, globalAdj, onUpdateGlobal, onUpdateDevis }) {
  const [open, setOpen] = useState(false)

  const margeColor =
    synth.pctMargeFinale <= 0
      ? 'var(--red)'
      : synth.pctMargeFinale > 0.2
        ? 'var(--green)'
        : 'var(--amber)'

  const hasGlobalAdj =
    synth.totalCharges > 0 ||
    globalAdj.marge_globale_pct > 0 ||
    globalAdj.assurance_pct > 0 ||
    globalAdj.remise_globale_pct > 0 ||
    globalAdj.remise_globale_montant > 0

  return (
    <>
      {/* Overlay sombre quand tiroir ouvert */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,.35)' }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Bulle flottante — commence après la sidebar (w-56 = 14rem) ──────── */}
      <div
        style={{
          position: 'fixed',
          bottom: '12px',
          left: 'calc(14rem + 12px)',
          right: '12px',
          zIndex: 50,
          borderRadius: '14px',
          background: 'var(--bg-elev)',
          border: '1px solid rgba(255,255,255,.08)',
          boxShadow: '0 12px 48px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04)',
          overflow: 'hidden',
        }}
      >
        {/* ── Tiroir détails — s'ouvre vers le haut (à l'intérieur de la bulle) ── */}
        {open && (
          <div
            style={{
              background: 'var(--bg-elev)',
              borderBottom: '1px solid rgba(255,255,255,.07)',
              maxHeight: '55vh',
              overflowY: 'auto',
            }}
          >
            {/* Grille 3 colonnes */}
            <div className="grid grid-cols-3 gap-0 px-6 py-4" style={{ maxWidth: '900px' }}>
              {/* Colonne 1 — Ajustements globaux */}
              <div className="pr-6" style={{ borderRight: '1px solid var(--brd-sub)' }}>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider mb-3"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Ajustements globaux
                </p>
                <div className="space-y-2.5">
                  <AdjRow
                    icon={<Percent className="w-3 h-3" style={{ color: 'var(--blue)' }} />}
                    label="Mg + Fg"
                    value={globalAdj.marge_globale_pct}
                    onChange={(v) => onUpdateGlobal('marge_globale_pct', v)}
                    suffix="%"
                    computed={fmtEur(synth.montantMargeGlobale)}
                  />
                  <AdjRow
                    icon={<ShieldCheck className="w-3 h-3" style={{ color: 'var(--purple)' }} />}
                    label="Assurance"
                    value={globalAdj.assurance_pct}
                    onChange={(v) => onUpdateGlobal('assurance_pct', v)}
                    suffix="%"
                    computed={fmtEur(synth.montantAssurance)}
                  />
                  <div>
                    <p
                      className="text-[10px] mb-1.5 flex items-center gap-1"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      <Tag className="w-3 h-3" style={{ color: 'var(--orange)' }} /> Remise globale
                    </p>
                    <div className="flex gap-1.5">
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          className="input text-xs text-right pr-5 py-1 h-7 w-full"
                          value={globalAdj.remise_globale_pct || ''}
                          onChange={(e) => onUpdateGlobal('remise_globale_pct', e.target.value)}
                          min={0}
                          max={100}
                          step={0.5}
                          placeholder="%"
                          disabled={globalAdj.remise_globale_montant > 0}
                        />
                        <span
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          %
                        </span>
                      </div>
                      <div className="flex-1">
                        <input
                          type="number"
                          className="input text-xs text-right py-1 h-7 w-full"
                          value={globalAdj.remise_globale_montant || ''}
                          onChange={(e) => onUpdateGlobal('remise_globale_montant', e.target.value)}
                          min={0}
                          step={10}
                          placeholder="€"
                        />
                      </div>
                    </div>
                    {synth.montantRemiseGlobale > 0 && (
                      <p
                        className="text-xs text-right font-medium mt-0.5"
                        style={{ color: 'var(--orange)' }}
                      >
                        − {fmtEur(synth.montantRemiseGlobale)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Colonne 2 — Détail des totaux */}
              <div className="px-6" style={{ borderRight: '1px solid var(--brd-sub)' }}>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider mb-3"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Détail
                </p>
                <div className="space-y-0.5">
                  {hasGlobalAdj && (
                    <>
                      <SynthRow label="Sous-total" val={fmtEur(synth.sousTotal)} muted />
                      {synth.montantMargeGlobale !== 0 && (
                        <SynthRow
                          label={`+ Mg+Fg ${globalAdj.marge_globale_pct}%`}
                          val={fmtEur(synth.montantMargeGlobale)}
                          colored="blue"
                        />
                      )}
                      {synth.montantAssurance !== 0 && (
                        <SynthRow
                          label={`+ Assurance ${globalAdj.assurance_pct}%`}
                          val={fmtEur(synth.montantAssurance)}
                          colored="purple"
                        />
                      )}
                      {synth.totalCharges > 0 && (
                        <SynthRow
                          label="+ Charges soc. pat."
                          val={fmtEur(synth.totalCharges)}
                          colored="red"
                        />
                      )}
                      {synth.montantRemiseGlobale !== 0 && (
                        <SynthRow
                          label="− Remise"
                          val={`-${fmtEur(synth.montantRemiseGlobale)}`}
                          colored="orange"
                        />
                      )}
                      <div style={{ borderTop: '1px solid var(--brd-sub)', margin: '4px 0' }} />
                    </>
                  )}
                  <SynthRow label="Total HT" val={fmtEur(synth.totalHTFinal)} big />
                  <div className="flex items-center justify-between text-xs py-0.5">
                    <span style={{ color: 'var(--txt-3)' }}>TVA</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={devis?.tva_rate ?? 20}
                        onChange={(e) => onUpdateDevis?.('tva_rate', e.target.value)}
                        className="w-12 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                        style={{
                          background: 'var(--bg-elev)',
                          border: '1px solid var(--brd-sub)',
                          color: 'var(--txt-2)',
                        }}
                      />
                      <span style={{ color: 'var(--txt-3)' }}>%</span>
                      <span
                        className="text-right font-medium w-20"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {fmtEur(synth.tva)}
                      </span>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--brd)', margin: '4px 0' }} />
                  <SynthRow label="TOTAL TTC" val={fmtEur(synth.totalTTC)} big highlight />
                </div>
              </div>

              {/* Colonne 3 — Échéancier + Notes */}
              <div className="pl-6">
                <p
                  className="text-[10px] font-bold uppercase tracking-wider mb-3"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Échéancier
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      <span>Acompte</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={devis?.acompte_pct ?? 30}
                        onChange={(e) => onUpdateDevis?.('acompte_pct', e.target.value)}
                        className="w-12 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                        style={{
                          background: 'var(--bg-elev)',
                          border: '1px solid var(--brd-sub)',
                          color: 'var(--blue)',
                        }}
                      />
                      <span>%</span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: 'var(--blue)' }}>
                      {fmtEur(synth.acompte)} TTC
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                      Solde
                    </span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
                      {fmtEur(synth.solde)} TTC
                    </span>
                  </div>
                </div>
                {devis?.notes && (
                  <div
                    className="mt-3 p-2.5 rounded-lg"
                    style={{
                      background: 'rgba(255,206,0,.1)',
                      border: '1px solid rgba(255,206,0,.25)',
                    }}
                  >
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--amber)' }}>
                      Notes
                    </p>
                    <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
                      {devis.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Barre principale — clic entier pour toggle ─────────────────────── */}
        <div
          className="flex items-center justify-between px-6 cursor-pointer select-none"
          style={{
            height: '52px',
            borderTop: open ? '1px solid rgba(255,255,255,.06)' : 'none',
          }}
          onClick={() => setOpen((p) => !p)}
        >
          {/* Gauche — métriques principales */}
          <div className="flex items-center gap-8">
            <BarMetric label="Total HT" value={fmtEur(synth.totalHTFinal)} prominent />
            <BarMetric label="Total TTC" value={fmtEur(synth.totalTTC)} muted />
            <BarMetric
              label="Marge"
              value={fmtPct(synth.pctMargeFinale)}
              subvalue={fmtEur(synth.margeFinale)}
              color={margeColor}
            />
          </div>

          {/* Droite — KPIs secondaires + bouton */}
          <div className="flex items-center gap-6">
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,.08)' }} />
            <BarMetric label="Coût réel HT" value={fmtEur(synth.totalCoutReel)} muted />
            {synth.totalCharges > 0 && (
              <BarMetric
                label="Charges soc."
                value={fmtEur(synth.totalCharges)}
                color="var(--red)"
                muted
              />
            )}
            {synth.totalInterne > 0 && (
              <BarMetric
                label="Part interne"
                value={fmtPct(synth.pctInterne)}
                subvalue={fmtEur(synth.totalInterne)}
                color="var(--purple)"
                muted
              />
            )}
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,.08)' }} />
            <div className="flex items-center gap-1.5" style={{ color: 'var(--txt-3)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-widest">Synthèse</span>
              {open ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </div>
          </div>
        </div>
      </div>
      {/* fin bulle */}
    </>
  )
}
