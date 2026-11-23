// ════════════════════════════════════════════════════════════════════════════
// EmbauchesTable — le tableur, reprise de l'Excel « SUIVI INTERMITTENCE »
// ════════════════════════════════════════════════════════════════════════════
//
// Une ligne par embauche, les totaux en tête comme dans l'Excel. Le taux, les
// jalons de contrat et les remarques s'éditent sur place : si chaque retouche
// imposait d'ouvrir une fiche, on retournerait sur Excel en une semaine. Le
// reste (jours, heures, frais) passe par la fiche, qui a le configurateur.
//
// Colonnes redimensionnables et mémorisées par utilisateur, donc largeurs en
// table-layout fixed + colgroup.
//
// Les colonnes Coût et Marge n'existent que si la base a servi les lignes de
// coût. Sur un dossier en portage, un non-admin ne les verra jamais.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { Pencil, Trash2, Copy, AlertCircle } from 'lucide-react'
import useColumnWidths from '../../hooks/useColumnWidths'
import ColumnResizer from '../../components/table/ColumnResizer'
import Tooltip from '../../components/Tooltip'
import { fmtEur } from '../../lib/cotisations'
import {
  computeEmbauche, totauxEmbauches, nomEmbauche, etatContrat, infosManquantes,
  estAPourvoir,
} from '../../lib/embauches'

const DEFAULTS = {
  nom: 190,
  poste: 150,
  taux: 92,
  contrat: 104,
  jours: 60,
  heures: 66,
  brut: 100,
  majorations: 96,
  frais: 86,
  facture: 108,
  cout: 108,
  marge: 104,
  remarques: 160,
  actions: 92,
}

const ETAT_COULEURS = {
  attente: { bg: 'var(--bg-elev)', fg: 'var(--txt-3)' },
  infos: { bg: 'rgba(255,159,10,.12)', fg: 'var(--amber)' },
  fait: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
  signe: { bg: 'rgba(0,200,117,.12)', fg: 'var(--green)' },
}

const eur = (v) => (v == null ? '—' : fmtEur(v))

function Th({ children, cols, ck, align = 'left' }) {
  return (
    <th
      className={`px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-${align} whitespace-nowrap`}
      style={{ position: 'relative', color: 'var(--txt-3)' }}
    >
      {children}
      <ColumnResizer {...cols.handle(ck)} />
    </th>
  )
}

/** Cellule éditable au clic, validée par Entrée ou perte de focus. */
function CelluleEditable({ valeur, onCommit, type = 'text', align = 'left', suffixe, lecture }) {
  const [edition, setEdition] = useState(false)
  const [brouillon, setBrouillon] = useState('')

  if (lecture) {
    return (
      <span className="text-xs truncate block" style={{ color: 'var(--txt-2)' }}>
        {valeur || '—'}
        {suffixe}
      </span>
    )
  }

  if (!edition) {
    return (
      <button
        type="button"
        onClick={() => {
          setBrouillon(valeur ?? '')
          setEdition(true)
        }}
        className={`w-full text-${align} text-xs truncate px-1 py-0.5 rounded`}
        style={{ color: valeur === '' || valeur == null ? 'var(--txt-3)' : 'var(--txt-2)' }}
        title="Cliquer pour modifier"
      >
        {valeur === '' || valeur == null ? '—' : valeur}
        {valeur != null && valeur !== '' && suffixe}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type={type}
      value={brouillon}
      onChange={(e) => setBrouillon(e.target.value)}
      onBlur={() => {
        setEdition(false)
        onCommit(brouillon)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setEdition(false)
          onCommit(brouillon)
        }
        if (e.key === 'Escape') setEdition(false)
      }}
      className={`w-full px-1 py-0.5 rounded text-xs text-${align} outline-none`}
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--blue)',
        color: 'var(--txt)',
      }}
    />
  )
}

export default function EmbauchesTable({
  embauches = [],
  dossier,
  params,
  onEdit,
  onDelete,
  onDuplicate,
  onPatch,
  lecture = false,
}) {
  const cols = useColumnWidths('embauches.tableur', DEFAULTS)

  const lignes = useMemo(
    () =>
      embauches.map((e) => ({
        embauche: e,
        calc: computeEmbauche({
          embauche: e,
          jours: e.jours,
          majorations: e.majorations,
          frais: e.frais,
          dossier,
          params,
          cout: e.cout,
        }),
      })),
    [embauches, dossier, params],
  )

  const totaux = useMemo(() => totauxEmbauches(lignes.map((l) => l.calc)), [lignes])

  // Afficher une colonne Coût vide à tout le monde laisserait croire à une
  // donnée manquante : on ne la monte que si la base en a servi au moins une.
  const montrerCout = lignes.some((l) => l.calc.cout)

  if (embauches.length === 0) {
    return (
      <div
        className="rounded-xl py-12 text-center"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Aucune embauche dans ce dossier.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full" style={{ tableLayout: 'fixed', minWidth: 1100 }}>
          <colgroup>
            <col style={{ width: cols.widths.nom }} />
            <col style={{ width: cols.widths.poste }} />
            <col style={{ width: cols.widths.taux }} />
            <col style={{ width: cols.widths.contrat }} />
            <col style={{ width: cols.widths.jours }} />
            <col style={{ width: cols.widths.heures }} />
            <col style={{ width: cols.widths.brut }} />
            <col style={{ width: cols.widths.majorations }} />
            <col style={{ width: cols.widths.frais }} />
            <col style={{ width: cols.widths.facture }} />
            {montrerCout && <col style={{ width: cols.widths.cout }} />}
            {montrerCout && <col style={{ width: cols.widths.marge }} />}
            <col style={{ width: cols.widths.remarques }} />
            {!lecture && <col style={{ width: cols.widths.actions }} />}
          </colgroup>

          <thead>
            {/* Totaux en tête, comme dans l'Excel */}
            <tr style={{ background: 'var(--bg-elev)' }}>
              <td className="px-2 py-1.5 text-[10px] font-bold uppercase" style={{ color: 'var(--txt-3)' }}>
                Total
              </td>
              <td />
              <td />
              <td />
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {totaux.totalJours}
              </td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {totaux.totalHeures}
              </td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {eur(totaux.brut)}
              </td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {eur(totaux.majorations)}
              </td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {eur(totaux.frais)}
              </td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                {eur(totaux.facture)}
              </td>
              {montrerCout && (
                <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums" style={{ color: 'var(--txt)' }}>
                  {eur(totaux.cout)}
                </td>
              )}
              {montrerCout && (
                <td
                  className="px-2 py-1.5 text-xs font-bold text-right tabular-nums"
                  style={{
                    color:
                      totaux.marge == null
                        ? 'var(--txt-3)'
                        : totaux.marge >= 0
                          ? 'var(--green)'
                          : 'var(--red)',
                  }}
                >
                  {eur(totaux.marge)}
                </td>
              )}
              <td />
              {!lecture && <td />}
            </tr>

            <tr style={{ borderBottom: '1px solid var(--brd)' }}>
              <Th cols={cols} ck="nom">Intermittent</Th>
              <Th cols={cols} ck="poste">Poste</Th>
              <Th cols={cols} ck="taux" align="right">Taux</Th>
              <Th cols={cols} ck="contrat">Contrat</Th>
              <Th cols={cols} ck="jours" align="right">Jours</Th>
              <Th cols={cols} ck="heures" align="right">Heures</Th>
              <Th cols={cols} ck="brut" align="right">Brut</Th>
              <Th cols={cols} ck="majorations" align="right">Major.</Th>
              <Th cols={cols} ck="frais" align="right">Frais</Th>
              <Th cols={cols} ck="facture" align="right">
                {dossier?.mode === 'frais_reels' ? 'Refacturé' : 'Facturé'}
              </Th>
              {montrerCout && <Th cols={cols} ck="cout" align="right">Coût réel</Th>}
              {montrerCout && <Th cols={cols} ck="marge" align="right">Marge</Th>}
              <Th cols={cols} ck="remarques">Remarques</Th>
              {!lecture && <Th cols={cols} ck="actions" align="right">&nbsp;</Th>}
            </tr>
          </thead>

          <tbody>
            {lignes.map(({ embauche: e, calc }) => {
              const etat = etatContrat(e)
              const couleurs = ETAT_COULEURS[etat.key]
              const manques = infosManquantes(e)
              const ouvert = estAPourvoir(e)

              return (
                <tr key={e.id} style={{ borderTop: '1px solid var(--brd-sub)' }}>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-xs truncate"
                        style={{
                          color: ouvert ? 'var(--txt-3)' : 'var(--txt)',
                          fontStyle: ouvert ? 'italic' : 'normal',
                          fontWeight: ouvert ? 400 : 500,
                        }}
                      >
                        {nomEmbauche(e)}
                      </span>
                      {manques.length > 0 && (
                        <Tooltip text={`Manque : ${manques.join(', ')}`}>
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--amber)' }} />
                        </Tooltip>
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-1.5">
                    <CelluleEditable
                      valeur={e.libelle_poste || e.poste_france_travail}
                      lecture={lecture}
                      onCommit={(v) => onPatch?.(e.id, { libelle_poste: v })}
                    />
                  </td>

                  <td className="px-2 py-1.5">
                    <CelluleEditable
                      valeur={e.taux}
                      type="number"
                      align="right"
                      suffixe=" €"
                      lecture={lecture}
                      onCommit={(v) => onPatch?.(e.id, { taux: Number(v) || 0 })}
                    />
                  </td>

                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      disabled={lecture}
                      onClick={() => {
                        // Un clic avance d'un cran : infos → contrat → signé.
                        if (!e.infos_recues) onPatch?.(e.id, { infos_recues: true })
                        else if (!e.contrat_fait) onPatch?.(e.id, { contrat_fait: true })
                        else if (!e.contrat_signe) onPatch?.(e.id, { contrat_signe: true })
                        else
                          onPatch?.(e.id, {
                            infos_recues: false,
                            contrat_fait: false,
                            contrat_signe: false,
                          })
                      }}
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                      style={{ background: couleurs.bg, color: couleurs.fg }}
                      title={lecture ? undefined : 'Cliquer pour faire avancer'}
                    >
                      {etat.label}
                    </button>
                  </td>

                  <td className="px-2 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--txt-2)' }}>
                    {calc.totalJours || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--txt-2)' }}>
                    {calc.totalHeures || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums font-medium" style={{ color: 'var(--txt)' }}>
                    {eur(calc.brut)}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--txt-2)' }}>
                    {calc.majorations.total ? eur(calc.majorations.total) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--txt-2)' }}>
                    {calc.fraisNonSoumis + calc.fraisSoumis
                      ? eur(calc.fraisNonSoumis + calc.fraisSoumis)
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums font-semibold" style={{ color: 'var(--txt)' }}>
                    {eur(calc.facture)}
                  </td>

                  {montrerCout && (
                    <td className="px-2 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--txt-2)' }}>
                      {calc.cout ? (
                        <span title={calc.cout.estEstimation ? 'Estimation' : 'Relevé Movinmotion'}>
                          {eur(calc.cout.montant)}
                          {calc.cout.estEstimation && (
                            <span style={{ color: 'var(--txt-3)' }}> ~</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}

                  {montrerCout && (
                    <td
                      className="px-2 py-1.5 text-xs text-right tabular-nums font-medium"
                      style={{
                        color:
                          calc.marge == null
                            ? 'var(--txt-3)'
                            : calc.marge >= 0
                              ? 'var(--green)'
                              : 'var(--red)',
                      }}
                    >
                      {calc.marge == null ? '—' : eur(calc.marge)}
                      {calc.margePct != null && (
                        <span className="block text-[9px]" style={{ color: 'var(--txt-3)' }}>
                          {calc.margePct} %
                        </span>
                      )}
                    </td>
                  )}

                  <td className="px-2 py-1.5">
                    <CelluleEditable
                      valeur={e.remarques}
                      lecture={lecture}
                      onCommit={(v) => onPatch?.(e.id, { remarques: v })}
                    />
                  </td>

                  {!lecture && (
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => onEdit?.(e)}
                          className="w-6 h-6 rounded flex items-center justify-center"
                          style={{ color: 'var(--txt-3)' }}
                          aria-label="Ouvrir la fiche"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate?.(e)}
                          className="w-6 h-6 rounded flex items-center justify-center"
                          style={{ color: 'var(--txt-3)' }}
                          aria-label="Dupliquer"
                          title="Dupliquer : même poste, mêmes jours, mêmes frais"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete?.(e)}
                          className="w-6 h-6 rounded flex items-center justify-center"
                          style={{ color: 'var(--txt-3)' }}
                          aria-label="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
