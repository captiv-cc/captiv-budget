// ════════════════════════════════════════════════════════════════════════════
// BulkActionBar — bandeau d'actions multi-sélection (LIV-14)
// ════════════════════════════════════════════════════════════════════════════
//
// Bandeau bottom-fixed qui apparaît dès qu'au moins 1 livrable est sélectionné.
// Permet d'appliquer une action en lot sur tous les livrables sélectionnés,
// quels que soient leurs blocs (sélection cross-blocs autorisée).
//
// 7 actions disponibles :
//   1. Statut         (popover via LivrableStatutPill — 6 statuts)
//   2. Monteur        (texte libre via uiPrompt)
//   3. Date livraison (date picker via uiPrompt)
//   4. Format         (popover via FormatSelect)
//   5. Lien Frame.io  (uiPrompt URL)
//   6. Lien Drive     (uiPrompt URL)
//   7. Supprimer      (confirm + soft delete + toast undo unique)
//
// Suppression bulk : on stocke les IDs supprimés et on relance
// `actions.restoreLivrable(id)` pour chacun au click "Annuler" du toast.
//
// Props :
//   - selectedIds      : Set<string>
//   - actions          : `useLivrables.actions`
//   - onClearSelection : () => void
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import {
  Calendar,
  Film,
  Link2,
  Loader2,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { confirm, prompt as uiPrompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import { LIVRABLE_STATUTS, LIVRABLE_FORMATS } from '../../../lib/livrablesHelpers'
import PopoverFloat from './PopoverFloat'

const STATUT_ORDER = ['brief', 'en_cours', 'a_valider', 'valide', 'livre', 'archive']

export default function BulkActionBar({
  selectedIds,
  actions,
  onClearSelection,
}) {
  const count = selectedIds?.size || 0
  const idsArr = Array.from(selectedIds || [])

  const [submitting, setSubmitting] = useState(false)

  // Helper : applique un patch en bulk + toast unifié.
  const applyBulk = useCallback(
    async (patch, label) => {
      if (!idsArr.length || submitting) return
      setSubmitting(true)
      try {
        await actions.bulkUpdateLivrables(idsArr, patch)
        notify.success(`${count} livrable${count > 1 ? 's' : ''} mis à jour : ${label}`)
      } catch (err) {
        notify.error('Erreur bulk update : ' + (err?.message || err))
      } finally {
        setSubmitting(false)
      }
    },
    [actions, count, idsArr, submitting],
  )

  // ─── Statut popover ──────────────────────────────────────────────────────
  const [statutOpen, setStatutOpen] = useState(false)
  const statutRef = useRef(null)
  const handleStatutPick = useCallback(
    async (key) => {
      setStatutOpen(false)
      await applyBulk({ statut: key }, LIVRABLE_STATUTS[key]?.label || key)
    },
    [applyBulk],
  )

  // ─── Format popover ──────────────────────────────────────────────────────
  const [formatOpen, setFormatOpen] = useState(false)
  const formatRef = useRef(null)
  const handleFormatPick = useCallback(
    async (f) => {
      setFormatOpen(false)
      await applyBulk({ format: f }, f || 'effacé')
    },
    [applyBulk],
  )

  // ─── Monteur (uiPrompt texte libre) ──────────────────────────────────────
  const handleMonteurEdit = useCallback(async () => {
    const next = await uiPrompt({
      title: `Monteur — ${count} livrable${count > 1 ? 's' : ''}`,
      message: 'Nom du monteur (laisse vide pour effacer).',
      placeholder: 'Ex : Hugo',
      initialValue: '',
      confirmLabel: 'Appliquer',
    })
    if (next === null) return
    await applyBulk(
      { assignee_external: next.trim() || null },
      next.trim() || 'monteur effacé',
    )
  }, [applyBulk, count])

  // ─── Date livraison (uiPrompt texte au format AAAA-MM-JJ) ────────────────
  // uiPrompt ne supporte pas type=date côté ConfirmHost, donc on demande la
  // date au format ISO via texte. Validation simple AAAA-MM-JJ (refus si
  // format incorrect — l'utilisateur peut retenter ou annuler).
  const handleDateEdit = useCallback(async () => {
    const next = await uiPrompt({
      title: `Date de livraison — ${count} livrable${count > 1 ? 's' : ''}`,
      message: 'Format AAAA-MM-JJ (ex : 2026-05-15). Laisse vide pour effacer.',
      placeholder: 'AAAA-MM-JJ',
      initialValue: '',
      confirmLabel: 'Appliquer',
    })
    if (next === null) return
    const trimmed = (next || '').trim()
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      notify.error('Format de date invalide. Attendu : AAAA-MM-JJ.')
      return
    }
    await applyBulk(
      { date_livraison: trimmed || null },
      trimmed || 'date effacée',
    )
  }, [applyBulk, count])

  // ─── Lien Frame / Drive (uiPrompt URL) ───────────────────────────────────
  const handleLinkEdit = useCallback(
    async (field, label) => {
      const next = await uiPrompt({
        title: `Lien ${label} — ${count} livrable${count > 1 ? 's' : ''}`,
        message: `Colle l'URL ${label} (laisse vide pour effacer).`,
        placeholder: 'https://…',
        initialValue: '',
        confirmLabel: 'Appliquer',
      })
      if (next === null) return
      await applyBulk(
        { [field]: next.trim() || null },
        `${label} ${next.trim() ? 'mis à jour' : 'effacé'}`,
      )
    },
    [applyBulk, count],
  )

  // ─── Suppression bulk avec toast undo unique ─────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    if (!idsArr.length) return
    const ok = await confirm({
      title: `Supprimer ${count} livrable${count > 1 ? 's' : ''} ?`,
      message: 'Tu pourras restaurer pendant 5 secondes.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    setSubmitting(true)
    try {
      // Soft delete séquentiel — pas d'API bulk delete pour l'instant
      // (cohérent avec hook qui patch state via deleteLivrable).
      const idsBackup = [...idsArr]
      for (const id of idsBackup) {
        await actions.deleteLivrable(id)
      }
      onClearSelection?.()
      // Toast unique avec restore en lot (pattern MAT-10I étendu).
      toast.custom(
        (t) => (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          >
            <Trash2 className="w-4 h-4" style={{ color: 'var(--red)' }} />
            <span className="text-sm">
              {idsBackup.length} livrable{idsBackup.length > 1 ? 's' : ''} supprimé
              {idsBackup.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(t.id)
                try {
                  for (const id of idsBackup) {
                    await actions.restoreLivrable(id)
                  }
                  notify.success('Livrables restaurés')
                } catch (err) {
                  notify.error('Erreur restauration : ' + (err?.message || err))
                }
              }}
              className="text-sm font-medium px-2 py-1 rounded"
              style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}
            >
              Annuler
            </button>
          </div>
        ),
        { duration: 5000 },
      )
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }, [actions, count, idsArr, onClearSelection])

  if (count === 0) return null

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-xl shadow-2xl"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        maxWidth: 'calc(100vw - 32px)',
        flexWrap: 'wrap',
      }}
      role="toolbar"
      aria-label="Actions sur la sélection"
    >
      {/* Indicateur de sélection */}
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-lg shrink-0"
        style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
      >
        <span className="text-sm font-bold tabular-nums">{count}</span>
        <span className="text-xs">sélectionné{count > 1 ? 's' : ''}</span>
      </div>

      <div
        style={{ width: 1, height: 24, background: 'var(--brd-sub)' }}
        aria-hidden
      />

      {/* Statut */}
      <button
        ref={statutRef}
        type="button"
        onClick={() => setStatutOpen((o) => !o)}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer le statut"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Tag className="w-3.5 h-3.5" />
        Statut
      </button>
      <PopoverFloat
        anchorRef={statutRef}
        open={statutOpen}
        onClose={() => setStatutOpen(false)}
        align="left"
        placement="top"
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', minWidth: 160 }}
        >
          {STATUT_ORDER.map((key) => {
            const s = LIVRABLE_STATUTS[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleStatutPick(key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{ background: s.bg, color: s.color }}
                >
                  {s.label}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverFloat>

      {/* Monteur */}
      <button
        type="button"
        onClick={handleMonteurEdit}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer le monteur"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <User className="w-3.5 h-3.5" />
        Monteur
      </button>

      {/* Date livraison */}
      <button
        type="button"
        onClick={handleDateEdit}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer la date de livraison"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Calendar className="w-3.5 h-3.5" />
        Date
      </button>

      {/* Format */}
      <button
        ref={formatRef}
        type="button"
        onClick={() => setFormatOpen((o) => !o)}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer le format"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Film className="w-3.5 h-3.5" />
        Format
      </button>
      <PopoverFloat
        anchorRef={formatRef}
        open={formatOpen}
        onClose={() => setFormatOpen(false)}
        align="left"
        placement="top"
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', minWidth: 120 }}
        >
          {LIVRABLE_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => handleFormatPick(f)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              style={{ color: 'var(--txt)' }}
            >
              {f}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
            <button
              type="button"
              onClick={() => handleFormatPick(null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs"
              style={{ color: 'var(--red)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Effacer
            </button>
          </div>
        </div>
      </PopoverFloat>

      {/* Lien Frame */}
      <button
        type="button"
        onClick={() => handleLinkEdit('lien_frame', 'Frame.io')}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer le lien Frame.io"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Link2 className="w-3.5 h-3.5" />
        Frame
      </button>

      {/* Lien Drive */}
      <button
        type="button"
        onClick={() => handleLinkEdit('lien_drive', 'Drive')}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--txt)' }}
        title="Changer le lien Drive"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Link2 className="w-3.5 h-3.5" />
        Drive
      </button>

      <div
        style={{ width: 1, height: 24, background: 'var(--brd-sub)' }}
        aria-hidden
      />

      {/* Supprimer (danger) */}
      <button
        type="button"
        onClick={handleBulkDelete}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ color: 'var(--red)' }}
        title="Supprimer la sélection"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--red-bg)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {submitting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
        Supprimer
      </button>

      <div
        style={{ width: 1, height: 24, background: 'var(--brd-sub)' }}
        aria-hidden
      />

      {/* Désélectionner */}
      <button
        type="button"
        onClick={onClearSelection}
        disabled={submitting}
        className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg shrink-0"
        style={{ color: 'var(--txt-3)' }}
        title="Tout désélectionner"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--txt)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-3)'
        }}
      >
        <X className="w-3.5 h-3.5" />
      </button>

    </div>
  )
}
