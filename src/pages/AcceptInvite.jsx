/**
 * Page /accept-invite — Activation d'un compte sur invitation.
 *
 * Destination des liens d'invitation Supabase Auth (`{SITE_URL}/accept-invite`).
 *
 * Flow :
 *  1. L'invité clique sur le lien dans son email.
 *  2. Supabase vérifie le token et crée une session temporaire, puis
 *     redirige ici avec les tokens dans le fragment d'URL (#access_token=…).
 *  3. Le SDK Supabase détecte ces tokens et crée la session.
 *  4. On affiche un formulaire "Choisir votre mot de passe".
 *  5. À la validation, on appelle supabase.auth.updateUser({password}).
 *  6. Une fois fait, marquage RPC mark_invitation_accepted + redirect /accueil.
 *
 * Layout : split-screen aligné avec la page Login (image asset + panel
 * formulaire darkmode). 5 states distincts (checking / invalid / ready /
 * saving / done) gérés dans le panneau droit, le panneau image reste
 * constant.
 *
 * Mode preview DEV : query param `?preview=checking|ready|invalid|done`
 * force l'état d'affichage avec un userInfo factice. Permet de valider
 * visuellement la page sans vraie invitation. Désactivé en production
 * via `import.meta.env.DEV`.
 *
 * Multi-tenant safe : page partagée entre toutes les orgs (l'utilisateur
 * arrive avec une session Supabase mais on ne consulte pas son org_id
 * ici), donc on affiche le branding PRODUIT (`appSettings.product_name`)
 * et non le branding org.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { notify } from '../lib/notify'
import { useAuth } from '../contexts/AuthContext'
import { Lock, Check, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react'

const PREVIEW_USER = {
  email: 'preview@captiv.cc',
  full_name: 'Hugo MARTIN',
}

export default function AcceptInvite() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { appSettings } = useAuth()

  const [phase, setPhase] = useState('checking') // checking | ready | invalid | saving | done
  const [userInfo, setUserInfo] = useState(null) // { email, full_name }
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)

  // ── Mode preview (DEV only) ────────────────────────────────────────────
  // Permet de visualiser n'importe quel état via ?preview=ready|invalid|...
  // En prod, le param est ignoré et on suit le vrai flow Supabase.
  const previewMode = import.meta.env.DEV ? searchParams.get('preview') : null

  // ── 1. Détection de la session au chargement ────────────────────────────
  useEffect(() => {
    if (previewMode) {
      // Mode preview : on force directement l'état demandé.
      setUserInfo(PREVIEW_USER)
      setPhase(previewMode)
      return
    }

    const check = async () => {
      // Laisse au SDK le temps de parser le hash de l'URL.
      await new Promise((r) => setTimeout(r, 300))
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setPhase('invalid')
        return
      }
      const user = session.user
      setUserInfo({
        email: user.email,
        full_name: user.user_metadata?.full_name || '',
      })
      setPhase('ready')
    }
    check()
  }, [previewMode])

  // ── 2. Soumission du mot de passe ────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    if (password !== password2) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }

    // En mode preview, on simule juste la transition done → home pour la démo.
    if (previewMode) {
      setPhase('saving')
      window.setTimeout(() => setPhase('done'), 600)
      window.setTimeout(() => navigate('/accueil', { replace: true }), 1600)
      return
    }

    setPhase('saving')
    const { error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError(updErr.message)
      setPhase('ready')
      return
    }

    // Marque l'invitation comme acceptée dans le log via RPC SECURITY
    // DEFINER (voir ch4c2_mark_invitation_accepted.sql). On passe par
    // une RPC parce que l'UPDATE direct ne passe pas toujours la RLS
    // selon le contexte JWT.
    try {
      await supabase.rpc('mark_invitation_accepted')
    } catch {
      // ignore — best-effort
    }

    setPhase('done')
    notify.success(`Bienvenue sur ${appSettings?.product_name || 'CAPTIV DESK'} !`)
    window.setTimeout(() => navigate('/accueil', { replace: true }), 1200)
  }

  const productName = appSettings?.product_name || 'CAPTIV DESK'

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      {/* ─── Côté gauche : visuel image ──────────────────────────────────── */}
      <ImagePanel productName={productName} />

      {/* ─── Côté droit : formulaire + footer ───────────────────────────── */}
      <div className="flex-1 flex flex-col p-6 sm:p-10 md:p-12 -mt-6 md:mt-0 rounded-t-3xl md:rounded-t-none relative" style={{ background: 'var(--bg)', zIndex: 5 }}>
        <div className="flex-1 flex items-start md:items-center justify-center pt-6 md:pt-0">
          <div
            className="w-full max-w-sm"
            style={{ animation: 'invite-form-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
          >
            {/* Titre — adapté selon l'état pour donner un sens immédiat
                de ce qui se passe. */}
            <div className="mb-6 md:mb-8">
              <h2
                className="text-4xl md:text-3xl font-semibold tracking-tight leading-tight"
                style={{ color: 'var(--txt)' }}
              >
                {phase === 'invalid'
                  ? 'Lien invalide'
                  : phase === 'done'
                    ? 'Compte activé'
                    : 'Activez votre compte'}
              </h2>
              {phase !== 'invalid' && phase !== 'done' && (
                <p className="text-sm mt-2" style={{ color: 'var(--txt-3)' }}>
                  Définissez votre mot de passe pour commencer.
                </p>
              )}
            </div>

            {/* États ────────────────────────────────────────────────────── */}
            {phase === 'checking' && <CheckingState />}
            {phase === 'invalid' && <InvalidState onGoLogin={() => navigate('/login')} />}
            {phase === 'done' && <DoneState />}

            {(phase === 'ready' || phase === 'saving') && userInfo && (
              <ReadyForm
                userInfo={userInfo}
                password={password}
                setPassword={setPassword}
                password2={password2}
                setPassword2={setPassword2}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                error={error}
                saving={phase === 'saving'}
                onSubmit={handleSubmit}
              />
            )}
          </div>
        </div>

        {/* Footer légal — pose discrète en bas du panneau droit. */}
        <footer
          className="text-[11px] text-center mt-8"
          style={{ color: 'var(--txt-3)' }}
        >
          © {new Date().getFullYear()} {productName}
          <span className="mx-2" aria-hidden="true">·</span>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="transition-colors"
            style={{ color: 'inherit' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'inherit'
            }}
          >
            Mentions légales
          </a>
          <span className="mx-2" aria-hidden="true">·</span>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="transition-colors"
            style={{ color: 'inherit' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'inherit'
            }}
          >
            Confidentialité
          </a>
        </footer>
      </div>

      {/* Bandeau preview en DEV pour rappeler qu'on est en mode démo,
          surtout utile quand on stack 4 onglets pour visualiser les états. */}
      {previewMode && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{
            background: 'rgba(255,200,120,0.15)',
            border: '1px solid rgba(255,200,120,0.4)',
            color: 'rgb(255,200,120)',
            backdropFilter: 'blur(6px)',
          }}
        >
          Preview · {previewMode}
        </div>
      )}

      {/* Keyframe d'animation locale (form fade + slide-up). */}
      <style>{`
        @keyframes invite-form-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ─── Panel visuel "Bienvenue à bord" ──────────────────────────────────── */
//
// Identique à ImagePanel de Login.jsx mais avec une punchline adaptée
// au contexte d'activation de compte ("Bienvenue à bord." plutôt que
// "Reprenez le fil." qui suggère un retour). On duplique volontairement
// pour rester portable et permettre une évolution divergente future.
function ImagePanel({ productName }) {
  return (
    <div
      className="relative overflow-hidden h-[50vh] md:h-auto md:flex-1"
      style={{
        background: '#000',
        isolation: 'isolate',
      }}
    >
      <img
        src="/login-bg.jpg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ zIndex: 1 }}
      />

      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.15) 65%, rgba(0,0,0,0.7) 100%)',
          zIndex: 2,
        }}
      />

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-24 md:hidden"
        style={{
          background: 'linear-gradient(to bottom, transparent 0%, var(--bg) 100%)',
          zIndex: 3,
        }}
      />

      {/* MOBILE : logo seul centré */}
      <div
        className="md:hidden absolute inset-0 flex items-center justify-center px-6"
        style={{ zIndex: 8 }}
      >
        <img
          src="/CAPTIV-desk-logo-blanc.png"
          alt={productName}
          className="h-10 w-auto object-contain"
          style={{ maxWidth: '220px' }}
        />
      </div>

      {/* DESKTOP : logo top-left + punchline bottom-left */}
      <div
        className="hidden md:flex md:flex-col md:absolute md:inset-0 md:justify-between md:p-12"
        style={{ zIndex: 8 }}
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/CAPTIV-desk-logo-blanc.png"
            alt={productName}
            className="h-7 w-auto object-contain"
            style={{ maxWidth: '180px' }}
          />
        </div>
        <div>
          <p
            className="text-3xl lg:text-4xl font-medium leading-tight tracking-tight text-white"
            style={{ textShadow: '0 2px 16px rgba(0,0,0,0.6)' }}
          >
            Bienvenue à bord.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── États du flow ─────────────────────────────────────────────────────── */

function CheckingState() {
  return (
    <div className="flex items-center gap-3 py-4">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-2)' }} />
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        Vérification du lien d&apos;invitation…
      </p>
    </div>
  )
}

function InvalidState({ onGoLogin }) {
  return (
    <div>
      <div
        className="flex items-start gap-3 p-4 rounded-lg mb-5"
        style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
        }}
      >
        <AlertCircle
          className="w-5 h-5 shrink-0 mt-0.5"
          style={{ color: 'rgb(252, 165, 165)' }}
        />
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
            Lien expiré ou déjà utilisé
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--txt-3)' }}>
            Ce lien d&apos;invitation a peut-être déjà été utilisé pour activer
            le compte, ou bien il a expiré. Demandez un nouveau lien à votre
            administrateur.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onGoLogin}
        className="w-full flex items-center justify-center gap-2 py-3 sm:py-2.5 px-4 rounded-lg font-semibold text-sm transition-all"
        style={{
          background: '#ffffff',
          color: '#0a0a0f',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)'
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,255,255,0.12)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        Aller à la page de connexion
      </button>
    </div>
  )
}

function DoneState() {
  return (
    <div className="flex flex-col items-center text-center py-4">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
        style={{
          background: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid rgba(34, 197, 94, 0.35)',
        }}
      >
        <Check className="w-6 h-6" style={{ color: 'rgb(134, 239, 172)' }} />
      </div>
      <p className="text-base font-medium" style={{ color: 'var(--txt)' }}>
        Bienvenue à bord !
      </p>
      <p className="text-sm mt-1" style={{ color: 'var(--txt-3)' }}>
        Redirection vers votre espace…
      </p>
    </div>
  )
}

function ReadyForm({
  userInfo,
  password,
  setPassword,
  password2,
  setPassword2,
  showPassword,
  setShowPassword,
  error,
  saving,
  onSubmit,
}) {
  return (
    <>
      {/* Identité de l'invité affichée en card subtile au-dessus du form
          pour confirmer "c'est bien toi qui actives ce compte". */}
      <div
        className="mb-5 rounded-lg p-3 flex items-center gap-3"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--brd)',
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--txt)',
          }}
        >
          {(userInfo.full_name || userInfo.email || '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          {userInfo.full_name && (
            <div
              className="text-sm font-medium truncate"
              style={{ color: 'var(--txt)' }}
            >
              {userInfo.full_name}
            </div>
          )}
          <div
            className={`text-xs truncate ${userInfo.full_name ? '' : 'font-medium'}`}
            style={{
              color: userInfo.full_name ? 'var(--txt-3)' : 'var(--txt)',
            }}
          >
            {userInfo.email}
          </div>
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'rgb(252, 165, 165)',
          }}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <DarkLabel>Mot de passe</DarkLabel>
          <DarkInput
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 caractères"
            required
            minLength={6}
            autoComplete="new-password"
            autoFocus
            trailingAction={{
              icon: showPassword ? EyeOff : Eye,
              onClick: () => setShowPassword((v) => !v),
              label: showPassword
                ? 'Masquer le mot de passe'
                : 'Afficher le mot de passe',
            }}
          />
        </div>

        <div>
          <DarkLabel>Confirmation</DarkLabel>
          <DarkInput
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="Retapez le même mot de passe"
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 sm:py-2.5 px-4 rounded-lg font-semibold text-sm transition-all"
          style={{
            background: saving ? 'rgba(255,255,255,0.7)' : '#ffffff',
            color: '#0a0a0f',
            cursor: saving ? 'wait' : 'pointer',
            marginTop: '0.5rem',
          }}
          onMouseEnter={(e) => {
            if (saving) return
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,255,255,0.12)'
          }}
          onMouseLeave={(e) => {
            if (saving) return
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Activation…</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Activer mon compte</span>
            </>
          )}
        </button>
      </form>
    </>
  )
}

/* ─── Helpers form (inputs sombres) ─────────────────────────────────────── */
//
// Dupliqués depuis Login.jsx pour rester portable. Si l'on doit les
// modifier ensemble plus tard (changement de design system), il faudra
// extraire dans un fichier shared (`src/features/auth/AuthInputs.jsx`).
function DarkLabel({ children, inline = false }) {
  return (
    <label
      className={`block text-[13px] font-medium ${inline ? '' : 'mb-1.5'}`}
      style={{ color: 'var(--txt-2)' }}
    >
      {children}
    </label>
  )
}

function DarkInput({ icon: IconComp, trailingAction, style, onFocus, onBlur, ...props }) {
  const hasLeading = Boolean(IconComp)
  const hasTrailing = Boolean(trailingAction)

  return (
    <div className="relative">
      {hasLeading && (
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--txt-3)' }}
          aria-hidden="true"
        >
          <IconComp className="w-4 h-4" />
        </span>
      )}

      <input
        {...props}
        className={`w-full py-2.5 rounded-lg text-sm transition-all outline-none ${hasLeading ? 'pl-10' : 'pl-3'} ${hasTrailing ? 'pr-10' : 'pr-3'}`}
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          color: 'var(--txt)',
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)'
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.05)'
          onFocus?.(e)
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--brd)'
          e.currentTarget.style.background = 'var(--bg-elev)'
          e.currentTarget.style.boxShadow = 'none'
          onBlur?.(e)
        }}
      />

      {hasTrailing && (
        <button
          type="button"
          onClick={trailingAction.onClick}
          aria-label={trailingAction.label}
          title={trailingAction.label}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--txt)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--txt-3)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <trailingAction.icon className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
