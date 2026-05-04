// ════════════════════════════════════════════════════════════════════════════
// PlansShareSession — Page publique /share/plans/:token (PLANS-SHARE-5d)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY des plans techniques d'un projet, partagée à un destinataire
// externe (technicien chantier, prestataire) via un lien public. Aucune
// authentification requise.
//
// Sécurité : la RPC share_plans_fetch (SECURITY DEFINER) filtre les plans
// côté serveur selon le scope du token (all / selection) et le toggle
// show_versions. Les signed URLs Storage sont générées côté lib avec une
// policy storage qui n'autorise anon que si un token actif existe.
//
// Layout : hero unifié SharePageHeader + filtres (chips catégories +
// search) + grille de cards de plans (vignette + nom + tags + V badge).
// Click card → ouvre PlanViewer en mode preloaded via URL state ?plan=<id>.
// Toggle dark/light persisté localStorage.
//
// Pattern aligné sur MatosShareSession + EquipeShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Loader2,
  Map as MapIcon,
  Search,
  X,
} from 'lucide-react'
import { usePlansShareSession } from '../hooks/usePlansShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import PlanViewer from '../features/plans/PlanViewer'

const THEME_STORAGE_KEY = 'plans-share-theme'

export default function PlansShareSession() {
  const { token } = useParams()
  const { payload, loading, error } = usePlansShareSession(token)

  // Toggle dark/light, persisté localStorage. Default 'dark' (cohérent
  // avec hub portail + autres pages share). Le visiteur peut basculer en
  // light pour impression / lecture en plein soleil.
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement des plans…
      </FullScreenStatus>
    )
  }

  if (error || !payload) {
    return <ErrorState error={error} />
  }

  return (
    <ShareContent
      payload={payload}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
    />
  )
}

// ─── Contenu principal ──────────────────────────────────────────────────────

function ShareContent({ payload, theme, onToggleTheme }) {
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const plans = useMemo(() => payload.plans || [], [payload.plans])
  const categories = useMemo(() => payload.categories || [], [payload.categories])
  const stats = payload.stats || {}

  // Map id → category pour résolution rapide.
  const categoryById = useMemo(() => {
    const m = new Map()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  // ── Filtres / search ──────────────────────────────────────────────────
  const [activeCategoryId, setActiveCategoryId] = useState('all')
  const [search, setSearch] = useState('')

  const filteredPlans = useMemo(() => {
    let list = plans
    if (activeCategoryId !== 'all') {
      if (activeCategoryId === '__uncat__') {
        list = list.filter((p) => !p.category_id)
      } else {
        list = list.filter((p) => p.category_id === activeCategoryId)
      }
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => {
        if ((p.name || '').toLowerCase().includes(q)) return true
        if ((p.description || '').toLowerCase().includes(q)) return true
        if (Array.isArray(p.tags) && p.tags.some((t) => t.toLowerCase().includes(q))) {
          return true
        }
        return false
      })
    }
    return list
  }, [plans, activeCategoryId, search])

  // Compteurs par catégorie pour les chips.
  const countByCategory = useMemo(() => {
    const map = new Map()
    for (const p of plans) {
      const k = p.category_id || '__uncat__'
      map.set(k, (map.get(k) || 0) + 1)
    }
    return map
  }, [plans])

  // ── PlanViewer : URL state ?plan=<id> ─────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams()
  const openedPlanId = searchParams.get('plan')

  const handleOpenPlan = useCallback(
    (plan) => {
      const next = new URLSearchParams(searchParams)
      next.set('plan', plan.id)
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  const handleCloseViewer = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('plan')
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  // Plan ouvert : on récupère depuis le payload (mode preloaded du viewer).
  const openedPlan = useMemo(() => {
    if (!openedPlanId) return null
    return plans.find((p) => p.id === openedPlanId) || null
  }, [openedPlanId, plans])

  // ── Meta items pour le SharePageHeader ────────────────────────────────
  const metaItems = []
  if (project.ref_projet) {
    metaItems.push({ type: 'ref', value: project.ref_projet })
  }
  if (share.label) metaItems.push({ type: 'label', value: share.label })
  if (payload.generated_at) {
    metaItems.push({ type: 'date', value: payload.generated_at })
  }

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        <SharePageHeader
          pageTitle="Plans"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {/* Stats compactes */}
        <div className="mt-4 mb-3">
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            {stats.total_plans || 0} plan{(stats.total_plans || 0) > 1 ? 's' : ''}
            {share.show_versions && ' · versions historiques accessibles'}
          </p>
        </div>

        {/* Filtres : chips catégories + search */}
        {plans.length > 0 && (
          <div className="space-y-2 mb-4">
            {/* Search */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
              }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom, tag, description…"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: 'var(--txt)' }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="p-0.5"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Chips catégories */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto pb-1"
              style={{ scrollbarWidth: 'thin' }}
            >
              <CategoryChip
                active={activeCategoryId === 'all'}
                onClick={() => setActiveCategoryId('all')}
                label="Toutes"
                count={plans.length}
              />
              {categories.map((c) => {
                const count = countByCategory.get(c.id) || 0
                if (count === 0) return null
                return (
                  <CategoryChip
                    key={c.id}
                    active={activeCategoryId === c.id}
                    onClick={() => setActiveCategoryId(c.id)}
                    label={c.label}
                    count={count}
                    color={c.color}
                  />
                )
              })}
              {countByCategory.has('__uncat__') && (
                <CategoryChip
                  active={activeCategoryId === '__uncat__'}
                  onClick={() => setActiveCategoryId('__uncat__')}
                  label="Sans catégorie"
                  count={countByCategory.get('__uncat__') || 0}
                />
              )}
            </div>
          </div>
        )}

        {/* Grille de plans */}
        {filteredPlans.length === 0 ? (
          <EmptyState hasFilters={search || activeCategoryId !== 'all'} />
        ) : (
          <ul className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {filteredPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                category={plan.category_id ? categoryById.get(plan.category_id) : null}
                onOpen={() => handleOpenPlan(plan)}
              />
            ))}
          </ul>
        )}

        <SharePageFooter generatedAt={payload.generated_at} />
      </div>

      {/* Viewer plein écran (mode preloaded — plan + signedUrl du payload) */}
      <PlanViewer
        planId={openedPlanId}
        plan={openedPlan}
        signedUrl={openedPlan?.signed_url || null}
        onClose={handleCloseViewer}
      />
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function CategoryChip({ active, onClick, label, count, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
        color: active ? 'var(--blue)' : 'var(--txt-2)',
        border: `1px solid ${active ? 'var(--blue-brd)' : 'var(--brd-sub)'}`,
      }}
    >
      {color && (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
      )}
      {label}
      <span
        className="text-[10px] tabular-nums"
        style={{ opacity: active ? 1 : 0.7 }}
      >
        {count}
      </span>
    </button>
  )
}

function PlanCard({ plan, category, onOpen }) {
  const isPdf = plan.file_type === 'pdf'
  const FileIcon = isPdf ? FileText : ImageIcon
  const hasThumbnail = Boolean(plan.thumbnail_signed_url)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group w-full text-left rounded-lg overflow-hidden transition-all"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          cursor: 'zoom-in',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.01)'
          e.currentTarget.style.borderColor = 'var(--brd-strong)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.borderColor = 'var(--brd)'
        }}
      >
        {/* Vignette plein largeur, ratio 4:3 */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            aspectRatio: '4/3',
          }}
        >
          {hasThumbnail ? (
            <img
              src={plan.thumbnail_signed_url}
              alt={plan.name}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileIcon
                className="w-10 h-10"
                style={{ color: 'var(--txt-3)', opacity: 0.5 }}
              />
            </div>
          )}
          {/* Badge type fichier (top-right) */}
          <span
            className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded backdrop-blur"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
            }}
          >
            {plan.file_type}
          </span>
          {/* Badge version (top-left) si V > 1 */}
          {plan.current_version > 1 && (
            <span
              className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded backdrop-blur"
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: 'white',
              }}
              title={`Version ${plan.current_version}`}
            >
              V{plan.current_version}
            </span>
          )}
        </div>

        {/* Méta sous la vignette */}
        <div className="px-2.5 py-2">
          <p
            className="text-xs font-semibold leading-tight truncate"
            style={{ color: 'var(--txt)' }}
          >
            {plan.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {category && (
              <>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: category.color }}
                />
                <span className="truncate">{category.label}</span>
              </>
            )}
            {!category && <span className="italic">Sans catégorie</span>}
          </div>
          {Array.isArray(plan.tags) && plan.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-3)',
                  }}
                >
                  {t}
                </span>
              ))}
              {plan.tags.length > 3 && (
                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                  +{plan.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  )
}

function EmptyState({ hasFilters }) {
  return (
    <div
      className="text-center py-12 px-4 rounded-lg"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd)',
      }}
    >
      <MapIcon
        className="w-10 h-10 mx-auto mb-2"
        style={{ color: 'var(--txt-3)', opacity: 0.5 }}
      />
      <p className="text-sm font-semibold" style={{ color: 'var(--txt-2)' }}>
        {hasFilters ? 'Aucun plan ne correspond' : 'Aucun plan partagé'}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
        {hasFilters
          ? 'Modifiez vos filtres pour voir d\u2019autres plans.'
          : 'Le partage de plans pour ce projet est vide.'}
      </p>
    </div>
  )
}

// ─── États pleine page (loading / error) ───────────────────────────────────

function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      {icon}
      <p className="mt-3 text-sm" style={{ color: 'var(--txt-2)' }}>
        {children}
      </p>
    </div>
  )
}

function ErrorState({ error }) {
  // Distingue token invalide / expiré (msg du serveur 28000) du reste.
  const msg = error?.message || ''
  const isInvalid = /invalid|expired|28000/i.test(msg)
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <AlertCircle
        className="w-10 h-10 mb-3"
        style={{ color: 'var(--red, #ef4444)' }}
      />
      <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
        {isInvalid ? 'Lien invalide ou expiré' : 'Impossible de charger les plans'}
      </h1>
      <p className="mt-2 text-sm max-w-md" style={{ color: 'var(--txt-3)' }}>
        {isInvalid
          ? 'Ce lien de partage n\u2019est plus valide. Demande un nouveau lien à la production.'
          : msg || 'Une erreur s\u2019est produite. Réessaye dans quelques instants.'}
      </p>
    </div>
  )
}
