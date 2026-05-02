// ════════════════════════════════════════════════════════════════════════════
// AddMemberModal — Ajout d'une personne à la techlist (sans devis_line)
// ════════════════════════════════════════════════════════════════════════════
//
// Ouvre une modale qui :
//   1. ContactPicker pour rechercher un contact existant ou en créer un.
//   2. Pré-rempli la spécialité depuis contact.specialite (modifiable).
//   3. Sélection de la catégorie (PROD / TECHNIQUE / POST-PROD ou custom).
//   4. Crée 1 row projet_membres SANS devis_line_id (= ligne libre dans la
//      techlist).
//
// Convention : si on ajoute une personne déjà attribuée via le devis, l'admin
// peut faire "Ajouter membre" → la row libre s'ajoutera en plus, et le tri
// par persona dans la techlist regroupera les rows de la même personne.
//
// Usage :
//   <AddMemberModal
//     open={open}
//     onClose={...}
//     contacts={contacts}
//     categories={categories}
//     onCreateContact={addContact}
//     onAddMember={addMember}
//     defaultCategory="PRODUCTION"
//   />
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { X, UserPlus, AlertCircle } from 'lucide-react'
import ContactPicker from './ContactPicker'
import { DEFAULT_CATEGORIES } from '../../../lib/crew'
import { notify } from '../../../lib/notify'

export default function AddMemberModal({
  open,
  onClose,
  contacts = [],
  categories = DEFAULT_CATEGORIES,
  onCreateContact,
  onAddMember,
  // null = boîte "À trier" (default depuis P1.5).
  defaultCategory = null,
}) {
  const SENTINEL_UNCATEGORIZED = '__uncategorized__'
  const SENTINEL_CUSTOM = '__custom__'

  const [contact, setContact] = useState(null)
  const [specialite, setSpecialite] = useState('')
  // category est soit SENTINEL_UNCATEGORIZED, soit une catégorie standard,
  // soit SENTINEL_CUSTOM (pour saisie libre).
  const [category, setCategory] = useState(defaultCategory ?? SENTINEL_UNCATEGORIZED)
  const [customCategory, setCustomCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset à l'ouverture
  useEffect(() => {
    if (open) {
      setContact(null)
      setSpecialite('')
      setCategory(defaultCategory ?? SENTINEL_UNCATEGORIZED)
      setCustomCategory('')
      setSubmitting(false)
    }
  }, [open, defaultCategory])

  // Auto-fill spécialité quand on sélectionne un contact
  useEffect(() => {
    if (contact?.specialite && !specialite) {
      setSpecialite(contact.specialite)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact])

  if (!open) return null

  // Résolution de la catégorie finale :
  //   - SENTINEL_UNCATEGORIZED → null (boîte "À trier")
  //   - SENTINEL_CUSTOM        → customCategory.trim().toUpperCase()
  //   - sinon                  → la valeur sélectionnée
  let finalCategory = null
  if (category === SENTINEL_CUSTOM) {
    const c = customCategory.trim()
    finalCategory = c ? c.toUpperCase() : null
  } else if (category !== SENTINEL_UNCATEGORIZED) {
    finalCategory = category
  }

  // canSubmit : contact requis. Catégorie peut être null (= À trier).
  // Si l'utilisateur a sélectionné "Nouvelle catégorie" mais n'a rien tapé,
  // on bloque pour éviter une catégorie vide bizarre.
  const customSelected = category === SENTINEL_CUSTOM
  const customMissing = customSelected && !customCategory.trim()
  const canSubmit = Boolean(contact) && !customMissing && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onAddMember({
        contact_id: contact.id,
        category: finalCategory, // null = À trier
        specialite: specialite.trim() || null,
        regime: contact.regime || null,
      })
      notify.success(`${contact.prenom || ''} ${contact.nom || ''} ajouté(e)`.trim())
      onClose?.()
    } catch (err) {
      console.error('[AddMemberModal] add error:', err)
      notify.error('Ajout échoué : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-visible"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <UserPlus className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Ajouter à l&rsquo;équipe
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Tech list — sans ligne de devis
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Form */}
        <div className="flex-1 px-5 py-4 space-y-4">
          {/* Contact */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt-2)' }}>
              Contact
            </label>
            <ContactPicker
              contacts={contacts}
              value={contact}
              onChange={setContact}
              onCreate={onCreateContact}
              placeholder="Rechercher dans l'annuaire…"
              autoFocus
            />
            {contact && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                {contact.email && <div>📧 {contact.email}</div>}
                {contact.telephone && <div>📞 {contact.telephone}</div>}
                {contact.ville && <div>📍 {contact.ville}</div>}
              </div>
            )}
          </div>

          {/* Spécialité */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt-2)' }}>
              Spécialité (optionnel)
            </label>
            <input
              type="text"
              value={specialite}
              onChange={(e) => setSpecialite(e.target.value)}
              placeholder="Ex: Cadreur, JRI, Steadicam…"
              className="w-full text-sm px-2.5 py-1.5 rounded-md border outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </div>

          {/* Catégorie */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt-2)' }}>
              Catégorie
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            >
              <option value={SENTINEL_UNCATEGORIZED}>
                📥 À trier (boîte de réception)
              </option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={SENTINEL_CUSTOM}>+ Nouvelle catégorie…</option>
            </select>

            {customSelected && (
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Nom de la catégorie (ex: CASTING)"
                className="w-full mt-2 text-sm px-2.5 py-1.5 rounded-md outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            )}

            {category === SENTINEL_UNCATEGORIZED && (
              <p className="mt-1.5 text-[10px] italic" style={{ color: 'var(--txt-3)' }}>
                La personne arrivera dans la boîte « À trier » de la techlist.
                Vous pourrez la classer ensuite par drag & drop.
              </p>
            )}
          </div>

          {/* Hint si pas de contact */}
          {!contact && (
            <div
              className="flex items-start gap-2 text-[11px] rounded-md px-2.5 py-2"
              style={{
                background: 'var(--blue-bg)',
                color: 'var(--blue)',
                border: '1px solid var(--blue-brd)',
              }}
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                Tapez un nom pour créer un nouveau contact dans l&rsquo;annuaire
                de votre organisation, ou choisissez-en un existant.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-opacity"
            style={{
              background: 'var(--blue)',
              color: '#fff',
              border: '1px solid var(--blue)',
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (canSubmit) e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              if (canSubmit) e.currentTarget.style.opacity = '1'
            }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            {submitting ? 'Ajout…' : 'Ajouter'}
          </button>
        </footer>
      </div>
    </div>
  )
}
