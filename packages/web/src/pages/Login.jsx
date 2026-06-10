import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AlertCircle, Mail, Lock, User, Eye, EyeOff, Building2, X, Copy, Check, ExternalLink } from 'lucide-react'

/**
 * Page de connexion / inscription / setup organisation.
 *
 * Layout : split-screen 50/50 sur desktop (visuel Spotlight à gauche,
 * formulaire à droite), stack vertical sur mobile (visuel compact en
 * banner-top, formulaire en dessous).
 *
 * Côté gauche (Spotlight) : fond noir profond + halo lumineux chaud
 * dans le coin haut-gauche (clin d'œil au projecteur de plateau).
 * Logo produit en top-left, punchline "Reprenez le fil." en bottom-left.
 *
 * Côté droit : formulaire en darkmode cohérent avec le reste de l'app
 * (CSS vars --bg / --bg-elev / --brd / --txt). Les 3 modes (login /
 * signup / setup) sont conservés tels quels.
 *
 * Multi-tenant safe : page partagée entre toutes les orgs (l'utilisateur
 * n'est pas encore loggé, on ne sait pas à quelle org il appartient),
 * donc on affiche le branding PRODUIT (`appSettings.product_name`) et
 * non le branding org.
 */
export default function Login() {
  const [mode, setMode] = useState('login') // login | signup | setup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Modale "Contacter le support" — null = fermée, sinon raison d'ouverture
  // ('forgot-password' ou 'no-account') qui décide du wording affiché.
  const [contactModal, setContactModal] = useState(null)

  const { signIn, signUp, createOrg, appSettings } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/accueil')
      } else if (mode === 'signup') {
        const { error } = await signUp(email, password, fullName)
        if (error) throw error
        setMode('setup')
      } else if (mode === 'setup') {
        const { error } = await createOrg(orgName)
        if (error) throw error
        navigate('/accueil')
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
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
      {/* Layout en colonne pour pouvoir poser un footer légal en bas du
          panneau, et garder le formulaire centré dans l'espace restant.
          Sur mobile : le panel chevauche légèrement l'image (margin-top
          négatif + border-radius top) pour créer l'effet "sheet" iOS qui
          remonte du bas. Sur desktop : layout split classique inchangé. */}
      <div
        className="flex-1 flex flex-col p-6 sm:p-10 md:p-12 -mt-6 md:mt-0 rounded-t-3xl md:rounded-t-none relative"
        style={{ background: 'var(--bg)', zIndex: 5 }}
      >
        {/* Sur mobile : form aligné en haut (items-start) avec un peu
            de padding-top pour respirer après le chevauchement de la
            card. Sur desktop : centré verticalement (items-center) dans
            la moitié droite. */}
        <div className="flex-1 flex items-start md:items-center justify-center pt-6 md:pt-0">
          <div
            className="w-full max-w-sm"
            // Animation d'apparition douce au load (translation + fade)
            style={{ animation: 'login-form-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
          >
            {/* Titre — sur mobile on l'augmente (text-4xl = 36px) pour
                ancrer la zone form, en cohérence avec les patterns SaaS
                mobile ("Welcome back!", "Sign In" en très gros). Sur
                desktop on garde text-3xl (30px) qui équilibre la
                punchline du côté gauche. Sous-titre retiré (était
                redondant avec "Reprenez le fil."). */}
            <div className="mb-6 md:mb-8">
              <h2
                className="text-4xl md:text-3xl font-semibold tracking-tight leading-tight"
                style={{ color: 'var(--txt)' }}
              >
                {mode === 'login'
                  ? 'Connexion'
                  : mode === 'setup'
                    ? 'Configurer votre organisation'
                    : 'Connexion'}
              </h2>
              {mode === 'setup' && (
                <p className="text-sm mt-2" style={{ color: 'var(--txt-3)' }}>
                  Dernière étape avant de commencer.
                </p>
              )}
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

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'setup' ? (
                <>
                  <div>
                    <DarkLabel>Nom complet</DarkLabel>
                    <DarkInput
                      icon={User}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Hugo MARTIN"
                      required
                    />
                  </div>
                  <div>
                    <DarkLabel>Nom de l&apos;organisation</DarkLabel>
                    <DarkInput
                      icon={Building2}
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Ex : Société XYZ"
                      required
                    />
                    <p className="text-xs mt-1.5" style={{ color: 'var(--txt-3)' }}>
                      Visible sur vos devis et PDF.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <DarkLabel>Email</DarkLabel>
                    <DarkInput
                      icon={Mail}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="votre@email.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    {/* Label password + lien "Mot de passe oublié ?" alignés
                        sur la même ligne. Le clic ouvre la modale support. */}
                    <div className="flex items-baseline justify-between mb-1.5">
                      <DarkLabel inline>Mot de passe</DarkLabel>
                      <button
                        type="button"
                        onClick={() => setContactModal('forgot-password')}
                        className="text-xs transition-colors"
                        style={{ color: 'var(--txt-3)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--txt-2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--txt-3)'
                        }}
                      >
                        Mot de passe oublié ?
                      </button>
                    </div>
                    <DarkInput
                      icon={Lock}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoComplete="current-password"
                      trailingAction={{
                        icon: showPassword ? EyeOff : Eye,
                        onClick: () => setShowPassword((v) => !v),
                        label: showPassword
                          ? 'Masquer le mot de passe'
                          : 'Afficher le mot de passe',
                      }}
                    />
                  </div>
                </>
              )}

              <SubmitButton loading={loading} mode={mode} />
            </form>

            {/* Toggle bas — "Pas encore de compte ?" est un faux toggle :
                les comptes Captiv Desk sont créés sur invitation par
                l'administrateur, pas en self-service. Le clic ouvre la
                modale support pour expliquer le process. */}
            {mode !== 'setup' && (
              <div
                className="mt-7 pt-6 text-center"
                style={{ borderTop: '1px solid var(--brd)' }}
              >
                <button
                  type="button"
                  onClick={() => setContactModal('no-account')}
                  className="text-sm font-medium transition-colors"
                  style={{ color: 'var(--txt-2)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--txt)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--txt-2)'
                  }}
                >
                  Pas encore de compte ? Contactez votre admin
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer légal — pose discrète en bas du panneau droit. Donne
            un cadre sérieux au login, sans peser visuellement. Les liens
            ouvrent les pages publiques correspondantes (à wirer plus tard
            sur les vraies routes /mentions-legales et /confidentialite si
            elles existent ; pour l'instant href="#" et onClick prévention). */}
        <footer
          className="text-[11px] text-center mt-8"
          style={{ color: 'var(--txt-3)' }}
        >
          © {new Date().getFullYear()} {appSettings?.product_name || 'CAPTIV DESK'}
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

      {/* Modale "Contacter le support" — partagée par les CTA
          "Mot de passe oublié ?" et "Pas encore de compte ? Contactez
          votre admin". Le wording change selon la raison d'ouverture. */}
      <ContactSupportModal
        open={contactModal !== null}
        reason={contactModal}
        supportEmail={appSettings?.product_support_email || 'contact@captiv.cc'}
        productName={productName}
        onClose={() => setContactModal(null)}
      />

      {/* Keyframe d'animation d'entrée du formulaire (translation + fade).
          Définie ici pour rester locale à la page Login et ne pas polluer
          le CSS global. */}
      <style>{`
        @keyframes login-form-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ─── Panel visuel — image plein cadre + overlay ────────────────────────── */
//
// Image hébergée dans `/public/login-bg.jpg`, posée en object-fit: cover.
// Par-dessus, un overlay gradient pour la lisibilité du contenu (logo +
// punchline), et un fade vers le fond du form panel (mobile only) pour
// adoucir la transition.
//
// Le contenu (logo + punchline) a deux compositions distinctes :
//   - MOBILE : logo + punchline empilés et centrés au milieu du panel.
//     Donne un look "intro app" cohérent avec les patterns SaaS mobile
//     (OctoCoin, Octopus, etc.).
//   - DESKTOP : logo en top-left, punchline en bottom-left, structure
//     éditoriale classique d'un hero split-screen.
function ImagePanel({ productName }) {
  return (
    <div
      // Mobile (stack vertical) : h-[50vh] = ~50% de la viewport.
      // L'image porte la moitié supérieure de l'écran, le formulaire
      // occupe la moitié basse, dans l'esprit "intro app" mobile
      // (pattern OctoCoin / Octopus). Desktop : flex-1 prend la moitié
      // gauche en split horizontal.
      className="relative overflow-hidden h-[50vh] md:h-auto md:flex-1"
      style={{
        background: '#000',
        isolation: 'isolate',
      }}
    >
      {/* Image de fond — object-fit cover pour remplir le panel quel
          que soit le viewport. aria-hidden car purement décorative. */}
      <img
        src="/login-bg.jpg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ zIndex: 1 }}
      />

      {/* Overlay gradient — assombrit haut et bas pour la lisibilité
          du contenu, laisse le centre relativement libre. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.15) 65%, rgba(0,0,0,0.7) 100%)',
          zIndex: 2,
        }}
      />

      {/* Fade vers la couleur du form panel — mobile only.
          Adoucit la transition image → form pour éviter l'effet
          "rectangle plat" et donner une continuité dans l'esprit
          "sheet" iOS. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-24 md:hidden"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, var(--bg) 100%)',
          zIndex: 3,
        }}
      />

      {/* ═══ MOBILE : logo seul centré ═══════════════════════════════════ */}
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

      {/* ═══ DESKTOP : logo top-left + punchline bottom-left ═════════════ */}
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
            Reprenez le fil.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers form (inputs sombres) ─────────────────────────────────────── */
//
// Ensemble cohérent pour les inputs darkmode :
//   - DarkLabel : libellé en case normale (plus moderne que uppercase
//     tracking), poids medium, taille 13px. Si `inline=true`, on supprime
//     le margin-bottom (utile quand le label cohabite avec un autre
//     élément sur la même ligne, ex: "Mot de passe oublié ?").
//   - DarkInput : input avec icône optionnelle à gauche (prop `icon`,
//     composant lucide-react) + action optionnelle à droite (prop
//     `trailingAction`, ex: show/hide password). Focus state avec liseré
//     blanc subtil + halo glow doux pour l'effet "premium".
//
// On évite la classe `.input` globale (qui peut être stylée pour fond
// clair) — on style en inline pour rester portable et indépendant du
// futur lightmode.
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
      {/* Icône à gauche, alignée verticalement, désactivée pour les
          interactions (purement décorative). */}
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
          // Focus : liseré blanc subtil + halo doux qui rappelle les
          // reflets satinés de l'image de fond (très léger, pas tape-à-l'œil).
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

      {/* Action à droite (ex: show/hide password). Bouton réel pour
          être cliquable + accessible clavier. */}
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

/* ─── Modale "Contacter le support" ─────────────────────────────────────── */
//
// Modale partagée par 2 CTA :
//   - "Mot de passe oublié ?" → reason='forgot-password'
//   - "Pas encore de compte ? Contactez votre admin" → reason='no-account'
//
// On affiche un wording adapté + l'email du support produit (issu de
// `appSettings.product_support_email`) avec deux actions :
//   - Copier l'email dans le presse-papier (confirmation visuelle)
//   - Ouvrir le client mail par défaut (mailto: avec sujet pré-rempli)
//
// La modale se ferme via ESC, click sur le backdrop, bouton X, ou bouton
// "Fermer". Le bouton de copie garde l'état "copié" pendant 2s pour
// rassurer l'utilisateur.
function ContactSupportModal({ open, reason, supportEmail, productName, onClose }) {
  const [copied, setCopied] = useState(false)

  // Reset l'état "copié" quand la modale se ferme/réouvre, sinon le
  // checkmark pourrait persister visuellement entre 2 ouvertures.
  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  // ESC pour fermer (UX standard).
  useEffect(() => {
    if (!open) return undefined
    function handleKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const isForgot = reason === 'forgot-password'
  const title = isForgot ? 'Mot de passe oublié' : 'Création de compte'
  const description = isForgot
    ? `La réinitialisation de mot de passe se fait par votre administrateur. Contactez le support de ${productName} pour qu'il vous envoie un nouveau lien d'accès.`
    : `Les comptes ${productName} sont créés sur invitation par votre administrateur. Contactez-le pour obtenir un accès à votre espace.`
  const subject = isForgot
    ? 'Réinitialisation du mot de passe'
    : 'Demande de création de compte'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(supportEmail)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Si l'API clipboard n'est pas dispo (vieux navigateur, http non
      // sécurisé), on retombe sur un fallback select+execCommand.
      try {
        const ta = document.createElement('textarea')
        ta.value = supportEmail
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        // tant pis — on laisse la modale ouverte, l'utilisateur peut
        // copier manuellement depuis le champ affiché.
      }
    }
  }

  function handleOpenMail() {
    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'login-modal-fade 200ms ease-out both',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-support-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl p-6 sm:p-7 relative"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          animation: 'login-modal-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      >
        {/* Bouton fermer */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute top-3 right-3 p-1.5 rounded transition-colors"
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
          <X className="w-4 h-4" />
        </button>

        <h3
          id="contact-support-title"
          className="text-lg font-semibold tracking-tight pr-6"
          style={{ color: 'var(--txt)' }}
        >
          {title}
        </h3>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {description}
        </p>

        {/* Bloc email du support */}
        <div
          className="mt-5 rounded-lg p-4 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--brd)',
          }}
        >
          <Mail className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] uppercase tracking-wider font-medium mb-0.5"
              style={{ color: 'var(--txt-3)' }}
            >
              Support
            </div>
            <div
              className="text-sm font-medium truncate"
              style={{ color: 'var(--txt)' }}
            >
              {supportEmail}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
            onMouseEnter={(e) => {
              if (copied) return
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            }}
            onMouseLeave={(e) => {
              if (copied) return
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" style={{ color: 'rgb(134, 239, 172)' }} />
                <span>Email copié</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copier l&apos;email</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleOpenMail}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all"
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
            <ExternalLink className="w-4 h-4" />
            <span>Ouvrir mon mail</span>
          </button>
        </div>
      </div>

      {/* Keyframes locales à la modale */}
      <style>{`
        @keyframes login-modal-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes login-modal-in {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}

/* ─── Bouton submit signature ───────────────────────────────────────────── */
//
// Bouton primaire blanc plein avec micro-translation négative au hover
// (-1px Y) pour donner une sensation tactile sans trop en faire. Sortie
// dans son propre composant pour garder le JSX du formulaire respirable.
function SubmitButton({ loading, mode }) {
  const label =
    mode === 'login'
      ? 'Se connecter'
      : mode === 'signup'
        ? 'Créer le compte'
        : "Créer l'organisation"

  return (
    <button
      type="submit"
      disabled={loading}
      // py-3 sur mobile (tap target plus généreux), py-2.5 sur sm+
      className="w-full flex items-center justify-center gap-2 py-3 sm:py-2.5 px-4 rounded-lg font-semibold text-sm transition-all"
      style={{
        background: loading ? 'rgba(255,255,255,0.7)' : '#ffffff',
        color: '#0a0a0f',
        cursor: loading ? 'wait' : 'pointer',
        marginTop: '0.5rem',
      }}
      onMouseEnter={(e) => {
        if (loading) return
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,255,255,0.12)'
      }}
      onMouseLeave={(e) => {
        if (loading) return
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {loading ? (
        <span
          className="w-4 h-4 border-2 rounded-full animate-spin"
          style={{
            borderColor: 'rgba(10,10,15,0.3)',
            borderTopColor: '#0a0a0f',
          }}
        />
      ) : (
        label
      )}
    </button>
  )
}
