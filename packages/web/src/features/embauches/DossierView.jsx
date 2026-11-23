// ════════════════════════════════════════════════════════════════════════════
// DossierView — un dossier et ses embauches
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Plus, Settings2, Users, Loader2, FolderOpen, FileText,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import EmbauchesTable from './EmbauchesTable'
import EmbaucheModal from './EmbaucheModal'
import DossierModal from './DossierModal'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'
import { fmtEur } from '../../lib/cotisations'
import {
  computeEmbauche,
  totauxEmbauches,
  MODES,
  buildJours,
  conventionLabel,
} from '../../lib/embauches'
import {
  listEmbauches, updateEmbauche, deleteEmbauche, createEmbauche,
  duplicateEmbauche, saveJours, fetchMembresProjet,
} from '../../lib/embauchesData'

function Stat({ label, valeur, sous, couleur }) {
  return (
    <div className="px-4 py-2.5" style={{ background: 'var(--bg-surf)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
        {label}
      </p>
      <p
        className="text-lg font-bold tabular-nums"
        style={{ color: couleur || 'var(--txt)' }}
      >
        {valeur}
      </p>
      {sous && (
        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {sous}
        </p>
      )}
    </div>
  )
}

export default function DossierView({ dossier, params, orgId, onRetour, onDossierChange }) {
  const [embauches, setEmbauches] = useState([])
  const [chargement, setChargement] = useState(true)
  const [fiche, setFiche] = useState(null) // { embauche } ou { embauche: null } = création
  const [reglages, setReglages] = useState(false)
  const [reprise, setReprise] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    setEmbauches(await listEmbauches(dossier.id))
    setChargement(false)
  }, [dossier.id])

  useEffect(() => {
    charger()
  }, [charger])

  const totaux = useMemo(
    () =>
      totauxEmbauches(
        embauches.map((e) =>
          computeEmbauche({
            embauche: e,
            jours: e.jours,
            majorations: e.majorations,
            frais: e.frais,
            dossier,
            params,
            cout: e.cout,
          }),
        ),
      ),
    [embauches, dossier, params],
  )

  async function patcher(id, patch) {
    // Optimiste : le tableur doit répondre au clavier sans attendre le réseau.
    setEmbauches((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    try {
      await updateEmbauche(id, patch)
    } catch (err) {
      notify.error('Enregistrement : ' + (err?.message || err))
      charger()
    }
  }

  async function supprimer(embauche) {
    const ok = await confirm({
      title: 'Supprimer cette embauche ?',
      message: 'Ses jours, majorations et frais seront supprimés avec elle.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    setEmbauches((prev) => prev.filter((e) => e.id !== embauche.id))
    try {
      await deleteEmbauche(embauche.id)
    } catch (err) {
      notify.error('Suppression : ' + (err?.message || err))
      charger()
    }
  }

  async function dupliquer(embauche) {
    try {
      await duplicateEmbauche(embauche)
      notify.success('Embauche dupliquée.')
      charger()
    } catch (err) {
      console.error('[embauches] dupliquer:', err)
      notify.error('Duplication : ' + (err?.message || err))
    }
  }

  /** Reprend l'équipe du projet lié : une embauche par membre, jours compris. */
  async function reprendreEquipe() {
    setReprise(true)
    try {
      const membres = await fetchMembresProjet(dossier.project_id)
      const dejaLa = new Set(embauches.map((e) => e.contact_id).filter(Boolean))
      const aCreer = membres.filter((m) => !m.contact?.id || !dejaLa.has(m.contact.id))

      if (aCreer.length === 0) {
        notify.info('Toute l’équipe est déjà reprise.')
        return
      }

      for (const m of aCreer) {
        const ligne = await createEmbauche({
          dossier_id: dossier.id,
          contact_id: m.contact?.id || null,
          nom: m.contact?.nom || m.nom || '',
          prenom: m.contact?.prenom || m.prenom || '',
          email: m.contact?.email || null,
          telephone: m.contact?.telephone || null,
          libelle_poste: m.specialite || '',
          taux: Number(m.budget_convenu) || Number(m.contact?.tarif_jour_ref) || 0,
          unite_taux: 'jour_8h',
        })
        const jours = buildJours(m.presence_days || [], [], params)
        if (jours.length) await saveJours(ligne.id, jours)
      }

      notify.success(
        `${aCreer.length} embauche${aCreer.length > 1 ? 's' : ''} reprise${aCreer.length > 1 ? 's' : ''} de l’équipe.`,
      )
      charger()
    } catch (err) {
      console.error('[embauches] reprendreEquipe:', err)
      notify.error('Reprise : ' + (err?.message || err))
    } finally {
      setReprise(false)
    }
  }

  const modeLabel = MODES.find((m) => m.key === dossier.mode)?.label || dossier.mode
  const modeFraisReels = dossier.mode === 'frais_reels'

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onRetour}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            aria-label="Retour aux dossiers"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate" style={{ color: 'var(--txt)' }}>
              {dossier.nom}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-[11px]">
              <span
                className="px-1.5 py-0.5 rounded font-semibold"
                style={{
                  background: modeFraisReels ? 'rgba(255,159,10,.12)' : 'var(--blue-bg)',
                  color: modeFraisReels ? 'var(--amber)' : 'var(--blue)',
                }}
              >
                {modeLabel}
                {!modeFraisReels && ` · ${Math.round((dossier.coef_vente ?? 0) * 100)} %`}
              </span>
              {dossier.client?.nom && (
                <span style={{ color: 'var(--txt-3)' }}>{dossier.client.nom}</span>
              )}
              {dossier.project?.id && (
                <Link
                  to={`/projets/${dossier.project.id}/projet`}
                  className="flex items-center gap-1 hover:underline"
                  style={{ color: 'var(--blue)' }}
                >
                  <FolderOpen className="w-3 h-3" />
                  {dossier.project.nom}
                </Link>
              )}
              {dossier.bon_commande && (
                <span className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                  <FileText className="w-3 h-3" />
                  {dossier.bon_commande}
                </span>
              )}
              {dossier.numero_objet && (
                <span style={{ color: 'var(--txt-3)' }}>
                  Objet {dossier.numero_objet}
                </span>
              )}
              {dossier.convention && (
                <span style={{ color: 'var(--txt-3)' }}>{conventionLabel(dossier.convention)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {dossier.project_id && (
            <button
              type="button"
              onClick={reprendreEquipe}
              disabled={reprise}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            >
              {reprise ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Users className="w-3.5 h-3.5" />
              )}
              Reprendre l’équipe
            </button>
          )}
          <button
            type="button"
            onClick={() => setReglages(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Réglages
          </button>
          <button
            type="button"
            onClick={() => setFiche({ embauche: null })}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Embauche
          </button>
        </div>
      </div>

      {/* Totaux */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-px rounded-xl overflow-hidden"
        style={{ background: 'var(--brd-sub)', border: '1px solid var(--brd)' }}
      >
        <Stat label="Embauches" valeur={totaux.lignes} sous={`${totaux.totalJours} jours`} />
        <Stat label="Heures" valeur={totaux.totalHeures} />
        <Stat
          label="Brut"
          valeur={fmtEur(totaux.brutTotal)}
          sous={totaux.majorations ? `dont ${fmtEur(totaux.majorations)} majorés` : null}
        />
        <Stat
          label={modeFraisReels ? 'Refacturé' : 'Facturé'}
          valeur={totaux.facture == null ? '—' : fmtEur(totaux.facture)}
        />
        <Stat
          label="Marge"
          valeur={totaux.marge == null ? '—' : fmtEur(totaux.marge)}
          sous={totaux.margePct != null ? `${totaux.margePct} %` : 'non visible'}
          couleur={
            totaux.marge == null
              ? 'var(--txt-3)'
              : totaux.marge >= 0
                ? 'var(--green)'
                : 'var(--red)'
          }
        />
      </div>

      {chargement ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
        </div>
      ) : (
        <EmbauchesTable
          embauches={embauches}
          dossier={dossier}
          params={params}
          onEdit={(e) => setFiche({ embauche: e })}
          onDelete={supprimer}
          onDuplicate={dupliquer}
          onPatch={patcher}
        />
      )}

      {fiche && (
        <EmbaucheModal
          embauche={fiche.embauche}
          dossier={dossier}
          params={params}
          onClose={() => setFiche(null)}
          onSaved={charger}
        />
      )}

      {reglages && (
        <DossierModal
          dossier={dossier}
          orgId={orgId}
          onClose={() => setReglages(false)}
          onSaved={(row) => onDossierChange?.(row)}
        />
      )}
    </div>
  )
}
