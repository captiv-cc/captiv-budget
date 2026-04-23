/**
 * CheckItemRow — ligne d'item cliquable dans la checklist terrain
 * (MAT-10E + MAT-10F + MAT-10G + MAT-10I + MAT-10N).
 *
 * La ligne est un tap target large (min 56px) pour un usage mobile sur le
 * plateau. Le tap principal toggle le pre_check. À droite, une bulle 💬 ouvre
 * le thread de commentaires et un menu ⋯ propose les actions secondaires
 * (retirer/remettre l'item, supprimer un additif).
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ ✅  Corps caméra · RED KOMODO (x1)  💬 2  ⋯  ✓ Camille │  ligne
 *   │  ┌─────────────────────────────────────────────────┐ │
 *   │  │ Léo — 14:32                                      │ │  thread
 *   │  │ Cache manquant                                   │ │
 *   │  │ ─────────────────────────────────────────────── │ │
 *   │  │ [votre commentaire...]            [Envoyer]     │ │  composer
 *   │  └─────────────────────────────────────────────────┘ │
 *   └───────────────────────────────────────────────────────┘
 *
 * État "retiré" (MAT-10N) :
 *   ┌───────────────────────────────────────────────────────┐
 *   │ 🚫  ~~Cam PLV100~~ — Non pris par Camille       💬 1  │
 *   │     ↳ "remplacée par PLV80"                           │
 *   └───────────────────────────────────────────────────────┘
 *   (ligne grisée, barrée, check désactivé, icône 🚫 à la place de ✓)
 *
 * MAT-10I — Undo snackbar : après un toggle réussi, on affiche un toast
 * "Coché par X — Annuler" pendant 5s. Le clic sur Annuler re-toggle.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Ban,
  Camera,
  Check,
  MessageCircle,
  MoreVertical,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { confirm, prompt } from '../../../../lib/confirm'
import LoueurTagList from './LoueurTagList'
import CheckPhotosSection from './CheckPhotosSection'

export default function CheckItemRow({
  item,
  comments = [],
  loueurs = [],
  // MAT-11 : photos "problème" ancrées à cet item, tri chrono ASC. Map passée
  // par CheckBlockCard depuis photosByItem du hook. Default [] si MAT-11 n'est
  // pas encore poussé (safe fallback).
  photos = [],
  // Identité (pour ownership delete/caption) et flag admin (MAT-11D).
  userName = null,
  isAdmin = false,
  onToggle,
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
  // MAT-11 : callbacks photos (passés depuis actions du hook). Si null, le
  // bouton Camera est masqué (mode read-only ou session non encore patchée).
  onUploadPhoto = null,
  onDeletePhoto = null,
  onUpdatePhotoCaption = null,
  showAddedBy = false,
}) {
  // État optimiste du check. Pendant le round-trip RPC, on flippe localement
  // pour un retour visuel instantané. La valeur serveur est autorité dès
  // que `pending` revient à null.
  const [pending, setPending] = useState(null) // null | 'checking' | 'unchecking'
  const [threadOpen, setThreadOpen] = useState(false)
  // MAT-11 : section photos dépliable indépendante du thread commentaires.
  // 2 expansions potentielles = 2 états distincts (pas de toggle exclusif).
  const [photosOpen, setPhotosOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const photoCount = photos.length
  const photosEnabled = Boolean(onUploadPhoto) // masqué si le hook n'expose pas l'action

  const serverChecked = Boolean(item.pre_check_at)
  const isRemoved = Boolean(item.removed_at)
  const isAdditif = Boolean(item.added_during_check)
  const displayChecked = pending === 'checking' ? true : pending === 'unchecking' ? false : serverChecked
  const authorName = item.pre_check_by_name || null
  const removedBy = item.removed_by_name || null
  const removedReason = item.removed_reason || null
  const commentCount = comments.length

  async function handleTap() {
    if (pending || isRemoved) return // pas de toggle sur item retiré
    const wasChecked = serverChecked
    setPending(wasChecked ? 'unchecking' : 'checking')
    try {
      await onToggle(item.id)
      // MAT-10I — Undo snackbar. 5s pour annuler. L'action Annuler re-toggle
      // simplement (le serveur remettra l'état opposé).
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

  // Fond de ligne selon l'état (retiré > coché > neutre).
  // Pour "retiré" : un léger fond orange très dilué (orange-bg est déjà
  // semi-transparent dans le thème) + on laisse le comportement opacity
  // sur le texte pour désaturer visuellement l'item.
  const rowBackground = isRemoved
    ? 'var(--orange-bg)'
    : displayChecked
      ? 'var(--green-bg)'
      : 'transparent'

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
              {/* Remarques de l'outil (ex. "avec sangle", "cable XLR fourni").
                  Affichées à gauche des pastilles loueurs — même ligne meta,
                  en italique discret pour ne pas concurrencer la désignation.
                  Tronquées à ~60 chars avec full text en tooltip natif. */}
              <RemarqueInline text={item.remarques} />
              {/* Pastilles loueurs (MAT-10O) — read-only. Placées juste après la
                  quantité/remarques pour rester visibles sans écraser le texte.
                  Sont naturellement wrapped par `flex-wrap` sur mobile. */}
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

        {/* Bouton commentaires (sort du tap-principal pour ne pas
            déclencher le toggle en ouvrant le thread) ───────────── */}
        <button
          type="button"
          onClick={() => setThreadOpen((v) => !v)}
          className="shrink-0 px-3 flex items-center gap-1.5 text-xs"
          style={{
            color: commentCount > 0 ? 'var(--blue)' : 'var(--txt-3)',
            background: threadOpen ? 'var(--bg-hov)' : 'transparent',
            borderLeft: '1px solid var(--brd-sub)',
          }}
          aria-label="Ouvrir les commentaires"
        >
          <MessageCircle className="w-4 h-4" />
          {commentCount > 0 && <span className="tabular-nums">{commentCount}</span>}
        </button>

        {/* MAT-11 : Bouton photos (aligné avec commentaires — même pattern
            d'expansion inline). Masqué si le parent n'a pas câblé l'action
            (mode read-only p.ex.). L'icône change de couleur quand ≥1
            photo est présente, pour attirer l'œil sur les items flaggés. */}
        {photosEnabled && (
          <button
            type="button"
            onClick={() => setPhotosOpen((v) => !v)}
            className="shrink-0 px-3 flex items-center gap-1.5 text-xs"
            style={{
              color: photoCount > 0 ? 'var(--orange)' : 'var(--txt-3)',
              background: photosOpen ? 'var(--bg-hov)' : 'transparent',
              borderLeft: '1px solid var(--brd-sub)',
            }}
            aria-label="Ouvrir les photos"
          >
            <Camera className="w-4 h-4" />
            {photoCount > 0 && <span className="tabular-nums">{photoCount}</span>}
          </button>
        )}

        {/* Menu kebab (MAT-10N) — actions secondaires ─────────────── */}
        {(onSetRemoved || (onDeleteAdditif && isAdditif)) && (
          <ItemMenuButton
            open={menuOpen}
            onToggle={() => setMenuOpen((v) => !v)}
            onClose={() => setMenuOpen(false)}
            item={item}
            isRemoved={isRemoved}
            isAdditif={isAdditif}
            onSetRemoved={onSetRemoved}
            onDeleteAdditif={onDeleteAdditif}
          />
        )}
      </div>

      {/* Thread de commentaires (déplié) ──────────────────────────────── */}
      {threadOpen && (
        <CommentsThread
          comments={comments}
          onSubmit={(body) => onAddComment({ itemId: item.id, body })}
        />
      )}

      {/* MAT-11 : Section photos (dépliée) — même pattern visuel que le
          thread commentaires mais délimitée par un border-top dédié pour
          distinguer les deux expansions quand les deux sont ouvertes. */}
      {photosOpen && photosEnabled && (
        <CheckPhotosSection
          photos={photos}
          kind="probleme"
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
        />
      )}
    </div>
  )
}

/* ═══ Thread de commentaires ═══════════════════════════════════════════ */

function CommentsThread({ comments, onSubmit }) {
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
      console.error('[CommentsThread] addComment failed', err)
      toast.error('Commentaire non envoyé')
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
          Aucun commentaire. Signalez un défaut, une remarque, une modification…
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
              <p className="mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--txt-2)' }}>
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
          placeholder="Ajouter un commentaire…"
          rows={2}
          className="flex-1 px-3 py-2 rounded-md text-sm resize-none"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
          onKeyDown={(e) => {
            // Entrée envoie, Shift+Entrée insère un saut de ligne (UX type Slack).
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
          {submitting ? '…' : 'Envoyer'}
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
  // Sinon, heure du jour. Pas de gestion multi-jour car la checklist est
  // session-scopée sur 1-2 jours max.
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

/* ═══ Menu kebab (MAT-10N) ════════════════════════════════════════════ */

/**
 * Bouton ⋯ qui ouvre un popover d'actions secondaires :
 *   - Retirer / Remettre dans le tournage (soft remove toggle)
 *   - Supprimer cet additif (hard, uniquement si added_during_check)
 *
 * Le popover est rendu via `createPortal` directement dans `document.body`
 * pour échapper à `overflow-hidden` de la carte parente (sinon il est
 * cliqué / visuellement tronqué). La position est calculée depuis la
 * bounding-rect du bouton déclencheur et recalculée au resize / scroll.
 *
 * Les prompts de confirmation / raison passent par les APIs `confirm()` et
 * `prompt()` de `lib/confirm.js` (dialogs stylés, pas les popups natifs).
 */
function ItemMenuButton({
  open,
  onToggle,
  onClose,
  item,
  isRemoved,
  isAdditif,
  onSetRemoved,
  onDeleteAdditif,
}) {
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const [coords, setCoords] = useState(null) // { top, right } en viewport coords

  // Calcule la position du menu sous le bouton, aligné à droite.
  // useLayoutEffect pour éviter le flash (le menu apparaît déjà positionné).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    function recompute() {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setCoords({
        top: rect.bottom + 4, // 4px de gap sous le bouton
        right: window.innerWidth - rect.right, // aligné sur le bord droit du bouton
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true) // capture pour intercepter scroll des parents
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  // Fermeture sur clic extérieur / Escape. Attention : on check à la fois
  // le bouton (pour ne pas re-fermer tout de suite) ET le menu (pour laisser
  // les clics internes passer).
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e) {
      if (buttonRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  async function handleToggleRemoved() {
    onClose()
    const willBeRemoved = !isRemoved
    const label = item.label || item.designation || 'cet item'
    try {
      let reason = null
      if (willBeRemoved) {
        // Dialog stylé avec champ texte — UX cohérente avec le reste du design.
        const answer = await prompt({
          title: `Retirer "${truncate(label, 40)}" du tournage ?`,
          message:
            'L\'item reste visible (barré) mais sera exclu de la checklist rendu loueur. Tu peux préciser une raison (facultatif).',
          placeholder: 'ex. remplacée par autre cam, défaut optique',
          confirmLabel: 'Retirer',
          cancelLabel: 'Annuler',
          multiline: true,
        })
        if (answer === null) return // l'utilisateur a cliqué Annuler
        reason = answer
      }
      await onSetRemoved({ itemId: item.id, removed: willBeRemoved, reason })
      toast.success(willBeRemoved ? 'Item retiré du tournage' : 'Item réactivé')
    } catch (err) {
      console.error('[ItemMenu] setRemoved failed', err)
      toast.error('Action impossible')
    }
  }

  async function handleDelete() {
    onClose()
    const label = item.label || item.designation || 'cet additif'
    const ok = await confirm({
      title: `Supprimer "${truncate(label, 40)}" ?`,
      message:
        'Cette action est irréversible et effacera l\'additif ainsi que ses commentaires. Pour juste l\'exclure du tournage sans le supprimer, utilise "Retirer du tournage".',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await onDeleteAdditif({ itemId: item.id })
      toast.success('Additif supprimé')
    } catch (err) {
      console.error('[ItemMenu] deleteAdditif failed', err)
      toast.error('Suppression impossible')
    }
  }

  const menu = open && coords && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[9998] min-w-[240px] rounded-lg shadow-2xl overflow-hidden"
          style={{
            top: coords.top,
            right: coords.right,
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
          }}
        >
          {onSetRemoved && (
            <button
              type="button"
              role="menuitem"
              onClick={handleToggleRemoved}
              className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors"
              style={{ color: isRemoved ? 'var(--green)' : 'var(--orange)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {isRemoved ? (
                <>
                  <RotateCcw className="w-4 h-4" />
                  Remettre dans le tournage
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4" />
                  Retirer du tournage
                </>
              )}
            </button>
          )}
          {onDeleteAdditif && isAdditif && (
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 border-t transition-colors"
              style={{
                color: 'var(--red)',
                borderColor: 'var(--brd-sub)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Trash2 className="w-4 h-4" />
              Supprimer cet additif
            </button>
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        className="shrink-0 px-3 flex items-center text-xs"
        style={{
          color: 'var(--txt-3)',
          background: open ? 'var(--bg-hov)' : 'transparent',
          borderLeft: '1px solid var(--brd-sub)',
        }}
        aria-label="Plus d'actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {menu}
    </>
  )
}

/* ═══ Undo snackbar (MAT-10I) ═════════════════════════════════════════ */

/**
 * Affiche un toast custom "Coché par X — Annuler" pendant 5s. L'Annuler
 * appelle onUndo() qui re-toggle l'item. On utilise react-hot-toast avec
 * render-function pour avoir un bouton cliquable dans le toast.
 */
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

/**
 * Affiche la remarque texte d'un item (ex. "avec sangle XLR", "sans cache")
 * sur la même ligne que la quantité et les pastilles loueurs.
 *
 * Rendu discret (italique, txt-3) pour ne pas concurrencer la désignation.
 * Tronquée à 60 caractères avec le full text accessible en tooltip natif —
 * utile sur mobile où la ligne meta est déjà bien chargée.
 *
 * Rend `null` si la remarque est vide ou whitespace-only : on ne veut pas
 * d'icône StickyNote orpheline.
 */
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
