/**
 * CheckSession — Checklist terrain plein écran (MAT-10D + MAT-14)
 *
 * Deux modes branchés via la prop `mode` :
 *   - `mode="token"` (défaut) → route publique `/check/:token`, anon avec
 *     prénom en localStorage, identité portée par le token jetable.
 *   - `mode="authed"` → route privée `/projets/:id/materiel/check/:versionId?`
 *     réservée aux membres CAPTIV connectés. Identité = profiles.full_name,
 *     aucun NamePrompt, aucun localStorage. Les actions passent par les RPC
 *     `check_*_authed` qui lisent auth.uid() côté serveur.
 *
 * Le shell JSX (header, blocks list, cloture modale, bannière) est commun.
 * Seules les sources de `session`/`actions`/`userName` changent.
 *
 * Layout :
 *   ┌──────────────────────────────────────────────────┐
 *   │ [logo] Projet · Version · présence             ⚙ │  ← header sticky
 *   ├──────────────────────────────────────────────────┤
 *   │                                                  │
 *   │   <BlocksList> (MAT-10E)                         │
 *   │                                                  │
 *   └──────────────────────────────────────────────────┘
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { Film, AlertTriangle, Loader2, Moon, Sun, CheckCircle2, FileSearch, Lock, Download, X } from 'lucide-react'
import { useCheckTokenSession } from '../hooks/useCheckTokenSession'
import { useCheckAuthedSession } from '../hooks/useCheckAuthedSession'
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

export default function CheckSession({ mode = 'token' }) {
  if (mode === 'authed') {
    return <AuthedCheckSession />
  }
  return <TokenCheckSession />
}

/* ═══ Mode token (anon /check/:token) ═════════════════════════════════════ */

function TokenCheckSession() {
  const { token } = useParams()
  const tokenSession = useCheckTokenSession(token)

  // Presence live — channel keyed par version (pas par token), pour que les
  // utilisateurs authenticated et les tokenisés apparaissent dans le même
  // roster. On attend donc que la session soit chargée (version.id dispo).
  const { users, currentKey } = useCheckPresence({
    versionId: tokenSession.session?.version?.id,
    userName: tokenSession.userName,
    enabled: Boolean(tokenSession.userName && tokenSession.session),
  })

  // Garde minimale : pas de token → retour accueil.
  if (!token) return <Navigate to="/accueil" replace />

  return (
    <CheckSessionShell
      {...tokenSession}
      mode="token"
      presenceUsers={users}
      presenceCurrentKey={currentKey}
      requireName
    />
  )
}

/* ═══ Mode authed (/projets/:id/materiel/check/:versionId?) ═══════════════ */

function AuthedCheckSession() {
  const { id: projectId, versionId: paramVersionId } = useParams()
  const { profile, user } = useAuth()

  // Nom d'affichage — identique au fallback utilisé par MaterielTab pour la
  // clôture admin. En dernier recours on tombe sur 'Utilisateur' pour éviter
  // un roster vide côté presence.
  const userName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.email ||
    'Utilisateur'

  // Si la route n'a pas de versionId, on résout l'active version du projet.
  // Pattern minimal : requête directe matos_versions + is_active=true. La
  // RLS côté can_read_outil filtre automatiquement.
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

  const authedSession = useCheckAuthedSession(resolvedVersionId, { userName })

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
    <CheckSessionShell
      {...authedSession}
      mode="authed"
      presenceUsers={users}
      presenceCurrentKey={currentKey}
      requireName={false}
    />
  )
}

/* ═══ Shell commun — header + body + modale clôture ═══════════════════════ */

function CheckSessionShell({
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
  progressByBlock,
  attachments,
  actions,
  presenceUsers,
  presenceCurrentKey,
  requireName,
}) {
  // Note : `users` et `currentKey` sont injectés par les wrappers Token/Authed
  // pour garder la logique presence dans le composant qui sait quel identifiant
  // (versionId) est stable dans son contexte.
  const users = presenceUsers
  const currentKey = presenceCurrentKey

  // ─── Light/Dark toggle (MAT-10K) ──────────────────────────────────────────
  // Décision Hugo 2026-04-22 : sombre par défaut, pas de persistance.
  // Le choix est donc purement en mémoire — reset à chaque rechargement.
  // On applique un data-attribute sur <html> (plutôt qu'une classe locale)
  // pour que les portals (modals, dropdowns, toasts) héritent aussi du thème.
  // Le cleanup au unmount retire l'attribut → l'app admin reste en dark.
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

  // ─── Filtre loueur (MAT-10O) ──────────────────────────────────────────────
  // `activeLoueurId === null` = mode "Tous", sinon = id d'un loueur sélectionné.
  // La sémantique "inclusive" (items du loueur + items sans loueur + additifs)
  // est implémentée dans le useMemo ci-dessous, volontairement côté client :
  //   - on a déjà tout le bundle en mémoire (RPC check_session_fetch)
  //   - recalculer le scope est ~O(items) et instantané à l'échelle d'une
  //     session de matos (quelques dizaines à centaines d'items max)
  //   - ça évite un aller-retour serveur et laisse le filtre ultra réactif
  const [activeLoueurId, setActiveLoueurId] = useState(null)

  // Items visibles par bloc après filtre. Helper pur (matosCheckFilter) pour
  // garder la logique testable et une sémantique "inclusive" (voir le module).
  const filteredItemsByBlock = useMemo(
    () => filterItemsByBlockPure(itemsByBlock, loueursByItem, activeLoueurId),
    [activeLoueurId, itemsByBlock, loueursByItem],
  )

  // Progression recalculée sur la slice filtrée, pour que la barre affiche
  // bien "3/5" quand on filtre un loueur, pas "3/42" du total global.
  const filteredProgressByBlock = useMemo(() => {
    if (activeLoueurId === null) return progressByBlock
    return computeProgressByBlockPure(blocks, filteredItemsByBlock)
  }, [activeLoueurId, blocks, filteredItemsByBlock, progressByBlock])

  // Compteurs par loueur pour les chips (total d'items non retirés sous ce
  // filtre). Facilite le choix sur le terrain : "TSF a 12 items à checker".
  const loueurCounts = useMemo(
    () => computeLoueurCountsPure(loueurs, itemsByBlock, loueursByItem),
    [loueurs, itemsByBlock, loueursByItem],
  )

  // ─── Clôture essais (MAT-12) ──────────────────────────────────────────────
  // État de la modale de confirmation + état de soumission. `closeError`
  // contient soit l'erreur côté upload, soit côté RPC — dans tous les cas on
  // l'affiche dans la modale et on laisse l'utilisateur re-tenter.
  const [clotureOpen, setClotureOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState(null)
  const [lastZip, setLastZip] = useState(null) // { blob, url, filename, download, revoke }

  // Aperçu bilan : state de soumission (bouton occupe un état "en cours" le
  // temps de la génération PDF/ZIP). Le blob est téléchargé directement puis
  // l'URL est révoquée sous 2s ; inutile de le garder en state.
  const [previewing, setPreviewing] = useState(false)

  // Libère l'URL Blob à l'unmount (pas besoin de la garder après la session).
  useEffect(() => () => lastZip?.revoke?.(), [lastZip])

  async function handlePreviewBilan() {
    if (previewing) return
    setPreviewing(true)
    try {
      const zip = await actions.preview()
      try {
        zip.download?.()
      } catch {
        /* no-op */
      }
      // Libère l'URL blob après 2s (le temps que le download démarre).
      setTimeout(() => {
        try {
          zip.revoke?.()
        } catch {
          /* no-op */
        }
      }, 2000)
    } catch (err) {
      console.error('[CheckSession] aperçu bilan :', err)
      // Pas de toast anon dispo ici — on affiche une alerte simple. Sur le
      // chemin admin (MaterielTab), notify.error gère le feedback.
      alert('Échec de l\'aperçu : ' + (err?.message || err))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleConfirmCloture() {
    setClosing(true)
    setCloseError(null)
    try {
      const { zip } = await actions.close({})
      setLastZip(zip)
      setClotureOpen(false)
    } catch (err) {
      console.error('[CheckSession] clôture :', err)
      setCloseError(err?.message || 'Échec de la clôture')
    } finally {
      setClosing(false)
    }
  }

  // ─── États d'erreur ────────────────────────────────────────────────────
  // Token inconnu / révoqué / expiré OU version introuvable / accès refusé :
  // la RPC renvoie null ou une erreur.
  if (error || (!loading && !session)) {
    return <ErrorScreen error={error} mode={mode} />
  }

  // ─── Loader initial ────────────────────────────────────────────────────
  if (loading) {
    return <LoadingScreen />
  }

  // ─── Prompt nom (mode token uniquement) ────────────────────────────────
  // En mode authed l'identité vient de profiles.full_name côté contexte Auth,
  // aucun prompt n'est jamais affiché.
  if (requireName && !userName) {
    return <NamePrompt onSubmit={setUserName} session={session} />
  }

  // ─── Vue principale (session active + user nommé) ──────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--txt)' }}>
      <CheckHeader
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
          {/* MAT-12 — Bannière "Essais clôturés" + lien archive bilan */}
          {session?.version?.closed_at && (
            <ClotureBanner version={session.version} lastZip={lastZip} />
          )}

          <CheckDocsViewer attachments={attachments} />

          {/* MAT-10O — Barre de filtre par loueur. Auto-masquée si <2 loueurs. */}
          <LoueurFilterBar
            loueurs={loueurs}
            activeLoueurId={activeLoueurId}
            onChange={setActiveLoueurId}
            counts={loueurCounts}
          />

          {/* Bouton Clôturer (+ Aperçu) — toujours visible si au moins 1 bloc */}
          {blocks.length > 0 && (
            <CloseEssaisAction
              version={session?.version}
              onOpen={() => {
                setCloseError(null)
                setClotureOpen(true)
              }}
              onPreview={handlePreviewBilan}
              previewing={previewing}
            />
          )}

          {blocks.length === 0 ? (
            <EmptyBlocksState />
          ) : (
            (() => {
              // En mode filtré, on masque les blocs qui deviennent vides
              // (aucun item ne passe le filtre) pour ne pas afficher une
              // cascade de cartes avec "Aucun item dans ce bloc".
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
                      loueursByItem={loueursByItem}
                      onToggleItem={actions.toggle}
                      onAddItem={actions.addItem}
                      onAddComment={actions.addComment}
                      onSetRemoved={actions.setRemoved}
                      onDeleteAdditif={actions.deleteAdditif}
                    />
                  ))}
                </div>
              )
            })()
          )}
        </div>
      </main>

      {/* MAT-12 — Modale de confirmation de clôture */}
      {clotureOpen && (
        <ClotureConfirmModal
          onConfirm={handleConfirmCloture}
          onCancel={() => setClotureOpen(false)}
          closing={closing}
          error={closeError}
          isAlreadyClosed={Boolean(session?.version?.closed_at)}
          userName={userName}
        />
      )}
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
          Chargement de la checklist…
        </p>
      </div>
    </div>
  )
}

function ErrorScreen({ error, mode = 'token' }) {
  // On distingue deux grandes familles :
  //  - Token mort : token inconnu / révoqué / expiré (RPC renvoie null)
  //  - Erreur authed : version introuvable / accès refusé / migration absente…
  //    → on affiche le vrai message d'erreur pour permettre le diagnostic,
  //    plutôt que "lien expiré" qui n'a aucun sens dans ce mode.
  if (error) {
    console.error('[CheckSession] erreur fetch session :', error)
  }

  const rawMessage =
    error?.message ||
    error?.details ||
    (typeof error === 'string' ? error : null)

  // Extraction du code Postgres si présent (42501 = forbidden, 28000 = not
  // authenticated, 22023 = introuvable). Permet un message plus parlant même
  // sans devtools ouverts.
  const pgCode = error?.code || error?.hint || null

  const title = (() => {
    if (mode === 'token') return 'Lien invalide ou expiré'
    if (pgCode === '42501' || /forbidden/i.test(rawMessage || '')) {
      return 'Accès refusé'
    }
    if (pgCode === '22023' || /introuvable/i.test(rawMessage || '')) {
      return 'Version introuvable'
    }
    return 'Impossible de charger la checklist'
  })()

  const subtitle = (() => {
    if (mode === 'token') {
      return "Ce lien de checklist n'est plus actif. Demandez un nouveau lien à la personne qui vous l'a partagé."
    }
    if (pgCode === '42501' || /forbidden/i.test(rawMessage || '')) {
      return "Tu n'as pas le droit d'accéder au matériel de ce projet. Demande à un administrateur de te donner l'accès à l'outil « Matériel »."
    }
    if (pgCode === '22023' || /introuvable/i.test(rawMessage || '')) {
      return "La version demandée n'existe pas ou a été supprimée. Reviens à l'onglet Matériel du projet."
    }
    return 'Une erreur est survenue en tentant de charger la session. Essaie de recharger la page.'
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

        {/* En mode authed, on expose le message technique brut pour faciliter
            le diagnostic côté admin (migration, perm, etc.) sans exiger
            l'ouverture de la console. Volontairement masqué en mode token
            pour ne pas fuiter de détails aux utilisateurs externes. */}
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
 * NamePrompt — écran plein écran, obligatoire avant de toucher à la checklist.
 * Le nom permet de tracer qui coche/commente quoi ("Validé par Camille").
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
              Checklist essais
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
              {/* La RPC renvoie `title` (alias de projects.title), pas `nom`. */}
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
          Apparaîtra à côté de chaque action (&laquo; coché par Camille &raquo;).
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
 * Header sticky : logo + projet/version + présence live + identité.
 * La presence (MAT-10H) affiche les pills des prénoms connectés en direct à
 * côté du bouton d'identité. Sur mobile, on garde tout sur une seule ligne
 * en tronquant le nom du projet en priorité.
 */
function CheckHeader({
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
            {/* RPC `check_session_fetch` renvoie `project.title`, jamais `nom`. */}
            {project?.title || 'Projet'}
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
            {version ? `V${version.numero}${version.label ? ` · ${version.label}` : ''}` : 'Version'}
          </p>
        </div>

        {/* Presence pills — s'efface si aucun roster (hook désactivé / chargement) */}
        {presenceUsers.length > 0 && (
          <div className="shrink-0 hidden sm:flex items-center">
            <PresenceStack users={presenceUsers} currentKey={presenceCurrentKey} maxVisible={4} />
          </div>
        )}

        {/* Toggle light/dark (MAT-10K) — pas de persistance : reset dark au
            rechargement, décidé avec Hugo. L'icône reflète le thème VERS lequel
            on bascule (soleil en mode sombre, lune en mode clair). */}
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

        {/* En mode authed, l'identité vient de l'auth Supabase — pas de bouton
            cliquable pour la modifier. On garde un simple label visuel. */}
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

      {/* Presence mobile : seconde ligne pour ne pas étrangler le header */}
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
        Demandez à la production d&apos;ajouter du matériel avant de lancer les essais.
      </p>
    </div>
  )
}

/**
 * Bouton "Clôturer les essais" — dernière action du flow terrain.
 *
 * Visible en permanence (même si déjà clôturée : "Re-générer le bilan").
 * Un bouton secondaire "Aperçu bilan" permet de télécharger le ZIP sans
 * clôturer (aucune écriture serveur, juste une génération locale) — utile
 * pour vérifier qu'il ne manque rien avant de geler la version.
 *
 * La génération du ZIP + upload + RPC est pilotée par la modale
 * ClotureConfirmModal pour que l'utilisateur ait une étape de confirmation.
 */
function CloseEssaisAction({ version, onOpen, onPreview, previewing }) {
  const isClosed = Boolean(version?.closed_at)
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
            Re-générer le bilan
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            Clôturer les essais et générer le bilan
          </>
        )}
      </button>

      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          disabled={previewing}
          className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: 'transparent',
            color: 'var(--txt-2)',
            border: '1px solid var(--brd)',
          }}
        >
          {previewing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Génération…
            </>
          ) : (
            <>
              <FileSearch className="w-4 h-4" />
              Aperçu du bilan
            </>
          )}
        </button>
      )}

      <p className="text-xs mt-2 text-center" style={{ color: 'var(--txt-3)' }}>
        {isClosed
          ? 'Met à jour le bilan archivé avec l\'état actuel.'
          : 'Génère un PDF par loueur + un bilan global, archivé dans les documents du projet.'}
      </p>
    </div>
  )
}

/**
 * Bannière "Essais clôturés" — affichée en haut du contenu si la version a
 * un `closed_at`. Offre un bouton de téléchargement direct du ZIP bilan si
 * on vient de le générer (`lastZip` stocké localement). Sinon, le ZIP est
 * accessible via le viewer docs (CheckDocsViewer).
 */
function ClotureBanner({ version, lastZip }) {
  const dateStr = (() => {
    try {
      return new Date(version.closed_at).toLocaleString('fr-FR', {
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
          Essais clôturés
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>
          {dateStr}
          {version.closed_by_name ? ` · par ${version.closed_by_name}` : ''}
        </p>
      </div>
      {lastZip?.download && (
        <button
          type="button"
          onClick={() => lastZip.download()}
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
 * Modale de confirmation de la clôture. Pédagogique : explique ce qui va se
 * passer (génération + upload + flag) et prévient en cas de re-clôture.
 *
 * Erreurs remontées : affichées dans la modale, on ne ferme pas tant que
 * l'utilisateur n'a pas re-confirmé ou cliqué Annuler.
 */
function ClotureConfirmModal({ onConfirm, onCancel, closing, error, isAlreadyClosed, userName }) {
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
              {isAlreadyClosed ? 'Re-générer le bilan ?' : 'Clôturer les essais ?'}
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
          <p>
            Cette action va&nbsp;:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>générer un PDF bilan <strong>global</strong> + 1 PDF par <strong>loueur</strong>&nbsp;;</li>
            <li>les archiver dans un ZIP attaché au projet&nbsp;;</li>
            <li>
              {isAlreadyClosed
                ? 'mettre à jour la date de clôture avec l\'état actuel.'
                : 'marquer la version comme clôturée.'}
            </li>
          </ul>
          {!isAlreadyClosed && (
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Les items resteront modifiables après clôture — tu peux re-clôturer
              à tout moment pour regénérer le bilan.
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
 * État affiché quand le filtre loueur actif masque tous les blocs (aucun
 * item ne passe le filtre). On propose un bouton raccourci pour revenir à
 * la vue "Tous", plutôt que laisser l'utilisateur chercher le chip "Tous"
 * lui-même (qui reste visible plus haut mais peut échapper à l'attention).
 */
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
