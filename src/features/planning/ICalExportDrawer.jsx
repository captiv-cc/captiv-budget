/**
 * ICalExportDrawer — Panneau latéral "Exporter en iCal" (PL-8 v1).
 *
 * Sert les deux scopes de l'export iCal :
 *   - scope='project' : tokens du projet (partagés avec l'org). Le drawer
 *     est ouvert depuis la toolbar de PlanningTab.
 *   - scope='my'      : tokens personnels cross-projets (events où le user
 *     est assigné). Ouvert depuis le menu utilisateur / sidebar globale.
 *
 * Fonctionnalités identiques dans les deux cas :
 *   - Lister les liens actifs + révoqués (audit)
 *   - Créer un nouveau lien (label optionnel)
 *   - Copier l'URL (https://) ou l'URL webcal:// (Apple one-tap)
 *   - Révoquer / restaurer un lien
 *   - Afficher "dernier accès il y a X" pour détecter les liens dormants
 *
 * Props :
 *   - open           : boolean
 *   - onClose        : () => void
 *   - scope          : 'project' | 'my'                  (défaut : 'project')
 *   - projectId      : UUID du projet (scope='project')
 *   - projectTitle   : string informative (scope='project')
 *   - userId         : UUID du user (scope='my')
 *   - orgId          : UUID de l'org (nécessaire pour la création)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X, Link2, Copy, Trash2, RotateCcw, Plus, Check, Info, Clock,
} from 'lucide-react'
import {
  listIcalTokens,
  createIcalToken,
  revokeIcalToken,
  restoreIcalToken,
  buildFeedUrl,
} from '../../lib/icalTokens'
import { notify } from '../../lib/notify'

/* ─── Helpers formatage ─────────────────────────────────────────────────── */

function fmtRelative(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `il y a ${days} j`
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `le ${day}/${m}/${d.getFullYear()}`
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${m}/${d.getFullYear()}`
}


/* ─── Token row ─────────────────────────────────────────────────────────── */

function TokenRow({ token, justCreated, onRevoke, onRestore }) {
  const { httpsUrl, webcalUrl } = useMemo(() => buildFeedUrl(token.token), [token.token])
  const [copied, setCopied] = useState(null) // 'https' | 'webcal' | null
  const [busy, setBusy] = useState(false)
  const revoked = Boolean(token.revoked_at)

  const copyToClipboard = useCallback((which, text) => {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(which)
        setTimeout(() => setCopied(null), 1500)
      } catch {
        notify?.('Impossible de copier — copiez manuellement le lien', 'error')
      }
    }
    copy()
  }, [])

  async function handleRevoke() {
    try {
      setBusy(true)
      await onRevoke(token.id)
    } finally {
      setBusy(false)
    }
  }
  async function handleRestore() {
    try {
      setBusy(true)
      await onRestore(token.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: justCreated ? 'var(--blue-bg)' : 'var(--bg-elev)',
        border: `1px solid ${justCreated ? 'var(--blue)' : 'var(--brd)'}`,
        opacity: revoked ? 0.6 : 1,
      }}
    >
      {/* Label + meta */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            {token.label || `Lien iCal #${token.token.slice(0, 6)}`}
          </div>
          <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: 'var(--txt-3)' }}>
            <span>Créé {fmtDate(token.created_at)}</span>
            {token.last_accessed_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Consulté {fmtRelative(token.last_accessed_at)}
              </span>
            )}
            {revoked && (
              <span style={{ color: 'var(--red)' }}>• Révoqué {fmtRelative(token.revoked_at)}</span>
            )}
          </div>
        </div>
      </div>

      {/* URL actions — masquées pour les tokens révoqués (inutilisables) */}
      {!revoked && (
        <div className="flex flex-col gap-1.5">
          <div
            className="flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-mono"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            <Link2 className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
            <span className="truncate flex-1 min-w-0" style={{ color: 'var(--txt-2)' }} title={httpsUrl}>
              {httpsUrl}
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => copyToClipboard('https', httpsUrl)}
              className="flex-1 px-2 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5"
              style={{
                background: copied === 'https' ? 'var(--blue)' : 'var(--bg-surf)',
                color: copied === 'https' ? '#fff' : 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            >
              {copied === 'https' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'https' ? 'Copié' : 'Copier le lien'}
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard('webcal', webcalUrl)}
              className="px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{
                background: copied === 'webcal' ? 'var(--blue)' : 'var(--bg-surf)',
                color: copied === 'webcal' ? '#fff' : 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              title="Lien webcal:// pour abonnement direct (Apple Calendar)"
            >
              {copied === 'webcal' ? <Check className="w-3.5 h-3.5" /> : 'webcal://'}
            </button>
          </div>
        </div>
      )}

      {/* Révocation / restauration */}
      <div className="flex justify-end">
        {revoked ? (
          <button
            type="button"
            onClick={handleRestore}
            disabled={busy}
            className="text-xs px-2 py-1 rounded flex items-center gap-1 hover:bg-[var(--bg-hov)] disabled:opacity-50"
            style={{ color: 'var(--txt-3)' }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurer
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={busy}
            className="text-xs px-2 py-1 rounded flex items-center gap-1 hover:bg-[var(--red-bg)] disabled:opacity-50"
            style={{ color: 'var(--red)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Révoquer
          </button>
        )}
      </div>
    </div>
  )
}


/* ─── Drawer ────────────────────────────────────────────────────────────── */

export default function ICalExportDrawer({
  open,
  onClose,
  scope = 'project',
  projectId,
  projectTitle,
  userId,
  orgId,
}) {
  const isProject = scope === 'project'
  const scopeId = isProject ? projectId : userId

  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [justCreatedId, setJustCreatedId] = useState(null)

  const load = useCallback(async () => {
    if (!scopeId) return
    try {
      setLoading(true)
      const rows = await listIcalTokens({
        projectId: isProject ? scopeId : null,
        userId:    isProject ? null    : scopeId,
        includeRevoked: true,
      })
      setTokens(rows)
    } catch (err) {
      notify?.('Impossible de charger les liens iCal : ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [scopeId, isProject])

  useEffect(() => {
    if (open) {
      load()
      setJustCreatedId(null)
      setShowCreate(false)
      setNewLabel('')
    }
  }, [open, load])

  async function handleCreate(e) {
    e?.preventDefault?.()
    if (!orgId) {
      notify?.('Organisation introuvable — impossible de créer le lien', 'error')
      return
    }
    try {
      setCreating(true)
      const created = await createIcalToken({
        projectId: isProject ? scopeId : null,
        userId:    isProject ? null    : scopeId,
        orgId,
        label: newLabel || null,
      })
      setTokens((t) => [created, ...t])
      setJustCreatedId(created.id)
      setShowCreate(false)
      setNewLabel('')
      notify?.('Lien iCal créé — copie-le pour le partager', 'success')
    } catch (err) {
      notify?.('Création échouée : ' + err.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id) {
    try {
      await revokeIcalToken(id)
      setTokens((t) => t.map((tok) =>
        tok.id === id ? { ...tok, revoked_at: new Date().toISOString() } : tok,
      ))
    } catch (err) {
      notify?.('Révocation échouée : ' + err.message, 'error')
    }
  }

  async function handleRestore(id) {
    try {
      await restoreIcalToken(id)
      setTokens((t) => t.map((tok) =>
        tok.id === id ? { ...tok, revoked_at: null } : tok,
      ))
    } catch (err) {
      notify?.('Restauration échouée : ' + err.message, 'error')
    }
  }

  if (!open) return null

  const activeTokens = tokens.filter((t) => !t.revoked_at)
  const revokedTokens = tokens.filter((t) => t.revoked_at)

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.18)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Exporter en iCal"
        className="h-full w-full sm:max-w-md flex flex-col"
        style={{ background: 'var(--bg-surf)', borderLeft: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
              {isProject ? 'Exporter en iCal' : 'Mon planning iCal'}
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {isProject ? (projectTitle || 'Projet') : 'Tous mes événements'}
            </div>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info bloc */}
        <div
          className="px-4 py-3 text-xs flex items-start gap-2"
          style={{
            background: 'var(--blue-bg)',
            color: 'var(--blue)',
            borderBottom: '1px solid var(--brd)',
          }}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            {isProject ? (
              <>
                Un lien iCal permet à Google Calendar, Apple Calendar ou Outlook
                d'afficher les événements de ce projet dans un calendrier personnel.
                L'abonnement se met à jour automatiquement (lecture seule).
              </>
            ) : (
              <>
                Ce lien iCal expose tous les événements où tu es assigné, tous
                projets confondus. À ajouter dans Google Calendar, Apple Calendar
                ou Outlook pour retrouver ton planning dans ton calendrier habituel.
                L'abonnement se met à jour automatiquement (lecture seule).
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {loading && (
            <div className="text-center text-xs py-6" style={{ color: 'var(--txt-3)' }}>
              Chargement…
            </div>
          )}

          {!loading && activeTokens.length === 0 && !showCreate && (
            <div
              className="rounded-lg p-4 text-center text-xs"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
            >
              Aucun lien iCal actif pour ce projet.
            </div>
          )}

          {!loading && activeTokens.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              justCreated={t.id === justCreatedId}
              onRevoke={handleRevoke}
              onRestore={handleRestore}
            />
          ))}

          {/* Formulaire de création */}
          {showCreate && (
            <form
              onSubmit={handleCreate}
              className="rounded-lg p-3 flex flex-col gap-2"
              style={{ background: 'var(--bg-elev)', border: '1px dashed var(--brd)' }}
            >
              <label
                className="text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--txt-3)' }}
              >
                Libellé (optionnel)
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex : Équipe tournage, Client externe…"
                className="px-2 py-1.5 rounded text-sm"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setNewLabel('') }}
                  disabled={creating}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  {creating ? 'Création…' : 'Créer le lien'}
                </button>
              </div>
            </form>
          )}

          {/* Historique révoqué (replié visuellement) */}
          {revokedTokens.length > 0 && (
            <div className="mt-2">
              <div
                className="text-[11px] uppercase tracking-wide mb-2"
                style={{ color: 'var(--txt-3)' }}
              >
                Liens révoqués ({revokedTokens.length})
              </div>
              <div className="flex flex-col gap-2">
                {revokedTokens.map((t) => (
                  <TokenRow
                    key={t.id}
                    token={t}
                    justCreated={false}
                    onRevoke={handleRevoke}
                    onRestore={handleRestore}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer : CTA création */}
        {!showCreate && (
          <div
            className="px-4 py-3"
            style={{ borderTop: '1px solid var(--brd)' }}
          >
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              <Plus className="w-4 h-4" />
              Nouveau lien iCal
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
