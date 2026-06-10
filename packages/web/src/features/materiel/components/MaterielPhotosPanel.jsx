// ════════════════════════════════════════════════════════════════════════════
// MaterielPhotosPanel — slide-over admin pour parcourir les photos d'une version
// ════════════════════════════════════════════════════════════════════════════
//
// MAT-11D — Vision transversale des photos d'une version matériel depuis
// l'onglet Matériel (admin). Complémentaire au mode chantier plein écran
// (`/projets/:id/materiel/check/:versionId`) qui reste le canal principal
// d'édition terrain :
//
//   - Mode chantier : contextuel, un item/bloc à la fois, utilisé "en essai"
//   - Ce panneau    : global, toutes les photos d'un coup, utilisé "en audit"
//                     (ex. avant clôture pour vérifier les preuves problèmes)
//
// Structure :
//
//   ┌───────────────────────────────────────────────┐
//   │ 📷 Photos                                  ✕  │ ← header
//   │    V2 — Tournage nov. · 12 photos · 8 prb / 4 │
//   │───────────────────────────────────────────────│
//   │  [Tous (12)]  [Problèmes (8)]  [Pack (4)]     │ ← filtres kind
//   │───────────────────────────────────────────────│
//   │  ┌─ BLOC 1 — CAM LIVE 1 ──────────────────┐  │
//   │  │ Photos pack (3)                         │  │ ← CheckPhotosSection
//   │  │ ◼ ◼ ◼                                   │  │    anchor=block, kind=pack
//   │  │ ─── Corps caméra ──────────────────────│  │
//   │  │   Photos problème (2)                   │  │ ← CheckPhotosSection
//   │  │   ◼ ◼                                   │  │    anchor=item, kind=probleme
//   │  │ ─── Optique ───────────────────────────│  │
//   │  │   Photos problème (1)                   │  │
//   │  │   ◼                                     │  │
//   │  └─────────────────────────────────────────┘  │
//   │                                               │
//   │  (blocs sans photo masqués)                   │
//   └───────────────────────────────────────────────┘
//
// Implémentation :
//   - useCheckAuthedSession(versionId) : réutilise le même bundle que le mode
//     chantier. Gratuit : déjà câblé aux RPC authed (gate can_edit_outil),
//     fournit les optimistic updates sur upload/delete/caption, pipeline image
//     HEIC→JPEG + compression inclus. Pas de refetch global — le hook ne tire
//     qu'une fois à l'ouverture (mount conditionnel via `open`).
//
//   - CheckPhotosSection réutilisé en brique atomique. Chaque groupe "pack de
//     bloc" + chaque "problème d'item" est une instance distincte avec son
//     propre anchor. Upload/delete/caption branchés sur les actions du hook.
//
//   - Filtre kind : simple boolean gating au rendu (pas de re-query). Les
//     compteurs dans le header reflètent le filtre actif pour que l'admin
//     visualise son scope courant.
//
// Props :
//   - open : boolean — contrôle backdrop + aside + fetch
//   - onClose : () => void — backdrop click / ✕ / Échap
//   - versionId : string (UUID) — id de la version à explorer
//   - activeVersionLabel : string — "V2 — Tournage nov." (header sous-titre)
//   - canEdit : boolean — active upload / delete / caption (isAdmin côté
//               CheckPhotosSection). Si false : lecture seule + download.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, Package, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useCheckAuthedSession } from '../../../hooks/useCheckAuthedSession'
import CheckPhotosSection from './check/CheckPhotosSection'

export default function MaterielPhotosPanel({
  open,
  onClose,
  versionId,
  activeVersionLabel = '',
  canEdit = false,
}) {
  const { user, profile } = useAuth()
  // Utilisé pour l'affichage "uploaded by" côté CheckPhotosSection. Côté RPC
  // authed, l'identité est dérivée de auth.uid() — on ne l'envoie pas.
  const userName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.email ||
    'Admin'

  // Lazy fetch : on ne trigger le hook que quand le panel est ouvert. Ferme
  // → versionId=null → le hook reset (voir useCheckAuthedSession early-return).
  // Re-ouvre → re-fetch frais (comportement désiré en contexte admin : on veut
  // une vue à jour, pas un cache coincé dans le temps).
  const effectiveVersionId = open ? versionId : null
  const {
    loading,
    error,
    blocks,
    items,
    photos,
    photosByItem,
    photosByBlock,
    actions,
  } = useCheckAuthedSession(effectiveVersionId, { userName })

  const [filter, setFilter] = useState('all') // 'all' | 'probleme' | 'pack'

  // Escape pour fermer — pattern identique à LoueurRecapPanel.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Compteurs globaux pour le header (non filtrés — le filtre change le
  // rendu, pas les totaux). On itère photos brut pour éviter les maps qui
  // incluent items/blocks vides.
  const counts = useMemo(() => {
    let probleme = 0
    let pack = 0
    for (const p of photos) {
      if (p.kind === 'probleme') probleme++
      else if (p.kind === 'pack') pack++
    }
    return { probleme, pack, total: probleme + pack }
  }, [photos])

  // Grouping pré-calculé : pour chaque block, on récupère ses photos pack +
  // la liste des items qui ont au moins une photo problème. On garde l'ordre
  // naturel des blocs (sort_order vient du bundle RPC). Les blocs sans photo
  // sont masqués pour garder le panneau compact.
  const groups = useMemo(() => {
    if (!blocks.length) return []
    const itemsByBlockId = new Map()
    for (const it of items) {
      if (!itemsByBlockId.has(it.block_id)) itemsByBlockId.set(it.block_id, [])
      itemsByBlockId.get(it.block_id).push(it)
    }
    const result = []
    for (const b of blocks) {
      const blockPhotos = photosByBlock.get(b.id) || []
      const pack = blockPhotos.filter((p) => p.kind === 'pack')
      const blockItems = itemsByBlockId.get(b.id) || []
      const itemsWithPhotos = []
      for (const it of blockItems) {
        const ip = photosByItem.get(it.id) || []
        const probleme = ip.filter((p) => p.kind === 'probleme')
        if (probleme.length > 0) itemsWithPhotos.push({ item: it, probleme })
      }
      if (pack.length === 0 && itemsWithPhotos.length === 0) continue
      result.push({ block: b, pack, items: itemsWithPhotos })
    }
    return result
  }, [blocks, items, photosByBlock, photosByItem])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over */}
      <aside
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(560px, 100vw)',
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--brd)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.2)',
        }}
        role="dialog"
        aria-label="Photos de la version matériel"
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Camera className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Photos
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {activeVersionLabel && <span>{activeVersionLabel} · </span>}
              {counts.total} {counts.total > 1 ? 'photos' : 'photo'}
              {counts.total > 0 && (
                <>
                  {' · '}
                  {counts.probleme} problème{counts.probleme > 1 ? 's' : ''}
                  {' · '}
                  {counts.pack} pack
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors"
            style={{ color: 'var(--txt-3)', background: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            aria-label="Fermer le panneau Photos"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Filtres kind — pilule simple, compteur live dans le label */}
        <div
          className="flex items-center gap-2 px-5 py-2.5 flex-wrap"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`Tous (${counts.total})`}
          />
          <FilterChip
            active={filter === 'probleme'}
            onClick={() => setFilter('probleme')}
            label={`Problèmes (${counts.probleme})`}
            icon={AlertTriangle}
            color="var(--orange)"
          />
          <FilterChip
            active={filter === 'pack'}
            onClick={() => setFilter('pack')}
            label={`Pack (${counts.pack})`}
            icon={Package}
            color="var(--blue)"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} />
          ) : groups.length === 0 ? (
            <EmptyState canEdit={canEdit} />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {groups.map((g) => (
                <BlockGroup
                  key={g.block.id}
                  block={g.block}
                  pack={g.pack}
                  items={g.items}
                  filter={filter}
                  canEdit={canEdit}
                  userName={userName}
                  actions={actions}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/* ═══ Filter chip ═══════════════════════════════════════════════════════════ */

function FilterChip({ active, onClick, label, icon: Icon, color = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
      style={{
        color: active ? color || 'var(--txt)' : 'var(--txt-3)',
        background: active ? 'var(--bg-hov)' : 'transparent',
        border: `1px solid ${active ? 'var(--brd)' : 'var(--brd-sub)'}`,
      }}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </button>
  )
}

/* ═══ Block group ═══════════════════════════════════════════════════════════ */

/**
 * Rend un bloc avec ses photos pack + ses items ayant au moins une photo
 * problème. Masque silencieusement les sections qui ne passent pas le filtre
 * kind actif — si rien ne reste, le groupe entier est masqué (return null).
 */
function BlockGroup({ block, pack, items, filter, canEdit, userName, actions }) {
  const showPack = (filter === 'all' || filter === 'pack') && pack.length > 0
  const showProbleme =
    (filter === 'all' || filter === 'probleme') && items.length > 0
  if (!showPack && !showProbleme) return null

  // Handlers callables uniquement si canEdit. Side effect du pattern "prop
  // null = cache les affordances" dans CheckPhotosSection (uploader masqué si
  // onUpload=null, pas de bouton delete si onDelete=null).
  const onUpload = canEdit ? actions.uploadPhoto : null
  const onDelete = canEdit ? actions.deletePhoto : null
  const onUpdateCaption = canEdit ? actions.updatePhotoCaption : null

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      <header
        className="px-4 py-2.5"
        style={{
          background: block.couleur ? `${block.couleur}14` : 'transparent',
          borderBottom: '1px solid var(--brd-sub)',
        }}
      >
        <h3
          className="text-xs font-semibold uppercase tracking-wide truncate"
          style={{ color: 'var(--txt)' }}
        >
          {block.titre || 'Bloc'}
        </h3>
      </header>

      {showPack && (
        <CheckPhotosSection
          photos={pack}
          kind="pack"
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={canEdit}
          onUpload={onUpload}
          onDelete={onDelete}
          onUpdateCaption={onUpdateCaption}
        />
      )}

      {showProbleme &&
        items.map(({ item, probleme }) => (
          <div
            key={item.id}
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <div
              className="px-4 pt-3 pb-0.5 text-xs font-medium truncate"
              style={{ color: 'var(--txt-2)' }}
              title={item.designation || item.label || ''}
            >
              {item.designation || item.label || '(sans nom)'}
            </div>
            <CheckPhotosSection
              photos={probleme}
              kind="probleme"
              anchor={{ itemId: item.id }}
              userName={userName}
              isAdmin={canEdit}
              onUpload={onUpload}
              onDelete={onDelete}
              onUpdateCaption={onUpdateCaption}
            />
          </div>
        ))}
    </section>
  )
}

/* ═══ States (loading / error / empty) ═════════════════════════════════════ */

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-10">
      <div
        className="w-5 h-5 border-2 rounded-full animate-spin"
        style={{
          borderColor: 'var(--blue)',
          borderTopColor: 'transparent',
        }}
        aria-label="Chargement des photos"
      />
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || error?.details || 'Erreur inconnue'
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: 'var(--orange-bg)' }}
      >
        <AlertTriangle className="w-5 h-5" style={{ color: 'var(--orange)' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
        Chargement impossible
      </p>
      <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
        {msg}
      </p>
    </div>
  )
}

function EmptyState({ canEdit }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: 'var(--blue-bg)' }}
      >
        <Camera className="w-5 h-5" style={{ color: 'var(--blue)' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
        Aucune photo sur cette version
      </p>
      <p className="text-xs max-w-xs" style={{ color: 'var(--txt-3)' }}>
        {canEdit
          ? 'Les photos prises pendant les essais (problèmes constatés, contenu des packs) apparaîtront ici.'
          : "Les photos apparaîtront ici dès que l'équipe en ajoute depuis le mode chantier."}
      </p>
    </div>
  )
}
