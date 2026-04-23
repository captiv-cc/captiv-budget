// ════════════════════════════════════════════════════════════════════════════
// LoueurPillsEditor — MAT-5 (v2 : dropdowns via Portal pour échapper aux
// containers `overflow:auto` des tableaux)
// ════════════════════════════════════════════════════════════════════════════
//
// Éditeur de loueurs rattachés à un item matériel. Affiche les pastilles
// (couleur + nom + numéro de référence optionnel) et permet :
//
//   - Clic sur pastille      → popover d'édition (numero_reference + retirer)
//   - Clic sur "+"           → dropdown listant les loueurs disponibles
//   - Dans le dropdown :     → sélection d'un loueur existant pour l'attacher
//   - "+ Créer un loueur"    → formulaire inline (nom + palette couleur)
//
// Les popovers (dropdown d'ajout & popover d'édition) sont rendus via
// `createPortal` sur `document.body` avec `position: fixed`, afin de ne pas
// être clippés par les parents en `overflow-x-auto` (tables de Block).
// Un listener scroll/resize ferme le popover pour éviter toute position
// obsolète.
//
// Props :
//   - itemId, loueurs, allLoueurs, loueursById, actions, orgId, canEdit
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Check, CircleDot, Search } from 'lucide-react'
import { LOUEUR_COLOR_PRESETS } from '../../../lib/materiel'
import { notify } from '../../../lib/notify'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Ajuste l'opacité d'une couleur hex pour les backgrounds pastels. */
function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b22'
  return hex + a
}

// ═════════════════════════════════════════════════════════════════════════════
// Composant principal
// ═════════════════════════════════════════════════════════════════════════════

export default function LoueurPillsEditor({
  itemId,
  loueurs = [],
  allLoueurs = [],
  loueursById,
  actions,
  orgId,
  canEdit,
}) {
  // Ref racine pour détecter le click-outside (pills + trigger +).
  const rootRef = useRef(null)
  // Ref sur le bouton "+" pour positionner le dropdown d'ajout.
  const addBtnRef = useRef(null)
  // Refs des pastilles pour positionner les EditPopovers (Map<item_loueur.id, HTMLElement>).
  const pillRefs = useRef(new Map())

  // Popover d'édition sur une pastille (identifiée par item_loueur.id). null = fermé.
  const [editingId, setEditingId] = useState(null)

  // Dropdown d'ajout (true = ouvert).
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Refs vers les DOM des popovers (rendus via Portal) — pour click-outside.
  const addPopRef = useRef(null)
  const editPopRef = useRef(null)

  // Close popovers on click-outside (y compris sur les popovers portalisés).
  useEffect(() => {
    if (!editingId && !dropdownOpen) return undefined
    function onDocClick(e) {
      const insideRoot = rootRef.current?.contains(e.target)
      const insideAdd = addPopRef.current?.contains(e.target)
      const insideEdit = editPopRef.current?.contains(e.target)
      if (!insideRoot && !insideAdd && !insideEdit) {
        setEditingId(null)
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [editingId, dropdownOpen])

  // Close popovers on Escape.
  useEffect(() => {
    if (!editingId && !dropdownOpen) return undefined
    function onKey(e) {
      if (e.key === 'Escape') {
        setEditingId(null)
        setDropdownOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editingId, dropdownOpen])

  // Loueurs déjà attachés à cet item (pour filtrer la liste du dropdown).
  const attachedIds = useMemo(() => new Set(loueurs.map((l) => l.loueur_id)), [loueurs])

  const availableLoueurs = useMemo(
    () => allLoueurs.filter((l) => !attachedIds.has(l.id)),
    [allLoueurs, attachedIds],
  )

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleAttach = useCallback(
    async (loueurId) => {
      try {
        await actions.addLoueur({ itemId, loueurId, numeroReference: null })
        setDropdownOpen(false)
      } catch (err) {
        notify.error('Erreur ajout loueur : ' + (err?.message || err))
      }
    },
    [actions, itemId],
  )

  const handleCreateAndAttach = useCallback(
    async ({ nom, couleur }) => {
      if (!orgId) {
        notify.error('Organisation introuvable — impossible de créer un loueur.')
        return
      }
      try {
        const loueur = await actions.createLoueur({ orgId, nom, couleur })
        if (loueur?.id) {
          await actions.addLoueur({ itemId, loueurId: loueur.id, numeroReference: null })
        }
        setDropdownOpen(false)
      } catch (err) {
        notify.error('Erreur création loueur : ' + (err?.message || err))
      }
    },
    [actions, itemId, orgId],
  )

  const handleUpdate = useCallback(
    async (itemLoueurId, fields) => {
      try {
        await actions.updateLoueur(itemLoueurId, fields)
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions],
  )

  const handleRemove = useCallback(
    async (itemLoueurId) => {
      try {
        await actions.removeLoueur(itemLoueurId)
        setEditingId(null)
      } catch (err) {
        notify.error('Erreur retrait : ' + (err?.message || err))
      }
    },
    [actions],
  )

  // ─── Rendu ───────────────────────────────────────────────────────────────
  const editingIl = editingId ? loueurs.find((x) => x.id === editingId) : null
  const editingLoueur = editingIl ? loueursById?.get(editingIl.loueur_id) : null

  return (
    <div ref={rootRef} className="relative flex items-center gap-1 flex-wrap">
      {loueurs.length === 0 && !canEdit && (
        <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          —
        </span>
      )}

      {loueurs.map((il) => {
        const l = loueursById?.get(il.loueur_id)
        const couleur = l?.couleur || '#64748b'
        const nom = l?.nom || 'Loueur inconnu'
        const isEditing = editingId === il.id
        return (
          <LoueurPill
            key={il.id}
            pillRef={(el) => {
              if (el) pillRefs.current.set(il.id, el)
              else pillRefs.current.delete(il.id)
            }}
            couleur={couleur}
            nom={nom}
            numeroReference={il.numero_reference}
            onClick={canEdit ? () => setEditingId(isEditing ? null : il.id) : undefined}
            canEdit={canEdit}
          />
        )
      })}

      {canEdit && (
        <button
          ref={addBtnRef}
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          title="Ajouter un loueur"
          aria-label="Ajouter un loueur"
          className="inline-flex items-center justify-center rounded-full transition-all"
          style={{
            width: '20px',
            height: '20px',
            background: dropdownOpen ? 'var(--blue-bg)' : 'var(--bg-elev)',
            color: dropdownOpen ? 'var(--blue)' : 'var(--txt-3)',
            border: '1px dashed var(--brd)',
          }}
        >
          <Plus className="w-3 h-3" />
        </button>
      )}

      {/* Dropdown d'ajout — Portal */}
      {canEdit && dropdownOpen && (
        <PortalPopover
          anchorRef={addBtnRef}
          onClose={() => setDropdownOpen(false)}
          popRef={addPopRef}
          width={260}
        >
          <AddDropdown
            availableLoueurs={availableLoueurs}
            onAttach={handleAttach}
            onCreate={handleCreateAndAttach}
            onClose={() => setDropdownOpen(false)}
          />
        </PortalPopover>
      )}

      {/* Popover d'édition d'une pastille — Portal */}
      {editingIl && (
        <PortalPopover
          anchorEl={pillRefs.current.get(editingIl.id)}
          onClose={() => setEditingId(null)}
          popRef={editPopRef}
          width={240}
        >
          <EditPopover
            il={editingIl}
            nom={editingLoueur?.nom || 'Loueur inconnu'}
            onSave={(fields) => handleUpdate(editingIl.id, fields)}
            onRemove={() => handleRemove(editingIl.id)}
            onClose={() => setEditingId(null)}
          />
        </PortalPopover>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// PortalPopover — helper : rend les children dans un Portal positionné
// en `fixed` sous l'ancre, se ferme au scroll extérieur.
// ═════════════════════════════════════════════════════════════════════════════

function PortalPopover({
  anchorRef,
  anchorEl,
  popRef,
  onClose,
  width = 260,
  children,
}) {
  const [pos, setPos] = useState(null)

  const getAnchor = useCallback(() => {
    return anchorEl || anchorRef?.current || null
  }, [anchorEl, anchorRef])

  // Calcul (ré)initial de la position.
  useEffect(() => {
    function recalc() {
      const el = getAnchor()
      if (!el) return
      const r = el.getBoundingClientRect()
      // Positionne l'angle top-left du popover juste sous l'ancre.
      let left = r.left
      // On clamp si on dépasse du viewport à droite.
      const overflow = left + width - window.innerWidth + 8
      if (overflow > 0) left -= overflow
      if (left < 8) left = 8
      setPos({ left, top: r.bottom + 4 })
    }
    recalc()
    // Sur scroll extérieur : on suit l'ancre au lieu de fermer. Fermer
    // posait problème sur mobile : dès que l'utilisateur tape dans le
    // champ de recherche, le clavier virtuel remonte la viewport (scroll)
    // et le popover se refermait avant même la saisie. Suivre l'ancre
    // est plus robuste — si l'ancre quitte la vue, on ferme, sinon on
    // replace le popover dessous.
    function onScroll(e) {
      if (popRef?.current?.contains(e.target)) return
      const el = getAnchor()
      if (!el) {
        onClose?.()
        return
      }
      const r = el.getBoundingClientRect()
      // Si l'ancre est hors viewport (au-dessus ou en-dessous), on ferme.
      if (r.bottom < 0 || r.top > window.innerHeight) {
        onClose?.()
        return
      }
      recalc()
    }
    function onResize() {
      recalc()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [getAnchor, onClose, popRef, width])

  if (!pos) return null

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width,
        zIndex: 9999,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,.6)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Pastille loueur (affichage seul)
// ═════════════════════════════════════════════════════════════════════════════

function LoueurPill({ pillRef, couleur, nom, numeroReference, onClick, canEdit }) {
  return (
    <button
      ref={pillRef}
      type="button"
      onClick={onClick}
      disabled={!canEdit}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold transition-all"
      style={{
        background: alpha(couleur, '22'),
        color: couleur,
        border: `1px solid ${alpha(couleur, '55')}`,
        cursor: canEdit ? 'pointer' : 'default',
      }}
      title={numeroReference ? `${nom} · ${numeroReference}` : nom}
    >
      <CircleDot className="w-2.5 h-2.5" />
      <span className="truncate max-w-[90px]">{nom}</span>
      {numeroReference && (
        <span style={{ opacity: 0.75, fontWeight: 600 }}>· {numeroReference}</span>
      )}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Popover d'édition d'une pastille (numero_reference + retirer)
// ═════════════════════════════════════════════════════════════════════════════

function EditPopover({ il, nom, onSave, onRemove, onClose }) {
  const [numeroRef, setNumeroRef] = useState(il.numero_reference || '')

  // Auto-focus au montage.
  const inputRef = useRef(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function handleSave() {
    const trimmed = numeroRef.trim()
    if (trimmed === (il.numero_reference || '')) {
      onClose()
      return
    }
    await onSave({ numero_reference: trimmed || null })
    onClose()
  }

  function handleKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wider truncate"
          style={{ color: 'var(--txt-3)', maxWidth: '160px' }}
        >
          {nom}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="p-0.5 rounded transition-all"
          style={{ color: 'var(--txt-3)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <label className="block mb-2">
        <span className="text-[10px] font-semibold" style={{ color: 'var(--txt-3)' }}>
          Numéro de référence
        </span>
        <input
          ref={inputRef}
          type="text"
          value={numeroRef}
          onChange={(e) => setNumeroRef(e.target.value)}
          onKeyDown={handleKey}
          placeholder="ex. 2/3/6"
          className="w-full mt-0.5 px-2 py-1 rounded-md text-xs focus:outline-none"
          style={{
            background: 'var(--bg-surf)',
            color: 'var(--txt)',
            border: '1px solid var(--brd)',
          }}
        />
      </label>

      <div className="flex items-center justify-between gap-2 mt-3">
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
          style={{ color: 'var(--red)', background: 'var(--red-bg)' }}
        >
          <X className="w-3 h-3" />
          Retirer
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-md"
          style={{ color: 'white', background: 'var(--blue)' }}
        >
          <Check className="w-3 h-3" />
          Enregistrer
        </button>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Dropdown d'ajout (liste + création)
// ═════════════════════════════════════════════════════════════════════════════

function AddDropdown({ availableLoueurs, onAttach, onCreate, onClose }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availableLoueurs
    return availableLoueurs.filter((l) => l.nom?.toLowerCase().includes(q))
  }, [availableLoueurs, query])

  if (creating) {
    return (
      <CreateLoueurForm
        onCancel={() => setCreating(false)}
        onSubmit={async (payload) => {
          await onCreate(payload)
          onClose()
        }}
      />
    )
  }

  return (
    <>
      {/* Recherche */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un loueur…"
          autoFocus
          className="w-full text-xs bg-transparent focus:outline-none"
          style={{ color: 'var(--txt)' }}
        />
      </div>

      {/* Liste */}
      <div className="max-h-[200px] overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p
            className="px-3 py-2 text-xs italic text-center"
            style={{ color: 'var(--txt-3)' }}
          >
            {query ? 'Aucun loueur trouvé' : 'Aucun loueur disponible'}
          </p>
        ) : (
          filtered.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onAttach(l.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-all"
              style={{ color: 'var(--txt)', background: 'transparent' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span
                className="inline-block rounded-full shrink-0"
                style={{
                  width: '10px',
                  height: '10px',
                  background: l.couleur || '#64748b',
                }}
              />
              <span className="truncate">{l.nom}</span>
            </button>
          ))
        )}
      </div>

      {/* Création */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-all"
        style={{
          color: 'var(--blue)',
          background: 'var(--blue-bg)',
          borderTop: '1px solid var(--brd-sub)',
        }}
      >
        <Plus className="w-3 h-3" />
        Créer un loueur
      </button>
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Formulaire de création d'un loueur (nom + palette couleur)
// ═════════════════════════════════════════════════════════════════════════════

function CreateLoueurForm({ onCancel, onSubmit }) {
  const [nom, setNom] = useState('')
  const [couleur, setCouleur] = useState(LOUEUR_COLOR_PRESETS[0])
  const [submitting, setSubmitting] = useState(false)
  const nameInputRef = useRef(null)

  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  async function handleSubmit() {
    const trimmed = nom.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await onSubmit({ nom: trimmed, couleur })
    } finally {
      setSubmitting(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--txt-3)' }}
        >
          Nouveau loueur
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annuler"
          className="p-0.5 rounded"
          style={{ color: 'var(--txt-3)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        ref={nameInputRef}
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Nom du loueur (ex. TSF, Panavision…)"
        className="w-full px-2 py-1 rounded-md text-xs focus:outline-none"
        style={{
          background: 'var(--bg-surf)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
        }}
      />

      <div className="mt-2">
        <span
          className="text-[10px] font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          Couleur
        </span>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {LOUEUR_COLOR_PRESETS.map((c) => {
            const selected = c === couleur
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCouleur(c)}
                aria-label={`Couleur ${c}`}
                title={c}
                className="rounded-full transition-all"
                style={{
                  width: '18px',
                  height: '18px',
                  background: c,
                  border: selected ? '2px solid var(--txt)' : '2px solid transparent',
                  boxShadow: selected ? '0 0 0 2px var(--bg-elev)' : 'none',
                }}
              />
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!nom.trim() || submitting}
        className="w-full mt-3 flex items-center justify-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md transition-all"
        style={{
          color: 'white',
          background: nom.trim() && !submitting ? 'var(--blue)' : 'var(--bg-hov)',
          cursor: nom.trim() && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        <Check className="w-3 h-3" />
        {submitting ? 'Création…' : 'Créer & ajouter'}
      </button>
    </div>
  )
}
