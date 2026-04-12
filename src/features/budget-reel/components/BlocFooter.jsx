/**
 * BlocFooter — footer KPI compact d'un bloc (mirror de KpiBar globale).
 * Affiche : Vente, Coût prévu→réel + écart %, Marge prévue→réelle + % CA,
 * et pastille statut paiement (reste à payer / tout réglé).
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { Check } from 'lucide-react'
import { fmtEur } from '../../../lib/cotisations'

export default function BlocFooter({
  venteBloc,
  prevuBloc,
  reelBloc,
  beneficePrevis,
  beneficeReel,
  resteBloc,
}) {
  const ecartCout = reelBloc - prevuBloc // signed
  const ecartPct = prevuBloc > 0 ? (ecartCout / prevuBloc) * 100 : 0
  const margePct = venteBloc > 0 ? (beneficeReel / venteBloc) * 100 : 0
  const deltaMarge = beneficeReel - beneficePrevis

  const coutColor =
    ecartCout > 0.01 ? 'var(--red)' : ecartCout < -0.01 ? 'var(--green)' : 'var(--txt)'
  const margeColor =
    beneficeReel < 0 ? 'var(--red)' : deltaMarge < -0.01 ? 'var(--amber)' : 'var(--green)'
  const ecartLabelColor =
    ecartCout > 0.01 ? 'var(--red)' : ecartCout < -0.01 ? 'var(--green)' : 'var(--txt-3)'

  const Lbl = ({ children }) => (
    <span
      className="uppercase tracking-widest font-semibold"
      style={{ color: 'var(--txt-3)', fontSize: 9 }}
    >
      {children}
    </span>
  )
  const Sep = () => <span style={{ color: 'var(--brd)', fontSize: 11 }}>·</span>

  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 flex-wrap"
      style={{ borderTop: '1px solid var(--brd-sub)', background: 'var(--bg-elev)', fontSize: 11 }}
    >
      {/* Vente */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Vente</Lbl>
        <span className="font-bold tabular-nums" style={{ color: 'var(--blue)', fontSize: 12 }}>
          {fmtEur(venteBloc)}
        </span>
      </span>

      <Sep />

      {/* Coût prévu → réel + écart inline */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Coût</Lbl>
        <span className="tabular-nums" style={{ color: 'var(--amber)' }}>
          {fmtEur(prevuBloc)}
        </span>
        <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>→</span>
        <span className="font-bold tabular-nums" style={{ color: coutColor, fontSize: 12 }}>
          {fmtEur(reelBloc)}
        </span>
        {Math.abs(ecartCout) >= 0.01 && (
          <span className="tabular-nums" style={{ color: ecartLabelColor, fontSize: 10 }}>
            ({ecartCout > 0 ? '+' : ''}
            {ecartPct.toFixed(0)} %)
          </span>
        )}
      </span>

      <Sep />

      {/* Marge prévue → réelle + % CA */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Marge</Lbl>
        <span className="tabular-nums" style={{ color: 'var(--purple)' }}>
          {fmtEur(beneficePrevis)}
        </span>
        <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>→</span>
        <span className="font-bold tabular-nums" style={{ color: margeColor, fontSize: 12 }}>
          {fmtEur(beneficeReel)}
        </span>
        {venteBloc > 0 && (
          <span className="tabular-nums" style={{ color: margeColor, fontSize: 10 }}>
            ({margePct.toFixed(0)} %)
          </span>
        )}
      </span>

      {/* Pastille statut paiement à droite */}
      {resteBloc > 0 && (
        <span
          className="ml-auto px-2 py-0.5 rounded-md font-semibold whitespace-nowrap"
          style={{ background: 'rgba(255,59,48,.1)', color: 'var(--red)', fontSize: 10 }}
        >
          Reste {fmtEur(resteBloc)}
        </span>
      )}
      {resteBloc === 0 && reelBloc > 0 && (
        <span
          className="ml-auto px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 whitespace-nowrap"
          style={{ background: 'rgba(0,200,117,.1)', color: 'var(--green)', fontSize: 10 }}
        >
          <Check className="w-2.5 h-2.5" /> Tout réglé
        </span>
      )}
    </div>
  )
}
