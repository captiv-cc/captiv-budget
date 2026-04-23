// ════════════════════════════════════════════════════════════════════════════
// MaterielTab — page "Matériel" d'un projet (refonte blocs)
// ════════════════════════════════════════════════════════════════════════════
//
// Version minimaliste orchestrant :
//   - un header global (MaterielHeader) avec versions + actions globales
//   - une liste de blocs (BlockList) empilés verticalement
//   - un panneau latéral (LoueurRecapPanel) sur demande
//
// Les états sont portés par `useMateriel(projectId)`, toute la logique
// métier se situe dans le hook / lib/materiel. Cette page ne fait que
// câbler les handlers + gérer deux états UI purs :
//   - `recapOpen` (slide-over récap loueurs)
//   - `detailed` (déjà persisté via localStorage dans le hook)
//
// Gating : `useProjectPermissions(projectId).can('materiel', 'edit')`.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import { Package, Plus } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useMateriel } from '../../hooks/useMateriel'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { useProjet } from '../ProjetLayout'
import { notify } from '../../lib/notify'
import MaterielHeader from '../../features/materiel/components/MaterielHeader'
import BlockList from '../../features/materiel/components/BlockList'
import LoueurRecapPanel from '../../features/materiel/components/LoueurRecapPanel'
import MaterielPhotosPanel from '../../features/materiel/components/MaterielPhotosPanel'
import ExportLoueurModal from '../../features/materiel/components/ExportLoueurModal'
import PdfPreviewModal from '../../features/materiel/components/PdfPreviewModal'
import BilanExportModal from '../../features/materiel/components/BilanExportModal'
import ShareChecklistModal from '../../features/materiel/components/ShareChecklistModal'
import LoueurDocsPanel from '../../features/materiel/components/LoueurDocsPanel'
import {
  exportMatosGlobalPDF,
  exportMatosChecklistPDF,
  exportMatosLoueursPDF,
  exportMatosLoueursZip,
} from '../../features/materiel/matosPdfExport'
import {
  closeEssaisAsAdmin,
  reopenMatosVersion,
} from '../../lib/matosCloture'
import { isUnassignedRecap } from '../../lib/materiel'
import { confirm, prompt } from '../../lib/confirm'

const OUTIL_KEY = 'materiel'

export default function MaterielTab() {
  const { id: projectId } = useParams()
  const navigate = useNavigate()
  const ctx = useProjet()
  const project = ctx?.project
  const { org, user, profile } = useAuth()
  const orgId = org?.id
  // Nom à afficher dans le bilan PDF (Clôturé par X). Fallback sur l'email si
  // le profil n'a pas encore de full_name renseigné (ancien compte). Le prompt
  // de clôture permettra toujours de surcharger.
  const defaultUserName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.email ||
    ''
  const { can } = useProjectPermissions(projectId)
  const canEdit = can(OUTIL_KEY, 'edit')

  const mat = useMateriel(projectId)
  const {
    loading,
    detailLoading,
    versions,
    activeVersion,
    activeVersionId,
    setActiveVersionId,
    blocks,
    items,
    itemsByBlock,
    loueursByItem,
    loueursById,
    loueurs,
    materielBdd,
    flagCounts,
    checklistProgress,
    recapByLoueur,
    detailed,
    setDetailed,
    infosLogistiqueByLoueur, // MAT-20
    actions,
  } = mat

  const [recapOpen, setRecapOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // MAT-11D : panneau latéral Photos (audit transversal des photos de la
  // version). Conditionnellement monté (cf. fin du composant) pour que le
  // hook useCheckAuthedSession dans MaterielPhotosPanel ne se déclenche qu'à
  // l'ouverture — pas de fetch parasite en background.
  const [photosPanelOpen, setPhotosPanelOpen] = useState(false)
  // MAT-22 : modale d'export bilan avec choix (global / ZIP / loueur unique)
  // + preview inline. Remplace l'ancien bouton "Aperçu bilan" qui téléchargeait
  // directement le ZIP sans preview.
  const [bilanExportOpen, setBilanExportOpen] = useState(false)

  // ─── MAT-14 : Mode chantier authentifié ─────────────────────────────────
  // Ouvre la route plein écran `/projets/:id/materiel/check/:versionId`
  // pour l'utilisateur connecté. La route résout l'active version si le
  // segment versionId est omis, donc passer l'id explicite reste safe si
  // activeVersionId est null (rare — mais on retombe proprement).
  const handleOpenChantierMode = useCallback(() => {
    if (!projectId) return
    const suffix = activeVersionId ? `/${activeVersionId}` : ''
    navigate(`/projets/${projectId}/materiel/check${suffix}`)
  }, [navigate, projectId, activeVersionId])

  // ─── Export PDF (MAT-7) ─────────────────────────────────────────────────
  // previewState : doc prêt à prévisualiser (ou ZIP prêt à télécharger).
  //   { open, title, url, filename, download, revoke, isZip }
  const [previewState, setPreviewState] = useState(null)
  const [exportLoueurOpen, setExportLoueurOpen] = useState(false)
  // Garde-fou anti double-clic sur les exports (génération asynchrone).
  const exportingRef = useRef(false)

  const closePreview = useCallback(() => {
    setPreviewState((prev) => {
      if (prev?.revoke) {
        try {
          prev.revoke()
        } catch {
          /* no-op */
        }
      }
      return null
    })
  }, [])

  const runExport = useCallback(
    async (fn, label) => {
      if (exportingRef.current) return
      if (!activeVersion) {
        notify.error('Aucune version active')
        return
      }
      exportingRef.current = true
      try {
        const result = await fn()
        // Si ZIP : on télécharge directement (pas de preview possible).
        if (result.isZip) {
          result.download()
          // On laisse le blob vivant quelques secondes pour que le download démarre
          // puis on révoque — setTimeout est suffisant ici.
          setTimeout(() => {
            try {
              result.revoke()
            } catch {
              /* no-op */
            }
          }, 2000)
          notify.success('Archive ZIP téléchargée')
          return
        }
        setPreviewState({
          open: true,
          title: label,
          url: result.url,
          filename: result.filename,
          download: result.download,
          revoke: result.revoke,
          isZip: false,
        })
      } catch (err) {
        notify.error('Erreur export PDF : ' + (err?.message || err))
      } finally {
        exportingRef.current = false
      }
    },
    [activeVersion],
  )

  const handleExportGlobal = useCallback(() => {
    runExport(
      () =>
        exportMatosGlobalPDF({
          project,
          activeVersion,
          blocks,
          itemsByBlock,
          loueursByItem,
          loueursById,
          org,
          infosLogistiqueByLoueur, // MAT-20
        }),
      'Liste globale',
    )
  }, [runExport, project, activeVersion, blocks, itemsByBlock, loueursByItem, loueursById, org, infosLogistiqueByLoueur])

  const handleExportChecklist = useCallback(() => {
    runExport(
      () =>
        exportMatosChecklistPDF({
          project,
          activeVersion,
          blocks,
          itemsByBlock,
          loueursByItem,
          loueursById,
          org,
        }),
      'Checklist tournage',
    )
  }, [runExport, project, activeVersion, blocks, itemsByBlock, loueursByItem, loueursById, org])

  const handleExportByLoueur = useCallback(() => {
    // MAT-18 : on ignore le groupe synthétique "Non assigné" pour tester
    // s'il y a quelque chose à exporter. Si seul "Non assigné" est présent,
    // on notifie comme si la version n'avait aucun loueur attribué.
    const realCount =
      recapByLoueur?.filter((r) => !isUnassignedRecap(r)).length ?? 0
    if (!realCount) {
      notify.info('Aucun loueur affecté sur cette version')
      return
    }
    setExportLoueurOpen(true)
  }, [recapByLoueur])

  const handleExportLoueurConfirm = useCallback(
    ({ selectedIds, format }) => {
      setExportLoueurOpen(false)
      if (format === 'zip') {
        runExport(
          () =>
            exportMatosLoueursZip({
              project,
              activeVersion,
              recapByLoueur,
              org,
              selectedLoueurIds: selectedIds,
              infosLogistiqueByLoueur, // MAT-20
            }),
          'Par loueur (ZIP)',
        )
      } else {
        runExport(
          () =>
            exportMatosLoueursPDF({
              project,
              activeVersion,
              recapByLoueur,
              org,
              selectedLoueurIds: selectedIds,
              infosLogistiqueByLoueur, // MAT-20
            }),
          'Par loueur',
        )
      }
    },
    [runExport, project, activeVersion, recapByLoueur, org, infosLogistiqueByLoueur],
  )

  // ─── Handlers ────────────────────────────────────────────────────────────
  async function handleCreateVersion() {
    if (!canEdit) return
    try {
      await actions.createVersion({})
      notify.success('Nouvelle version créée')
    } catch (err) {
      notify.error('Erreur création version : ' + (err?.message || err))
    }
  }

  async function handleDuplicateVersion() {
    if (!canEdit || !activeVersionId) return
    try {
      await actions.duplicateVersion(activeVersionId)
      notify.success('Version dupliquée')
    } catch (err) {
      notify.error('Erreur duplication : ' + (err?.message || err))
    }
  }

  async function handleRestoreVersion(versionId) {
    try {
      await actions.restoreVersion(versionId)
      notify.success('Version restaurée')
    } catch (err) {
      notify.error('Erreur restauration : ' + (err?.message || err))
    }
  }

  async function handleRenameVersion(versionId, label) {
    try {
      await actions.updateVersion(versionId, { label })
    } catch (err) {
      notify.error('Erreur renommage : ' + (err?.message || err))
    }
  }

  async function handleDeleteVersion(versionId) {
    try {
      await actions.deleteVersion(versionId)
      notify.success('Version supprimée')
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }

  // ─── MAT-22 : Export bilan avec choix (global / ZIP / loueur) + preview ──
  //
  // Remplace l'ancien `previewBilanAsAdmin` + runExport qui téléchargeait
  // directement le ZIP. Désormais, on ouvre `BilanExportModal` qui fetch le
  // snapshot une fois et laisse l'utilisateur choisir le format avec preview
  // inline avant de télécharger. Aucune écriture DB / Storage ici.
  const handlePreviewBilan = useCallback(() => {
    if (!activeVersion) return
    setBilanExportOpen(true)
  }, [activeVersion])

  // ─── MAT-12 : Clôture essais + bilan PDF ────────────────────────────────
  //
  // handleCloseEssais :
  //   1. Prompt pour confirmer + éditer le nom affiché dans le bilan
  //   2. closeEssaisAsAdmin : crée un token admin éphémère, fetch la session,
  //      agrège, build le ZIP (PDF global + PDFs par loueur), upload, RPC close
  //   3. Téléchargement immédiat du ZIP local (bonus UX : l'admin a la copie
  //      avant même qu'il ouvre le viewer docs)
  //   4. Refresh pour que la version affiche `closed_at` et que le nouveau
  //      matos_version_attachment "Bilan essais V{n}" apparaisse dans les docs
  async function handleCloseEssais() {
    if (!canEdit || !activeVersion) return
    if (activeVersion.closed_at) {
      notify.info('Cette version est déjà clôturée')
      return
    }
    const name = await prompt({
      title: 'Clôturer les essais',
      message:
        'Génère le bilan PDF (global + par loueur) et pose la version en lecture seule. Tu pourras toujours ré-ouvrir si besoin.',
      placeholder: 'Prénom / Nom',
      initialValue: defaultUserName,
      required: true,
      confirmLabel: 'Clôturer & générer le bilan',
    })
    if (!name) return
    try {
      const { payload, zip } = await closeEssaisAsAdmin({
        versionId: activeVersion.id,
        userName: name,
        pdfOptions: { org },
      })
      // Download local direct (bonus UX).
      try {
        zip.download?.()
      } catch {
        /* no-op */
      }
      setTimeout(() => {
        try {
          zip.revoke?.()
        } catch {
          /* no-op */
        }
      }, 2000)
      notify.success(
        `Essais clôturés · Bilan archivé${payload?.attachment_id ? ' + déposé dans Documents loueur' : ''}`,
      )
      actions.refresh?.()
    } catch (err) {
      notify.error('Erreur clôture : ' + (err?.message || err))
    }
  }

  // handleReopenEssais : RPC authenticated qui efface closed_at/closed_by/
  // bilan_archive_path. Les anciennes archives ZIP restent accessibles dans
  // matos_version_attachments (audit trail), elles ne sont pas supprimées.
  async function handleReopenEssais() {
    if (!canEdit || !activeVersion?.closed_at) return
    const ok = await confirm({
      title: 'Ré-ouvrir la version',
      message:
        "Cette action efface la marque de clôture. Les bilans PDF déjà archivés restent consultables dans l'onglet Documents loueur (audit).",
      confirmLabel: 'Ré-ouvrir',
      cancelLabel: 'Annuler',
    })
    if (!ok) return
    try {
      await reopenMatosVersion(activeVersion.id)
      notify.success('Version ré-ouverte')
      actions.refresh?.()
    } catch (err) {
      notify.error('Erreur ré-ouverture : ' + (err?.message || err))
    }
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{
            borderColor: 'var(--blue)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    )
  }

  // ─── Empty state : aucune version sur le projet ─────────────────────────
  if (!versions.length) {
    return (
      <EmptyNoVersions
        projectTitle={project?.title}
        canEdit={canEdit}
        onCreate={handleCreateVersion}
      />
    )
  }

  // ─── Rendu principal ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full">
      <MaterielHeader
        totalItems={items.length}
        flagCounts={flagCounts}
        checklistProgress={checklistProgress}
        versions={versions}
        activeVersion={activeVersion}
        onSelectVersion={setActiveVersionId}
        onCreateVersion={handleCreateVersion}
        onDuplicateVersion={handleDuplicateVersion}
        onRestoreVersion={handleRestoreVersion}
        onRenameVersion={handleRenameVersion}
        onDeleteVersion={handleDeleteVersion}
        detailed={detailed}
        onToggleDetailed={setDetailed}
        onOpenRecap={() => setRecapOpen(true)}
        onOpenShare={() => setShareOpen(true)}
        onOpenChantierMode={handleOpenChantierMode}
        onOpenPhotos={() => setPhotosPanelOpen(true)}
        onExportGlobal={handleExportGlobal}
        onExportByLoueur={handleExportByLoueur}
        onExportChecklist={handleExportChecklist}
        onPreviewBilan={handlePreviewBilan}
        onCloseEssais={handleCloseEssais}
        onReopenEssais={handleReopenEssais}
        canEdit={canEdit}
      />

      <div className="p-5 flex-1">
        {detailLoading ? (
          <div className="flex items-center justify-center p-10">
            <div
              className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--blue)',
                borderTopColor: 'transparent',
              }}
            />
          </div>
        ) : (
          <>
            <BlockList
              blocks={blocks}
              itemsByBlock={itemsByBlock}
              loueursByItem={loueursByItem}
              loueursById={loueursById}
              allLoueurs={loueurs}
              orgId={orgId}
              materielBdd={materielBdd}
              actions={actions}
              canEdit={canEdit}
              detailed={detailed}
            />
            <LoueurDocsPanel versionId={activeVersionId} canEdit={canEdit} />
          </>
        )}
      </div>

      <LoueurRecapPanel
        open={recapOpen}
        onClose={() => setRecapOpen(false)}
        recap={recapByLoueur}
        activeVersionLabel={
          activeVersion
            ? `V${activeVersion.numero}${activeVersion.label ? ' — ' + activeVersion.label : ''}`
            : ''
        }
        project={project}
        activeVersion={activeVersion}
        org={org}
        onPreview={(result, title) =>
          setPreviewState({
            open: true,
            title,
            url: result.url,
            filename: result.filename,
            download: result.download,
            revoke: result.revoke,
            isZip: Boolean(result.isZip),
          })
        }
        infosLogistiqueByLoueur={infosLogistiqueByLoueur}
        onSaveInfos={actions.saveLoueurInfos}
        canEdit={canEdit}
      />

      <ExportLoueurModal
        open={exportLoueurOpen}
        onClose={() => setExportLoueurOpen(false)}
        recapByLoueur={recapByLoueur}
        onConfirm={handleExportLoueurConfirm}
      />

      <PdfPreviewModal
        open={Boolean(previewState?.open)}
        onClose={closePreview}
        title={previewState?.title}
        url={previewState?.url}
        filename={previewState?.filename}
        onDownload={() => previewState?.download?.()}
        isZip={Boolean(previewState?.isZip)}
      />

      {/* MAT-22 : Modale d'export bilan avec choix (global / ZIP / loueur)
          + preview inline. Ouverte via le dropdown Essais > "Exporter bilan". */}
      <BilanExportModal
        open={bilanExportOpen}
        onClose={() => setBilanExportOpen(false)}
        versionId={activeVersion?.id}
        org={org}
      />

      <ShareChecklistModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        activeVersion={activeVersion}
      />

      {/* MAT-11D : Panneau Photos (slide-over) — monté conditionnellement pour
          que useCheckAuthedSession à l'intérieur ne se déclenche qu'au premier
          open. Re-ouvrir = re-fetch frais (désiré en contexte admin d'audit). */}
      {photosPanelOpen && activeVersionId && (
        <MaterielPhotosPanel
          open={photosPanelOpen}
          onClose={() => setPhotosPanelOpen(false)}
          versionId={activeVersionId}
          activeVersionLabel={
            activeVersion
              ? `V${activeVersion.numero}${activeVersion.label ? ' — ' + activeVersion.label : ''}`
              : ''
          }
          canEdit={canEdit}
        />
      )}
    </div>
  )
}

// ─── Empty state : projet sans version ──────────────────────────────────────

function EmptyNoVersions({ projectTitle, canEdit, onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full p-10">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'var(--blue-bg)' }}
      >
        <Package className="w-6 h-6" style={{ color: 'var(--blue)' }} />
      </div>
      <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--txt)' }}>
        Aucune version matériel
      </h2>
      <p className="text-sm mb-6 text-center max-w-md" style={{ color: 'var(--txt-3)' }}>
        {projectTitle ? (
          <>
            Le projet <span style={{ color: 'var(--txt-2)' }}>{projectTitle}</span> n&apos;a
            pas encore de version matériel. Crée-en une pour démarrer.
          </>
        ) : (
          'Crée une première version pour démarrer.'
        )}
      </p>

      {canEdit ? (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{ background: 'var(--blue)', color: 'white' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          Créer la première version
        </button>
      ) : (
        <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          Tu n&apos;as pas les droits pour créer une version sur ce projet.
        </p>
      )}
    </div>
  )
}
