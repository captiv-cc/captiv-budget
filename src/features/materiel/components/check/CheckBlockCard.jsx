/**
 * CheckBlockCard — carte d'un bloc de matériel dans la checklist terrain
 * (MAT-10E + MAT-10F + MAT-23E).
 *
 * Rend un header coloré (titre + progression + ⋯ menu bloc) + une preview
 * horizontale des photos pack (view-only) + la liste des items cliquables
 * + une section "Additifs" pour les items added_during_check + un formulaire
 * d'ajout inline en bas.
 *
 * Quand tous les items (base + additifs) sont checkés, un bandeau vert est
 * ajouté en haut pour signaler visuellement "bloc validé".
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ✓ BLOC VALIDÉ                             │  ← bandeau si allChecked
 *   │───────────────────────────────────────────│
 *   │ CAM LIVE 1              7/10 validés  ⋯  │  ← header + menu
 *   │───────────────────────────────────────────│
 *   │  [📷 pack preview, hideUploader=true]    │  ← MAT-23E : view-only
 *   │───────────────────────────────────────────│
 *   │  (section dépliée : signal / pack / note) │  ← MAT-23E
 *   │───────────────────────────────────────────│
 *   │ ⬜ Corps caméra · ARRI                    │
 *   │ ✅ Optique · ZEISS                        │  ← items de base
 *   │ ...                                       │
 *   │─── Additifs (ajoutés pendant les essais) ─│
 *   │ ⬜ Bras magique · Ajouté par Camille      │
 *   │───────────────────────────────────────────│
 *   │ + Ajouter un additif                      │  ← AddItemForm
 *   └───────────────────────────────────────────┘
 *
 * MAT-23E — pourquoi un menu ⋯ au niveau bloc ?
 *   - Cohérence avec CheckItemRow (MAT-23D) : un seul paradigme "⋯ → section
 *     dépliée" sur TOUTE la checklist, pas deux patterns différents selon
 *     qu'on est sur une ligne ou sur un header de bloc.
 *   - Les photos kind='pack' restent visibles en tête (preview, hideUploader
 *     pour alléger). L'édition se fait via ⋯ → Photos pack (section avec
 *     uploader complet).
 *   - Les blocs peuvent désormais avoir des signalements (photos+comments
 *     kind='probleme') et des notes (comments kind='note'), utiles pour un
 *     message général qui concerne l'ensemble d'un bloc (ex. "valise
 *     abîmée").
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  MessageCircle,
  MoreHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ActionSheet from '../../../../components/ActionSheet'
import CheckItemRow from './CheckItemRow'
import AddItemForm from './AddItemForm'
import CheckPhotosSection from './CheckPhotosSection'

export default function CheckBlockCard({
  block,
  items,
  progress,
  commentsByItem,
  // MAT-23E : commentaires indexés par block_id (kinds 'probleme' + 'note').
  // Séparés localement pour les badges du menu ⋯ et les sections.
  commentsByBlock = null,
  // MAT-10O : index item_id → [loueurs]. Injecté depuis CheckSession pour
  // afficher les pastilles loueurs sur chaque ligne (read-only). Le parent
  // peut passer `null`/`undefined` si aucun tagging n'est activé.
  loueursByItem = null,
  // MAT-19 : liste des loueurs connus de la version, utilisée par AddItemForm
  // pour proposer un loueur à l'additif au moment de l'ajout.
  loueurs = [],
  // MAT-11 : photos par item (pour les lignes) + photos du bloc (pour la
  // section pack en tête). Défauts vides pour rester rétro-compatible.
  photosByItem = null,
  photosByBlock = null,
  userName = null,
  isAdmin = false,
  onToggleItem,
  onAddItem,
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
  // MAT-11 : callbacks photos (upload/delete/caption). Si null, tout le bloc
  // photos (pack + problème) est masqué → ex. mode read-only legacy.
  onUploadPhoto = null,
  onDeletePhoto = null,
  onUpdatePhotoCaption = null,
}) {
  const { total = 0, checked = 0, ratio = 0, allChecked = false } = progress || {}
  const pct = Math.round(ratio * 100)

  // Section dépliée (exclusive) — mêmes clés que CheckItemRow pour garder la
  // mémoire musculaire entre les deux niveaux ligne / bloc.
  const [expandedSection, setExpandedSection] = useState(null)
  //   'signal' | 'pack' | 'notes' | null
  function toggleSection(key) {
    setExpandedSection((prev) => (prev === key ? null : key))
  }

  // Sépare les items de base vs les additifs ajoutés pendant les essais.
  // Les additifs apparaissent dans une section dédiée en bas.
  const baseItems = items.filter((it) => !it.added_during_check)
  const additifItems = items.filter((it) => it.added_during_check)

  // MAT-11 : activation des photos. Une seule flag suffit (onUploadPhoto
  // présent == on est câblé). Les 2 autres callbacks sont implicitement là
  // aussi si l'appelant respecte l'API du hook.
  const photosEnabled = Boolean(onUploadPhoto)

  // Split photos par kind sur l'ancrage bloc. Le hook nous donne toutes les
  // photos block_id-anchored ; depuis MAT-23 les blocs peuvent porter les 2
  // kinds (pack + probleme).
  const blockPhotos = photosEnabled ? (photosByBlock?.get(block.id) || []) : []
  const blockPhotosPack = blockPhotos.filter((p) => p.kind === 'pack')
  const blockPhotosProbleme = blockPhotos.filter((p) => p.kind === 'probleme')

  // Split comments par kind sur l'ancrage bloc.
  const blockComments = commentsByBlock?.get(block.id) || []
  const blockCommentsProbleme = blockComments.filter((c) => c.kind === 'probleme')
  const blockCommentsNote = blockComments.filter((c) => c.kind !== 'probleme')

  const signalCount = blockCommentsProbleme.length + blockPhotosProbleme.length

  // Menu ⋯ du bloc — 3 entrées symétriques à celles d'un item. Pas de
  // "Retirer/Supprimer" au niveau bloc (les blocs sont gérés via MaterielTab).
  const menuActions = [
    {
      id: 'signal',
      icon: AlertTriangle,
      label: 'Signaler',
      variant: signalCount > 0 ? 'warning' : 'default',
      badge: signalCount > 0 ? signalCount : null,
      onClick: () => toggleSection('signal'),
    },
    onUploadPhoto || blockPhotosPack.length > 0
      ? {
          id: 'pack',
          icon: Camera,
          label: 'Photos pack',
          badge: blockPhotosPack.length > 0 ? blockPhotosPack.length : null,
          onClick: () => toggleSection('pack'),
        }
      : null,
    {
      id: 'notes',
      icon: MessageCircle,
      label: 'Commentaires',
      badge: blockCommentsNote.length > 0 ? blockCommentsNote.length : null,
      onClick: () => toggleSection('notes'),
    },
  ].filter(Boolean)

  // Titre du bottom sheet mobile : label court du bloc (l'utilisateur ne voit
  // pas le ⋯ header pendant que la sheet est ouverte).
  const menuTitle = block.titre || 'Bloc'

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${allChecked ? 'var(--green)' : 'var(--brd)'}`,
        transition: 'border-color 180ms',
      }}
    >
      {/* Bandeau "bloc validé" — apparaît seulement quand tout est coché ─── */}
      {allChecked && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--green)',
            color: '#0a2e1a',
          }}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
          Bloc validé
        </div>
      )}

      {/* Header : titre + progression + ⋯ menu ───────────────────────────── */}
      <header
        className="flex items-stretch border-b"
        style={{
          background: block.couleur ? `${block.couleur}14` : 'transparent',
          borderColor: 'var(--brd-sub)',
        }}
      >
        <div className="flex-1 min-w-0 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-sm font-semibold uppercase tracking-wide truncate flex items-center gap-2"
              style={{ color: 'var(--txt)' }}
            >
              <span className="truncate">{block.titre || 'Bloc'}</span>
              {/* Pastille signalement — écho visuel de CheckItemRow (style
                  discret : texte coloré + icône, pas de fond ni bordure). */}
              {signalCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--orange)' }}
                  title={`${signalCount} signalement${signalCount > 1 ? 's' : ''} sur ce bloc`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {signalCount}
                </span>
              )}
              {/* Pastille photos pack — repère discret côté bloc. */}
              {blockPhotosPack.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--blue)' }}
                  title={`${blockPhotosPack.length} photo${blockPhotosPack.length > 1 ? 's' : ''} pack`}
                >
                  <Camera className="w-2.5 h-2.5" />
                  {blockPhotosPack.length}
                </span>
              )}
              {/* Pastille commentaires notes — repère discret côté bloc. */}
              {blockCommentsNote.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--txt-3)' }}
                  title={`${blockCommentsNote.length} commentaire${blockCommentsNote.length > 1 ? 's' : ''}`}
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  {blockCommentsNote.length}
                </span>
              )}
            </h2>
            {block.description && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
                {block.description}
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <span className="text-xs tabular-nums" style={{ color: 'var(--txt-2)' }}>
              {checked}/{total}
            </span>
            <div
              className="h-1.5 w-16 rounded-full overflow-hidden"
              style={{ background: 'var(--bg)' }}
            >
              <div
                className="h-full"
                style={{
                  width: `${pct}%`,
                  background: allChecked ? 'var(--green)' : 'var(--blue)',
                  transition: 'width 220ms ease-out, background 220ms',
                }}
              />
            </div>
          </div>
        </div>

        {/* Menu ⋯ du bloc ──────────────────────────────────────────────── */}
        {menuActions.length > 0 && (
          <ActionSheet
            title={menuTitle}
            actions={menuActions}
            trigger={({ ref, toggle, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className="shrink-0 px-3 flex items-center text-xs"
                style={{
                  color: 'var(--txt-3)',
                  background: open ? 'var(--bg-hov)' : 'transparent',
                  borderLeft: '1px solid var(--brd-sub)',
                }}
                aria-label="Plus d'actions sur ce bloc"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            )}
          />
        )}
      </header>

      {/* MAT-23E : Preview photos pack (view-only, hideUploader=true) ───────
          On affiche la grille des photos pack en tête pour que l'équipe voit
          le contenu de la valise "d'un coup d'œil". L'ajout se fait via
          ⋯ → Photos pack (section éditable dédiée). On masque la preview
          si aucune photo pack : on évite un grand espace vide sur les blocs
          sans pack documenté. */}
      {photosEnabled && blockPhotosPack.length > 0 && (
        <CheckPhotosSection
          photos={blockPhotosPack}
          kind="pack"
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
          compact
          hideUploader
        />
      )}

      {/* Section dépliée — signalements (photos + comments problème) ──── */}
      {expandedSection === 'signal' && (
        <BlockSignalSection
          photos={blockPhotosProbleme}
          comments={blockCommentsProbleme}
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          onAddComment={(body) =>
            onAddComment({ blockId: block.id, kind: 'probleme', body })
          }
          onUploadPhoto={onUploadPhoto}
          onDeletePhoto={onDeletePhoto}
          onUpdatePhotoCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section dépliée — photos pack éditable (uploader visible) ─────── */}
      {expandedSection === 'pack' && (
        <CheckPhotosSection
          photos={blockPhotosPack}
          kind="pack"
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section dépliée — commentaires notes ──────────────────────────── */}
      {expandedSection === 'notes' && (
        <BlockCommentsThread
          comments={blockCommentsNote}
          onSubmit={(body) =>
            onAddComment({ blockId: block.id, kind: 'note', body })
          }
          placeholder="Commentaire sur ce bloc…"
          emptyLabel="Aucun commentaire sur ce bloc. Laisse une note pour l'équipe."
          submitLabel="Envoyer"
        />
      )}

      {/* Items de base ────────────────────────────────────────────────────── */}
      {baseItems.length === 0 && additifItems.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
          Aucun item dans ce bloc.
        </div>
      ) : (
        <div>
          {baseItems.map((it) => (
            <CheckItemRow
              key={it.id}
              item={it}
              comments={commentsByItem?.get(it.id) || []}
              loueurs={loueursByItem?.get(it.id) || []}
              photos={photosByItem?.get(it.id) || []}
              userName={userName}
              isAdmin={isAdmin}
              onToggle={onToggleItem}
              onAddComment={onAddComment}
              onSetRemoved={onSetRemoved}
              onUploadPhoto={onUploadPhoto}
              onDeletePhoto={onDeletePhoto}
              onUpdatePhotoCaption={onUpdatePhotoCaption}
              // onDeleteAdditif volontairement omis : pas de hard-delete sur
              // les items de base (ils doivent rester pour l'audit & le bilan).
            />
          ))}
        </div>
      )}

      {/* Section additifs ─────────────────────────────────────────────────── */}
      {additifItems.length > 0 && (
        <>
          <div
            className="px-4 py-2 text-xs font-medium uppercase tracking-wide border-t border-b"
            style={{
              color: 'var(--purple)',
              background: 'var(--purple-bg)',
              borderColor: 'var(--purple-brd)',
            }}
          >
            Additifs · ajoutés pendant les essais
          </div>
          <div>
            {additifItems.map((it) => (
              <CheckItemRow
                key={it.id}
                item={it}
                comments={commentsByItem?.get(it.id) || []}
                loueurs={loueursByItem?.get(it.id) || []}
                photos={photosByItem?.get(it.id) || []}
                userName={userName}
                isAdmin={isAdmin}
                onToggle={onToggleItem}
                onAddComment={onAddComment}
                onSetRemoved={onSetRemoved}
                onDeleteAdditif={onDeleteAdditif}
                onUploadPhoto={onUploadPhoto}
                onDeletePhoto={onDeletePhoto}
                onUpdatePhotoCaption={onUpdatePhotoCaption}
                showAddedBy
              />
            ))}
          </div>
        </>
      )}

      {/* Formulaire d'ajout d'additif ─────────────────────────────────────── */}
      <AddItemForm blockId={block.id} onAdd={onAddItem} loueurs={loueurs} />
    </section>
  )
}

/* ═══ Block signal section ═══════════════════════════════════════════════ */

/**
 * Jumelle côté bloc de SignalSection (CheckItemRow). Combine photos problème
 * + composer commentaires problème. Pas de dépendance sur CheckItemRow pour
 * garder le composant bloc autonome (sinon cyclique à l'import).
 */
function BlockSignalSection({
  photos,
  comments,
  anchor,
  userName,
  isAdmin,
  onAddComment,
  onUploadPhoto,
  onDeletePhoto,
  onUpdatePhotoCaption,
}) {
  const photosEnabled = Boolean(onUploadPhoto)
  return (
    <div
      className="border-t"
      style={{ borderColor: 'var(--brd-sub)', background: 'var(--bg)' }}
    >
      {photosEnabled && (
        <CheckPhotosSection
          photos={photos}
          kind="probleme"
          anchor={anchor}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
        />
      )}
      <BlockCommentsThread
        comments={comments}
        onSubmit={onAddComment}
        placeholder="Signaler un problème sur ce bloc…"
        emptyLabel={
          photosEnabled
            ? 'Aucun problème signalé. Photos + commentaire visibles dans le bilan loueur.'
            : 'Aucun problème signalé. Les signalements apparaissent dans le bilan loueur.'
        }
        submitLabel="Signaler"
      />
    </div>
  )
}

/* ═══ Block comments thread ═══════════════════════════════════════════════ */

// NB: duplique la logique de CommentsThread dans CheckItemRow. On garde le
// composant local pour éviter un export cyclique (CheckItemRow importe
// déjà CheckBlockCard rien, mais on évite de créer une dépendance inverse).
// Si la forme diverge un jour, on hoistera dans un fichier dédié.
function BlockCommentsThread({
  comments,
  onSubmit,
  placeholder = 'Ajouter un commentaire…',
  emptyLabel = null,
  submitLabel = 'Envoyer',
}) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setBody('')
    } catch (err) {
      console.error('[BlockCommentsThread] submit failed', err)
      const detail = err?.message || err?.details || err?.hint
      toast.error(
        detail
          ? `Commentaire non envoyé — ${detail}`
          : 'Commentaire non envoyé',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="px-4 py-3 space-y-3 border-t"
      style={{
        borderColor: 'var(--brd-sub)',
        background: 'var(--bg)',
      }}
    >
      {comments.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          {emptyLabel || 'Aucun commentaire pour le moment.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium" style={{ color: 'var(--txt)' }}>
                  {c.author_name}
                </span>
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  {formatRelativeTime(c.created_at)}
                </span>
              </div>
              <p
                className="mt-0.5 whitespace-pre-wrap"
                style={{ color: 'var(--txt-2)' }}
              >
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 pt-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="flex-1 px-3 py-2 rounded-md text-sm resize-none"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
        />
        <button
          type="submit"
          disabled={!body.trim() || submitting}
          className="px-3 py-2 rounded-md text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--acc)', color: '#000' }}
        >
          {submitting ? '…' : submitLabel}
        </button>
      </form>
    </div>
  )
}

function formatRelativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000)
  if (diffSec < 30) return 'à l’instant'
  if (diffSec < 3600) {
    const m = Math.round(diffSec / 60)
    return `il y a ${m} min`
  }
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
