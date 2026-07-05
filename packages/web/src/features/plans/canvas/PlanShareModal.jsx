// ════════════════════════════════════════════════════════════════════════════
// PlanShareModal — partager un plan éditable au client (lien token)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Link2, Loader2, ShieldOff, X } from 'lucide-react'
import {
  getActiveShareToken,
  createShareToken,
  revokeShareToken,
  publicPlanUrl,
} from '../../../lib/plansCanvasShare'
import { updateCanvas } from '../../../lib/plansCanvas'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'

const VALIDITES = [
  { label: 'Sans expiration', days: null },
  { label: '7 jours', days: 7 },
  { label: '30 jours', days: 30 },
  { label: '90 jours', days: 90 },
]

export default function PlanShareModal({ canvas, onClose, onStatutChange }) {
  const { user } = useAuth()
  const [token, setToken] = useState(undefined) // undefined = chargement
  const [permissions, setPermissions] = useState('comment')
  const [expiresInDays, setExpiresInDays] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getActiveShareToken(canvas.id)
      .then(setToken)
      .catch(() => setToken(null))
  }, [canvas.id])

  async function handleCreate() {
    if (busy) return
    setBusy(true)
    try {
      const row = await createShareToken({
        canvasId: canvas.id,
        permissions,
        expiresInDays,
        userId: user?.id,
      })
      setToken(row)
      // Statut du plan : brouillon → partagé client.
      if (canvas.statut === 'brouillon') {
        await updateCanvas(canvas.id, { statut: 'partage_client', updated_by: user?.id })
        onStatutChange?.('partage_client')
      }
    } catch (err) {
      notify.error('Création du lien impossible : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke() {
    if (!token || busy) return
    setBusy(true)
    try {
      await revokeShareToken(token.id)
      setToken(null)
      notify.success('Lien désactivé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicPlanUrl(token.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      notify.error('Copie impossible')
    }
  }

  const fieldStyle = { background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Partager au client
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {token === undefined ? (
          <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--txt-3)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Chargement…
          </div>
        ) : token ? (
          <>
            <div className="text-xs mb-2" style={{ color: 'var(--txt-2)' }}>
              Lien actif — lecture seule{token.permissions === 'comment' ? ' + commentaires' : ''}
              {token.expires_at
                ? `, expire le ${new Date(token.expires_at).toLocaleDateString('fr-FR')}`
                : ''}
              {token.view_count > 0 && ` · consulté ${token.view_count} fois`}
            </div>
            <div className="flex items-center gap-1.5 mb-4">
              <div
                className="flex-1 text-[11px] px-2.5 py-2 rounded-md truncate"
                style={fieldStyle}
              >
                {publicPlanUrl(token.token)}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md shrink-0"
                style={{ background: 'var(--blue)', color: '#fff' }}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--red)' }}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              Désactiver ce lien
            </button>
          </>
        ) : (
          <>
            <label className="block mb-3">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                Le client peut
              </span>
              <select
                value={permissions}
                onChange={(e) => setPermissions(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-md outline-none"
                style={fieldStyle}
              >
                <option value="comment">Consulter et commenter</option>
                <option value="view">Consulter uniquement</option>
              </select>
            </label>
            <label className="block mb-5">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                Validité du lien
              </span>
              <select
                value={expiresInDays ?? ''}
                onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : null)}
                className="w-full text-sm px-3 py-2 rounded-md outline-none"
                style={fieldStyle}
              >
                {VALIDITES.map((v) => (
                  <option key={v.label} value={v.days ?? ''}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-md"
              style={{ background: 'var(--blue)', color: '#fff', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              Créer le lien client
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
