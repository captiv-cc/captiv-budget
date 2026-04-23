// ════════════════════════════════════════════════════════════════════════════
// MaterielHeader — en-tête de la page Matériel
// ════════════════════════════════════════════════════════════════════════════
//
// Structure :
//
//   ┌───────────────────────────────────────────────────────────────────┐
//   │ 📦 Matériel                                                        │
//   │    X items · checklist Y/Z · 🟢 n / 🟡 n / 🔴 n                    │
//   │                                                                    │
//   │                                                                    │
//   │                         [VersionSwitcher] [Dupliquer] [+Version]   │
//   │                                          [Détails]  [Récap loueurs]│
//   └───────────────────────────────────────────────────────────────────┘
//
// Les pastilles de flags + compteurs sont compactes, alignées à gauche.
// Les actions sont groupées à droite et restent visibles en read-only (sauf
// Dupliquer/Nouvelle version qui disparaissent si !canEdit).
//
// Props :
//   - totalItems, flagCounts, checklistProgress
//   - versions, activeVersion
//   - onSelectVersion, onCreateVersion, onDuplicateVersion,
//     onRestoreVersion, onRenameVersion, onDeleteVersion
//   - detailed, onToggleDetailed
//   - onOpenRecap
//   - onOpenPhotos : ouvre le panneau latéral Photos (MAT-11D) — optionnel,
//                    le bouton est masqué si null
//   - onExportGlobal, onExportByLoueur, onExportChecklist (MAT-7)
//   - onPreviewBilan, onCloseEssais, onReopenEssais  (MAT-12)
//   - canEdit
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  Lock,
  LockOpen,
  MoreHorizontal,
  Package,
  PackageCheck,
  Plus,
  Share2,
  Truck,
  Users,
} from 'lucide-react'
// Note — MAT-22 : "Aperçu bilan" et "Clôturer" ne sont plus des boutons
// autonomes mais des items du dropdown Essais (même point d'entrée que
// Checklist/Partager). Le ClotureBadge (+ Ré-ouvrir) reste affiché hors
// dropdown puisqu'il communique l'état clôturé de la version.
import { MATOS_FLAGS } from '../../../lib/materiel'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import ActionSheet from '../../../components/ActionSheet'
import VersionSwitcher from './VersionSwitcher'
import ExportPdfMenu from './ExportPdfMenu'

export default function MaterielHeader({
  totalItems = 0,
  flagCounts = {},
  checklistProgress = {},
  versions = [],
  activeVersion = null,
  onSelectVersion,
  onCreateVersion,
  onDuplicateVersion,
  onRestoreVersion,
  onRenameVersion,
  onDeleteVersion,
  detailed = false,
  onToggleDetailed,
  onOpenRecap,
  onOpenShare,
  onOpenChantierMode,
  // MAT-11D : ouvre le panneau "Photos" latéral (audit transversal des
  // photos de la version). null → bouton masqué (ex. projet sans outil).
  onOpenPhotos = null,
  onExportGlobal,
  onExportByLoueur,
  onExportChecklist,
  onPreviewBilan,
  onCloseEssais,
  onReopenEssais,
  // MAT-13C — Rendu (loueur / retour de matériel). Parallèle à essais :
  // mode chantier authed dédié, lien tokenisé dédié (phase='rendu'), PDF
  // "bon de retour" synthétique, clôture, ré-ouverture.
  onOpenChantierModeRendu,
  onOpenShareRendu,
  onPreviewBonRetour,
  onCloseRendu,
  onReopenRendu,
  canEdit = true,
}) {
  const closedAt = activeVersion?.closed_at || null
  const closedByName = activeVersion?.closed_by_name || null
  const renduClosedAt = activeVersion?.rendu_closed_at || null
  const renduClosedByName = activeVersion?.rendu_closed_by_name || null
  const done =
    (checklistProgress?.pre?.done || 0) +
    (checklistProgress?.post?.done || 0) +
    (checklistProgress?.prod?.done || 0)
  const total =
    (checklistProgress?.pre?.total || 0) +
    (checklistProgress?.post?.total || 0) +
    (checklistProgress?.prod?.total || 0)

  // Responsive : sur mobile, les actions secondaires (Dupliquer, Nouvelle
  // version, Détails, Export, Photos) basculent dans un menu "Plus" (bottom
  // sheet via ActionSheet). Les actions primaires visibles en permanence :
  // VersionSwitcher, dropdowns Essais/Rendu, Récap loueurs.
  const bp = useBreakpoint()
  const isMobile = bp.isMobile

  // Construction de la liste d'actions du menu "Plus" sur mobile. Les items
  // sont filtrés dynamiquement par canEdit / présence de handler.
  const moreActions = []
  if (canEdit && activeVersion && onDuplicateVersion) {
    moreActions.push({
      id: 'duplicate',
      icon: Copy,
      label: 'Dupliquer la version',
      onClick: onDuplicateVersion,
    })
  }
  if (canEdit && onCreateVersion) {
    moreActions.push({
      id: 'create',
      icon: Plus,
      label: 'Nouvelle version',
      onClick: onCreateVersion,
    })
  }
  if (moreActions.length > 0) {
    moreActions.push({ id: 'sep-version', type: 'separator' })
  }
  if (onToggleDetailed) {
    moreActions.push({
      id: 'toggle-detailed',
      icon: detailed ? EyeOff : Eye,
      label: detailed ? 'Masquer les détails' : 'Afficher les détails',
      onClick: () => onToggleDetailed?.(!detailed),
    })
  }
  if (activeVersion && onExportGlobal) {
    moreActions.push({
      id: 'export-global',
      icon: FileText,
      label: 'Exporter PDF (global)',
      onClick: onExportGlobal,
    })
  }
  if (activeVersion && onExportByLoueur) {
    moreActions.push({
      id: 'export-loueur',
      icon: FileText,
      label: 'Exporter PDF (par loueur)',
      onClick: onExportByLoueur,
    })
  }
  if (activeVersion && onExportChecklist) {
    moreActions.push({
      id: 'export-checklist',
      icon: FileText,
      label: 'Exporter checklist (PDF)',
      onClick: onExportChecklist,
    })
  }
  if (onOpenPhotos && activeVersion) {
    moreActions.push({ id: 'sep-photos', type: 'separator' })
    moreActions.push({
      id: 'photos',
      icon: Camera,
      label: 'Photos',
      variant: 'primary',
      onClick: onOpenPhotos,
    })
  }

  return (
    <div
      className="flex flex-col gap-3 px-5 py-4"
      style={{ borderBottom: '1px solid var(--brd-sub)' }}
    >
      {/* Ligne 1 : titre + compteurs + flags */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Package className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Matériel
          </h1>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {totalItems} {totalItems > 1 ? 'éléments' : 'élément'} · checklist{' '}
            {done}/{total}
          </p>
        </div>

        {/* Flags */}
        <div className="flex items-center gap-2 flex-wrap ml-0 sm:ml-4">
          <FlagPill flag="ok" count={flagCounts?.ok || 0} />
          <FlagPill flag="attention" count={flagCounts?.attention || 0} />
          <FlagPill flag="probleme" count={flagCounts?.probleme || 0} />
        </div>
      </div>

      {/* Ligne 2 : version + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <VersionSwitcher
          versions={versions}
          activeVersion={activeVersion}
          onSelect={onSelectVersion}
          onRestore={onRestoreVersion}
          onRename={onRenameVersion}
          onDelete={onDeleteVersion}
          canEdit={canEdit}
        />

        {canEdit && activeVersion && !isMobile && (
          <button
            type="button"
            onClick={onDuplicateVersion}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-elev)'
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
            title="Dupliquer la version active dans une nouvelle version"
          >
            <Copy className="w-3 h-3" />
            Dupliquer
          </button>
        )}

        {canEdit && !isMobile && (
          <button
            type="button"
            onClick={onCreateVersion}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--blue-bg)'
              e.currentTarget.style.color = 'var(--blue)'
              e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-elev)'
              e.currentTarget.style.color = 'var(--txt-2)'
              e.currentTarget.style.borderColor = 'var(--brd)'
            }}
            title="Créer une nouvelle version vide"
          >
            <Plus className="w-3 h-3" />
            Nouvelle version
          </button>
        )}

        {/* Actions à droite */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {!isMobile && (
            <button
              type="button"
              onClick={() => onToggleDetailed?.(!detailed)}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
              style={{
                background: detailed ? 'var(--blue-bg)' : 'var(--bg-elev)',
                color: detailed ? 'var(--blue)' : 'var(--txt-2)',
                border: `1px solid ${detailed ? 'var(--blue)' : 'var(--brd)'}`,
              }}
              title={detailed ? 'Masquer les détails (checklist + remarques)' : 'Afficher les détails (checklist + remarques)'}
            >
              {detailed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              Détails
            </button>
          )}

          {!isMobile && (
            <ExportPdfMenu
              onExportGlobal={onExportGlobal}
              onExportByLoueur={onExportByLoueur}
              onExportChecklist={onExportChecklist}
              disabled={!activeVersion}
            />
          )}

          {/* MAT-22 : Dropdown "Essais" unifié — Checklist + Partager +
              Aperçu bilan + Clôturer (avec séparateur entre les groupes).
              On l'affiche pour toute version active : les items d'édition
              (Partager, Clôturer) sont filtrés à l'intérieur via `canEdit`,
              l'aperçu bilan reste ouvert à tous (lecture). Le badge Clôturé
              et le bouton Ré-ouvrir restent hors dropdown — ils communiquent
              un état de la version, pas une action ponctuelle. */}
          {activeVersion && (
            <EssaisDropdown
              onOpenChantierMode={onOpenChantierMode}
              onOpenShare={onOpenShare}
              onPreviewBilan={onPreviewBilan}
              onCloseEssais={onCloseEssais}
              canEdit={canEdit}
              closedAt={closedAt}
            />
          )}

          {activeVersion && closedAt && (
            <ClotureBadge
              closedAt={closedAt}
              closedByName={closedByName}
              canEdit={canEdit}
              onReopen={onReopenEssais}
            />
          )}

          {/* MAT-13C : Dropdown "Rendu" — parallèle au dropdown "Essais".
              Point d'entrée unique pour les workflows de la phase rendu
              (loueur / retour matériel) : mode chantier authed, lien
              tokenisé dédié, bon de retour PDF, clôture.
              Gate "essais non clos" : si la version n'est pas clôturée côté
              essais, les items sont disabled + tooltip explicatif. C'est
              une UX non bloquante (aucun verrou SQL), on laisse juste
              l'utilisateur comprendre l'ordre naturel du flow. */}
          {activeVersion && (
            <RenduDropdown
              onOpenChantierMode={onOpenChantierModeRendu}
              onOpenShare={onOpenShareRendu}
              onPreviewBonRetour={onPreviewBonRetour}
              onCloseRendu={onCloseRendu}
              canEdit={canEdit}
              essaisClosedAt={closedAt}
              renduClosedAt={renduClosedAt}
            />
          )}

          {activeVersion && renduClosedAt && (
            <ClotureRenduBadge
              closedAt={renduClosedAt}
              closedByName={renduClosedByName}
              canEdit={canEdit}
              onReopen={onReopenRendu}
            />
          )}

          {/* MAT-11D : bouton "Photos" — ouvre le panneau transversal d'audit
              des photos de la version. Même zone d'affordance que "Récap
              loueurs" (deux vues latérales exploratoires). Style "outline"
              pour ne pas voler la vedette au CTA principal Récap qui reste
              solide. Sur mobile, l'action est poussée dans le menu "Plus". */}
          {onOpenPhotos && activeVersion && !isMobile && (
            <button
              type="button"
              onClick={onOpenPhotos}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-all"
              style={{
                background: 'transparent',
                color: 'var(--blue)',
                border: '1px solid var(--blue)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--blue-bg)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              title="Voir toutes les photos de la version"
            >
              <Camera className="w-3 h-3" />
              Photos
            </button>
          )}

          <button
            type="button"
            onClick={onOpenRecap}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--blue)',
              color: 'white',
              border: '1px solid var(--blue)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            title="Voir le récap par loueur"
          >
            <Users className="w-3 h-3" />
            Récap loueurs
          </button>

          {/* Menu "Plus" — mobile uniquement. Consolide les actions
              secondaires (Dupliquer, Nouvelle version, Détails, Exports,
              Photos) en un seul ⋯ trigger qui ouvre une bottom sheet. */}
          {isMobile && moreActions.length > 0 && (
            <ActionSheet
              title="Autres actions"
              align="right"
              trigger={({ ref, toggle, open }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  aria-label="Autres actions"
                  aria-expanded={open}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
                  style={{
                    background: open ? 'var(--bg-hov)' : 'var(--bg-elev)',
                    color: 'var(--txt-2)',
                    border: '1px solid var(--brd)',
                  }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                  Plus
                </button>
              )}
              actions={moreActions}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Dropdown "Essais" — point d'entrée unique pour tous les workflows de la
 * phase essais (MAT-22 consolide ici ce qui était éparpillé en plusieurs
 * boutons autonomes) :
 *
 *   GROUPE 1 — workflows terrain :
 *     - Checklist : ouvre le mode chantier authenticated (MAT-14), identité
 *       = user connecté, route `/projets/:id/materiel/check/:versionId`.
 *     - Partager : ouvre ShareChecklistModal pour générer un lien tokenisé
 *       destiné à un loueur / prestataire externe.
 *
 *   GROUPE 2 — bilan / clôture :
 *     - Exporter bilan : ouvre la BilanExportModal (choix global / ZIP /
 *       loueur unique avec preview avant téléchargement). Accessible même
 *       en read-only (lecture seule).
 *     - Clôturer essais : pose la version en lecture seule et archive le
 *       bilan PDF/ZIP dans les documents. Visible uniquement si `canEdit`
 *       ET si la version n'est pas déjà clôturée. Quand elle l'est, c'est
 *       le `ClotureBadge` (hors dropdown) qui prend le relais + propose la
 *       ré-ouverture.
 *
 * Fermeture : click outside + touche Échap (pattern standard). On évite un
 * portal/popper pour rester simple — le dropdown tient en position absolue
 * sous le bouton. Un séparateur visuel sépare les deux groupes.
 */
function EssaisDropdown({
  onOpenChantierMode,
  onOpenShare,
  onPreviewBilan,
  onCloseEssais,
  canEdit = true,
  closedAt = null,
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handleClick(e) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Le bouton Clôturer n'est pas pertinent si la version est déjà clôturée
  // (le ClotureBadge + Ré-ouvrir couvrent ce cas hors dropdown).
  const showCloseItem = Boolean(canEdit && onCloseEssais && !closedAt)
  const showShareItem = Boolean(canEdit && onOpenShare)
  // Le groupe "bilan" contient au minimum l'export bilan. La clôture est
  // ajoutée dessous si elle est pertinente.
  const showBilanGroup = Boolean(onPreviewBilan || showCloseItem)
  // Le séparateur n'a de sens que si on a du contenu dans les deux groupes.
  const showSeparator = Boolean(onOpenChantierMode || showShareItem) && showBilanGroup

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
        style={{
          background: open ? 'var(--blue-bg)' : 'var(--bg-elev)',
          color: open ? 'var(--blue)' : 'var(--txt-2)',
          border: `1px solid ${open ? 'var(--blue)' : 'var(--brd)'}`,
        }}
        onMouseEnter={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--blue-bg)'
          e.currentTarget.style.color = 'var(--blue)'
          e.currentTarget.style.borderColor = 'var(--blue)'
        }}
        onMouseLeave={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--bg-elev)'
          e.currentTarget.style.color = 'var(--txt-2)'
          e.currentTarget.style.borderColor = 'var(--brd)'
        }}
        title="Essais terrain, export bilan et clôture"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ClipboardCheck className="w-3 h-3" />
        Essais
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-40 rounded-lg overflow-hidden"
          style={{
            // Sur mobile, on clampe la largeur au viewport pour éviter un
            // débord horizontal (minWidth 240px + bouton près du bord gauche
            // = dropdown qui sort à droite). Sur desktop, minWidth s'applique.
            minWidth: 'min(240px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.25)',
          }}
        >
          {/* Groupe 1 : workflows terrain */}
          {onOpenChantierMode && (
            <EssaisDropdownItem
              icon={ClipboardCheck}
              label="Checklist"
              description="Ouvrir le mode chantier (ton compte)"
              onClick={() => {
                setOpen(false)
                onOpenChantierMode?.()
              }}
            />
          )}
          {showShareItem && (
            <EssaisDropdownItem
              icon={Share2}
              label="Partager"
              description="Générer un lien pour le loueur / l'équipe"
              onClick={() => {
                setOpen(false)
                onOpenShare?.()
              }}
            />
          )}

          {showSeparator && (
            <div
              className="my-1 mx-2"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            />
          )}

          {/* Groupe 2 : bilan / clôture */}
          {onPreviewBilan && (
            <EssaisDropdownItem
              icon={FileSearch}
              label="Exporter bilan"
              description="Global, ZIP ou loueur unique — avec preview"
              onClick={() => {
                setOpen(false)
                onPreviewBilan?.()
              }}
            />
          )}
          {showCloseItem && (
            <EssaisDropdownItem
              icon={Lock}
              label="Clôturer les essais"
              description="Archiver le bilan et figer la version"
              onClick={() => {
                setOpen(false)
                onCloseEssais?.()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function EssaisDropdownItem({ icon: Icon, label, description, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
      style={{
        background: 'transparent',
        color: 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-2)'
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue)' }} />
      <span className="flex flex-col min-w-0">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {description}
        </span>
      </span>
    </button>
  )
}

/**
 * Dropdown "Rendu" — point d'entrée unique pour tous les workflows de la
 * phase rendu (retour loueur), miroir du dropdown "Essais" (MAT-13C) :
 *
 *   GROUPE 1 — workflows terrain :
 *     - Checklist rendu : ouvre le mode chantier authed en phase rendu
 *       (route `/projets/:id/materiel/rendu/:versionId`).
 *     - Partager : génère un lien tokenisé phase='rendu' pour le loueur
 *       (même ShareChecklistModal, sélecteur phase).
 *
 *   GROUPE 2 — bilan / clôture :
 *     - Aperçu bon de retour : preview du PDF synthétique MAT-13E.
 *     - Clôturer le rendu : fige la version côté rendu + archive PDF.
 *
 * Gate "essais non clos" : si la version n'a pas été clôturée côté essais
 * (`!essaisClosedAt`), les items sont visuellement disabled avec un tooltip
 * explicite. C'est une UX non bloquante (aucun verrou SQL côté MAT-13A), on
 * guide juste l'utilisateur dans l'ordre naturel du workflow. L'admin peut
 * toujours forcer via le badge Clôturé (pas relevant ici) — ici on veut
 * juste éviter les ouvertures de rendu "par erreur".
 */
function RenduDropdown({
  onOpenChantierMode,
  onOpenShare,
  onPreviewBonRetour,
  onCloseRendu,
  canEdit = true,
  essaisClosedAt = null,
  renduClosedAt = null,
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handleClick(e) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const essaisGate = !essaisClosedAt
  const gateTitle = essaisGate
    ? 'Clôturez d\'abord les essais avant de démarrer le rendu.'
    : null

  // showCloseItem : canEdit + rendu pas encore clôturé + handler dispo
  const showCloseItem = Boolean(canEdit && onCloseRendu && !renduClosedAt)
  const showShareItem = Boolean(canEdit && onOpenShare)
  const showBilanGroup = Boolean(onPreviewBonRetour || showCloseItem)
  const showSeparator =
    Boolean(onOpenChantierMode || showShareItem) && showBilanGroup

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
        style={{
          background: open ? 'var(--orange-bg, #fff4e5)' : 'var(--bg-elev)',
          color: open ? 'var(--orange, #b45309)' : 'var(--txt-2)',
          border: `1px solid ${open ? 'var(--orange, #b45309)' : 'var(--brd)'}`,
        }}
        onMouseEnter={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--orange-bg, #fff4e5)'
          e.currentTarget.style.color = 'var(--orange, #b45309)'
          e.currentTarget.style.borderColor = 'var(--orange, #b45309)'
        }}
        onMouseLeave={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--bg-elev)'
          e.currentTarget.style.color = 'var(--txt-2)'
          e.currentTarget.style.borderColor = 'var(--brd)'
        }}
        title="Retour loueur, bon de retour et clôture"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Truck className="w-3 h-3" />
        Rendu
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-40 rounded-lg overflow-hidden"
          style={{
            // Cf. EssaisDropdown : clamp viewport sur mobile pour éviter un
            // débord horizontal quand le bouton est près du bord de l'écran.
            minWidth: 'min(260px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.25)',
          }}
        >
          {/* Bandeau "essais non clos" — informatif, non bloquant */}
          {essaisGate && (
            <div
              className="flex items-start gap-2 px-3 py-2 text-[11px] leading-tight"
              style={{
                background: 'var(--orange-bg, #fff4e5)',
                color: 'var(--orange, #b45309)',
                borderBottom: '1px solid var(--brd-sub)',
              }}
            >
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                Les essais ne sont pas clôturés. Tu peux ouvrir le rendu quand
                même, mais l&apos;ordre naturel est&nbsp;: <strong>essais → rendu</strong>.
              </span>
            </div>
          )}

          {/* Groupe 1 : workflows terrain */}
          {onOpenChantierMode && (
            <RenduDropdownItem
              icon={PackageCheck}
              label="Checklist rendu"
              description="Ouvrir le mode chantier rendu (ton compte)"
              onClick={() => {
                setOpen(false)
                onOpenChantierMode?.()
              }}
              dimmed={essaisGate}
              dimmedTitle={gateTitle}
            />
          )}
          {showShareItem && (
            <RenduDropdownItem
              icon={Share2}
              label="Partager"
              description="Générer un lien rendu pour le loueur"
              onClick={() => {
                setOpen(false)
                onOpenShare?.()
              }}
              dimmed={essaisGate}
              dimmedTitle={gateTitle}
            />
          )}

          {showSeparator && (
            <div
              className="my-1 mx-2"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            />
          )}

          {/* Groupe 2 : bilan / clôture */}
          {onPreviewBonRetour && (
            <RenduDropdownItem
              icon={FileSearch}
              label="Aperçu bon de retour"
              description="PDF synthétique des items retournés"
              onClick={() => {
                setOpen(false)
                onPreviewBonRetour?.()
              }}
              dimmed={essaisGate}
              dimmedTitle={gateTitle}
            />
          )}
          {showCloseItem && (
            <RenduDropdownItem
              icon={Lock}
              label="Clôturer le rendu"
              description="Archiver le bon de retour et figer la phase rendu"
              onClick={() => {
                setOpen(false)
                onCloseRendu?.()
              }}
              dimmed={essaisGate}
              dimmedTitle={gateTitle}
            />
          )}
        </div>
      )}
    </div>
  )
}

function RenduDropdownItem({
  icon: Icon,
  label,
  description,
  onClick,
  dimmed = false,
  dimmedTitle = null,
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
      style={{
        background: 'transparent',
        color: dimmed ? 'var(--txt-3)' : 'var(--txt-2)',
        opacity: dimmed ? 0.75 : 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        if (!dimmed) e.currentTarget.style.color = 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = dimmed ? 'var(--txt-3)' : 'var(--txt-2)'
      }}
      title={dimmed && dimmedTitle ? dimmedTitle : undefined}
    >
      <Icon
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: 'var(--orange, #b45309)' }}
      />
      <span className="flex flex-col min-w-0">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {description}
        </span>
      </span>
    </button>
  )
}

/**
 * Badge "Rendu clôturé le DD/MM/YYYY par X" — équivalent de `ClotureBadge`
 * mais pour la phase rendu. Affiché dès que `activeVersion.rendu_closed_at`
 * est posé. Expose un bouton Ré-ouvrir pour les admins.
 */
function ClotureRenduBadge({ closedAt, closedByName, canEdit, onReopen }) {
  const dateLabel = (() => {
    try {
      const d = new Date(closedAt)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return '—'
    }
  })()

  const title = closedByName
    ? `Rendu clôturé le ${dateLabel} par ${closedByName}`
    : `Rendu clôturé le ${dateLabel}`

  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
      style={{
        background: 'var(--orange-bg, #fff4e5)',
        color: 'var(--orange, #b45309)',
        border: '1px solid var(--orange, #b45309)',
      }}
      title={title}
    >
      <PackageCheck className="w-3 h-3" />
      <span className="truncate max-w-[10rem]">
        Rendu clôturé {dateLabel}
        {closedByName ? ` · ${closedByName}` : ''}
      </span>
      {canEdit && onReopen && (
        <button
          type="button"
          onClick={onReopen}
          className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-all ml-1"
          style={{
            background: 'transparent',
            color: 'var(--orange, #b45309)',
            border: '1px solid var(--orange, #b45309)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--orange, #b45309)'
            e.currentTarget.style.color = 'white'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--orange, #b45309)'
          }}
          title="Ré-ouvrir le rendu (efface rendu_closed_at, garde l'archive du bon de retour)"
        >
          <LockOpen className="w-3 h-3" />
          Ré-ouvrir
        </button>
      )}
    </div>
  )
}

function FlagPill({ flag, count }) {
  const def = MATOS_FLAGS[flag]
  const Icon =
    flag === 'ok' ? CheckCircle2 : flag === 'attention' ? Circle : AlertTriangle
  return (
    <span
      className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
      style={{ background: def.bg, color: def.color }}
    >
      <Icon className="w-3 h-3" />
      {count}
    </span>
  )
}

/**
 * Badge "Clôturé le DD/MM/YYYY par X" affiché sur l'en-tête quand
 * `activeVersion.closed_at` est posé. Pour les admins, expose un bouton
 * "Ré-ouvrir" (pertinent si on a oublié un item ou qu'on veut re-générer
 * un bilan après corrections).
 */
function ClotureBadge({ closedAt, closedByName, canEdit, onReopen }) {
  const dateLabel = (() => {
    try {
      const d = new Date(closedAt)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return '—'
    }
  })()

  const title = closedByName
    ? `Essais clôturés le ${dateLabel} par ${closedByName}`
    : `Essais clôturés le ${dateLabel}`

  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
        border: '1px solid var(--blue)',
      }}
      title={title}
    >
      <CheckCircle2 className="w-3 h-3" />
      <span className="truncate max-w-[10rem]">
        Clôturé {dateLabel}
        {closedByName ? ` · ${closedByName}` : ''}
      </span>
      {canEdit && onReopen && (
        <button
          type="button"
          onClick={onReopen}
          className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-all ml-1"
          style={{
            background: 'transparent',
            color: 'var(--blue)',
            border: '1px solid var(--blue)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--blue)'
            e.currentTarget.style.color = 'white'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          title="Ré-ouvrir la version (efface closed_at, garde l'archive bilan)"
        >
          <LockOpen className="w-3 h-3" />
          Ré-ouvrir
        </button>
      )}
    </div>
  )
}
