/**
 * RenduSession — Checklist terrain phase RENDU plein écran (MAT-13C)
 *
 * Pendant du fichier `CheckSession.jsx` mais scopé pour la phase rendu (retour
 * du matériel au loueur). Deux modes branchés via la prop `mode` :
 *   - `mode="token"` (défaut) → route publique `/rendu/:token`, anon avec
 *     prénom en localStorage. Le token doit être phase='rendu' côté BDD —
 *     sinon les RPC répondent SQLSTATE 42501.
 *   - `mode="authed"` → route privée `/projets/:id/materiel/rendu/:versionId?`
 *     réservée aux membres CAPTIV connectés. Identité = profiles.full_name.
 *
 * Le shell JSX (header, blocks list, cloture modale, bannière) est proche du
 * fichier essais, mais toutes les actions routent sur les hooks rendu et le
 * wording est adapté ("Bon de retour" au lieu de "Bilan", "Rendu clôturé" au
 * lieu de "Essais clôturés", etc.).
 *
 * Particularités MAT-13 :
 *   - Bannière d'alerte si `!session.version.closed_at` : "Les essais ne sont
 *     pas clôturés" — on laisse l'utilisateur continuer (pas de blocage hard)
 *     mais on prévient que l'état initial peut être incomplet.
 *   - Les composants sous-jacents (CheckBlockCard, LoueurFilterBar…) sont
 *     réutilisés tels quels : ils lisent directement `post_check_at` vs
 *     `pre_check_at` via la prop `phase` qu'on leur passera en MAT-13D (pour
 *     l'instant MAT-13C garde le même rendu qu'essais — la différenciation
 *     visuelle fine est le périmètre MAT-13D).
 *
 * Layout :
 *   ┌──────────────────────────────────────────────────┐
 *   │ [logo] Projet · Version · présence             ⚙ │  ← header sticky
 *   ├──────────────────────────────────────────────────┤
 *   │  [alerte essais non clos si applicable]          │
 *   │  <BlocksList>                                    │
 *   │                                                  │
 *   │  [CTA Clôturer le rendu]                         │
 *   └──────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Check,
  Download,
  FileSearch,
  Film,
  Lock,
  Loader2,
  MessageSquare,
  Moon,
  Sun,
  X,
} from 'lucide-react'
import { useRenduTokenSession } from '../hooks/useRenduTokenSession'
import { useRenduAuthedSession } from '../hooks/useRenduAuthedSession'
import { useCheckPresence } from '../hooks/useCheckPresence'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  filterItemsByBlock as filterItemsByBlockPure,
  computeProgressByBlock as computeProgressByBlockPure,
  computeLoueurCounts as computeLoueurCountsPure,
} from '../lib/matosCheckFilter'
import CheckBlockCard from '../features/materiel/components/check/CheckBlockCard'
import CheckDocsViewer from '../features/materiel/components/check/CheckDocsViewer'
import LoueurFilterBar from '../features/materiel/components/check/LoueurFilterBar'
import PresenceStack from '../features/materiel/components/check/PresenceStack'
import BonRetourExportModal from '../features/materiel/components/BonRetourExportModal'

export default function RenduSession({ mode = 'token' }) {
  if (mode === 'authed') {
    return <AuthedRenduSession />
  }
  return <TokenRenduSession />
}

/* ═══ Mode token (anon /rendu/:token) ═════════════════════════════════════ */

function TokenRenduSession() {
  const { token } = useParams()
  const tokenSession = useRenduTokenSession(token)

  // Presence live — channel keyed par version comme pour les essais, pour que
  // tous (essais + rendu + authed) apparaissent dans le même roster si des
  // sessions parallèles sont ouvertes. Pragma : on ne distingue pas phase='rendu'
  // dans la presence elle-même (c'est juste "qui est en ligne sur la version").
  const { users, currentKey } = useCheckPresence({
    versionId: tokenSession.session?.version?.id,
    userName: tokenSession.userName,
    enabled: Boolean(tokenSession.userName && tokenSession.session),
  })

  if (!token) return <Navigate to="/accueil" replace />

  return (
    <RenduSessionShell
      {...tokenSession}
      mode="token"
      presenceUsers={users}
      presenceCurrentKey={currentKey}
      requireName
    />
  )
}

/* ═══ Mode authed (/projets/:id/materiel/rendu/:versionId?) ═══════════════ */

function AuthedRenduSession() {
  const { id: projectId, versionId: paramVersionId } = useParams()
  const { profile, user } = useAuth()

  const userName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.email ||
    'Utilisateur'

  // Même pattern que AuthedCheckSession : si la route n'a pas de versionId,
  // on résout l'active version du projet via une requête directe matos_versions.
  const [resolvedVersionId, setResolvedVersionId] = useState(paramVersionId || null)
  const [resolveError, setResolveError] = useState(null)

  useEffect(() => {
    if (paramVersionId) {
      setResolvedVersionId(paramVersionId)
      return
    }
    if (!projectId) return
    let cancelled = false
    async function resolve() {
      setResolveError(null)
      try {
        const { data, error } = await supabase
          .from('matos_versions')
          .select('id')
          .eq('project_id', projectId)
          .eq('is_active', true)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setResolveError(error)
          return
        }
        if (!data?.id) {
          setResolveError(new Error('Aucune version active sur ce projet'))
          return
        }
        setResolvedVersionId(data.id)
      } catch (err) {
        if (!cancelled) setResolveError(err)
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [projectId, paramVersionId])

  const authedSession = useRenduAuthedSession(resolvedVersionId, { userName })

  const { users, currentKey } = useCheckPresence({
    versionId: resolvedVersionId,
    userName,
    enabled: Boolean(userName && authedSession.session),
  })

  if (!projectId) return <Navigate to="/accueil" replace />

  if (resolveError) {
    return <ErrorScreen error={resolveError} mode="authed" />
  }

  if (!resolvedVersionId) {
    return <LoadingScreen />
  }

  return (
    <RenduSessionShell
      {...authedSession}
      mode="authed"
      presenceUsers={users}
      presenceCurrentKey={currentKey}
      requireName={false}
    />
  )
}

/* ═══ Shell commun — header + body + modale clôture rendu ═════════════════ */

function RenduSessionShell({
  mode,
  loading,
  error,
  session,
  userName,
  setUserName,
  blocks,
  itemsByBlock,
  loueurs,
  loueursByItem,
  commentsByItem,
  commentsByBlock = new Map(),
  progressByBlock,
  attachments,
  photosByItem = new Map(),
  photosByBlock = new Map(),
  infosLogistiqueByLoueur = new Map(),
  actions,
  presenceUsers,
  presenceCurrentKey,
  requireName,
}) {
  const users = presenceUsers
  const currentKey = presenceCurrentKey

  // ─── Light/Dark toggle (cohérence MAT-10K) ────────────────────────────────
  const [checkTheme, setCheckTheme] = useState('dark')
  useEffect(() => {
    const root = document.documentElement
    if (checkTheme === 'light') {
      root.dataset.checkTheme = 'light'
    } else {
      delete root.dataset.checkTheme
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [checkTheme])

  // ─── Filtre loueur (MAT-10O, réutilisé) ──────────────────────────────────
  const [activeLoueurId, setActiveLoueurId] = useState(null)

  const filteredItemsByBlock = useMemo(
    () => filterItemsByBlockPure(itemsByBlock, loueursByItem, activeLoueurId),
    [activeLoueurId, itemsByBlock, loueursByItem],
  )

  // Progress filtrée : on calcule en phase='rendu' pour que les compteurs
  // reflètent post_check_at, pas pre_check_at. C'est la seule différence
  // fonctionnelle avec le shell essais.
  const filteredProgressByBlock = useMemo(() => {
    if (activeLoueurId === null) return progressByBlock
    return computeProgressByBlockPure(blocks, filteredItemsByBlock, { phase: 'rendu' })
  }, [activeLoueurId, blocks, filteredItemsByBlock, progressByBlock])

  const loueurCounts = useMemo(
    () => computeLoueurCountsPure(loueurs, itemsByBlock, loueursByItem),
    [loueurs, itemsByBlock, loueursByItem],
  )

  // ─── Clôture rendu ────────────────────────────────────────────────────────
  const [clotureOpen, setClotureOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState(null)
  const [lastPdf, setLastPdf] = useState(null) // { blob, url, filename, download, revoke }

  // MAT-13H : l'aperçu du bon-retour passe désormais par `BonRetourExportModal`
  // qui offre 3 modes (global / ZIP / un loueur) et génère les PDFs à la volée.
  // On remplace l'ancien preview inline (un seul PDF via `actions.preview()`)
  // par un simple flag d'ouverture de la modale — la modale gère elle-même
  // son propre état (building, errors, revocation des blob URLs).
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => () => lastPdf?.revoke?.(), [lastPdf])

  const handlePreviewBonRetour = useCallback(() => {
    if (!session) return
    setExportOpen(true)
  }, [session])

  async function handleConfirmCloture() {
    setClosing(true)
    setCloseError(null)
    try {
      const { pdf } = await actions.close(mode === 'token' ? { userName } : {})
      setLastPdf(pdf)
      setClotureOpen(false)
    } catch (err) {
      console.error('[RenduSession] clôture rendu :', err)
      setCloseError(err?.message || 'Échec de la clôture')
    } finally {
      setClosing(false)
    }
  }

  // ─── États d'erreur ──────────────────────────────────────────────────────
  if (error || (!loading && !session)) {
    return <ErrorScreen error={error} mode={mode} />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (requireName && !userName) {
    return <NamePrompt onSubmit={setUserName} session={session} />
  }

  const essaisClosed = Boolean(session?.version?.closed_at)
  const renduClosed = Boolean(session?.version?.rendu_closed_at)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--txt)' }}>
      <RenduHeader
        session={session}
        userName={userName}
        onEditName={requireName ? () => setUserName(null) : null}
        presenceUsers={users}
        presenceCurrentKey={currentKey}
        theme={checkTheme}
        onToggleTheme={() => setCheckTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        mode={mode}
      />

      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-3xl mx-auto">
          {/* MAT-13G — Feedback global : champ libre en tête de la checklist
              retour. Valeur persistée sur matos_versions.rendu_feedback et
              insérée en tête du PDF bon de retour. Éditable par tous (token
              phase='rendu' + authed) — pas de gate admin. Désactivé quand le
              rendu est clôturé (le champ reste visible en lecture seule pour
              montrer ce qui a été envoyé au loueur). */}
          <RenduFeedbackBanner
            scope="global"
            value={session?.version?.rendu_feedback ?? ''}
            onSave={actions.setRenduFeedback}
            disabled={renduClosed}
          />

          {/* MAT-13C — Alerte si essais pas clôturés. Purement informative :
              on laisse l'utilisateur avancer pour ne pas bloquer un cas réel
              (loueur qui arrive plus tôt, équipe qui a oublié de clôturer).
              La gate est côté UI admin (bouton Rendu désactivé dans le
              dropdown) — ici on prévient seulement. */}
          {!essaisClosed && !renduClosed && <EssaisNotClosedBanner />}

          {/* Bannière "Rendu clôturé" si déjà closed */}
          {renduClosed && <RenduClotureBanner version={session.version} lastPdf={lastPdf} />}

          <CheckDocsViewer attachments={attachments} />

          <LoueurFilterBar
            loueurs={loueurs}
            activeLoueurId={activeLoueurId}
            onChange={setActiveLoueurId}
            counts={loueurCounts}
          />

          {/* MAT-13G — Feedback par loueur : champ libre affiché uniquement
              quand on filtre un loueur. Il atterrit dans le PDF "Un seul
              loueur" + dans la section loueur du ZIP. Stocké dans
              matos_version_loueur_infos.rendu_feedback (upsert via RPC). */}
          {activeLoueurId && (
            <RenduFeedbackBanner
              scope="loueur"
              loueurName={loueurs.find((l) => l.id === activeLoueurId)?.nom}
              value={
                infosLogistiqueByLoueur.get(activeLoueurId)?.rendu_feedback ?? ''
              }
              onSave={(body) =>
                actions.setRenduFeedbackLoueur({ loueurId: activeLoueurId, body })
              }
              disabled={renduClosed}
            />
          )}

          {/* CTA clôture rendu — toujours visible si au moins 1 bloc */}
          {blocks.length > 0 && (
            <CloseRenduAction
              version={session?.version}
              onOpen={() => {
                setCloseError(null)
                setClotureOpen(true)
              }}
              onPreview={handlePreviewBonRetour}
            />
          )}

          {blocks.length === 0 ? (
            <EmptyBlocksState />
          ) : (
            (() => {
              const visibleBlocks = activeLoueurId === null
                ? blocks
                : blocks.filter((b) => (filteredItemsByBlock.get(b.id) || []).length > 0)

              if (visibleBlocks.length === 0) {
                return <EmptyFilteredState onReset={() => setActiveLoueurId(null)} />
              }

              return (
                <div className="space-y-4">
                  {visibleBlocks.map((b) => (
                    <CheckBlockCard
                      key={b.id}
                      block={b}
                      items={filteredItemsByBlock.get(b.id) || []}
                      progress={filteredProgressByBlock.get(b.id)}
                      commentsByItem={commentsByItem}
                      commentsByBlock={commentsByBlock}
                      loueursByItem={loueursByItem}
                      loueurs={loueurs}
                      photosByItem={photosByItem}
                      photosByBlock={photosByBlock}
                      userName={userName}
                      isAdmin={mode === 'authed'}
                      // MAT-13D — la card lit post_check_*, filtre les kinds
                      // rendu/retour, masque Photos pack + AddItemForm, fusionne
                      // les additifs avec les items de base. Les actions
                      // essais-only (addItem, setRemoved, deleteAdditif) sont
                      // absentes du hook rendu (undefined) → doublement ignorées
                      // côté UI via le garde `phase === 'rendu'`.
                      phase="rendu"
                      onToggleItem={actions.toggle}
                      onAddItem={actions.addItem}
                      onAddComment={actions.addComment}
                      onSetRemoved={actions.setRemoved}
                      onDeleteAdditif={actions.deleteAdditif}
                      onUploadPhoto={actions.uploadPhoto}
                      onDeletePhoto={actions.deletePhoto}
                      onUpdatePhotoCaption={actions.updatePhotoCaption}
                    />
                  ))}
                </div>
              )
            })()
          )}
        </div>
      </main>

      {/* Modale de confirmation clôture rendu */}
      {clotureOpen && (
        <ClotureRenduConfirmModal
          onConfirm={handleConfirmCloture}
          onCancel={() => setClotureOpen(false)}
          closing={closing}
          error={closeError}
          isAlreadyClosed={renduClosed}
          userName={userName}
        />
      )}

      {/* Modale export bon-retour (MAT-13H — remplace l'ancien PreviewPdfModal
          inline). 3 modes : global / ZIP / un loueur, miroir de MAT-22. */}
      <BonRetourExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        session={session}
      />
    </div>
  )
}

/* ═══ Sous-composants ═════════════════════════════════════════════════════ */

function LoadingScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex flex-col items-center gap-4">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: 'var(--blue)' }}
        />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Chargement de la checklist rendu…
        </p>
      </div>
    </div>
  )
}

function ErrorScreen({ error, mode = 'token' }) {
  if (error) {
    console.error('[RenduSession] erreur fetch session :', error)
  }

  const rawMessage =
    error?.message ||
    error?.details ||
    (typeof error === 'string' ? error : null)

  const pgCode = error?.code || error?.hint || null

  // MAT-13 : cas spécifique — token phase='essais' utilisé sur /rendu/:token.
  // La RPC renvoie SQLSTATE 42501 avec "phase mismatch". On déchiffre ça.
  const isPhaseMismatch = /phase mismatch|phase='essais'/i.test(rawMessage || '')

  const title = (() => {
    if (mode === 'token') {
      if (isPhaseMismatch) return 'Lien incorrect pour le rendu'
      return 'Lien invalide ou expiré'
    }
    if (pgCode === '42501' || /forbidden/i.test(rawMessage || '')) {
      return 'Accès refusé'
    }
    if (pgCode === '22023' || /introuvable/i.test(rawMessage || '')) {
      return 'Version introuvable'
    }
    return 'Impossible de charger la checklist rendu'
  })()

  const subtitle = (() => {
    if (mode === 'token') {
      if (isPhaseMismatch) {
        return "Ce lien est un lien de checklist essais, pas de rendu. Demandez un lien de rendu à la personne qui l'a partagé."
      }
      return "Ce lien de checklist rendu n'est plus actif. Demandez un nouveau lien à la personne qui vous l'a partagé."
    }
    if (pgCode === '42501' || /forbidden/i.test(rawMessage || '')) {
      return "Tu n'as pas le droit d'accéder au matériel de ce projet."
    }
    if (pgCode === '22023' || /introuvable/i.test(rawMessage || '')) {
      return "La version demandée n'existe pas ou a été supprimée."
    }
    return "Une erreur est survenue. Essaie de recharger la page."
  })()

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="max-w-md w-full p-6 rounded-2xl text-center"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        <AlertTriangle
          className="w-12 h-12 mx-auto mb-4"
          style={{ color: 'var(--orange)' }}
        />
        <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--txt)' }}>
          {title}
        </h1>
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {subtitle}
        </p>

        {mode === 'authed' && rawMessage && (
          <details className="mt-4 text-left">
            <summary
              className="text-xs cursor-pointer"
              style={{ color: 'var(--txt-3)' }}
            >
              Détail technique
            </summary>
            <pre
              className="mt-2 p-2 rounded text-[11px] whitespace-pre-wrap break-words"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--brd)',
                color: 'var(--txt-3)',
              }}
            >
{rawMessage}
{pgCode ? `\n(code: ${pgCode})` : ''}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

/**
 * NamePrompt — identique à CheckSession mais wording "rendu" pour l'en-tête.
 * On ne réexporte pas le composant CheckSession pour éviter un import circulaire
 * et garder chaque page autonome.
 */
function NamePrompt({ onSubmit, session }) {
  const [name, setName] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-w-md w-full p-6 rounded-2xl"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Film className="w-5 h-5" style={{ color: 'var(--blue)' }} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
              Checklist rendu
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
              {session?.project?.title || 'Projet'}
              {session?.version?.label ? ` — ${session.version.label}` : ''}
            </p>
          </div>
        </div>

        <label className="block text-sm mb-2" style={{ color: 'var(--txt)' }}>
          Votre prénom
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex. Camille"
          autoFocus
          className="w-full px-4 py-3 rounded-lg text-base"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
        <p className="text-xs mt-2" style={{ color: 'var(--txt-3)' }}>
          Apparaîtra à côté de chaque action.
        </p>

        <button
          type="submit"
          disabled={!name.trim()}
          className="w-full mt-5 px-4 py-3 rounded-lg text-sm font-medium disabled:opacity-40"
          style={{
            background: 'var(--acc)',
            color: '#000',
          }}
        >
          Commencer
        </button>
      </form>
    </div>
  )
}

/**
 * Header sticky : quasi identique à CheckHeader mais avec un sous-titre "Rendu"
 * pour que l'utilisateur distingue immédiatement s'il est sur essais ou rendu
 * (même version, phases différentes).
 */
function RenduHeader({
  session,
  userName,
  onEditName,
  presenceUsers = [],
  presenceCurrentKey = null,
  theme = 'dark',
  onToggleTheme,
  mode = 'token',
}) {
  const project = session?.project
  const version = session?.version
  const isLight = theme === 'light'
  return (
    <header
      className="sticky top-0 z-10 px-4 py-3 md:px-8 border-b"
      style={{
        background: 'var(--bg-surf)',
        borderColor: 'var(--brd)',
      }}
    >
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Film className="w-4 h-4" style={{ color: 'var(--blue)' }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            {project?.title || 'Projet'}
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
            {version
              ? `V${version.numero}${version.label ? ` · ${version.label}` : ''} · Rendu`
              : 'Rendu'}
          </p>
        </div>

        {presenceUsers.length > 0 && (
          <div className="shrink-0 hidden sm:flex items-center">
            <PresenceStack users={presenceUsers} currentKey={presenceCurrentKey} maxVisible={4} />
          </div>
        )}

        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isLight ? 'Passer en mode sombre' : 'Passer en mode clair'}
            title={isLight ? 'Passer en mode sombre' : 'Passer en mode clair'}
            className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        )}

        {onEditName ? (
          <button
            type="button"
            onClick={onEditName}
            className="shrink-0 text-xs px-3 py-1.5 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
            title="Changer de prénom"
          >
            {userName}
          </button>
        ) : (
          <span
            className="shrink-0 text-xs px-3 py-1.5 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
            title={mode === 'authed' ? 'Identifiant CAPTIV' : undefined}
          >
            {userName}
          </span>
        )}
      </div>

      {presenceUsers.length > 0 && (
        <div className="max-w-3xl mx-auto mt-2 flex sm:hidden items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
            En ligne
          </span>
          <PresenceStack users={presenceUsers} currentKey={presenceCurrentKey} maxVisible={5} />
        </div>
      )}
    </header>
  )
}

function EmptyBlocksState() {
  return (
    <div
      className="p-8 rounded-2xl text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        Cette version de matériel n&apos;a pas encore de blocs.
      </p>
      <p className="text-xs mt-2" style={{ color: 'var(--txt-3)' }}>
        Le matériel doit être créé en amont (onglet Matériel) avant de lancer le rendu.
      </p>
    </div>
  )
}

function EmptyFilteredState({ onReset }) {
  return (
    <div
      className="p-8 rounded-2xl text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        Aucun item pour ce loueur.
      </p>
      <p className="text-xs mt-2" style={{ color: 'var(--txt-3)' }}>
        Le filtre masque tous les blocs — change de loueur ou reviens à la liste globale.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex items-center px-4 py-2 rounded-md text-sm font-medium"
        style={{
          background: 'var(--blue)',
          color: '#fff',
        }}
      >
        Afficher tous les items
      </button>
    </div>
  )
}

/**
 * Bannière d'alerte "Essais non clôturés" — purement informative. On laisse
 * l'utilisateur continuer le rendu (cas légitime : loueur pressé, oubli de
 * clôture côté admin) mais on prévient que l'état de référence (pre_check_*)
 * n'est pas figé, donc que des modifs essais peuvent encore arriver et fausser
 * la comparaison rendu ↔ essais.
 */
function EssaisNotClosedBanner() {
  return (
    <div
      className="mb-4 p-3 rounded-xl flex items-start gap-3"
      style={{
        background: 'var(--orange-bg, #3a2a1a)',
        border: '1px solid var(--orange, #c87c28)',
      }}
    >
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--orange, #c87c28)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
          Les essais ne sont pas clôturés
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-2)' }}>
          Le rendu peut être lancé, mais l&apos;état initial du matériel peut
          encore évoluer côté essais. Demande à un admin de clôturer les essais
          avant de finaliser le rendu.
        </p>
      </div>
    </div>
  )
}

/**
 * Bannière "Rendu clôturé" — affichée si `version.rendu_closed_at`.
 * Offre un bouton de téléchargement direct du PDF bon-retour si on vient
 * de le générer (lastPdf en mémoire). Sinon le PDF est accessible via le
 * viewer docs (attachment "Bon de retour V{n}").
 */
function RenduClotureBanner({ version, lastPdf }) {
  const dateStr = (() => {
    try {
      return new Date(version.rendu_closed_at).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch {
      return ''
    }
  })()

  return (
    <div
      className="mb-4 p-3 rounded-xl flex items-center gap-3"
      style={{
        background: 'var(--blue-bg)',
        border: '1px solid var(--blue)',
      }}
    >
      <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--blue)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
          Rendu clôturé
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>
          {dateStr}
          {version.rendu_closed_by_name ? ` · par ${version.rendu_closed_by_name}` : ''}
        </p>
      </div>
      {lastPdf?.download && (
        <button
          type="button"
          onClick={() => lastPdf.download()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
          style={{
            background: 'var(--blue)',
            color: '#fff',
          }}
        >
          <Download className="w-3.5 h-3.5" />
          Télécharger
        </button>
      )}
    </div>
  )
}

/**
 * CTA "Clôturer le rendu" — équivalent CloseEssaisAction. Le bouton principal
 * reste visible même après clôture (ré-clôture = regénération du bon-retour).
 * Un bouton secondaire ouvre la modale d'export (MAT-13H : 3 modes).
 */
function CloseRenduAction({ version, onOpen, onPreview }) {
  const isClosed = Boolean(version?.rendu_closed_at)
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-colors"
        style={{
          background: isClosed ? 'var(--bg-surf)' : 'var(--acc)',
          color: isClosed ? 'var(--txt)' : '#000',
          border: isClosed ? '1px solid var(--brd)' : 'none',
        }}
      >
        {isClosed ? (
          <>
            <CheckCircle2 className="w-4 h-4" />
            Re-générer le bon de retour
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            Clôturer le rendu et générer le bon de retour
          </>
        )}
      </button>

      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--txt-2)',
            border: '1px solid var(--brd)',
          }}
        >
          <FileSearch className="w-4 h-4" />
          Aperçu et export du bon de retour
        </button>
      )}

      <p className="text-xs mt-2 text-center" style={{ color: 'var(--txt-3)' }}>
        {isClosed
          ? 'Met à jour le bon de retour archivé avec l\'état actuel.'
          : 'Génère un PDF synthétique du retour, archivé dans les documents du projet.'}
      </p>
    </div>
  )
}

/**
 * Modale de confirmation — miroir de ClotureConfirmModal essais. Le corps
 * décrit le pipeline rendu (PDF seul, pas de ZIP) et pointe vers la
 * ré-clôture comme mécanisme de correction.
 */
function ClotureRenduConfirmModal({ onConfirm, onCancel, closing, error, isAlreadyClosed, userName }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0, 0, 0, 0.6)' }}
      onClick={closing ? undefined : onCancel}
    >
      <div
        className="max-w-md w-full p-6 rounded-2xl"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--blue-bg)' }}
            >
              <Lock className="w-5 h-5" style={{ color: 'var(--blue)' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
              {isAlreadyClosed ? 'Re-générer le bon de retour ?' : 'Clôturer le rendu ?'}
            </h2>
          </div>
          {!closing && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Fermer"
              className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center"
              style={{ color: 'var(--txt-2)' }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="space-y-3 text-sm" style={{ color: 'var(--txt-2)' }}>
          <p>Cette action va&nbsp;:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>générer un <strong>PDF bon de retour</strong> synthétique (items rendus, signalements, photos retour)&nbsp;;</li>
            <li>l&apos;archiver dans les documents du projet&nbsp;;</li>
            <li>
              {isAlreadyClosed
                ? 'mettre à jour la date de clôture rendu avec l\'état actuel.'
                : 'marquer le rendu de cette version comme clôturé.'}
            </li>
          </ul>
          {!isAlreadyClosed && (
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Tu pourras re-clôturer à tout moment pour regénérer le PDF.
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Sera enregistré au nom de <strong>{userName || '—'}</strong>.
          </p>
        </div>

        {error && (
          <div
            className="mt-4 p-3 rounded-lg text-xs"
            style={{
              background: 'var(--red-bg, #3a1a1a)',
              color: 'var(--red, #f88)',
              border: '1px solid var(--red, #a33)',
            }}
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={closing}
            className="px-4 py-2 rounded-md text-sm disabled:opacity-40"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={closing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60"
            style={{
              background: 'var(--acc)',
              color: '#000',
            }}
          >
            {closing && <Loader2 className="w-4 h-4 animate-spin" />}
            {closing ? 'Clôture en cours…' : (isAlreadyClosed ? 'Re-générer' : 'Clôturer')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * MAT-13G — Bannière champ libre "Feedback rendu" au-dessus de la checklist.
 *
 * Deux scopes :
 *   - `scope="global"`   : stocké sur matos_versions.rendu_feedback
 *   - `scope="loueur"`   : stocké sur matos_version_loueur_infos.rendu_feedback
 *                           (upsert par loueur). `loueurName` est affiché en
 *                           sous-titre pour clarifier le scope.
 *
 * UX autosave :
 *   - état local `draft` synchronisé avec la prop `value` tant qu'on ne tape pas
 *   - debounce 1s après frappe → appel `onSave(draft)`
 *   - appel `onSave` aussi onBlur (pour que l'utilisateur qui quitte le champ
 *     n'attende pas le debounce)
 *   - indicateur "Enregistré" (Check vert 2s) après save OK
 *
 * Désactivé visuellement en lecture seule si `disabled` (ex : rendu clôturé).
 */
function RenduFeedbackBanner({ scope = 'global', loueurName = null, value, onSave, disabled }) {
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [errorMsg, setErrorMsg] = useState(null)
  const lastSavedRef = useRef(value ?? '')
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  // Sync externe → local si l'on reçoit une nouvelle valeur sans édition en cours.
  // On ne clobbe pas le draft tant que l'utilisateur tape (draft ≠ lastSaved).
  useEffect(() => {
    const next = value ?? ''
    if (next !== lastSavedRef.current && draft === lastSavedRef.current) {
      setDraft(next)
      lastSavedRef.current = next
    } else if (next !== lastSavedRef.current) {
      lastSavedRef.current = next
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = useCallback(
    async (body) => {
      if (body === lastSavedRef.current) return
      if (!onSave) return
      setSaving(true)
      setErrorMsg(null)
      try {
        await onSave(body)
        lastSavedRef.current = body
        setSavedAt(Date.now())
      } catch (err) {
        setErrorMsg(err?.message || 'Erreur lors de l’enregistrement')
      } finally {
        setSaving(false)
      }
    },
    [onSave],
  )

  // Hide "Enregistré" after 2s.
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(0), 2000)
    return () => clearTimeout(t)
  }, [savedAt])

  function handleChange(e) {
    const next = e.target.value
    setDraft(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      commit(next)
    }, 1000)
  }

  function handleBlur() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    commit(draft)
  }

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), [])

  const isLoueurScope = scope === 'loueur'
  const tint = isLoueurScope ? 'var(--purple, #a076d7)' : 'var(--orange, #c87c28)'
  const tintBg = isLoueurScope ? 'var(--purple-bg, #2a1a3a)' : 'var(--orange-bg, #3a2a1a)'

  return (
    <div
      className="mb-4 p-3 rounded-xl"
      style={{
        background: tintBg,
        border: `1px solid ${tint}`,
      }}
    >
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 shrink-0 mt-0.5" style={{ color: tint }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {isLoueurScope
                ? `Feedback loueur${loueurName ? ` · ${loueurName}` : ''}`
                : 'Feedback / instructions pour le bon de retour'}
            </p>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {saving && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Enregistrement…
                </>
              )}
              {!saving && savedAt > 0 && (
                <>
                  <Check className="w-3 h-3" style={{ color: 'var(--green, #4ade80)' }} />
                  Enregistré
                </>
              )}
            </span>
          </div>
          <p className="text-[11px] mt-0.5 mb-2" style={{ color: 'var(--txt-3)' }}>
            {isLoueurScope
              ? "Apparaît en tête du bon de retour dédié à ce loueur (export \"Un seul loueur\" ou section ZIP)."
              : "Apparaît en tête du PDF bon de retour global. Indications, feedbacks, remarques à transmettre."}
          </p>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={disabled}
            rows={3}
            placeholder={
              disabled
                ? 'Clôturé — lecture seule'
                : isLoueurScope
                  ? 'Ex: Pas de caution retenue, petite rayure signalée sur housse camera 1…'
                  : 'Ex: Retour échelonné : Arri lundi matin, TSF mardi AM. Caisses à rapporter dans les housses d’origine.'
            }
            className="w-full px-3 py-2 rounded-lg text-sm resize-y disabled:opacity-60"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
              minHeight: 72,
            }}
          />
          {errorMsg && (
            <p className="text-xs mt-1" style={{ color: 'var(--red, #f88)' }}>
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}


// MAT-13H : `PreviewPdfModal` supprimé — remplacé par BonRetourExportModal
// (3 modes global/ZIP/loueur), importé depuis features/materiel/components.
