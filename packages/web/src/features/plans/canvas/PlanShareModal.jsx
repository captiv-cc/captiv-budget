// ════════════════════════════════════════════════════════════════════════════
// PlanShareModal — partager un plan éditable (lien public token)
// ════════════════════════════════════════════════════════════════════════════
//
// Aligné sur la modale du module de partage des fichiers plans (PLANS-SHARE) :
// libellé interne par destinataire, expiration par date, liste des liens
// actifs (vues, copier / ouvrir / révoquer). Plusieurs liens actifs possibles
// (un par destinataire : client, régisseur, prestataire…).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, Loader2, Share2, X } from 'lucide-react'
import {
  listActiveShareTokens,
  createShareToken,
  revokeShareToken,
  publicPlanUrl,
} from '../../../lib/plansCanvasShare'
import { updateCanvas } from '../../../lib/plansCanvas'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'

export default function PlanShareModal({ canvas, onClose, onStatutChange }) {
  const { user } = useAuth()
  const [tokens, setTokens] = useState(null)
  const [label, setLabel] = useState('')
  const [permissions, setPermissions] = useState('comment')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    listActiveShareTokens(canvas.id)
      .then(setTokens)
      .catch(() => setTokens([]))
  }, [canvas.id])

  async function handleCreate() {
    if (busy) return
    setBusy(true)
    try {
      const row = await createShareToken({
        canvasId: canvas.id,
        label,
        permissions,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        userId: user?.id,
      })
      setTokens((prev) => [row, ...(prev || [])])
      setLabel('')
      setExpiresAt('')
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

  async function handleRevoke(row) {
    const ok = await confirm({
      title: 'Désactiver ce lien',
      message: `Le lien${row.label ? ` « ${row.label} »` : ''} ne fonctionnera plus pour son destinataire.`,
      confirmLabel: 'Désactiver',
      danger: true,
    })
    if (!ok) return
    try {
      await revokeShareToken(row.id)
      setTokens((prev) => prev.filter((t) => t.id !== row.id))
      notify.success('Lien désactivé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleCopy(row) {
    try {
      await navigator.clipboard.writeText(publicPlanUrl(row.token))
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(null), 1800)
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
        className="w-full max-w-lg rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', maxHeight: '85vh' }}
      >
        {/* En-tête */}
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Share2 className="w-4.5 h-4.5" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Partager le plan
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
              Lien public en lecture seule pour un destinataire externe (client, régisseur, prestataire…).
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4">
          {/* Nouveau lien */}
          <div className="rounded-xl p-4" style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}>
            <div className="text-[11px] font-bold tracking-wide mb-3" style={{ color: 'var(--blue)' }}>
              NOUVEAU LIEN
            </div>

            <label className="block mb-3">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                Libellé interne (optionnel)
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='Ex : "Client", "Régisseur Paul", "Équipe lumière"…'
                className="w-full text-sm px-3 py-2 rounded-md outline-none"
                style={{ ...fieldStyle, background: 'var(--bg-elev)' }}
              />
            </label>

            <label className="block mb-3">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                Le destinataire peut
              </span>
              <select
                value={permissions}
                onChange={(e) => setPermissions(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-md outline-none"
                style={{ ...fieldStyle, background: 'var(--bg-elev)' }}
              >
                <option value="comment">Consulter, commenter et valider</option>
                <option value="view">Consulter uniquement</option>
              </select>
            </label>

            <label className="block mb-4">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
                Expiration (optionnelle)
              </span>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full text-sm px-3 py-2 rounded-md outline-none"
                style={{ ...fieldStyle, background: 'var(--bg-elev)', colorScheme: 'dark' }}
              />
              <span className="block text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
                Vide = lien permanent (à utiliser avec parcimonie).
              </span>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-md"
                style={{ background: 'var(--blue)', color: '#fff', opacity: busy ? 0.6 : 1 }}
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Créer le lien
              </button>
            </div>
          </div>

          {/* Liens actifs */}
          <div>
            <div className="text-[11px] font-bold tracking-wide mb-2" style={{ color: 'var(--txt-3)' }}>
              ACTIFS ({tokens?.length ?? '…'})
            </div>
            {tokens === null ? (
              <div className="flex items-center gap-2 text-sm py-3" style={{ color: 'var(--txt-3)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Chargement…
              </div>
            ) : tokens.length === 0 ? (
              <div className="text-xs py-3" style={{ color: 'var(--txt-3)' }}>
                Aucun lien actif sur ce plan.
              </div>
            ) : (
              tokens.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 mb-2"
                  style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
                        {row.label || `Lien #${row.token.slice(0, 6)}`}
                      </span>
                      <span className="text-[10px] font-bold" style={{ color: 'var(--green, #00c875)' }}>
                        Actif
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                        · {row.permissions === 'comment' ? 'commentaires' : 'lecture seule'}
                        {row.expires_at &&
                          ` · expire le ${new Date(row.expires_at).toLocaleDateString('fr-FR')}`}
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                      {row.view_count > 0
                        ? `${row.view_count} vue${row.view_count > 1 ? 's' : ''}${
                            row.last_viewed_at
                              ? ` · dernière vue le ${new Date(row.last_viewed_at).toLocaleDateString('fr-FR')}`
                              : ''
                          }`
                        : 'Jamais consulté'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(row)}
                    className="p-1.5 rounded-md"
                    style={{ color: copiedId === row.id ? 'var(--green, #00c875)' : 'var(--txt-3)' }}
                    title="Copier le lien"
                  >
                    {copiedId === row.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={publicPlanUrl(row.token)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-md"
                    style={{ color: 'var(--txt-3)' }}
                    title="Ouvrir la page"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRevoke(row)}
                    className="p-1.5 rounded-md"
                    style={{ color: 'var(--txt-3)' }}
                    title="Désactiver le lien"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-4 py-2 rounded-md"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
