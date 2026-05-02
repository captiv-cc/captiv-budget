// ════════════════════════════════════════════════════════════════════════════
// AddMemberModal — Ajout d'une personne à la techlist (sans devis_line)
// ════════════════════════════════════════════════════════════════════════════
//
// Deux modes (P1.6) :
//
//   1. ANNUAIRE (par défaut) : on choisit/crée un contact dans l'annuaire
//      org via ContactPicker. La row projet_membres pointe vers ce
//      contact_id. Le contact est réutilisable sur d'autres projets.
//
//   2. HORS ANNUAIRE (toggle "Pas dans l'annuaire") : on saisit prenom,
//      nom, email, téléphone directement, et on crée la row sans
//      contact_id. Les infos sont stockées sur projet_membres lui-même
//      (champs prenom/nom/email/telephone). Utile pour les renforts
//      ponctuels qu'on ne veut pas garder dans l'annuaire.
//
// Catégorie : si "À trier" sélectionnée, finalCategory = null. Sinon
// catégorie standard ou custom (saisie libre).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { X, UserPlus, AlertCircle, BookUser, UserX } from 'lucide-react'
import ContactPicker from './ContactPicker'
import { DEFAULT_CATEGORIES } from '../../../lib/crew'
import { notify } from '../../../lib/notify'

const SENTINEL_UNCATEGORIZED = '__uncategorized__'
const SENTINEL_CUSTOM = '__custom__'

export default function AddMemberModal({
  open,
  onClose,
  contacts = [],
  categories = DEFAULT_CATEGORIES,
  onCreateContact,
  onAddMember,
  defaultCategory = null,
}) {
  // Mode : 'annuaire' (default) ou 'adhoc' (hors annuaire)
  const [mode, setMode] = useState('annuaire')

  // ── Mode annuaire ──────────────────────────────────────────────────
  const [contact, setContact] = useState(null)

  // ── Mode hors annuaire ─────────────────────────────────────────────
  const [adhocPrenom, setAdhocPrenom] = useState('')
  const [adhocNom, setAdhocNom] = useState('')
  const [adhocEmail, setAdhocEmail] = useState('')
  const [adhocTelephone, setAdhocTelephone] = useState('')

  // ── Communs ────────────────────────────────────────────────────────
  const [specialite, setSpecialite] = useState('')
  const [category, setCategory] = useState(defaultCategory ?? SENTINEL_UNCATEGORIZED)
  const [customCategory, setCustomCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset à l'ouverture
  useEffect(() => {
    if (open) {
      setMode('annuaire')
      setContact(null)
      setAdhocPrenom('')
      setAdhocNom('')
      setAdhocEmail('')
      setAdhocTelephone('')
      setSpecialite('')
      setCategory(defaultCategory ?? SENTINEL_UNCATEGORIZED)
      setCustomCategory('')
      setSubmitting(false)
    }
  }, [open, defaultCategory])

  // Auto-fill spécialité depuis le contact (mode annuaire)
  useEffect(() => {
    if (mode === 'annuaire' && contact?.specialite && !specialite) {
      setSpecialite(contact.specialite)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, mode])

  if (!open) return null

  // Résolution catégorie finale
  let finalCategory = null
  if (category === SENTINEL_CUSTOM) {
    const c = customCategory.trim()
    finalCategory = c ? c.toUpperCase() : null
  } else if (category !== SENTINEL_UNCATEGORIZED) {
    finalCategory = category
  }

  const customSelected = category === SENTINEL_CUSTOM
  const customMissing = customSelected && !customCategory.trim()

  // canSubmit dépend du mode
  let canSubmit = false
  if (mode === 'annuaire') {
    canSubmit = Boolean(contact) && !customMissing && !submitting
  } else {
    // Mode adhoc : prénom OU nom requis (au moins l'un des deux)
    const hasName = Boolean(adhocPrenom.trim() || adhocNom.trim())
    canSubmit = hasName && !customMissing && !submitting
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      let payload
      let displayName
      if (mode === 'annuaire') {
        payload = {
          contact_id: contact.id,
          category: finalCategory,
          specialite: specialite.trim() || null,
          regime: contact.regime || null,
        }
        displayName = `${contact.prenom || ''} ${contact.nom || ''}`.trim()
      } else {
        payload = {
          // Pas de contact_id → row "ad-hoc"
          contact_id: null,
          category: finalCategory,
          specialite: specialite.trim() || null,
          // Infos sur la row directement
          prenom: adhocPrenom.trim() || null,
          nom: adhocNom.trim() || null,
          email: adhocEmail.trim().toLowerCase() || null,
          telephone: adhocTelephone.trim() || null,
        }
        displayName = `${adhocPrenom.trim()} ${adhocNom.trim()}`.trim()
      }
      await onAddMember(payload)
      notify.success(`${displayName} ajouté(e)`.trim())
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

        {/* Body */}
        <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto">
          {/* Toggle Mode annuaire / hors annuaire */}
          <div
            className="flex gap-1 p-1 rounded-lg"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
          >
            {[
              { k: 'annuaire', l: 'Depuis l\u2019annuaire', icon: BookUser },
              { k: 'adhoc', l: 'Hors annuaire', icon: UserX },
            ].map(({ k, l, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className="flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5"
                style={
                  mode === k
                    ? {
                        background: 'var(--bg-surf)',
                        color: 'var(--txt)',
                        boxShadow: '0 1px 3px rgba(0,0,0,.18)',
                      }
                    : {
                        color: 'var(--txt-3)',
                        background: 'transparent',
                      }
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {l}
              </button>
            ))}
          </div>

          {mode === 'annuaire' ? (
            <>
              {/* Contact */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{ color: 'var(--txt-2)' }}
                >
                  Contact
                </label>
                <ContactPicker
                  contacts={contacts}
                  value={contact}
                  onChange={setContact}
                  onCreate={onCreateContact}
                  placeholder="Rechercher dans l&rsquo;annuaire…"
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
            </>
          ) : (
            <>
              {/* Mode hors annuaire : saisie directe */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: 'var(--txt-2)' }}
                  >
                    Prénom
                  </label>
                  <input
                    type="text"
                    value={adhocPrenom}
                    onChange={(e) => setAdhocPrenom(e.target.value)}
                    placeholder="Hugo"
                    autoFocus
                    className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd)',
                      color: 'var(--txt)',
                    }}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: 'var(--txt-2)' }}
                  >
                    Nom
                  </label>
                  <input
                    type="text"
                    value={adhocNom}
                    onChange={(e) => setAdhocNom(e.target.value)}
                    placeholder="Martin"
                    className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd)',
                      color: 'var(--txt)',
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: 'var(--txt-2)' }}
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    value={adhocEmail}
                    onChange={(e) => setAdhocEmail(e.target.value)}
                    placeholder="hugo@example.fr"
                    className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd)',
                      color: 'var(--txt)',
                    }}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-semibold mb-1.5"
                    style={{ color: 'var(--txt-2)' }}
                  >
                    Téléphone
                  </label>
                  <input
                    type="tel"
                    value={adhocTelephone}
                    onChange={(e) => setAdhocTelephone(e.target.value)}
                    placeholder="06…"
                    className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd)',
                      color: 'var(--txt)',
                    }}
                  />
                </div>
              </div>

              <p className="text-[10px] italic" style={{ color: 'var(--txt-3)' }}>
                Cette personne ne sera pas ajoutée à l&rsquo;annuaire de
                l&rsquo;organisation. Pratique pour les renforts ponctuels.
              </p>
            </>
          )}

          {/* Poste (commun aux 2 modes) — stocké dans la colonne `specialite` */}
          <div>
            <label
              className="block text-xs font-semibold mb-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
              Poste (optionnel)
            </label>
            <input
              type="text"
              value={specialite}
              onChange={(e) => setSpecialite(e.target.value)}
              placeholder="Ex: Cadreur, JRI, Steadicam…"
              className="w-full text-sm px-2.5 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </div>

          {/* Catégorie */}
          <div>
            <label
              className="block text-xs font-semibold mb-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
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
              <p
                className="mt-1.5 text-[10px] italic"
                style={{ color: 'var(--txt-3)' }}
              >
                La personne arrivera dans la boîte « À trier » de la techlist.
                Vous pourrez la classer ensuite par drag & drop.
              </p>
            )}
          </div>

          {/* Hint contextuel */}
          {mode === 'annuaire' && !contact && (
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
