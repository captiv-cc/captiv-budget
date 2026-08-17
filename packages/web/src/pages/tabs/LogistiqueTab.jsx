// ════════════════════════════════════════════════════════════════════════════
// LogistiqueTab — Onglet "Logistique" d'un projet (V0 PROVISOIRE)
// ════════════════════════════════════════════════════════════════════════════
//
// Mini outil rapide pour publier les infos logistique de l'équipe :
//   - Liste des personnes ajoutées (1 carte par personne, choix manuel)
//   - Chaque carte : 3 sous-blocs Transport / Hébergement / Repas
//     (textarea libre + upload PDF/PNG/JPG multi)
//
// Sera REMPLACÉ par LOGISTIQUE V1/V2/V3 (calendrier, hébergements partagés,
// transports avec tracking, per diem, etc.) — d'où le naming `logistique_v0`
// partout (DB, perm, bucket).
//
// Pattern aligné sur DerouleTab pour la gestion permissions / loading / error.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, AlertCircle, Lock, Truck, Loader2, Inbox, Table2, Users, ClipboardList, Share2 } from 'lucide-react'
import LogistiqueShareModal from '../../features/logistique/LogistiqueShareModal'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { useProjet } from '../ProjetLayout'
import { useLogistiqueV0 } from '../../hooks/useLogistiqueV0'
import { fetchProjectMembers, listTechlistRows } from '../../lib/crew'
import LogistiqueEntryCard from '../../features/logistique/LogistiqueEntryCard'
import LogistiqueStructuredSection from '../../features/logistique/LogistiqueStructuredSection'
import LogistiqueGlobalCard from '../../features/logistique/LogistiqueGlobalCard'
import LogistiqueGridView from '../../features/logistique/LogistiqueGridView'
import LogistiqueSyntheseView from '../../features/logistique/LogistiqueSyntheseView'
import TrajetModal from '../../features/logistique/TrajetModal'
import { fetchLogistique, upsertHebergementMembre } from '../../lib/logistique'
import { notify } from '../../lib/notify'

const OUTIL_KEY = 'logistique_v0'

export default function LogistiqueTab() {
  const { id: projectId } = useParams()
  // LOGI-V1 : le project (metadata.equipe pour l'ordre des catégories,
  // metadata périodes pour ancrer la modale Présence sur l'événement).
  const { project } = useProjet() || {}
  const { org } = useAuth()
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

  const {
    entries,
    documentsByEntry,
    global: globalRow,
    globalDocuments,
    loading,
    error,
    addEntry,
    removeEntry,
    updateEntryText,
    setEntryHiddenKinds,
    uploadDocument,
    deleteDocument,
    updateGlobalText,
    uploadGlobalDocument,
    deleteGlobalDocument,
  } = useLogistiqueV0(canRead ? projectId : null)

  // Charge la liste des membres du projet pour le picker d'ajout + le mapping
  // entry.membre_id → infos membre (nom, prénom, spécialité).
  const [membres, setMembres] = useState([])
  const [membresLoading, setMembresLoading] = useState(true)
  useEffect(() => {
    if (!canRead || !projectId) {
      setMembresLoading(false)
      return
    }
    let cancelled = false
    setMembresLoading(true)
    fetchProjectMembers(projectId)
      .then((data) => {
        if (!cancelled) setMembres(data)
      })
      .catch((err) => {
         
        console.error('[LogistiqueTab] fetchProjectMembers error :', err)
      })
      .finally(() => {
        if (!cancelled) setMembresLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, canRead])

  // LOGI-V1 P1 : vue Grille (personnes × jours) vs vue Par personne (V0).
  // Persistée par projet ; défaut = grille (la nouvelle vue centrale).
  const VIEW_KEY = `logistique.view.${projectId || 'global'}`
  const [view, setViewRaw] = useState(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      return v === 'personnes' || v === 'synthese' ? v : 'grille'
    } catch {
      return 'grille'
    }
  })
  const setView = (v) => {
    setViewRaw(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* ignore */
    }
  }

  // LOGI-V1 P2 : données structurées (trajets, hébergements, nuits) pour la
  // vue « Par personne » — la grille fait son propre fetch de son côté.
  const [logiV1, setLogiV1] = useState(null)
  const loadLogiV1 = useCallback(async () => {
    if (!projectId) return
    try {
      setLogiV1(await fetchLogistique(projectId))
    } catch (err) {
      console.warn('[LogistiqueTab] fetchLogistique:', err?.message || err)
    }
  }, [projectId])
  useEffect(() => {
    if (view === 'personnes' && canRead) loadLogiV1()
  }, [view, canRead, loadLogiV1])

  // Éditeur de trajet partagé (vue Par personne). { membre, trajet|null }
  const [trajetEdit, setTrajetEdit] = useState(null)

  // P4+ : accès direct au partage portail (retour Hugo — bouton dédié comme
  // les autres onglets ; la config Logistique du lien s'y règle).
  const [shareOpen, setShareOpen] = useState(false)

  // Chambre / PDJ : la row hebergement_membres est créée à la volée sur le
  // 1er edit — l'hébergement lui-même DÉRIVE des nuits (modèle validé Hugo).
  // hebId vient du bloc édité : une personne peut avoir plusieurs séjours
  // (logement A puis B), chacun avec sa chambre et son PDJ.
  async function handlePatchHebergementMembre(membre, patch, hebId) {
    const targetHebId = hebId
    if (!targetHebId) return
    try {
      await upsertHebergementMembre({
        projectId,
        hebergementId: targetHebId,
        membreId: membre.id,
        patch,
      })
      await loadLogiV1()
    } catch (err) {
      notify.error('Hébergement : ' + (err?.message || err))
    }
  }

  // ─── Guard permissions ────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div className="p-8 text-center">
        <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Tu n&apos;as pas accès à la logistique de ce projet.
        </p>
      </div>
    )
  }

  if (loading || membresLoading) {
    return (
      <div className="p-12 text-center">
        <Loader2
          className="w-6 h-6 mx-auto animate-spin"
          style={{ color: 'var(--txt-3)' }}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle
          className="w-8 h-8 mx-auto mb-2"
          style={{ color: 'var(--red)' }}
        />
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {error.message || 'Erreur lors du chargement de la logistique'}
        </p>
      </div>
    )
  }

  async function handleAdd(membreIds) {
    // Itère séquentiellement pour éviter de spammer la DB.
    for (const id of membreIds) {
      await addEntry({ membreId: id })
    }
  }

  return (
    <div className="p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <div>
            <h1
              className="text-lg font-semibold"
              style={{ color: 'var(--txt)' }}
            >
              Logistique & VHR
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
              Transport · Hébergement · Repas — adossé aux présences Équipe
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              title="Liens de partage du projet — sections Logistique configurables par lien"
            >
              <Share2 className="w-3.5 h-3.5" />
              Partager
            </button>
          )}
          {/* LOGI-V1 : bascule Grille / Par personne */}
          <div
            className="flex items-center rounded-md overflow-hidden"
            style={{ border: '1px solid var(--brd)' }}
          >
            <ViewBtn
              active={view === 'grille'}
              icon={Table2}
              label="Grille"
              onClick={() => setView('grille')}
            />
            <ViewBtn
              active={view === 'personnes'}
              icon={Users}
              label="Par personne"
              onClick={() => setView('personnes')}
            />
            <ViewBtn
              active={view === 'synthese'}
              icon={ClipboardList}
              label="Synthèse"
              onClick={() => setView('synthese')}
            />
          </div>
        </div>
      </div>

      {/* ─── Bloc Global (infos générales projet) ─────────────────────── */}
      <div className="mb-4">
        <LogistiqueGlobalCard
          text={globalRow?.text}
          documents={globalDocuments}
          readOnly={!canEdit}
          onUpdateText={updateGlobalText}
          onUploadDocument={uploadGlobalDocument}
          onDeleteDocument={deleteGlobalDocument}
        />
      </div>

      {/* ─── Vue Grille (LOGI-V1 P1) ─────────────────────────────────── */}
      {view === 'grille' && (
        <LogistiqueGridView
          projectId={projectId}
          project={project}
          membres={membres}
          canEdit={canEdit}
        />
      )}

      {/* ─── Vue Synthèse (LOGI-V1 P3) ────────────────────────────────── */}
      {view === 'synthese' && (
        <LogistiqueSyntheseView
          projectId={projectId}
          project={project}
          org={org}
          membres={membres}
        />
      )}

      {/* ─── Vue Par personne — TOUTE l'équipe (retour Hugo : la vue ne
           listait que les entries V0 créées à la main → paraissait vide).
           Rows principales fusionnées comme la Crew list ; la carte V0
           (notes + docs) n'existe que si des notes ont été créées, sinon
           carte légère avec la couche structurée + bouton d'activation. */}
      {view === 'personnes' &&
        (membres.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {listTechlistRows(membres).map((membre) => {
              const entry = entries.find((e) => e.membre_id === membre.id) || null
              const structured = logiV1
                ? {
                    trajets: logiV1.trajets.filter((t) => t.membre_id === membre.id),
                    hebergements: logiV1.hebergements,
                    hebergementMembres: logiV1.hebergementMembres.filter(
                      (hm) => hm.membre_id === membre.id,
                    ),
                    nuits: logiV1.nuits.filter((n) => n.membre_id === membre.id),
                    docs: logiV1.docs,
                    onEditTrajet: (t) => setTrajetEdit({ membre, trajet: t }),
                    onAddTrajet: () => setTrajetEdit({ membre, trajet: null }),
                    onPatchHebergementMembre: (patch, hebId) =>
                      handlePatchHebergementMembre(membre, patch, hebId),
                  }
                : null
              if (entry) {
                return (
                  <LogistiqueEntryCard
                    key={membre.id}
                    entry={entry}
                    membre={membre}
                    documentsByKind={documentsByEntry.get(entry.id)}
                    readOnly={!canEdit}
                    onUpdateText={updateEntryText}
                    onUploadDocument={uploadDocument}
                    onDeleteDocument={deleteDocument}
                    onRemoveEntry={removeEntry}
                    onSetHiddenKinds={setEntryHiddenKinds}
                    structured={structured}
                  />
                )
              }
              return (
                <LightPersonCard
                  key={membre.id}
                  membre={membre}
                  structured={structured}
                  canEdit={canEdit}
                  onActivateNotes={() => handleAdd([membre.id])}
                />
              )
            })}
          </div>
        ))}

      {/* Éditeur de trajet (vue Par personne) */}
      {trajetEdit && (
        <TrajetModal
          projectId={projectId}
          membre={trajetEdit.membre}
          membreName={
            trajetEdit.membre?.contact
              ? `${trajetEdit.membre.contact.prenom || ''} ${trajetEdit.membre.contact.nom || ''}`.trim()
              : `${trajetEdit.membre?.prenom || ''} ${trajetEdit.membre?.nom || ''}`.trim()
          }
          trajet={trajetEdit.trajet}
          docs={
            trajetEdit.trajet && logiV1
              ? logiV1.docs.filter(
                  (doc) => doc.parent_type === 'trajet' && doc.parent_id === trajetEdit.trajet.id,
                )
              : []
          }
          onSaved={() => loadLogiV1()}
          onDeleted={() => loadLogiV1()}
          onClose={() => setTrajetEdit(null)}
        />
      )}

      {/* Partage portail (multi-liens, config Logistique par lien) */}
      {shareOpen && (
        <LogistiqueShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={projectId}
        />
      )}

    </div>
  )
}

// ─── Carte légère (membre sans notes V0) ───────────────────────────────────
// La couche structurée (trajets, hébergement) vit ici quoi qu'il arrive ;
// les notes libres + documents V0 s'activent à la demande.
function LightPersonCard({ membre, structured, canEdit, onActivateNotes }) {
  const prenom = membre.contact?.prenom || membre.prenom || ''
  const nom = membre.contact?.nom || membre.nom || ''
  const fullName = `${prenom} ${nom}`.trim() || 'Sans nom'
  const initials = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
  const poste = membre.devis_line?.produit || membre.specialite || membre.contact?.specialite || ''

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {fullName}
          </p>
          {poste && (
            <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
              {poste}
            </p>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onActivateNotes}
            className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
            style={{ color: 'var(--txt-3)', border: '1px dashed var(--brd)' }}
            title="Activer les notes libres et documents par rubrique (transport / hébergement / repas)"
          >
            <Plus className="w-3 h-3" />
            Notes &amp; documents
          </button>
        )}
      </div>
      {structured && <LogistiqueStructuredSection {...structured} readOnly={!canEdit} />}
    </div>
  )
}

// ─── ViewBtn (bascule Grille / Par personne) ───────────────────────────────
function ViewBtn({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
        color: active ? 'var(--blue)' : 'var(--txt-2)',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Inbox
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--txt)' }}>
        Aucun membre au projet
      </h2>
      <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--txt-3)' }}>
        Ajoute des personnes à l&apos;équipe (onglet Équipe) — elles apparaîtront
        automatiquement ici avec leurs trajets, hébergement et repas.
      </p>
    </div>
  )
}
