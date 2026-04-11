/**
 * KpiBar — bandeau récapitulatif principal du Budget Réel.
 * Affiche : Vente HT, Coût prévu→réel, Marge prévue→réelle, ligne avancement
 * (budget engagé, reste à engager/régler) et ligne TVA (collectée/récup./à reverser).
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { fmtEur } from '../../../lib/cotisations'

export default function KpiBar({ global: g, refDevis }) {
  const ecartColor = g.ecartCout > 0.01 ? 'var(--red)' : g.ecartCout < -0.01 ? 'var(--green)' : 'var(--txt-3)'
  const margeColor = g.margeReelle < 0 ? 'var(--red)'
                    : g.deltaMarge < -0.01 ? 'var(--amber)'
                    : 'var(--green)'
  const margePct   = g.venteHT ? (g.margeReelle / g.venteHT) * 100 : 0
  const ecartPct   = g.coutPrevu ? (g.ecartCout / g.coutPrevu) * 100 : 0

  const Block = ({ label, children, flex = 1 }) => (
    <div style={{ flex, minWidth: 0, padding: '0 14px' }}>
      <p className="text-[9px] font-semibold uppercase tracking-widest mb-0.5"
        style={{ color: 'var(--txt-3)' }}>{label}</p>
      {children}
    </div>
  )
  const Sep = () => <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--brd)' }} />

  return (
    <div className="rounded-xl"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>

      {/* Ligne principale : Vente · Coût · Marge */}
      <div className="flex items-stretch py-3">
        <Block label="Vente HT">
          <p className="font-bold tabular-nums text-lg" style={{ color: 'var(--blue)' }}>{fmtEur(g.venteHT)}</p>
          <p className="text-[9px]" style={{ color: 'var(--txt-3)' }}>
            Devis V{refDevis.version_number}{refDevis.status === 'accepte' ? ' · accepté' : ''}
          </p>
        </Block>

        <Sep />

        <Block label="Coût  prévu → réel" flex={1.4}>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>{fmtEur(g.coutPrevu)}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <span className="font-bold tabular-nums text-lg" style={{ color: g.ecartCout > 0.01 ? 'var(--red)' : 'var(--green)' }}>{fmtEur(g.coutReelProjete)}</span>
          </div>
          <p className="text-[9px]" style={{ color: ecartColor }}>
            {g.ecartCout > 0 ? '+' : ''}{fmtEur(g.ecartCout)} ({g.ecartCout > 0 ? '+' : ''}{ecartPct.toFixed(1)} %) {g.ecartCout > 0.01 ? '· dépassement' : g.ecartCout < -0.01 ? '· économie' : '· =prévu'}
          </p>
        </Block>

        <Sep />

        <Block label="Marge  prévue → réelle" flex={1.4}>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-sm" style={{ color: 'var(--purple)' }}>{fmtEur(g.margePrevue)}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <span className="font-bold tabular-nums text-lg" style={{ color: margeColor }}>{fmtEur(g.margeReelle)}</span>
          </div>
          <p className="text-[9px]" style={{ color: margeColor }}>
            {margePct.toFixed(1)} % du CA · {g.deltaMarge > 0 ? '+' : ''}{fmtEur(g.deltaMarge)} vs prévu
          </p>
        </Block>
      </div>

      {/* Ligne secondaire : avancement · cashflow */}
      <div className="flex items-center px-4 py-1.5 gap-4 text-[10px]"
        style={{ borderTop: '1px solid var(--brd)', color: 'var(--txt-3)' }}>
        <div className="flex items-center gap-2 flex-1">
          <span className="uppercase tracking-wide font-semibold" style={{ color: 'var(--txt-3)', fontSize: 9 }}>
            Budget engagé
          </span>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-elev)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, g.avancement)}%`, height: '100%',
              background: g.avancement > 100.5 ? 'var(--red)'
                : g.avancement >= 99 ? 'var(--green)'
                : g.avancement >= 50 ? 'var(--blue)'
                : 'var(--amber)',
            }} />
          </div>
          <span className="tabular-nums" style={{
            color: g.avancement > 100.5 ? 'var(--red)' : 'var(--txt)',
            fontWeight: 600,
          }}>{g.avancement.toFixed(0)} %</span>
          <span style={{ opacity: 0.7 }}>· {g.nbLignesSaisies}/{g.nbLignes} lignes confirmées</span>
        </div>
        <span>·</span>
        <span>
          Reste à engager <span className="tabular-nums font-semibold" style={{
            color: g.ecartCout > 0.01 ? 'var(--red)'
              : g.resteAEngager > 0 ? 'var(--amber)'
              : 'var(--green)',
          }}>{fmtEur(g.resteAEngager)}</span>
        </span>
        <span>·</span>
        <span>
          Reste à régler <span className="tabular-nums font-semibold" style={{ color: g.resteRegler > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmtEur(g.resteRegler)}</span>
        </span>
      </div>

      {/* Ligne TVA — collectée · récupérable · à reverser */}
      <div className="flex items-center px-4 py-1.5 gap-4 text-[10px]"
        style={{ borderTop: '1px solid var(--brd)', color: 'var(--txt-3)' }}>
        <span className="uppercase tracking-wide font-semibold" style={{ color: 'var(--txt-3)', fontSize: 9 }}>
          TVA
        </span>
        <span>
          Collectée <span className="tabular-nums font-semibold" style={{ color: 'var(--blue)' }}>{fmtEur(g.tvaCollectee)}</span>
        </span>
        <span>·</span>
        <span>
          Récupérable <span className="tabular-nums font-semibold" style={{ color: 'var(--green)' }}>{fmtEur(g.tvaRecuperable)}</span>
        </span>
        <span>·</span>
        <span className="ml-auto">
          À reverser <span className="tabular-nums font-bold" style={{
            color: g.tvaAReverser > 0 ? 'var(--amber)' : 'var(--txt-3)',
            fontSize: 11,
          }}>{fmtEur(g.tvaAReverser)}</span>
        </span>
      </div>
    </div>
  )
}
