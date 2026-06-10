// ════════════════════════════════════════════════════════════════════════════
// TechlistShareModal — Gestion des tokens de partage public techlist (P4.2C)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis le dropdown "Exporter" → "Lien web partageable" de
// la TechListView. Permet aux admins (canSeeCrew) de :
//   1. Créer un nouveau lien /share/equipe/:token avec label + scope + options
//   2. Lister les liens actifs + révoqués du projet
//   3. Copier l'URL, ouvrir, renommer, révoquer/restaurer, supprimer
//
// Form de création :
//   - Label libre (ex: "Régisseur Paul")
//   - Périmètre dropdown : "Tous lots" / "Lot · Principal" / "Lot · X"
//     (basé sur lotsWithRef ; en mono-lot, dropdown caché → toujours 'all')
//   - Toggle Coordonnées visibles (default on)
//   - Expiration optionnelle (date)
//
// Pattern aligné sur LivrableShareModal.jsx (LIV-24D).
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
  Eye,
  EyeOff,
} from 'lucide-react'
import { buildShareUrl, getShareTokenState } from '../../../lib/equipeShare'
import { useEquipeShareTokens } from '../../../hooks/useEquipeShareTokens'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

export default function TechlistShareModal({
  open,
  onClose,
  projectId,
  // Lots du projet (lotsWithRef de EquipeTab) — pour le dropdown de scope.
  // En mono-lot ou aucun lot, le dropdown n'est pas affiché et scope='all'
  // est forcé.
  lots = [],
  // Map { [lotId]: { title, color } } — pour afficher le dot de couleur.
  lotInfoMap = {},
}) {
  const { tokens, loading, create, revoke, restore, remove } = useEquipeShareTokens(
    open ? projectId : null,
  )

  // ─── Form state ────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState('all') // 'all' | lotId
  const [showSensitive, setShowSensitive] = useState(true)
  const [expiresAt, setExpiresAt] = useState('') // 'YYYY-MM-DD'

  // Pré-déplie le form au 1er coup si pas de token actif
  useEffect(() => {
    if (!open) return
    const hasActive = tokens.some((t) => getShareTokenState(t) === 'active')
    setFormOpen(!hasActive)
  }, [open, tokens])

  useEffect(() => {
    if (!open) {
      setLabel('')
      setScope('all')
      setShowSensitive(true)
      setExpiresAt('')
    }
  }, [open])

  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  if (!open) return null

  const isMultiLot = lots.length > 1

  async function handleCreate() {
    if (creating) return
    setCreating(true)
    try {
      const isLot = scope !== 'all'
      const expiresIso = expiresAt ? `${expiresAt}T23:59:59` : null
      const newToken = await create({
        label: label.trim() || null,
        scope: isLot ? 'lot' : 'all',
        lotId: isLot ? scope : null,
        showSensitive,
        expiresAt: expiresIso,
      })
      try {
        await navigator.clipboard.writeText(buildShareUrl(newToken.token))
        notify.success('Lien créé et copié dans le presse-papiers')
      } catch {
        notify.success('Lien créé')
      }
      setLabel('')
      setScope('all')
      setShowSensitive(true)
      setExpiresAt('')
      setFormOpen(false)
    } catch (err) {
      console.error('[TechlistShareModal] create error', err)
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
      message:
        'Le destinataire ne pourra plus accéder à la techlist. L\'historique de vues est conservé.',
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
      message: 'L\'historique de vues sera effacé. Préférez "Révoquer" pour garder la trace.',
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
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Share2 className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Partager la crew list
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Crée un lien public read-only pour un destinataire externe.
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
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ─── Form de création ──────────────────────────────────────── */}
          {formOpen ? (
            <CreateForm
              label={label}
              setLabel={setLabel}
              scope={scope}
              setScope={setScope}
              showSensitive={showSensitive}
              setShowSensitive={setShowSensitive}
              expiresAt={expiresAt}
              setExpiresAt={setExpiresAt}
              isMultiLot={isMultiLot}
              lots={lots}
              lotInfoMap={lotInfoMap}
              creating={creating}
              onCancel={() => setFormOpen(false)}
              onCreate={handleCreate}
              hasExistingTokens={tokens.length > 0}
            />
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="w-full text-sm py-2 rounded-md flex items-center justify-center gap-1.5 transition-colors"
              style={{
                background: 'var(--blue-bg)',
                color: 'var(--blue)',
                border: '1px dashed var(--blue-brd)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <Plus className="w-3.5 h-3.5" />
              Nouveau lien de partage
            </button>
          )}

          {/* ─── Liste des tokens ──────────────────────────────────────── */}
          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </p>
            ) : tokens.length === 0 ? (
              <p
                className="text-xs text-center py-6 italic"
                style={{ color: 'var(--txt-3)' }}
              >
                Aucun lien de partage pour ce projet.
              </p>
            ) : (
              <>
                {activeTokens.length > 0 && (
                  <Section title={`Actifs (${activeTokens.length})`}>
                    {activeTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        lots={lots}
                        lotInfoMap={lotInfoMap}
                        onCopy={() => handleCopy(t)}
                        onOpen={() => handleOpen(t)}
                        onRevoke={() => handleRevoke(t)}
                      />
                    ))}
                  </Section>
                )}
                {otherTokens.length > 0 && (
                  <Section
                    title={`Révoqués / expirés (${otherTokens.length})`}
                    muted
                  >
                    {otherTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        lots={lots}
                        lotInfoMap={lotInfoMap}
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

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Fermer
          </button>
        </footer>
      </div>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

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

function CreateForm({
  label,
  setLabel,
  scope,
  setScope,
  showSensitive,
  setShowSensitive,
  expiresAt,
  setExpiresAt,
  isMultiLot,
  lots,
  lotInfoMap,
  creating,
  onCancel,
  onCreate,
  hasExistingTokens,
}) {
  return (
    <div
      className="rounded-md p-3 space-y-3"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: 'var(--blue)' }}
      >
        Nouveau lien
      </p>

      {/* Label */}
      <div>
        <label
          className="block text-[11px] font-semibold mb-1"
          style={{ color: 'var(--txt-2)' }}
        >
          Libellé interne (optionnel)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='Ex: "Régisseur Paul", "Prod Renault"…'
          maxLength={80}
          className="input text-sm h-9 w-full"
        />
      </div>

      {/* Scope (multi-lot only) */}
      {isMultiLot && (
        <div>
          <label
            className="block text-[11px] font-semibold mb-1"
            style={{ color: 'var(--txt-2)' }}
          >
            Périmètre
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="input text-sm h-9 w-full"
          >
            <option value="all">Tous les lots</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                Lot · {l.title}
              </option>
            ))}
          </select>
          {scope !== 'all' && (
            <div
              className="mt-1.5 flex items-center gap-1.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    lotInfoMap[scope]?.color || 'var(--txt-3)',
                }}
              />
              <span>Filtrage strict — les attributions ad-hoc seront masquées.</span>
            </div>
          )}
        </div>
      )}

      {/* Toggle coordonnées */}
      <div>
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSensitive}
            onChange={(e) => setShowSensitive(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div
              className="text-[11px] font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
              {showSensitive ? (
                <Eye className="w-3 h-3" style={{ color: 'var(--blue)' }} />
              ) : (
                <EyeOff className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
              )}
              Afficher les coordonnées (téléphone + email)
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
              {showSensitive
                ? 'Le destinataire pourra contacter chaque membre directement.'
                : 'Mode anonyme : la techlist liste seulement les postes et noms.'}
            </div>
          </div>
        </label>
      </div>

      {/* Expiration */}
      <div>
        <label
          className="block text-[11px] font-semibold mb-1"
          style={{ color: 'var(--txt-2)' }}
        >
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
        <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          Vide = lien permanent (à utiliser avec parcimonie).
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {hasExistingTokens && (
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="text-xs px-3 py-1.5 rounded-md"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="text-xs px-3 py-1.5 rounded-md font-semibold"
          style={{
            background: 'var(--blue)',
            color: '#fff',
            opacity: creating ? 0.6 : 1,
            cursor: creating ? 'wait' : 'pointer',
          }}
        >
          {creating ? 'Création…' : 'Créer le lien'}
        </button>
      </div>
    </div>
  )
}

function TokenRow({
  token,
  lots,
  lotInfoMap,
  muted = false,
  onCopy,
  onOpen,
  onRevoke,
  onRestore,
  onDelete,
}) {
  const state = getShareTokenState(token)
  const lot = token.scope === 'lot' ? lots.find((l) => l.id === token.lot_id) : null
  const lotColor = lot ? lotInfoMap[lot.id]?.color : null
  const stateLabels = {
    active: { text: 'Actif', color: 'var(--green)' },
    expired: { text: 'Expiré', color: 'var(--amber)' },
    revoked: { text: 'Révoqué', color: 'var(--red)' },
  }
  const stateMeta = stateLabels[state] || stateLabels.active

  return (
    <div
      className="rounded-md px-3 py-2.5 flex items-center gap-3"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {token.label || `Lien #${(token.token || '').slice(0, 6)}`}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: `${stateMeta.color}1a`,
              color: stateMeta.color,
              fontWeight: 600,
            }}
          >
            {stateMeta.text}
          </span>
          {/* Scope */}
          {token.scope === 'all' ? (
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              · Tous lots
            </span>
          ) : lot ? (
            <span
              className="text-[10px] inline-flex items-center gap-1"
              style={{ color: lotColor || 'var(--txt-3)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: lotColor || 'var(--txt-3)' }}
              />
              {lot.title}
            </span>
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              · Lot supprimé
            </span>
          )}
          {!token.show_sensitive && (
            <span
              className="text-[10px] inline-flex items-center gap-0.5"
              style={{ color: 'var(--txt-3)' }}
              title="Coordonnées masquées"
            >
              <EyeOff className="w-2.5 h-2.5" />
              Anonyme
            </span>
          )}
        </div>
        <div
          className="text-[10px] mt-0.5 truncate"
          style={{ color: 'var(--txt-3)' }}
        >
          {token.view_count > 0
            ? `${token.view_count} vue${token.view_count > 1 ? 's' : ''}`
            : 'Pas encore consulté'}
          {token.last_accessed_at &&
            ' · dernière vue ' + formatRelativeDate(token.last_accessed_at)}
          {token.expires_at && ' · expire ' + formatDate(token.expires_at)}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {state === 'active' && (
          <>
            <IconBtn title="Copier le lien" onClick={onCopy}>
              <Copy className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Ouvrir" onClick={onOpen}>
              <ExternalLink className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Révoquer" danger onClick={onRevoke}>
              <X className="w-3.5 h-3.5" />
            </IconBtn>
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatRelativeDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 1) return "aujourd'hui"
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays} j`
  return `le ${formatDate(iso)}`
}
