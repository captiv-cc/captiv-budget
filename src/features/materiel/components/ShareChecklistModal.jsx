// ════════════════════════════════════════════════════════════════════════════
// ShareChecklistModal — Gestion des tokens de partage checklist terrain (MAT-10L)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis le bouton "Essais" de MaterielHeader. Permet aux membres
// CAPTIV de :
//   1. Créer un nouveau lien `/check/:token` pour la version active (avec un
//      label libre et une expiration optionnelle).
//   2. Lister les liens actifs + révoqués de la version (avec date de création,
//      dernière utilisation, expiration).
//   3. Copier l'URL, révoquer / restaurer, renommer un token, le supprimer.
//
// Layout :
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  🔗 Partager la checklist terrain              ✕         │
//   │  V3 · Préparation tournage                               │
//   ├──────────────────────────────────────────────────────────┤
//   │  Créer un lien                                           │
//   │   Label : [Équipe caméra_____________________]           │
//   │   Expire : [Jamais ▼]                                    │
//   │   [+ Créer un lien]                                      │
//   ├──────────────────────────────────────────────────────────┤
//   │  Liens actifs (2)                                        │
//   │  ┌──────────────────────────────────────────────────┐    │
//   │  │ Équipe caméra · créé il y a 2h · jamais utilisé  │    │
//   │  │ https://captiv.cc/check/abc…xyz                   │    │
//   │  │ [Copier] [Ouvrir] [⋯ Révoquer / Renommer]         │    │
//   │  └──────────────────────────────────────────────────┘    │
//   │  Liens révoqués (1) — repliable                          │
//   └──────────────────────────────────────────────────────────┘
//
// Props :
//   - open          : boolean
//   - onClose       : () => void
//   - activeVersion : { id, numero, label } — requis pour créer/lister tokens
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import {
  buildCheckUrl,
  createCheckToken,
  listCheckTokens,
  renameCheckToken,
  restoreCheckToken,
  revokeCheckToken,
} from '../../../lib/matosCheckToken'
import { confirm, prompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

// Options d'expiration proposées dans le select.
// Chaque option calcule un ISO string au moment de la soumission.
const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Jamais', days: null },
  { value: '1d', label: '24 heures', days: 1 },
  { value: '3d', label: '3 jours', days: 3 },
  { value: '7d', label: '7 jours', days: 7 },
  { value: '30d', label: '30 jours', days: 30 },
]

export default function ShareChecklistModal({ open, onClose, activeVersion }) {
  const versionId = activeVersion?.id || null
  const versionLabel = activeVersion
    ? `V${activeVersion.numero}${activeVersion.label ? ' · ' + activeVersion.label : ''}`
    : ''

  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)

  // État du formulaire de création
  const [newLabel, setNewLabel] = useState('')
  const [newExpiry, setNewExpiry] = useState('never')
  const [creating, setCreating] = useState(false)

  // ─── Load tokens ────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!versionId) return
    setLoading(true)
    try {
      const list = await listCheckTokens({ versionId, includeRevoked: true })
      setTokens(list)
    } catch (err) {
      notify.error('Erreur chargement des liens : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [versionId])

  useEffect(() => {
    if (open && versionId) {
      reload()
    }
  }, [open, versionId, reload])

  // Reset création quand on rouvre
  useEffect(() => {
    if (open) {
      setNewLabel('')
      setNewExpiry('never')
      setShowRevoked(false)
    }
  }, [open])

  // Escape pour fermer
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ─── Actions ────────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e?.preventDefault?.()
    if (!versionId || creating) return
    setCreating(true)
    try {
      const opt = EXPIRY_OPTIONS.find((o) => o.value === newExpiry)
      const expiresAt = opt?.days
        ? new Date(Date.now() + opt.days * 86400000).toISOString()
        : null
      const created = await createCheckToken({
        versionId,
        label: newLabel,
        expiresAt,
      })
      setTokens((prev) => [created, ...prev])
      setNewLabel('')
      setNewExpiry('never')
      notify.success('Lien créé')
      // Copie auto dans le clipboard pour partage immédiat (UX mobile terrain)
      const url = buildCheckUrl(created.token)
      try {
        await navigator.clipboard?.writeText(url)
        notify.info('URL copiée dans le presse-papier')
      } catch {
        /* no-op — pas de clipboard disponible */
      }
    } catch (err) {
      notify.error('Erreur création : ' + (err?.message || err))
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = useCallback(async (token) => {
    const url = buildCheckUrl(token.token)
    try {
      await navigator.clipboard.writeText(url)
      notify.success('URL copiée')
    } catch (err) {
      notify.error('Copie impossible : ' + (err?.message || err))
    }
  }, [])

  const handleOpen = useCallback((token) => {
    const url = buildCheckUrl(token.token)
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const handleRevoke = useCallback(
    async (token) => {
      const ok = await confirm({
        title: 'Révoquer ce lien ?',
        message:
          'Les personnes qui utilisent ce lien perdront l\'accès immédiatement. Tu peux restaurer le lien plus tard si besoin.',
        confirmLabel: 'Révoquer',
        cancelLabel: 'Annuler',
        danger: true,
      })
      if (!ok) return
      try {
        await revokeCheckToken(token.id)
        setTokens((prev) =>
          prev.map((t) =>
            t.id === token.id ? { ...t, revoked_at: new Date().toISOString() } : t,
          ),
        )
        notify.success('Lien révoqué')
      } catch (err) {
        notify.error('Erreur révocation : ' + (err?.message || err))
      }
    },
    [],
  )

  const handleRestore = useCallback(async (token) => {
    try {
      await restoreCheckToken(token.id)
      setTokens((prev) =>
        prev.map((t) => (t.id === token.id ? { ...t, revoked_at: null } : t)),
      )
      notify.success('Lien restauré')
    } catch (err) {
      notify.error('Erreur restauration : ' + (err?.message || err))
    }
  }, [])

  const handleRename = useCallback(async (token) => {
    const next = await prompt({
      title: 'Renommer le lien',
      message: 'Ce label t\'aide à identifier le destinataire. Exemples : « Équipe caméra », « Loueur VDEF »…',
      placeholder: 'Ex. Équipe caméra',
      initialValue: token.label || '',
      confirmLabel: 'Renommer',
    })
    if (next === null) return // cancel
    try {
      await renameCheckToken(token.id, next)
      setTokens((prev) =>
        prev.map((t) => (t.id === token.id ? { ...t, label: next.trim() || null } : t)),
      )
      notify.success('Lien renommé')
    } catch (err) {
      notify.error('Erreur renommage : ' + (err?.message || err))
    }
  }, [])

  // ─── Partition active vs révoqués ──────────────────────────────────────
  const { activeTokens, revokedTokens } = useMemo(() => {
    const actives = []
    const revoked = []
    for (const t of tokens) {
      if (t.revoked_at) revoked.push(t)
      else actives.push(t)
    }
    return { activeTokens: actives, revokedTokens: revoked }
  }, [tokens])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Container */}
      <div
        className="fixed z-50 flex flex-col rounded-xl shadow-2xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(620px, 92vw)',
          maxHeight: '90vh',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-start gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Share2 className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Partager la checklist terrain
            </h2>
            {versionLabel && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
                {versionLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-all shrink-0"
            style={{ background: 'transparent', color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {/* Formulaire de création ──────────────────────────────────────── */}
          <form
            onSubmit={handleCreate}
            className="px-5 py-4 border-b"
            style={{ borderColor: 'var(--brd-sub)' }}
          >
            <h3
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: 'var(--txt-3)' }}
            >
              Créer un nouveau lien
            </h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex. Équipe caméra (facultatif)"
                className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
              <div className="relative">
                <select
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="appearance-none px-3 py-2 pr-8 rounded-md text-sm cursor-pointer"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                  }}
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Expire : {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--txt-3)' }}
                />
              </div>
              <button
                type="submit"
                disabled={creating || !versionId}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--blue)',
                  color: 'white',
                }}
                onMouseEnter={(e) => {
                  if (creating) return
                  e.currentTarget.style.opacity = '0.9'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Créer
              </button>
            </div>
          </form>

          {/* Liste des liens ────────────────────────────────────────────── */}
          <div className="px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
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
                {/* Actifs */}
                <h3
                  className="text-xs font-semibold uppercase tracking-wide mb-3 flex items-center gap-2"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Liens actifs
                  <span
                    className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold"
                    style={{
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-2)',
                    }}
                  >
                    {activeTokens.length}
                  </span>
                </h3>

                {activeTokens.length === 0 ? (
                  <EmptyHint />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeTokens.map((tk) => (
                      <TokenRow
                        key={tk.id}
                        token={tk}
                        onCopy={handleCopy}
                        onOpen={handleOpen}
                        onRename={handleRename}
                        onRevoke={handleRevoke}
                      />
                    ))}
                  </ul>
                )}

                {/* Révoqués (repliable) */}
                {revokedTokens.length > 0 && (
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => setShowRevoked((s) => !s)}
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide transition-all"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--txt-2)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--txt-3)'
                      }}
                    >
                      <ChevronDown
                        className="w-3.5 h-3.5 transition-transform"
                        style={{
                          transform: showRevoked ? 'rotate(0deg)' : 'rotate(-90deg)',
                        }}
                      />
                      Liens révoqués
                      <span
                        className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold"
                        style={{
                          background: 'var(--bg-elev)',
                          color: 'var(--txt-3)',
                        }}
                      >
                        {revokedTokens.length}
                      </span>
                    </button>

                    {showRevoked && (
                      <ul className="mt-3 flex flex-col gap-2">
                        {revokedTokens.map((tk) => (
                          <TokenRow
                            key={tk.id}
                            token={tk}
                            onCopy={handleCopy}
                            onOpen={handleOpen}
                            onRename={handleRename}
                            onRestore={handleRestore}
                            revoked
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyHint() {
  return (
    <div
      className="p-4 rounded-lg text-center"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--brd)',
      }}
    >
      <Link2
        className="w-5 h-5 mx-auto mb-2"
        style={{ color: 'var(--txt-3)' }}
      />
      <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
        Aucun lien actif pour cette version.
      </p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
        Crée un lien ci-dessus et partage-le par SMS / WhatsApp / email à l&apos;équipe.
      </p>
    </div>
  )
}

// ─── Ligne token ────────────────────────────────────────────────────────────

function TokenRow({
  token,
  onCopy,
  onOpen,
  onRename,
  onRevoke,
  onRestore,
  revoked = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const url = buildCheckUrl(token.token)

  const createdAgo = formatRelative(token.created_at)
  const lastAccessed = token.last_accessed_at
    ? `utilisé ${formatRelative(token.last_accessed_at)}`
    : 'jamais utilisé'
  const expiresInfo = formatExpiry(token.expires_at)

  // Ferme le menu sur click outside (listener global — léger ici)
  useEffect(() => {
    if (!menuOpen) return undefined
    function onDocClick() {
      setMenuOpen(false)
    }
    // defer pour ignorer le click qui vient d'ouvrir le menu
    const t = setTimeout(() => {
      document.addEventListener('click', onDocClick)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onDocClick)
    }
  }, [menuOpen])

  return (
    <li
      className="relative p-3 rounded-lg transition-all"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--brd)',
        opacity: revoked ? 0.6 : 1,
      }}
    >
      {/* Ligne 1 : label + meta */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-sm font-semibold truncate flex-1 min-w-0"
          style={{
            color: 'var(--txt)',
            textDecoration: revoked ? 'line-through' : 'none',
          }}
        >
          {token.label || 'Sans label'}
        </span>

        {/* Badges meta */}
        <span
          className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
          title={`Créé le ${formatDate(token.created_at)}`}
        >
          créé {createdAgo}
        </span>

        {expiresInfo && (
          <span
            className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{
              background: expiresInfo.expired ? 'var(--red-bg)' : 'var(--bg-elev)',
              color: expiresInfo.expired ? 'var(--red)' : 'var(--txt-3)',
            }}
            title={`Expire le ${formatDate(token.expires_at)}`}
          >
            <Clock className="w-2.5 h-2.5" />
            {expiresInfo.label}
          </span>
        )}
      </div>

      {/* URL */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded mb-2 font-mono text-[11px] truncate"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt-2)',
          border: '1px solid var(--brd-sub)',
        }}
        title={url}
      >
        <Link2 className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <span className="truncate">{url}</span>
      </div>

      {/* Actions + dernière utilisation */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--txt-3)' }}>
          {lastAccessed}
        </span>

        {!revoked && (
          <>
            <ActionButton
              onClick={() => onCopy(token)}
              icon={Copy}
              label="Copier"
              tone="primary"
            />
            <ActionButton
              onClick={() => onOpen(token)}
              icon={ExternalLink}
              label="Ouvrir"
            />
          </>
        )}

        {revoked && (
          <ActionButton
            onClick={() => onRestore(token)}
            icon={RotateCcw}
            label="Restaurer"
            tone="primary"
          />
        )}

        {/* Menu ⋯ */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((s) => !s)
            }}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
            style={{
              background: menuOpen ? 'var(--bg-hov)' : 'transparent',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }
            }}
            aria-label="Plus d'actions"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 z-10 min-w-[180px] py-1 rounded-md shadow-lg"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
            >
              <MenuItem
                icon={Pencil}
                label="Renommer"
                onClick={() => {
                  setMenuOpen(false)
                  onRename(token)
                }}
              />
              {!revoked && (
                <MenuItem
                  icon={Trash2}
                  label="Révoquer"
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    onRevoke(token)
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

// ─── Sous-composants UI ─────────────────────────────────────────────────────

function ActionButton({ onClick, icon: Icon, label, tone = 'default' }) {
  const isPrimary = tone === 'primary'
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all"
      style={{
        background: isPrimary ? 'var(--blue-bg)' : 'transparent',
        color: isPrimary ? 'var(--blue)' : 'var(--txt-2)',
        border: `1px solid ${isPrimary ? 'var(--blue)' : 'var(--brd)'}`,
      }}
      onMouseEnter={(e) => {
        if (isPrimary) {
          e.currentTarget.style.background = 'var(--blue)'
          e.currentTarget.style.color = 'white'
        } else {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--txt)'
        }
      }}
      onMouseLeave={(e) => {
        if (isPrimary) {
          e.currentTarget.style.background = 'var(--blue-bg)'
          e.currentTarget.style.color = 'var(--blue)'
        } else {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-2)'
        }
      }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all"
      style={{
        background: 'transparent',
        color: danger ? 'var(--red)' : 'var(--txt)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--red-bg)' : 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

// ─── Helpers date ───────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Format relatif court en français : "il y a 2 h", "il y a 3 j", etc.
 * Utilise Intl.RelativeTimeFormat pour rester localisé sans dépendance externe.
 */
function formatRelative(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then // ms
  const abs = Math.abs(diff)
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)

  try {
    const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' })
    if (abs < 60_000) return rtf.format(-sec, 'second')
    if (abs < 3_600_000) return rtf.format(-min, 'minute')
    if (abs < 86_400_000) return rtf.format(-hr, 'hour')
    return rtf.format(-day, 'day')
  } catch {
    return formatDate(iso)
  }
}

/**
 * Renvoie `{ label, expired }` pour un ISO d'expiration (ou null si pas d'expire).
 *   - expire dans 2 j → "dans 2 j", expired=false
 *   - expiré depuis 1 h → "expiré", expired=true
 */
function formatExpiry(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = then - Date.now()
  const expired = diff <= 0
  if (expired) return { label: 'expiré', expired: true }
  const day = Math.round(diff / 86_400_000)
  const hr = Math.round(diff / 3_600_000)
  try {
    const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' })
    if (diff < 3_600_000) {
      const min = Math.round(diff / 60_000)
      return { label: `expire ${rtf.format(min, 'minute')}`, expired: false }
    }
    if (diff < 86_400_000) {
      return { label: `expire ${rtf.format(hr, 'hour')}`, expired: false }
    }
    return { label: `expire ${rtf.format(day, 'day')}`, expired: false }
  } catch {
    return { label: 'expire', expired: false }
  }
}
