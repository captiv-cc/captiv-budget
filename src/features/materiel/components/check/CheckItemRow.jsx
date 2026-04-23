/**
 * CheckItemRow — ligne d'item cliquable dans la checklist terrain
 * (MAT-10E + MAT-10F + MAT-10G + MAT-10I + MAT-10N + MAT-11 + MAT-23D).
 *
 * Tap principal sur la ligne = toggle du pre_check. À droite, UN SEUL bouton
 * ⋯ (kebab) qui ouvre un menu contextuel (ActionSheet) avec 5 actions :
 *
 *   • Signaler          — commentaire kind='probleme' + photos kind='probleme'
 *   • Photos pack       — photos kind='pack' (items ET blocs, MAT-23 : pas
 *                         réservé aux blocs comme historiquement MAT-11)
 *   • Commentaires      — notes internes (kind='note'), PAS dans bilan loueur
 *   • Retirer / Remettre — soft toggle du retrait du tournage (MAT-10N)
 *   • Supprimer additif  — hard delete, uniquement si added_during_check
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ ✅  Corps caméra · RED KOMODO (x1)    ⋯    ✓ Camille │  ligne
 *   │  ┌─────────────────────────────────────────────────┐ │
 *   │  │  (section dépliée selon l'action tapée)         │ │  section
 *   │  └─────────────────────────────────────────────────┘ │
 *   └───────────────────────────────────────────────────────┘
 *
 * Rationale UX (Hugo, session MAT-23) :
 *   - Trop de boutons empilés à droite devenait illisible sur mobile.
 *   - Le kebab unique libère la ligne et permet d'exprimer les badges
 *     (nombre de problèmes / photos / notes) via les entrées du menu.
 *   - Mobile : le menu se déploie en bottom sheet (tap-cible 56px, dos
 *     plus accessible au pouce). Desktop : popover classique.
 *
 * État "retiré" (MAT-10N) :
 *   ┌───────────────────────────────────────────────────────┐
 *   │ 🚫  ~~Cam PLV100~~ — Non pris par Camille        ⋯   │
 *   │     ↳ "remplacée par PLV80"                           │
 *   └───────────────────────────────────────────────────────┘
 *   (ligne grisée, barrée, check désactivé, icône 🚫 à la place de ✓)
 *
 * Undo snackbar (MAT-10I) : après un toggle réussi, toast "Coché par X —
 * Annuler" pendant 5s, re-toggle en cas de clic.
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { confirm, prompt } from '../../../../lib/confirm'
import ActionSheet from '../../../../components/ActionSheet'
import LoueurTagList from './LoueurTagList'
import CheckPhotosSection from './CheckPhotosSection'

export default function CheckItemRow({
  item,
  // Tous les commentaires de l'item (les 2 kinds). Séparation par kind faite
  // localement (commentsNote / commentsProbleme) pour les badges + sections.
  comments = [],
  loueurs = [],
  // Toutes les photos ancrées à cet item (les 2 kinds). MAT-23 : les photos
  // kind='pack' peuvent désormais être sur un item (auparavant réservées aux
  // blocs).
  photos = [],
  // Identité (pour ownership delete/caption photos + composer commentaires
  // en mode token) et flag admin (peut supprimer toute photo / override
  // ownership).
  userName = null,
  isAdmin = false,
  onToggle,
  // Signature MAT-23 : onAddComment({ itemId, kind, body })
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
  // MAT-11 : callbacks photos. Si null, la section photos est masquée et les
  // entrées Signaler / Photos pack du menu deviennent "view-only" (lecture
  // seule de ce qui existe déjà).
  onUploadPhoto = null,
  onDeletePhoto = null,
  onUpdatePhotoCaption = null,
  showAddedBy = false,
}) {
  // Toggle optimiste. Pendant le round-trip RPC on flippe localement — la
  // valeur serveur reprend la main dès que `pending` revient à null.
  const [pending, setPending] = useState(null) // null | 'checking' | 'unchecking'

  // Section dépliée : une seule à la fois (exclusivité pour garder la ligne
  // lisible). Toggle si on re-sélectionne la même entrée du menu.
  const [expandedSection, setExpandedSection] = useState(null) // 'signal' | 'pack' | 'notes' | null

  const serverChecked = Boolean(item.pre_check_at)
  const isRemoved = Boolean(item.removed_at)
  const isAdditif = Boolean(item.added_during_check)
  const displayChecked =
    pending === 'checking' ? true : pending === 'unchecking' ? false : serverChecked
  const authorName = item.pre_check_by_name || null
  const removedBy = item.removed_by_name || null
  const removedReason = item.removed_reason || null

  // Split comments + photos par kind (pour les badges et les sections).
  const commentsProbleme = comments.filter((c) => c.kind === 'probleme')
  const commentsNote = comments.filter((c) => c.kind !== 'probleme') // défaut 'note'
  const photosProbleme = photos.filter((p) => p.kind === 'probleme')
  const photosPack = photos.filter((p) => p.kind === 'pack')

  // Total signalements = photos problème + commentaires problème. Utile pour
  // l'œil : un item avec un signalement sort visuellement du lot (variant
  // 'warning' sur l'entrée "Signaler").
  const signalCount = commentsProbleme.length + photosProbleme.length

  async function handleTap() {
    if (pending || isRemoved) return // pas de toggle sur item retiré
    const wasChecked = serverChecked
    setPending(wasChecked ? 'unchecking' : 'checking')
    try {
      await onToggle(item.id)
      showUndoToast({
        action: wasChecked ? 'uncheck' : 'check',
        itemLabel: item.label || item.designation || 'item',
        onUndo: () => onToggle(item.id).catch(() => {}),
      })
    } catch (err) {
      console.error('[CheckItemRow] toggle failed', err)
      toast.error('Impossible d’enregistrer la coche')
    } finally {
      setPending(null)
    }
  }

  // Toggle / fermeture des sections — chaque action du menu bascule sa
  // section. Re-tap = ferme. Tap d'une autre = bascule vers celle-ci.
  function toggleSection(key) {
    setExpandedSection((prev) => (prev === key ? null : key))
  }

  async function handleToggleRemoved() {
    const willBeRemoved = !isRemoved
    const label = item.label || item.designation || 'cet item'
    try {
      let reason = null
      if (willBeRemoved) {
        const answer = await prompt({
          title: `Retirer "${truncate(label, 40)}" du tournage ?`,
          message:
            "L'item reste visible (barré) mais sera exclu de la checklist rendu loueur. Tu peux préciser une raison (facultatif).",
          placeholder: 'ex. remplacée par autre cam, défaut optique',
          confirmLabel: 'Retirer',
          cancelLabel: 'Annuler',
          multiline: true,
        })
        if (answer === null) return
        reason = answer
      }
      await onSetRemoved({ itemId: item.id, removed: willBeRemoved, reason })
      toast.success(willBeRemoved ? 'Item retiré du tournage' : 'Item réactivé')
    } catch (err) {
      console.error('[CheckItemRow] setRemoved failed', err)
      toast.error('Action impossible')
    }
  }

  async function handleDelete() {
    const label = item.label || item.designation || 'cet additif'
    const ok = await confirm({
      title: `Supprimer "${truncate(label, 40)}" ?`,
      message:
        'Cette action est irréversible et effacera l\'additif ainsi que ses commentaires et photos. Pour juste l\'exclure du tournage sans le supprimer, utilise "Retirer du tournage".',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await onDeleteAdditif({ itemId: item.id })
      toast.success('Additif supprimé')
    } catch (err) {
      console.error('[CheckItemRow] deleteAdditif failed', err)
      toast.error('Suppression impossible')
    }
  }

  // Construction du menu. On filtre les `null`/`false` pour permettre les
  // entrées conditionnelles (ex. "Supprimer additif" seulement pour additifs).
  const menuActions = [
    {
      id: 'signal',
      icon: AlertTriangle,
      label: 'Signaler',
      variant: signalCount > 0 ? 'warning' : 'default',
      badge: signalCount > 0 ? signalCount : null,
      onClick: () => toggleSection('signal'),
    },
    onUploadPhoto || photosPack.length > 0
      ? {
          id: 'pack',
          icon: Camera,
          label: 'Photos pack',
          badge: photosPack.length > 0 ? photosPack.length : null,
          onClick: () => toggleSection('pack'),
        }
      : null,
    {
      id: 'notes',
      icon: MessageCircle,
      label: 'Commentaires',
      badge: commentsNote.length > 0 ? commentsNote.length : null,
      onClick: () => toggleSection('notes'),
    },
    onSetRemoved ? { id: 'sep-1', type: 'separator' } : null,
    onSetRemoved
      ? {
          id: 'removed',
          icon: isRemoved ? RotateCcw : Ban,
          label: isRemoved ? 'Remettre dans le tournage' : 'Retirer du tournage',
          variant: isRemoved ? 'success' : 'warning',
          onClick: handleToggleRemoved,
        }
      : null,
    onDeleteAdditif && isAdditif
      ? {
          id: 'delete',
          icon: Trash2,
          label: 'Supprimer cet additif',
          variant: 'danger',
          onClick: handleDelete,
        }
      : null,
  ].filter(Boolean)

  const rowBackground = isRemoved
    ? 'var(--orange-bg)'
    : displayChecked
      ? 'var(--green-bg)'
      : 'transparent'

  // Un label court pour le titre du bottom sheet mobile. Garde le contexte
  // (l'user ne voit pas le bouton ⋯ pendant que la sheet est ouverte).
  const menuTitle = (() => {
    const base = item.label || item.designation || 'Item'
    return truncate(base, 40)
  })()

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: 'var(--brd-sub)',
        background: rowBackground,
        transition: 'background-color 140ms',
      }}
    >
      {/* Ligne cliquable principale ────────────────────────────────────── */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={handleTap}
          disabled={isRemoved}
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-h-[56px]"
          style={{
            opacity: pending ? 0.85 : isRemoved ? 0.55 : 1,
            cursor: isRemoved ? 'default' : 'pointer',
          }}
        >
          {/* Case à cocher ou badge retiré ─────────────────────────────── */}
          {isRemoved ? (
            <span
              className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
              style={{
                background: 'var(--orange-bg)',
                color: 'var(--orange)',
              }}
              aria-label="item retiré du tournage"
            >
              <Ban className="w-4 h-4" strokeWidth={2.5} />
            </span>
          ) : (
            <span
              className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center border"
              style={{
                background: displayChecked ? 'var(--green)' : 'transparent',
                borderColor: displayChecked ? 'var(--green)' : 'var(--brd)',
                color: '#fff',
              }}
            >
              {displayChecked && <Check className="w-4 h-4" strokeWidth={3} />}
            </span>
          )}

          {/* Désignation + label + qte + badge additif ──────────────── */}
          <span className="flex-1 min-w-0">
            <span
              className="block text-sm"
              style={{
                color: 'var(--txt)',
                textDecoration: isRemoved ? 'line-through' : 'none',
                textDecorationColor: 'var(--txt-3)',
              }}
            >
              {item.label && (
                <span className="font-semibold">
                  {item.label}
                  <span className="mx-1.5" style={{ color: 'var(--txt-3)' }}>
                    ·
                  </span>
                </span>
              )}
              <span>
                {item.designation || (
                  <em style={{ color: 'var(--txt-3)' }}>sans désignation</em>
                )}
              </span>
            </span>
            <span className="flex items-center gap-2 mt-0.5 flex-wrap">
              {Number(item.quantite) > 1 && (
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  x{item.quantite}
                </span>
              )}
              <RemarqueInline text={item.remarques} />
              <LoueurTagList loueurs={loueurs} />
              {showAddedBy && item.added_by_name && !isRemoved && (
                <span className="text-xs" style={{ color: 'var(--purple)' }}>
                  Ajouté par {item.added_by_name}
                </span>
              )}
              {isRemoved && removedBy && (
                <span className="text-xs" style={{ color: 'var(--orange)' }}>
                  Non pris{removedBy ? ` par ${removedBy}` : ''}
                </span>
              )}
              {isRemoved && removedReason && (
                <span
                  className="text-xs italic"
                  style={{ color: 'var(--txt-3)' }}
                  title={removedReason}
                >
                  « {truncate(removedReason, 40)} »
                </span>
              )}
              {/* Pastilles récap visuelles sur la ligne — 3 micro-indicateurs
                  indépendants pour repérer de loin les items qui méritent
                  qu'on ouvre le menu. Volontairement minimalistes (icône +
                  chiffre, pas de fond ni bordure) : les badges DU menu
                  portent déjà le détail et la couleur de variant ; ici on
                  duplique juste l'essentiel pour la vue liste, sans charger
                  l'UI.
                    • ⚠ orange : signalements (photos/comments kind='probleme')
                    • 📷 bleu  : photos pack (documentation interne, MAT-23)
                    • 💬 gris  : commentaires internes (kind='note')         */}
              {signalCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--orange)' }}
                  title={`${signalCount} signalement${signalCount > 1 ? 's' : ''}`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {signalCount}
                </span>
              )}
              {photosPack.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--blue)' }}
                  title={`${photosPack.length} photo${photosPack.length > 1 ? 's' : ''} pack`}
                >
                  <Camera className="w-2.5 h-2.5" />
                  {photosPack.length}
                </span>
              )}
              {commentsNote.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--txt-3)' }}
                  title={`${commentsNote.length} commentaire${commentsNote.length > 1 ? 's' : ''}`}
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  {commentsNote.length}
                </span>
              )}
            </span>
          </span>

          {/* Flag pastille (si posé) ─────────────────────────────────── */}
          {item.flag && !isRemoved && <FlagDot flag={item.flag} />}

          {/* Auteur du check (visible quand coché) ──────────────────── */}
          {displayChecked && !isRemoved && authorName && (
            <span
              className="shrink-0 text-xs px-2 py-1 rounded-md"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              ✓ {authorName}
            </span>
          )}
        </button>

        {/* Menu unifié (⋯) — remplace les 3 boutons séparés de MAT-11C ─ */}
        {menuActions.length > 0 && (
          <ActionSheet
            title={menuTitle}
            actions={menuActions}
            trigger={({ ref, toggle, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className="shrink-0 px-3 flex items-center text-xs min-h-[56px]"
                style={{
                  color: 'var(--txt-3)',
                  background: open ? 'var(--bg-hov)' : 'transparent',
                  borderLeft: '1px solid var(--brd-sub)',
                }}
                aria-label="Plus d'actions"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            )}
          />
        )}
      </div>

      {/* Section dépliée ─ signalements (photos + comments problème) ──── */}
      {expandedSection === 'signal' && (
        <SignalSection
          photos={photosProbleme}
          comments={commentsProbleme}
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
          onAddComment={(body) =>
            onAddComment({ itemId: item.id, kind: 'probleme', body })
          }
          onUploadPhoto={onUploadPhoto}
          onDeletePhoto={onDeletePhoto}
          onUpdatePhotoCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section photos pack ───────────────────────────────────────────── */}
      {expandedSection === 'pack' && (
        <CheckPhotosSection
          photos={photosPack}
          kind="pack"
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section commentaires (notes) ──────────────────────────────────── */}
      {expandedSection === 'notes' && (
        <CommentsThread
          comments={commentsNote}
          onSubmit={(body) =>
            onAddComment({ itemId: item.id, kind: 'note', body })
          }
          placeholder="Ajouter un commentaire…"
          emptyLabel="Aucun commentaire. Laisse une note pour l'équipe."
          submitLabel="Envoyer"
        />
      )}
    </div>
  )
}

/* ═══ Signal section (photos + comments problème) ══════════════════════ */

/**
 * Section dépliée pour "Signaler". Combine :
 *   1. Une grille de photos problème (kind='probleme') avec uploader
 *   2. Un thread de commentaires problème avec composer dédié ("Signaler un
 *      problème…" comme placeholder)
 *
 * Les 2 blocs sont indépendants côté data (l'utilisateur peut ajouter un
 * commentaire SANS photo et vice-versa), mais visuellement côte-à-côte pour
 * refléter l'idée de signalement unique.
 */
function SignalSection({
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
      <CommentsThread
        comments={comments}
        onSubmit={onAddComment}
        placeholder="Signaler un problème…"
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

/* ═══ Thread de commentaires ═══════════════════════════════════════════ */

function CommentsThread({
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
      console.error('[CommentsThread] submit failed', err)
      // Affiche le message serveur si dispo (ex. "function does not exist"
      // quand la migration MAT-23A n'est pas encore appliquée). Aide au
      // diagnostic en prod sans avoir à ouvrir la console.
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
            // Entrée envoie, Shift+Entrée insère un saut de ligne (UX Slack).
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

/**
 * Affichage relatif d'une date type "à l'instant", "il y a 5 min", "14:32".
 * Pour garder l'UX terrain lisible sans traîner moment/date-fns.
 */
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

/* ═══ Flag pastille ═══════════════════════════════════════════════════ */

function FlagDot({ flag }) {
  const map = {
    ok: { color: 'var(--green)', bg: 'var(--green-bg)' },
    attention: { color: 'var(--orange)', bg: 'var(--orange-bg)' },
    probleme: { color: 'var(--red)', bg: 'var(--red-bg)' },
  }
  const style = map[flag]
  if (!style) return null
  return (
    <span
      className="shrink-0 w-2.5 h-2.5 rounded-full"
      style={{
        background: style.color,
        boxShadow: `0 0 0 3px ${style.bg}`,
      }}
      aria-label={`flag ${flag}`}
    />
  )
}

/* ═══ Undo snackbar (MAT-10I) ═════════════════════════════════════════ */

function showUndoToast({ action, itemLabel, onUndo }) {
  const msg = action === 'check' ? 'Coché' : 'Décoché'
  toast.custom(
    (t) => (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-lg"
        style={{
          background: '#1f2937',
          color: '#f9fafb',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
        }}
      >
        <span className="text-sm">
          {msg} <span style={{ opacity: 0.6 }}>—</span>{' '}
          <span style={{ opacity: 0.85 }}>{truncate(itemLabel, 30)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onUndo()
            toast.dismiss(t.id)
          }}
          className="text-xs font-medium px-2 py-1 rounded"
          style={{
            background: 'rgba(255,255,255,0.12)',
            color: '#f9fafb',
          }}
        >
          Annuler
        </button>
      </div>
    ),
    { duration: 5000, position: 'bottom-center' },
  )
}

function truncate(str, max) {
  if (!str) return ''
  return str.length > max ? `${str.slice(0, max - 1)}…` : str
}

/* ═══ Remarque inline ═════════════════════════════════════════════════════ */

function RemarqueInline({ text }) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  return (
    <span
      className="inline-flex items-center gap-1 text-xs italic"
      style={{ color: 'var(--txt-3)' }}
      title={trimmed}
    >
      <StickyNote className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[160px]">{truncate(trimmed, 60)}</span>
    </span>
  )
}
