// ════════════════════════════════════════════════════════════════════════════
// MusiqueAutorShareModal — liens du portail RP autorisations (MUS-7 A3)
// ════════════════════════════════════════════════════════════════════════════
//
// Ouverte depuis « Partager aux RP » de l'onglet Autorisations. Un lien par
// destinataire (chargé de comm, RP festival) : le porteur du lien peut
// mettre à jour les statuts, contacts, docs et commenter — sans compte.
// Pattern aligné sur LogistiqueShareModal (sans config de sections).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  Copy,
  ExternalLink,
  Plus,
  Share2,
  Trash2,
  X,
  RotateCcw,
  Calendar,
} from 'lucide-react'
import { buildShareUrl, getShareTokenState } from '../../lib/musiqueAutorShare'
import { useMusiqueAutorShareTokens } from '../../hooks/useMusiqueAutorShareTokens'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function MusiqueAutorShareModal({ open, onClose, projectId }) {
  const { tokens, loading, create, revoke, restore, remove } =
    useMusiqueAutorShareTokens(open ? projectId : null)

  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  useEffect(() => {
    if (!open || loading) return
    setFormOpen(activeTokens.length === 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading])

  useEffect(() => {
    if (!open) {
      setLabel('')
      setExpiresAt('')
    }
  }, [open])

  if (!open) return null

  async function handleCreate() {
    if (creating) return
    setCreating(true)
    try {
      const newToken = await create({
        label: label.trim() || null,
        expiresAt: expiresAt ? `${expiresAt}T23:59:59` : null,
      })
      try {
        await navigator.clipboard.writeText(buildShareUrl(newToken.token))
        notify.success('Lien créé et copié dans le presse-papiers')
      } catch {
        notify.success('Lien créé')
      }
      setLabel('')
      setExpiresAt('')
      setFormOpen(false)
    } catch (err) {
      console.error('[MusiqueAutorShareModal] create', err)
      notify.error('Création échouée : ' + (err?.message || err))
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy(t) {
    try {
      await navigator.clipboard.writeText(buildShareUrl(t.token))
      notify.success('Lien copié')
    } catch {
      notify.error('Impossible de copier')
    }
  }

  function handleOpen(t) {
    window.open(buildShareUrl(t.token), '_blank', 'noopener,noreferrer')
  }

  async function handleRevoke(t) {
    const ok = await confirm({
      title: 'Révoquer ce lien',
      message: 'Le destinataire ne pourra plus accéder ni modifier le suivi.',
      confirmLabel: 'Révoquer',
      destructive: true,
    })
    if (!ok) return
    try {
      await revoke(t.id)
      notify.success('Lien révoqué')
    } catch (err) {
      notify.error('Révocation échouée : ' + (err?.message || err))
    }
  }

  async function handleRestore(t) {
    try {
      await restore(t.id)
      notify.success('Lien restauré')
    } catch (err) {
      notify.error('Restauration échouée : ' + (err?.message || err))
    }
  }

  async function handleDelete(t) {
    const ok = await confirm({
      title: 'Supprimer définitivement ce lien',
      message: 'Préférez « Révoquer » pour garder la trace.',
      confirmLabel: 'Supprimer',
      destructive: true,
    })
    if (!ok) return
    try {
      await remove(t.id)
      notify.success('Lien supprimé')
    } catch (err) {
      notify.error('Suppression échouée : ' + (err?.message || err))
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
        className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <header
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,110,55,0.12)' }}
          >
            <Share2 className="w-4 h-4" style={{ color: '#FF6E37' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Partager aux RP
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Le porteur du lien met à jour le suivi des autorisations — sans compte.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {formOpen ? (
            <div
              className="rounded-md p-3 space-y-3"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
            >
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#FF6E37' }}>
                Nouveau lien
              </p>
              <div>
                <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                  Destinataire (optionnel)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder='Ex : "Marie — comm festival"'
                  maxLength={80}
                  className="input text-sm h-9 w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                  Expiration (optionnelle)
                </label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="input text-sm h-9 flex-1"
                  />
                  {expiresAt && (
                    <button
                      type="button"
                      onClick={() => setExpiresAt('')}
                      className="text-[11px]"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      Effacer
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                {tokens.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    disabled={creating}
                    className="text-xs px-3 py-1.5 rounded-md"
                    style={{ background: 'transparent', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
                  >
                    Annuler
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="text-xs px-3 py-1.5 rounded-md font-semibold"
                  style={{ background: 'var(--blue)', color: '#fff', opacity: creating ? 0.6 : 1 }}
                >
                  {creating ? 'Création…' : 'Créer le lien'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="w-full text-sm py-2 rounded-md flex items-center justify-center gap-1.5"
              style={{ background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px dashed var(--blue-brd)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Nouveau lien RP
            </button>
          )}

          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </p>
            ) : (
              <>
                {activeTokens.length === 0 && otherTokens.length === 0 && (
                  <p className="text-xs text-center py-6 italic" style={{ color: 'var(--txt-3)' }}>
                    Aucun lien RP pour ce projet.
                  </p>
                )}
                {activeTokens.length > 0 && (
                  <Section title={`Actifs (${activeTokens.length})`}>
                    {activeTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        onCopy={() => handleCopy(t)}
                        onOpen={() => handleOpen(t)}
                        onRevoke={() => handleRevoke(t)}
                      />
                    ))}
                  </Section>
                )}
                {otherTokens.length > 0 && (
                  <Section title={`Révoqués / expirés (${otherTokens.length})`} muted>
                    {otherTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        muted
                        onCopy={() => handleCopy(t)}
                        onOpen={() => handleOpen(t)}
                        onRestore={() => handleRestore(t)}
                        onDelete={() => handleDelete(t)}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
          </div>
        </div>

        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md"
            style={{ background: 'transparent', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
          >
            Fermer
          </button>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, muted = false, children }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-widest font-bold mb-2"
        style={{ color: muted ? 'var(--txt-3)' : 'var(--txt-2)', opacity: muted ? 0.7 : 1 }}
      >
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TokenRow({ token, muted = false, onCopy, onOpen, onRevoke, onRestore, onDelete }) {
  const state = getShareTokenState(token)
  const stateLabels = {
    active: { text: 'Actif', color: 'var(--green)' },
    expired: { text: 'Expiré', color: 'var(--amber)' },
    revoked: { text: 'Révoqué', color: 'var(--red)' },
  }
  const stateMeta = stateLabels[state] || stateLabels.active
  const views = Number(token.view_count) || 0

  return (
    <div
      className="rounded-md px-3 py-2.5 flex items-center gap-3"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)', opacity: muted ? 0.7 : 1 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {token.label || `Lien #${(token.token || '').slice(0, 6)}`}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: `${stateMeta.color}1a`, color: stateMeta.color, fontWeight: 600 }}
          >
            {stateMeta.text}
          </span>
        </div>
        <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
          {views > 0 ? `${views} vue${views > 1 ? 's' : ''}` : 'Pas encore consulté'}
          {token.expires_at &&
            ' · expire ' + new Date(token.expires_at).toLocaleDateString('fr-FR')}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {state === 'active' && (
          <>
            <IconBtn title="Copier le lien" onClick={onCopy}>
              <Copy className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Ouvrir" onClick={onOpen}>
              <ExternalLink className="w-3.5 h-3.5" />
            </IconBtn>
            {onRevoke && (
              <IconBtn title="Révoquer" danger onClick={onRevoke}>
                <X className="w-3.5 h-3.5" />
              </IconBtn>
            )}
          </>
        )}
        {state !== 'active' && (
          <>
            {onRestore && state === 'revoked' && (
              <IconBtn title="Restaurer" onClick={onRestore}>
                <RotateCcw className="w-3.5 h-3.5" />
              </IconBtn>
            )}
            {onDelete && (
              <IconBtn title="Supprimer définitivement" danger onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1.5 rounded transition-colors"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = danger ? 'var(--red)' : 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-3)'
      }}
    >
      {children}
    </button>
  )
}
