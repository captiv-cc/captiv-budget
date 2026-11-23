// ════════════════════════════════════════════════════════════════════════════
// Embauches — vue d'ensemble du suivi des contrats d'intermittence
// ════════════════════════════════════════════════════════════════════════════
//
// Entrée réservée aux admins (garde de route). Deux angles :
//   · Ce mois-ci : les embauches de la période, tous dossiers confondus
//   · Dossiers   : la liste, portage comme suivi interne
//
// Cf. docs/CHANTIER_EMBAUCHES.md.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileSignature, Plus, ChevronLeft, ChevronRight, Loader2, FolderOpen, Info,
  SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import DossierModal from '../features/embauches/DossierModal'
import DossierView from '../features/embauches/DossierView'
import ParamsModal from '../features/embauches/ParamsModal'
import EmbauchesTable from '../features/embauches/EmbauchesTable'
import { fmtEur } from '../lib/cotisations'
import {
  computeEmbauche, totauxEmbauches, bornesMois, paramsPourConvention,
  MODES, STATUTS_DOSSIER,
} from '../lib/embauches'
import {
  fetchParamsParConvention,
  listDossiers,
  listEmbauchesPeriode,
} from '../lib/embauchesData'

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function Stat({ label, valeur, sous, couleur }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
        {label}
      </p>
      <p className="text-xl font-bold tabular-nums" style={{ color: couleur || 'var(--txt)' }}>
        {valeur}
      </p>
      {sous && (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {sous}
        </p>
      )}
    </div>
  )
}

// ─── Vue mensuelle ──────────────────────────────────────────────────────────

function VueMois({ orgId, paramsParConvention, onOuvrirDossier }) {
  const maintenant = new Date()
  const [periode, setPeriode] = useState({
    annee: maintenant.getFullYear(),
    mois: maintenant.getMonth(),
  })
  const [donnees, setDonnees] = useState({ embauches: [], dossiers: [] })
  const [chargement, setChargement] = useState(true)

  const bornes = useMemo(
    () => bornesMois(periode.annee, periode.mois),
    [periode],
  )

  useEffect(() => {
    let annule = false
    setChargement(true)
    listEmbauchesPeriode(orgId, bornes.debut, bornes.fin).then((d) => {
      if (annule) return
      setDonnees(d)
      setChargement(false)
    })
    return () => {
      annule = true
    }
  }, [orgId, bornes])

  const parDossier = useMemo(() => {
    const index = new Map(donnees.dossiers.map((d) => [d.id, d]))
    const groupes = new Map()
    for (const e of donnees.embauches) {
      if (!groupes.has(e.dossier_id)) {
        groupes.set(e.dossier_id, { dossier: index.get(e.dossier_id), embauches: [] })
      }
      groupes.get(e.dossier_id).embauches.push(e)
    }
    return [...groupes.values()].filter((g) => g.dossier)
  }, [donnees])

  const totaux = useMemo(() => {
    const calcs = []
    for (const { dossier, embauches } of parDossier) {
      for (const e of embauches) {
        calcs.push(
          computeEmbauche({
            embauche: e,
            jours: e.jours,
            majorations: e.majorations,
            frais: e.frais,
            dossier,
            params: paramsPourConvention(paramsParConvention, dossier?.convention),
            cout: e.cout,
          }),
        )
      }
    }
    return totauxEmbauches(calcs)
  }, [parDossier, paramsParConvention])

  // Un contrat à cheval sur deux mois compte ici pour sa totalité : les
  // majorations et les frais ne portent pas de date, les proratiser
  // inventerait des chiffres. On le dit plutôt que de le masquer.
  const aCheval = useMemo(
    () =>
      donnees.embauches.filter((e) =>
        (e.jours || []).some((j) => j.date_jour < bornes.debut || j.date_jour > bornes.fin),
      ).length,
    [donnees, bornes],
  )

  function bouger(delta) {
    setPeriode((p) => {
      const d = new Date(p.annee, p.mois + delta, 1)
      return { annee: d.getFullYear(), mois: d.getMonth() }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => bouger(-1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          aria-label="Mois précédent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold w-40 text-center" style={{ color: 'var(--txt)' }}>
          {MOIS[periode.mois]} {periode.annee}
        </span>
        <button
          type="button"
          onClick={() => bouger(1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          aria-label="Mois suivant"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          label="Embauches"
          valeur={totaux.lignes}
          sous={`${parDossier.length} dossier${parDossier.length > 1 ? 's' : ''}`}
        />
        <Stat label="Jours" valeur={totaux.totalJours} sous={`${totaux.totalHeures} h`} />
        <Stat label="Masse salariale brute" valeur={fmtEur(totaux.brut)} />
        <Stat
          label="Facturé"
          valeur={totaux.facture == null ? '—' : fmtEur(totaux.facture)}
        />
        <Stat
          label="Marge"
          valeur={totaux.marge == null ? '—' : fmtEur(totaux.marge)}
          sous={totaux.margePct != null ? `${totaux.margePct} %` : null}
          couleur={
            totaux.marge == null
              ? 'var(--txt-3)'
              : totaux.marge >= 0
                ? 'var(--green)'
                : 'var(--red)'
          }
        />
      </div>

      {aCheval > 0 && (
        <p
          className="flex items-start gap-2 text-[11px] px-3 py-2 rounded-lg"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          {aCheval} contrat{aCheval > 1 ? 's débordent' : ' déborde'} du mois. Les montants
          affichés couvrent la totalité du contrat, pas seulement la part de {MOIS[periode.mois].toLowerCase()}.
        </p>
      )}

      {chargement ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
        </div>
      ) : parDossier.length === 0 ? (
        <div
          className="rounded-xl py-12 text-center"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            Aucune embauche sur {MOIS[periode.mois].toLowerCase()} {periode.annee}.
          </p>
        </div>
      ) : (
        parDossier.map(({ dossier, embauches }) => (
          <div key={dossier.id} className="space-y-2">
            <button
              type="button"
              onClick={() => onOuvrirDossier(dossier)}
              className="flex items-center gap-2 text-sm font-semibold hover:underline"
              style={{ color: 'var(--txt)' }}
            >
              <FolderOpen className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
              {dossier.nom}
              <span className="text-[11px] font-normal" style={{ color: 'var(--txt-3)' }}>
                {embauches.length} embauche{embauches.length > 1 ? 's' : ''}
              </span>
            </button>
            <EmbauchesTable
              embauches={embauches}
              dossier={dossier}
              params={paramsPourConvention(paramsParConvention, dossier?.convention)}
              lecture
            />
          </div>
        ))
      )}
    </div>
  )
}

// ─── Liste des dossiers ─────────────────────────────────────────────────────

function ListeDossiers({ dossiers, chargement, onOuvrir }) {
  if (chargement) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  if (dossiers.length === 0) {
    return (
      <div
        className="rounded-xl py-12 text-center"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Aucun dossier. Créez-en un pour suivre vos contrats.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {dossiers.map((d) => {
        const modeFraisReels = d.mode === 'frais_reels'
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onOuvrir(d)}
            className="text-left rounded-xl p-4 transition-colors"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                {d.nom}
              </h3>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0"
                style={{
                  background: modeFraisReels ? 'rgba(255,159,10,.12)' : 'var(--blue-bg)',
                  color: modeFraisReels ? 'var(--amber)' : 'var(--blue)',
                }}
              >
                {MODES.find((m) => m.key === d.mode)?.label || d.mode}
              </span>
            </div>
            <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--txt-3)' }}>
              {d.client?.nom || 'Suivi interne'}
              {d.project?.nom ? ` · ${d.project.nom}` : ''}
            </p>
            <p className="text-[10px] mt-2" style={{ color: 'var(--txt-3)' }}>
              {STATUTS_DOSSIER.find((s) => s.key === d.statut)?.label || d.statut}
              {d.date_debut ? ` · dès le ${d.date_debut.split('-').reverse().join('/')}` : ''}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Embauches() {
  const { org } = useAuth()
  const orgId = org?.id

  const [vue, setVue] = useState('mois')
  const [dossiers, setDossiers] = useState([])
  const [chargement, setChargement] = useState(true)
  const [paramsParConvention, setParamsParConvention] = useState(null)
  const [reglages, setReglages] = useState(false)
  const [creation, setCreation] = useState(false)
  const [ouvert, setOuvert] = useState(null)

  const charger = useCallback(async () => {
    if (!orgId) return
    setChargement(true)
    const [p, d] = await Promise.all([fetchParamsParConvention(orgId), listDossiers(orgId)])
    setParamsParConvention(p)
    setDossiers(d)
    setChargement(false)
  }, [orgId])

  useEffect(() => {
    charger()
  }, [charger])

  function ouvrirDossier(d) {
    setOuvert(d)
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(20,184,166,.12)' }}
          >
            <FileSignature className="w-5 h-5" style={{ color: '#14B8A6' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
              Embauches
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Suivi des contrats d’intermittence, portage et projets internes
            </p>
          </div>
        </div>

        {!ouvert && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReglages(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Règles de calcul
            </button>
            <button
              type="button"
              onClick={() => setCreation(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Nouveau dossier
            </button>
          </div>
        )}
      </div>

      {ouvert ? (
        <DossierView
          dossier={ouvert}
          params={paramsPourConvention(paramsParConvention, ouvert.convention)}
          orgId={orgId}
          onRetour={() => {
            setOuvert(null)
            charger()
          }}
          onDossierChange={(row) => {
            setOuvert(row)
            charger()
          }}
        />
      ) : (
        <>
          <div className="flex gap-1 mb-4">
            {[
              { key: 'mois', label: 'Ce mois-ci' },
              { key: 'dossiers', label: `Dossiers${dossiers.length ? ` (${dossiers.length})` : ''}` },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setVue(t.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: vue === t.key ? 'var(--bg-surf)' : 'transparent',
                  border: `1px solid ${vue === t.key ? 'var(--brd)' : 'transparent'}`,
                  color: vue === t.key ? 'var(--txt)' : 'var(--txt-3)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {vue === 'mois' ? (
            paramsParConvention && (
              <VueMois
                orgId={orgId}
                paramsParConvention={paramsParConvention}
                onOuvrirDossier={ouvrirDossier}
              />
            )
          ) : (
            <ListeDossiers
              dossiers={dossiers}
              chargement={chargement}
              onOuvrir={ouvrirDossier}
            />
          )}
        </>
      )}

      {reglages && paramsParConvention && (
        <ParamsModal
          orgId={orgId}
          parConvention={paramsParConvention}
          onClose={() => setReglages(false)}
          onSaved={(convention, ligne) =>
            setParamsParConvention((prev) => ({ ...prev, [convention]: ligne }))
          }
        />
      )}

      {creation && (
        <DossierModal
          orgId={orgId}
          onClose={() => setCreation(false)}
          onSaved={(row) => {
            charger()
            setOuvert(row)
          }}
        />
      )}
    </div>
  )
}
