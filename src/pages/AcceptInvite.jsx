/**
 * Page /accept-invite — Chantier 4C.2
 *
 * Destination des liens d'invitation Supabase (`{SITE_URL}/accept-invite`).
 *
 * Flow :
 *  1. L'invité clique sur le lien dans son email (ou sur le lien copié).
 *  2. Supabase vérifie le token et crée une session temporaire, puis redirige
 *     ici avec les tokens dans le fragment d'URL (#access_token=…).
 *  3. Le SDK Supabase détecte ces tokens et crée automatiquement la session.
 *  4. On affiche un formulaire "Choisir votre mot de passe".
 *  5. À la validation, on appelle supabase.auth.updateUser({password}).
 *  6. Une fois fait, redirection vers /accueil.
 *
 * Si l'utilisateur arrive ici sans être loggé (lien expiré / déjà utilisé),
 * on affiche un message d'erreur avec un lien vers /login.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Lock, Check, AlertCircle, Loader2 } from 'lucide-react'

export default function AcceptInvite() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('checking') // checking | ready | invalid | saving | done
  const [userInfo, setUserInfo] = useState(null) // { email, full_name }
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState(null)

  // ── 1. Détection de la session au chargement ────────────────────────────
  useEffect(() => {
    // Laisse au SDK le temps de parser le hash de l'URL
    const check = async () => {
      // Supabase parse automatiquement access_token dans le hash
      // au moment où createClient est appelé. On attend un petit délai
      // pour laisser onAuthStateChange se déclencher.
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
  }, [])

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
    setPhase('saving')
    const { error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError(updErr.message)
      setPhase('ready')
      return
    }

    // Marque l'invitation comme acceptée dans le log via RPC
    // SECURITY DEFINER (voir ch4c2_mark_invitation_accepted.sql).
    // On passe par une RPC parce que le UPDATE direct ne passe pas
    // toujours la RLS selon le contexte JWT.
    try {
      await supabase.rpc('mark_invitation_accepted')
    } catch {
      // ignore
    }

    setPhase('done')
    toast.success('Bienvenue dans CAPTIV !')
    // Petite pause pour que le toast soit visible
    setTimeout(() => navigate('/accueil', { replace: true }), 800)
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Logo / titre */}
        <div className="text-center mb-6">
          <div
            className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Lock className="w-6 h-6" style={{ color: 'var(--blue)' }} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Bienvenue sur CAPTIV
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
            Finalisez la création de votre compte
          </p>
        </div>

        {phase === 'checking' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--blue)' }} />
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Vérification du lien…
            </p>
          </div>
        )}

        {phase === 'invalid' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-8 h-8" style={{ color: 'var(--red)' }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                Lien invalide ou expiré
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                Ce lien d&apos;invitation a peut-être déjà été utilisé, ou bien il a expiré.
                Demandez un nouveau lien à votre administrateur.
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="text-xs font-medium mt-2"
              style={{ color: 'var(--blue)' }}
            >
              Aller à la page de connexion →
            </button>
          </div>
        )}

        {(phase === 'ready' || phase === 'saving') && userInfo && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center text-xs pb-2" style={{ color: 'var(--txt-3)' }}>
              {userInfo.full_name && (
                <p className="font-medium" style={{ color: 'var(--txt-2)' }}>
                  {userInfo.full_name}
                </p>
              )}
              <p>{userInfo.email}</p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--txt-2)' }}>
                Choisissez un mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 caractères"
                required
                minLength={6}
                autoFocus
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--txt-2)' }}>
                Confirmation
              </label>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Retapez le même mot de passe"
                required
                minLength={6}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>

            {error && (
              <div
                className="flex items-start gap-2 p-2.5 rounded-md text-xs"
                style={{
                  background: 'rgba(255,59,48,.1)',
                  color: 'var(--red)',
                  border: '1px solid rgba(255,59,48,.25)',
                }}
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={phase === 'saving'}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--blue)', color: 'white' }}
            >
              {phase === 'saving' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Enregistrement…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Activer mon compte
                </>
              )}
            </button>
          </form>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,.15)' }}
            >
              <Check className="w-5 h-5" style={{ color: '#10b981' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              Compte activé !
            </p>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Redirection…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
