// ════════════════════════════════════════════════════════════════════════════
// ContenusShareModal — les deux liens du module Contenus
// ════════════════════════════════════════════════════════════════════════════
//
// Un lien de suivi pour les photographes (lecture, sans mot de passe) et un
// lien d'équipe pour le festival (écriture, mot de passe obligatoire).
// L'écriture sans mot de passe est refusée ici : le lien circule par message,
// il ouvrirait la création et la suppression à quiconque le reçoit.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, Link2, Loader2, Pencil, Trash2, X } from 'lucide-react'
import {
  buildContenusShareUrl,
  createContenusShareToken,
  deleteContenusShareToken,
  listContenusShareTokens,
  revokeContenusShareToken,
  setContenusSharePassword,
} from '../../lib/contenusShare'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function ContenusShareModal({ projectId, onClose }) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)

  const load = useCallback(async () => {
    try {
      setTokens(await listContenusShareTokens(projectId))
    } catch (err) {
      notify.error('Liens : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  async function createLecture() {
    setBusy(true)
    try {
      await createContenusShareToken({
        projectId,
        label: 'Suivi photographes',
        canEdit: false,
      })
      await load()
    } catch (err) {
      notify.error('Création : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function createEdition(password) {
    setBusy(true)
    try {
      await createContenusShareToken({
        projectId,
        label: 'Équipe festival',
        canEdit: true,
        password,
        passwordHint: 'Mot de passe communiqué par la production',
      })
      await load()
    } catch (err) {
      notify.error('Création : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function copy(token) {
    const url = buildContenusShareUrl(token.token)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(token.id)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      notify.error('Copie impossible — ' + url)
    }
  }

  async function revoke(token) {
    const ok = await confirm({
      title: 'Révoquer ce lien ?',
      message: 'Il cessera immédiatement de fonctionner pour tout le monde.',
      confirmLabel: 'Révoquer',
      danger: true,
    })
    if (!ok) return
    await revokeContenusShareToken(token.id)
    await load()
  }

  const lecture = tokens.filter((t) => !t.can_edit && !t.revoked_at)
  const edition = tokens.filter((t) => t.can_edit && !t.revoked_at)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <div
        className="relative w-full max-w-2xl rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        <header
          className="flex items-center gap-2.5 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <Link2 className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Partager les contenus
          </h2>
          <button type="button" onClick={onClose} className="ml-auto p-1.5" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5 [&>*]:shrink-0">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto my-6" style={{ color: 'var(--txt-3)' }} />
          ) : (
            <>
              <Section
                icon={<Eye className="w-3.5 h-3.5" />}
                title="Suivi photographes"
                desc="Lecture seule, sans mot de passe. Ils voient l'état de validation de leurs contenus."
                tokens={lecture}
                copied={copied}
                onCopy={copy}
                onRevoke={revoke}
                onCreate={createLecture}
                busy={busy}
              />
              <EditionSection
                tokens={edition}
                copied={copied}
                onCopy={copy}
                onRevoke={revoke}
                onCreate={createEdition}
                onResetPassword={async (t, pwd) => {
                  await setContenusSharePassword(t.id, pwd)
                  await load()
                  notify.success('Mot de passe mis à jour')
                }}
                busy={busy}
              />

              {tokens.some((t) => t.revoked_at) && (
                <details>
                  <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--txt-3)' }}>
                    Liens révoqués
                  </summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {tokens
                      .filter((t) => t.revoked_at)
                      .map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                          <span className="flex-1 truncate line-through">{t.label || t.token}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteContenusShareToken(t.id)
                              await load()
                            }}
                            style={{ color: 'var(--red, #ef4444)' }}
                            title="Supprimer définitivement"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ icon, title, desc, tokens, copied, onCopy, onRevoke, onCreate, busy }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: 'var(--txt-3)' }}>{icon}</span>
        <h3 className="text-xs font-bold" style={{ color: 'var(--txt)' }}>
          {title}
        </h3>
      </div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--txt-3)' }}>
        {desc}
      </p>
      {tokens.map((t) => (
        <TokenRow key={t.id} token={t} copied={copied} onCopy={onCopy} onRevoke={onRevoke} />
      ))}
      {tokens.length === 0 && (
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
          style={{ color: 'var(--txt-2)', border: '1px dashed var(--brd)' }}
        >
          Créer le lien
        </button>
      )}
    </section>
  )
}

function EditionSection({ tokens, copied, onCopy, onRevoke, onCreate, onResetPassword, busy }) {
  const [pwd, setPwd] = useState('')
  const [resetFor, setResetFor] = useState(null)

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        <h3 className="text-xs font-bold" style={{ color: 'var(--txt)' }}>
          Équipe festival
        </h3>
      </div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--txt-3)' }}>
        Ajout, modification, validation et suppression, derrière un mot de passe.
        Chaque action est signée du prénom saisi à l&apos;ouverture.
      </p>

      {tokens.map((t) => (
        <div key={t.id}>
          <TokenRow token={t} copied={copied} onCopy={onCopy} onRevoke={onRevoke} />
          {resetFor === t.id ? (
            <form
              className="flex gap-2 mt-1.5"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!pwd.trim()) return
                await onResetPassword(t, pwd.trim())
                setPwd('')
                setResetFor(null)
              }}
            >
              <input
                type="text"
                value={pwd}
                autoFocus
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Nouveau mot de passe"
                className="flex-1 text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
              />
              <button type="submit" className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: 'var(--blue)', color: '#fff' }}>
                Changer
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setResetFor(t.id)}
              className="text-[10px] mt-1"
              style={{ color: 'var(--blue)' }}
            >
              Changer le mot de passe
            </button>
          )}
        </div>
      ))}

      {tokens.length === 0 && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!pwd.trim()) return
            await onCreate(pwd.trim())
            setPwd('')
          }}
        >
          <input
            type="text"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Mot de passe du lien *"
            className="flex-1 text-xs px-2.5 py-2 rounded-lg outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
          <button
            type="submit"
            disabled={busy || !pwd.trim()}
            className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            Créer le lien
          </button>
        </form>
      )}
    </section>
  )
}

function TokenRow({ token, copied, onCopy, onRevoke }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: 'var(--txt-2)' }}>
        {buildContenusShareUrl(token.token)}
      </span>
      {token.view_count > 0 && (
        <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
          {token.view_count} vue{token.view_count > 1 ? 's' : ''}
        </span>
      )}
      <button type="button" onClick={() => onCopy(token)} className="p-1 shrink-0" style={{ color: 'var(--blue)' }} title="Copier">
        {copied === token.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={() => onRevoke(token)} className="p-1 shrink-0" style={{ color: 'var(--red, #ef4444)' }} title="Révoquer">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
