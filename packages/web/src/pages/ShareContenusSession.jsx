// ════════════════════════════════════════════════════════════════════════════
// ShareContenusSession — page publique /share/contenus/:token
// ════════════════════════════════════════════════════════════════════════════
//
// Deux usages sur la même page, selon le lien :
//   - photographes : lecture seule, sans mot de passe ;
//   - équipe du festival : écriture complète après mot de passe, chaque
//     action signée du prénom saisi (mémorisé pour ce lien).
//
// Aucun compte : c'est le token qui authentifie, le mot de passe qui ouvre
// l'écriture, et le prénom qui trace. Tout passe par des RPC — le serveur
// refuse une écriture venue d'un lien de lecture, quoi que fasse le client.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Images, Loader2, Lock, Plus, UserRound } from 'lucide-react'
import {
  fetchContenusShare,
  shareAddRef,
  shareCommentContenu,
  shareCreateContenu,
  shareDeleteContenu,
  shareUpdateContenu,
} from '../lib/contenusShare'
import {
  VOIR_TOUT,
  formatJourLabel,
  readContenuIdentity,
  refValues,
  writeContenuIdentity,
} from '../lib/contenus'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import ContenusTable from '../features/contenus/ContenusTable'
import { ContenuForm } from './tabs/ContenusTab'
import { confirm } from '../lib/confirm'
import { notify } from '../lib/notify'

const PWD_PREFIX = 'contenus.share.pwd.'
const NAME_PREFIX = 'contenus.share.prenom.'

export default function ShareContenusSession() {
  const { token } = useParams()

  // Mot de passe et prénom sont gardés PAR LIEN : plusieurs personnes du
  // festival ouvrent le même lien sur des postes différents.
  const [password, setPassword] = useState(
    () => sessionStorage.getItem(PWD_PREFIX + token) || null,
  )
  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(NAME_PREFIX + token) || '',
  )

  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [needPassword, setNeedPassword] = useState(false)
  const [adding, setAdding] = useState(false)
  // Lien de suivi : qui consulte ? Mémorisé par projet, comme l'identité
  // des pages logistique et déroulé.
  const [moi, setMoi] = useState(null)

  const [theme, setTheme] = useState(() =>
    localStorage.getItem(PROJECT_SHARE_THEME_KEY) === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    localStorage.setItem(PROJECT_SHARE_THEME_KEY, theme)
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  const load = useCallback(
    async (pwd) => {
      setLoading(true)
      try {
        const data = await fetchContenusShare(token, pwd ?? null)
        setPayload(data)
        setMoi(readContenuIdentity(data?.project?.id))
        setNeedPassword(false)
        setError(null)
      } catch (e) {
        // 28P01 = mot de passe requis ou erroné : on montre la porte plutôt
        // qu'un écran d'erreur.
        if (e?.code === '28P01') {
          setNeedPassword(true)
          sessionStorage.removeItem(PWD_PREFIX + token)
        } else {
          setError(e)
        }
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (token) load(password)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const canEdit = Boolean(payload?.share?.can_edit)
  const contenus = useMemo(() => payload?.contenus || [], [payload])
  const events = useMemo(() => payload?.events || [], [payload])
  const artistes = useMemo(() => payload?.artistes || [], [payload])
  const refs = useMemo(() => {
    const rows = payload?.refs || []
    return {
      espace: refValues(rows, 'espace'),
      photographe: refValues(rows, 'photographe'),
      suivi: refValues(rows, 'suivi'),
    }
  }, [payload])
  const jours = useMemo(
    () => (payload?.jours || []).map((d, i) => ({ date: d, label: formatJourLabel(d, i) })),
    [payload],
  )

  async function reload() {
    await load(password)
  }

  async function handlePatch(contenu, patch) {
    setPayload((prev) => ({
      ...prev,
      contenus: prev.contenus.map((c) => (c.id === contenu.id ? { ...c, ...patch } : c)),
    }))
    try {
      await shareUpdateContenu({
        token,
        password,
        contenuId: contenu.id,
        patch,
        authorName,
      })
      if (patch.statut && patch.statut !== contenu.statut) await reload()
    } catch (e) {
      notify.error('Enregistrement : ' + (e?.message || e))
      reload()
    }
  }

  async function handleDelete(contenu) {
    const ok = await confirm({
      title: 'Supprimer ce contenu ?',
      message: 'Il disparaîtra de la liste pour tout le monde.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await shareDeleteContenu({ token, password, contenuId: contenu.id })
      await reload()
    } catch (e) {
      notify.error('Suppression : ' + (e?.message || e))
    }
  }

  async function handleComment(contenu, text) {
    try {
      await shareCommentContenu({
        token,
        password,
        contenuId: contenu.id,
        body: text,
        authorName,
      })
      await reload()
    } catch (e) {
      notify.error('Commentaire : ' + (e?.message || e))
    }
  }

  async function handleCreate(fields) {
    try {
      await shareCreateContenu({ token, password, payload: fields, authorName })
      setAdding(false)
      await reload()
    } catch (e) {
      notify.error('Création : ' + (e?.message || e))
    }
  }

  async function handleCreateRef(kind, valeur) {
    try {
      await shareAddRef({ token, password, kind, valeur })
      await reload()
    } catch (e) {
      notify.error('Liste : ' + (e?.message || e))
    }
  }

  if (needPassword) {
    return (
      <PasswordGate
        onSubmit={async (pwd) => {
          sessionStorage.setItem(PWD_PREFIX + token, pwd)
          setPassword(pwd)
          await load(pwd)
        }}
      />
    )
  }

  if (loading) {
    return (
      <FullScreen icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}>
        Chargement des contenus…
      </FullScreen>
    )
  }

  if (error || !payload) return <ErrorState error={error} />

  // Le lien d'écriture exige un prénom : sans lui, plus rien n'est traçable.
  if (canEdit && !authorName.trim()) {
    return (
      <NameGate
        onSubmit={(name) => {
          localStorage.setItem(NAME_PREFIX + token, name)
          setAuthorName(name)
        }}
      />
    )
  }

  // Lien de suivi : on demande une fois qui consulte, pour lui montrer ses
  // contenus d'abord. « Voir tout » est mémorisé aussi, sinon la question
  // reviendrait à chaque visite.
  if (!canEdit && !moi && refs.photographe.length > 0) {
    return (
      <PhotographeGate
        photographes={refs.photographe}
        onPick={(nom) => {
          writeContenuIdentity(payload.project?.id, nom)
          setMoi(nom)
        }}
      />
    )
  }

  const mineName = !canEdit && moi && moi !== VOIR_TOUT ? moi : null

  const project = payload.project || {}
  const metaItems = []
  if (payload.share?.label) metaItems.push({ type: 'label', value: payload.share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  return (
    <div className="min-h-screen share-theme-transition" style={{ background: 'var(--bg)', color: 'var(--txt)' }}>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        <SharePageHeader
          pageTitle="Contenus"
          project={project}
          org={payload.org || null}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />

        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {canEdit
              ? 'Clique sur une valeur pour la modifier, sur la bulle 💬 pour commenter. Tout s’enregistre automatiquement.'
              : 'Suivi de validation des contenus. Lecture seule.'}
          </p>
          {!canEdit && moi && (
            <span className="text-xs ml-auto flex items-center gap-2" style={{ color: 'var(--txt-3)' }}>
              {moi === VOIR_TOUT ? 'Tous les contenus' : moi}
              <button
                type="button"
                onClick={() => {
                  writeContenuIdentity(payload.project?.id, null)
                  setMoi(null)
                }}
                style={{ color: 'var(--blue)' }}
              >
                changer
              </button>
            </span>
          )}
          {canEdit && (
            <span className="text-xs ml-auto flex items-center gap-2" style={{ color: 'var(--txt-3)' }}>
              Connecté : <strong style={{ color: 'var(--txt-2)' }}>{authorName}</strong>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(NAME_PREFIX + token)
                  setAuthorName('')
                }}
                style={{ color: 'var(--blue)' }}
              >
                changer
              </button>
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter un contenu
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-4">
            <ContenuForm
              refs={refs}
              jours={jours}
              artistes={artistes}
              onCancel={() => setAdding(false)}
              onSubmit={handleCreate}
              onCreateRef={handleCreateRef}
            />
          </div>
        )}

        <div className="mt-5">
          <ContenusTable
            contenus={contenus}
            events={events}
            canEdit={canEdit}
            refs={refs}
            jours={jours}
            artistes={artistes}
            onPatch={handlePatch}
            onDelete={handleDelete}
            onComment={handleComment}
            onCreateRef={handleCreateRef}
            mineName={mineName}
          />
        </div>

        <SharePageFooter />
      </div>
    </div>
  )
}

// ─── Portes d'entrée ────────────────────────────────────────────────────────

function PasswordGate({ onSubmit }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Centered icon={<Lock className="w-6 h-6" style={{ color: 'var(--blue)' }} />} title="Espace protégé">
      <p className="text-xs mb-3" style={{ color: 'var(--txt-3)' }}>
        Saisis le mot de passe communiqué par la production.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!value || busy) return
          setBusy(true)
          try {
            await onSubmit(value)
          } finally {
            setBusy(false)
          }
        }}
        className="flex gap-2"
      >
        <input
          type="password"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder="Mot de passe"
          className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
        />
        <button
          type="submit"
          disabled={!value || busy}
          className="text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          Entrer
        </button>
      </form>
    </Centered>
  )
}

function PhotographeGate({ photographes, onPick }) {
  return (
    <Centered
      icon={<UserRound className="w-6 h-6" style={{ color: 'var(--blue)' }} />}
      title="Qui es-tu ?"
    >
      <p className="text-xs mb-3" style={{ color: 'var(--txt-3)' }}>
        Tes contenus s&apos;afficheront en premier. Tu pourras toujours voir
        ceux de toute l&apos;équipe.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {photographes.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onPick(VOIR_TOUT)}
        className="text-[11px] font-semibold mt-3"
        style={{ color: 'var(--blue)' }}
      >
        Je ne suis pas dans la liste — voir tous les contenus
      </button>
    </Centered>
  )
}

function NameGate({ onSubmit }) {
  const [value, setValue] = useState('')
  return (
    <Centered icon={<UserRound className="w-6 h-6" style={{ color: 'var(--blue)' }} />} title="Qui es-tu ?">
      <p className="text-xs mb-3" style={{ color: 'var(--txt-3)' }}>
        Ton prénom apparaîtra à côté de tes ajouts et de tes validations.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder="Prénom"
          className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          Continuer
        </button>
      </form>
    </Centered>
  )
}

// ─── États ──────────────────────────────────────────────────────────────────

function Centered({ icon, title, children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-sm w-full p-6 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          {icon}
          <h1 className="text-base font-bold">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}

function FullScreen({ icon, children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="flex flex-col items-center gap-3">
        {icon}
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {children}
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  const msg = (error?.message || '').toLowerCase()
  const invalid = msg.includes('invalid') || msg.includes('expired')
  return (
    <Centered
      icon={<AlertCircle className="w-6 h-6" style={{ color: 'var(--red)' }} />}
      title={invalid ? 'Lien invalide' : 'Page inaccessible'}
    >
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        {invalid
          ? "Ce lien n'est plus valide. Il a peut-être été révoqué ou a expiré."
          : 'Impossible de charger les contenus pour le moment. Réessaie dans quelques instants.'}
      </p>
      <Images className="w-8 h-8 mt-4 mx-auto" style={{ color: 'var(--txt-3)', opacity: 0.3 }} />
    </Centered>
  )
}
