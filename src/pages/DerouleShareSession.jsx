// ════════════════════════════════════════════════════════════════════════════
// DerouleShareSession — Page publique /share/deroule/:token (Vague 2)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY du déroulé d'un projet, partagée à un destinataire externe
// via un lien public. Aucune authentification requise.
//
// Sécurité : la RPC share_deroule_fetch (SECURITY DEFINER) filtre les données
// côté serveur — pas de notes internes ni coordonnées si show_sensitive=false.
//
// Layout : sélecteur de date (chips horizontales) + vue liste compacte par
// défaut (mobile-first), avec basculement timeline simplifiée pour desktop.
// Toggle light/dark + responsive.
//
// Pattern aligné sur EquipeShareSession.jsx (P4.2D).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import {
  AlertCircle,
  Loader2,
  Clock,
  MapPin,
  Inbox,
  List as ListIcon,
  LayoutGrid,
  X,
  Users,
} from 'lucide-react'
import { useDerouleShareSession } from '../hooks/useDerouleShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import {
  effectiveCouleurCreneau,
  formatMinHHMM,
  sortCreneauxByTime,
  defaultLaneLibelle,
  creneauDureeMin,
  CRENEAU_TYPE_COLORS,
} from '../lib/deroule'

// Constantes timeline (alignées sur DerouleTimelineView admin pour cohérence
// visuelle entre back-office et page partagée).
const PX_PER_HOUR = 60
const LANE_HEADER_H = 36
const TIME_COL_W = 56

const THEME_STORAGE_KEY = 'deroule-share-theme'
const VIEW_STORAGE_KEY = 'deroule-share-view'

// Couleur d'accent fixe pour les éléments interactifs (sélecteur de date,
// boutons toggle). On n'utilise PAS brandColor ici — un brand sombre ou
// proche du fond rend le sélectionné invisible. Cette couleur est garantie
// contrastée sur fond clair ET fond sombre.
const ACCENT = '#3B82F6'

export default function DerouleShareSession() {
  const { token } = useParams()
  const { payload, loading, error } = useDerouleShareSession(token)

  // Toggle light/dark — default DARK (cohérent avec l'app + autres share).
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.dataset.checkTheme = 'light'
    } else {
      delete root.dataset.checkTheme
    }
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
        Chargement…
      </FullScreenStatus>
    )
  }
  if (error || !payload) {
    return <ErrorState error={error} />
  }

  return <ShareContent payload={payload} theme={theme} setTheme={setTheme} />
}

// ─── Contenu principal ──────────────────────────────────────────────────────

function ShareContent({ payload, theme, setTheme }) {
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const deroules = useMemo(() => payload.deroules || [], [payload.deroules])
  const lanes = useMemo(() => payload.lanes || [], [payload.lanes])
  const creneaux = useMemo(() => payload.creneaux || [], [payload.creneaux])
  const membres = useMemo(() => payload.membres || [], [payload.membres])
  const showSensitive = share.show_sensitive !== false

  // Vue active : 'liste' (cards verticales) ou 'timeline' (grille lanes ×
  // heures, blocs positionnés en absolute — calque visuel du back-office).
  // Persistée par-tab dans localStorage. Default timeline sur desktop, liste
  // sur mobile (le toggle est masqué en < sm — la timeline est trop dense
  // pour mobile).
  const [view, setView] = useState(() => {
    if (typeof localStorage === 'undefined') return 'timeline'
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'liste' ? 'liste' : 'timeline'
  })
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  // Sélection du jour : par défaut le 1er déroulé (chronologique). Si on a
  // un déroulé "aujourd'hui", on le sélectionne en priorité.
  const todayIso = new Date().toISOString().slice(0, 10)
  const [selectedDeroleId, setSelectedDeroleId] = useState(() => {
    if (!deroules.length) return null
    const today = deroules.find((d) => d.date_jour === todayIso)
    return today ? today.id : deroules[0].id
  })
  // Si la sélection est obsolète après reload, reset.
  useEffect(() => {
    if (!deroules.length) {
      setSelectedDeroleId(null)
      return
    }
    if (!deroules.some((d) => d.id === selectedDeroleId)) {
      const today = deroules.find((d) => d.date_jour === todayIso)
      setSelectedDeroleId(today ? today.id : deroules[0].id)
    }
  }, [deroules, selectedDeroleId, todayIso])

  // Index helpers
  const laneById = useMemo(() => {
    const m = new Map()
    for (const l of lanes) m.set(l.id, l)
    return m
  }, [lanes])
  const membreById = useMemo(() => {
    const m = new Map()
    for (const x of membres) {
      const prenom = x.prenom || ''
      const nom = x.nom || ''
      const fullName = `${prenom} ${nom}`.trim() || '—'
      const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
      m.set(x.id, { ...x, fullName, ini })
    }
    return m
  }, [membres])

  const currentDeroule = useMemo(
    () => deroules.find((d) => d.id === selectedDeroleId) || null,
    [deroules, selectedDeroleId],
  )
  const currentLanes = useMemo(() => {
    if (!currentDeroule) return []
    return lanes
      .filter((l) => l.deroule_id === currentDeroule.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [lanes, currentDeroule])
  const currentCreneaux = useMemo(() => {
    if (!currentDeroule) return []
    return sortCreneauxByTime(
      creneaux.filter((c) => c.deroule_id === currentDeroule.id),
    )
  }, [creneaux, currentDeroule])

  // Note : on n'utilise PAS le brand_color de l'org pour les éléments
  // interactifs (sélecteur de date, toggle vue) — un brand sombre rendrait
  // les états sélectionnés invisibles. Le SharePageHeader gère lui-même le
  // branding hero. Cf. constante ACCENT en top of file pour les accents UI.

  // Construction des metaItems pour le SharePageHeader.
  const metaItems = []
  if (project.ref_projet) metaItems.push({ type: 'ref', value: project.ref_projet })
  if (share.label) metaItems.push({ type: 'label', value: share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        {/* ── Header unifié partagé ──────────────────────────────────────── */}
        <SharePageHeader
          pageTitle="Déroulé"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />

        {/* ── Sélecteur de jour + toggle vue ─────────────────────────────── */}
        {deroules.length === 0 ? (
          <EmptyDeroulesState />
        ) : (
          <>
            <div className="mt-5 flex items-start justify-between gap-3 flex-wrap">
              <DaySelector
                deroules={deroules}
                selectedId={selectedDeroleId}
                onSelect={setSelectedDeroleId}
                todayIso={todayIso}
              />
              <ViewToggle view={view} onChange={setView} />
            </div>

            {/* ── Notes du jour (si renseignées) ─────────────────────────── */}
            {showSensitive && currentDeroule?.notes && (
              <div
                className="mt-4 rounded-md px-3 py-2 text-xs leading-relaxed"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd-sub)',
                  color: 'var(--txt-2)',
                }}
              >
                <span
                  className="text-[10px] uppercase tracking-widest font-bold mr-2"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Briefing
                </span>
                {currentDeroule.notes}
              </div>
            )}

            {/* ── Vue active (liste cards / timeline lanes×heures) ───────── */}
            <div className="mt-4">
              {currentCreneaux.length === 0 ? (
                <EmptyDayState />
              ) : view === 'timeline' ? (
                <CreneauxTimeline
                  deroule={currentDeroule}
                  creneaux={currentCreneaux}
                  lanes={currentLanes}
                  membreById={membreById}
                  todayIso={todayIso}
                  showSensitive={showSensitive}
                />
              ) : (
                <CreneauxList
                  creneaux={currentCreneaux}
                  laneById={laneById}
                  currentLanes={currentLanes}
                  membreById={membreById}
                  showSensitive={showSensitive}
                />
              )}
            </div>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <SharePageFooter />
      </div>
    </div>
  )
}

// ─── Day selector (chips horizontales scrollable mobile) ────────────────────
//
// Design : on utilise ACCENT (bleu fixe) plutôt que brandColor parce qu'un
// brand sombre rendrait le sélectionné indiscernable du fond. Le sélectionné
// a un fond plein bleu avec border bleue ; le non-sélectionné a un fond
// surface neutre avec border discrète. L'écart visuel est ainsi très net.
// Le badge "AUJ" est masqué quand le jour est sélectionné (redondant —
// l'accent porte déjà l'info "tu es ici").

function DaySelector({ deroules, selectedId, onSelect, todayIso }) {
  return (
    <div className="-mx-1 overflow-x-auto flex-1 min-w-0">
      <div className="inline-flex items-center gap-2 px-1 pb-1">
        {deroules.map((d) => {
          const isActive = d.id === selectedId
          const isToday = d.date_jour === todayIso
          const date = parseDateIso(d.date_jour)
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d.id)}
              className="rounded-md px-3 py-2 text-xs whitespace-nowrap transition-all flex flex-col items-center min-w-[68px]"
              style={{
                background: isActive ? ACCENT : 'var(--bg-surf)',
                color: isActive ? '#fff' : 'var(--txt-2)',
                border: `1px solid ${isActive ? ACCENT : 'var(--brd-sub)'}`,
                fontWeight: isActive ? 600 : 500,
                boxShadow: isActive ? `0 0 0 2px ${ACCENT}33` : 'none',
              }}
            >
              <span className="text-[10px] uppercase tracking-wider opacity-80">
                {dayLabel(date)}
              </span>
              <span className="text-base font-bold leading-tight mt-0.5">
                {date ? String(date.getDate()).padStart(2, '0') : '?'}
              </span>
              <span className="text-[10px] opacity-80">
                {date ? monthShort(date) : ''}
              </span>
              {/* Badge "AUJ" UNIQUEMENT si on n'est pas sur ce jour — redondant
                  avec le fond accent quand actif. Évite double signal visuel. */}
              {isToday && !isActive && (
                <span
                  className="text-[9px] mt-0.5 px-1 rounded"
                  style={{
                    background: 'var(--green-bg)',
                    color: 'var(--green)',
                    fontWeight: 600,
                  }}
                >
                  AUJ
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Toggle vue Timeline / Liste ────────────────────────────────────────────
//
// Pattern aligné sur ViewToggle de DerouleTab admin. Visible sur tous les
// breakpoints — sur mobile la timeline scroll naturellement (la timeline
// horizontale par lanes peut overflow le viewport étroit, c'est le comportement
// attendu : le destinataire scroll latéralement pour explorer les lanes).

function ViewToggle({ view, onChange }) {
  return (
    <div
      className="inline-flex items-center rounded-md p-0.5 shrink-0"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      <ToggleBtn
        active={view === 'timeline'}
        onClick={() => onChange('timeline')}
        title="Vue timeline (lanes × heures)"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Timeline
      </ToggleBtn>
      <ToggleBtn
        active={view === 'liste'}
        onClick={() => onChange('liste')}
        title="Vue liste"
      >
        <ListIcon className="w-3.5 h-3.5" />
        Liste
      </ToggleBtn>
    </div>
  )
}

function ToggleBtn({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 text-xs rounded inline-flex items-center gap-1 transition-colors"
      style={{
        background: active ? ACCENT : 'transparent',
        color: active ? '#fff' : 'var(--txt-2)',
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  )
}

// ─── Vue timeline (lanes verticales × heures, blocs absolus) ────────────────
//
// Calque visuel du DerouleTimelineView admin, simplifié read-only.
//
// Améliorations Vague 2.1 :
//   - SHARE-1+2 : auto-scroll au mount vers le 1er créneau (ou now line si jour J)
//   - SHARE-3   : légende des types de créneau présents dans le jour
//   - SHARE-4   : layout compact pour blocs de petite hauteur rendue (< 36px)
//   - SHARE-5   : click sur bloc → drawer détail read-only
//   - SHARE-7   : crop intelligent ±1h autour des bornes des créneaux
//                 (au lieu d'afficher la plage 00:00–23:59 quand seule la
//                 fenêtre 11:00–00:00 contient des événements).
//   - SHARE-8   : créneaux multi-lane rendus en bandeau transverse
//                 (top/bottom borders marquées, pas de border-radius) pour
//                 les distinguer visuellement des blocs mono-lane.
//
// La timeline étend dynamiquement la borne haute si un créneau déborde
// au-delà des bornes configurées (V0.5 : heure_fin_min jusqu'à 1680 = 04:00 J+1).

const COMPACT_BLOCK_THRESHOLD_PX = 36 // hauteur rendue < 36px → layout compact horizontal
const SCROLL_OFFSET_TOP = 80 // marge en haut du viewport pour l'auto-scroll

function CreneauxTimeline({ deroule, creneaux, lanes, membreById, todayIso, showSensitive }) {
  // [SHARE-7] Crop intelligent — la timeline n'affiche que la plage active
  // [1er créneau − 60min, dernier créneau + 60min], snappée sur les heures
  // rondes (10:30 → 10:00, 23:45 → 24:00). Évite l'immense vide en haut/bas
  // quand l'activité ne commence qu'à 11:00 sur un déroulé "00:00–23:59".
  // Si aucun créneau, on retombe sur les bornes configurées du déroulé pour
  // afficher la grille vide attendue.
  const { heureDebutMin, heureFinMin } = useMemo(() => {
    const startConfig = deroule?.heure_debut_min ?? 0
    const endConfig = deroule?.heure_fin_min ?? 1439

    if (creneaux.length === 0) {
      return { heureDebutMin: startConfig, heureFinMin: endConfig }
    }

    let firstStart = Infinity
    let lastEnd = -Infinity
    for (const c of creneaux) {
      if (typeof c.heure_debut_min === 'number' && c.heure_debut_min < firstStart) {
        firstStart = c.heure_debut_min
      }
      if (typeof c.heure_fin_min === 'number' && c.heure_fin_min > lastEnd) {
        lastEnd = c.heure_fin_min
      }
    }
    if (!isFinite(firstStart) || !isFinite(lastEnd)) {
      return { heureDebutMin: startConfig, heureFinMin: endConfig }
    }

    // Clamp [0, 1680] = [00:00, 04:00 J+1] pour les créneaux nuit.
    const startCropped = Math.max(0, Math.floor((firstStart - 60) / 60) * 60)
    const endCropped = Math.min(1680, Math.ceil((lastEnd + 60) / 60) * 60)

    return { heureDebutMin: startCropped, heureFinMin: endCropped }
  }, [creneaux, deroule])
  const stepMin = deroule?.display_step_min || 15

  // Now line — refresh chaque minute, visible uniquement si déroulé = aujourd'hui.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const isToday = deroule?.date_jour === todayIso
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null

  // Hauteur totale de la timeline = (heureFin - heureDebut) en heures × PX_PER_HOUR.
  // Calcul direct, sans repliage de plages vides — décision Hugo : la
  // timeline reste contiguë, même quand il y a des trous longs.
  const totalDisplayHeight = useMemo(
    () => Math.max(60, heureFinMin - heureDebutMin) / 60 * PX_PER_HOUR,
    [heureDebutMin, heureFinMin],
  )

  // Position helpers — projection minutes → pixels linéaire et continue.
  function minToDisplayY(min) {
    return ((min - heureDebutMin) / 60) * PX_PER_HOUR
  }
  function durationToDisplayHeight(startMin, endMin) {
    return Math.max(0, ((endMin - startMin) / 60) * PX_PER_HOUR)
  }

  const nowVisible =
    nowMin !== null && nowMin >= heureDebutMin && nowMin <= heureFinMin
  const showNowLine = nowVisible

  // Graduations sur toute la plage [heureDebutMin, heureFinMin], pas par stepMin.
  const graduations = useMemo(() => {
    const out = []
    for (let m = heureDebutMin; m <= heureFinMin; m += stepMin) {
      out.push({
        minutes: m,
        label: m % 60 === 0 ? formatMinHHMM(m) : null,
        isHourMark: m % 60 === 0,
      })
    }
    return out
  }, [heureDebutMin, heureFinMin, stepMin])

  // Partition créneaux : par lane (mono) + multi_lane (overlay sur tout)
  const creneauxByLane = useMemo(() => {
    const map = new Map()
    for (const lane of lanes) map.set(lane.id, [])
    for (const c of creneaux) {
      if (c.multi_lane) continue
      if (!map.has(c.lane_id)) map.set(c.lane_id, [])
      map.get(c.lane_id).push(c)
    }
    return map
  }, [lanes, creneaux])
  const creneauxMultiLane = useMemo(
    () => creneaux.filter((c) => c.multi_lane),
    [creneaux],
  )
  const sortedLanes = useMemo(
    () => [...lanes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [lanes],
  )

  // [SHARE-3] Légende — uniquement les types présents dans le jour.
  const presentTypes = useMemo(() => {
    const set = new Set()
    for (const c of creneaux) set.add(c.type || 'autre')
    // Ordre déterministe basé sur l'ordre de CRENEAU_TYPE_COLORS
    const ordered = Object.keys(CRENEAU_TYPE_COLORS).filter((t) => set.has(t))
    return ordered
  }, [creneaux])

  // [SHARE-1+2] Auto-scroll au mount.
  // Cible : nowMin si jour J, sinon le premier créneau du jour, en laissant
  // ~30min de contexte au-dessus pour éviter de coller la cible en haut.
  // On scroll la WINDOW (pas le container) : la timeline n'a pas son propre
  // scroll vertical, c'est la page entière qui scrolle.
  const wrapperRef = useRef(null)
  const didScrollRef = useRef(false)
  useEffect(() => {
    if (didScrollRef.current) return
    if (!wrapperRef.current) return
    didScrollRef.current = true

    let targetMin = null
    if (isToday && nowMin !== null && nowVisible) {
      targetMin = Math.max(heureDebutMin, nowMin - 30)
    } else if (creneaux.length > 0) {
      const sorted = [...creneaux].sort(
        (a, b) => (a.heure_debut_min ?? 0) - (b.heure_debut_min ?? 0),
      )
      targetMin = Math.max(heureDebutMin, (sorted[0].heure_debut_min ?? 0) - 30)
    }
    if (targetMin === null) return

    // requestAnimationFrame pour s'assurer que le layout est calculé.
    const raf = requestAnimationFrame(() => {
      const containerEl = wrapperRef.current
      if (!containerEl) return
      const rect = containerEl.getBoundingClientRect()
      const targetY = LANE_HEADER_H + minToDisplayY(targetMin)
      const absoluteY = rect.top + window.scrollY + targetY
      window.scrollTo({
        top: Math.max(0, absoluteY - SCROLL_OFFSET_TOP),
        behavior: 'auto',
      })
    })
    return () => cancelAnimationFrame(raf)
    // Volontairement run UNE seule fois au mount — c'est le but de
    // "auto-scroll initial". Refaire le scroll à chaque changement de
    // déroulé serait disruptif (il faudrait alors repenser la nav).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [SHARE-5 / SHARE-10] Popover détail au clic sur un bloc.
  // selected = { creneau, anchorRect } — anchorRect est le getBoundingClientRect
  // du bouton bloc au moment du clic. Sert d'ancre pour positionner le popover.
  const [selected, setSelected] = useState(null)

  // Helper pour rendre un bloc dans une lane (mono ou multi). Utilise
  // minToDisplayY pour gérer le repliage.
  function renderBlock(c, isMultiLane = false) {
    const top = minToDisplayY(c.heure_debut_min)
    const height = durationToDisplayHeight(c.heure_debut_min, c.heure_fin_min)
    return (
      <ReadOnlyBlock
        key={c.id}
        creneau={c}
        top={top}
        height={height}
        membreById={membreById}
        isMultiLane={isMultiLane}
        onClick={(rect) => setSelected({ creneau: c, anchorRect: rect })}
      />
    )
  }

  return (
    <>
      <div
        ref={wrapperRef}
        className="rounded-lg overflow-x-auto"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        {/* Header lanes */}
        <div
          className="flex"
          style={{
            background: 'var(--bg-elev)',
            borderBottom: '1px solid var(--brd)',
            minWidth: 'fit-content',
          }}
        >
          <div
            style={{
              width: TIME_COL_W,
              minWidth: TIME_COL_W,
              height: LANE_HEADER_H,
              borderRight: '1px solid var(--brd-sub)',
            }}
          />
          {sortedLanes.map((lane) => (
            <div
              key={lane.id}
              className="flex items-center gap-1 px-2 text-xs flex-1"
              style={{
                height: LANE_HEADER_H,
                borderRight: '1px solid var(--brd-sub)',
                fontWeight: 500,
                color: 'var(--txt-2)',
                minWidth: 120,
              }}
            >
              <span className="truncate">
                {lane.libelle || defaultLaneLibelle(lane.sort_order)}
              </span>
            </div>
          ))}
        </div>

        {/* Body timeline */}
        <div
          className="relative flex"
          style={{
            height: totalDisplayHeight + 16,
            minHeight: 200,
            minWidth: 'fit-content',
          }}
        >
          {/* Colonne heures */}
          <div
            style={{
              width: TIME_COL_W,
              minWidth: TIME_COL_W,
              position: 'relative',
              borderRight: '1px solid var(--brd-sub)',
            }}
          >
            {graduations.map((g) => (
              <div
                key={g.minutes}
                style={{
                  position: 'absolute',
                  top: minToDisplayY(g.minutes),
                  right: 6,
                  fontSize: 10,
                  color: g.isHourMark ? 'var(--txt-2)' : 'var(--txt-3)',
                  fontWeight: g.isHourMark ? 500 : 400,
                  lineHeight: 1,
                  transform: 'translateY(-50%)',
                }}
              >
                {g.label || ''}
              </div>
            ))}
          </div>

          {/* Lanes mono */}
          {sortedLanes.map((lane) => {
            const creneauxLane = creneauxByLane.get(lane.id) || []
            return (
              <div
                key={lane.id}
                className="flex-1 relative"
                style={{
                  borderRight: '1px solid var(--brd-sub)',
                  minWidth: 120,
                }}
              >
                {/* Graduations de fond */}
                {graduations.map((g) => (
                  <div
                    key={g.minutes}
                    style={{
                      position: 'absolute',
                      top: minToDisplayY(g.minutes),
                      left: 0,
                      right: 0,
                      height: 0,
                      borderTop: `1px ${g.isHourMark ? 'solid' : 'dashed'} var(--brd-sub)`,
                      opacity: g.isHourMark ? 0.6 : 0.25,
                      pointerEvents: 'none',
                    }}
                  />
                ))}
                {/* Créneaux mono-lane */}
                {creneauxLane.map((c) => renderBlock(c, false))}
              </div>
            )
          })}

          {/* Couche multi-lane : par-dessus toutes les lanes */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: 0,
              left: TIME_COL_W,
              right: 0,
              bottom: 0,
            }}
          >
            {creneauxMultiLane.map((c) => renderBlock(c, true))}
          </div>

          {/* Now line */}
          {showNowLine && (
            <div
              className="absolute pointer-events-none z-30"
              style={{
                top: minToDisplayY(nowMin),
                left: TIME_COL_W,
                right: 0,
                borderTop: '1.5px solid #E24B4A',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: -42,
                  top: -8,
                  background: '#E24B4A',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 500,
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                {formatMinHHMM(nowMin)}
              </div>
            </div>
          )}
        </div>

        {/* [SHARE-3] Légende des types de créneau présents */}
        {presentTypes.length > 0 && (
          <div
            className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-[10px] items-center"
            style={{
              borderTop: '1px solid var(--brd-sub)',
              color: 'var(--txt-3)',
              background: 'var(--bg-elev)',
            }}
          >
            <span className="font-semibold uppercase tracking-wider">
              Légende
            </span>
            {presentTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center gap-1"
                style={{ color: 'var(--txt-2)' }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: CRENEAU_TYPE_COLORS[type],
                    borderRadius: 2,
                    display: 'inline-block',
                  }}
                />
                {labelForType(type)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* [SHARE-5 / SHARE-10] Popover détail créneau, render via Portal.
          Desktop : popover ancré à droite (ou gauche si overflow) du bloc.
          Mobile  : bottom-sheet qui remonte du bas. */}
      {selected && (
        <CreneauDetailPopover
          creneau={selected.creneau}
          anchorRect={selected.anchorRect}
          lane={
            selected.creneau.multi_lane
              ? null
              : lanes.find((l) => l.id === selected.creneau.lane_id) || null
          }
          totalLanes={lanes.length}
          membreById={membreById}
          showSensitive={showSensitive}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

// ─── Bloc créneau read-only (timeline) ──────────────────────────────────────
//
// Rectangle coloré positionné en absolute. Click → ouvre le drawer détail.
//
// [SHARE-4] Layout compact horizontal quand la hauteur rendue est < 36px
// (au lieu de "durée ≤ 25min" qui laissait passer en mode 2-lignes les
// blocs de 30min, alors écrasés). Le seuil est basé sur la hauteur effective
// du bloc — plus robuste si PX_PER_HOUR change.
//
// [SHARE-9] Style identique pour mono-lane et multi-lane : même apparence
// (rounded, border-left épaisse, fond translucide). La seule différence est
// l'étendue horizontale (multi-lane s'étend de bord à bord, mono-lane reste
// confiné à sa lane) et l'indicateur subtil ↔ devant le titre. Décision
// Hugo : "trop incohérents par rapport aux autres" avec l'ancien bandeau.
//
// Ordre des infos cohérent entre compact et normal : titre EN PREMIER,
// heure ENSUITE (alignement avec le layout normal sur 2 lignes).

function ReadOnlyBlock({ creneau: c, top, height, membreById, isMultiLane = false, onClick }) {
  const color = effectiveCouleurCreneau(c)
  const minH = 22
  const memberIds = Array.isArray(c.member_ids) ? c.member_ids : []
  const isCancel = c.statut === 'annule'
  const dureeMin = creneauDureeMin(c)

  const renderedHeight = Math.max(minH, height - 2)
  const isCompact = renderedHeight < COMPACT_BLOCK_THRESHOLD_PX

  // Le handler passe le BoundingClientRect du bouton au parent — sert d'ancre
  // pour positionner le popover détail à côté du bloc cliqué (SHARE-10).
  const handleClick = (e) => onClick?.(e.currentTarget.getBoundingClientRect())

  // Style commun mono / multi-lane. La seule différence est le positionnement
  // horizontal : multi-lane s'étend pleine largeur (gérée par le container
  // parent qui le positionne par-dessus toutes les lanes), mono-lane reste
  // confiné à sa colonne avec une petite marge.
  const blockStyle = {
    top,
    left: isMultiLane ? 4 : 4,
    right: isMultiLane ? 4 : 4,
    height: renderedHeight,
    background: `${color}26`,
    borderLeft: `3px solid ${color}`,
    border: `1px solid ${color}55`,
    borderRadius: 4,
    color: 'var(--txt)',
    opacity: isCancel ? 0.5 : 1,
    textDecoration: isCancel ? 'line-through' : 'none',
    pointerEvents: 'auto',
    zIndex: isMultiLane ? 5 : 2,
    cursor: 'pointer',
  }

  const titrePrefix = isMultiLane ? '↔ ' : ''
  const titre = c.titre || '(sans titre)'

  if (isCompact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="absolute text-left flex items-center gap-2 overflow-hidden"
        style={{
          ...blockStyle,
          padding: '2px 6px',
          fontSize: 11,
        }}
        title={`${titre} · ${formatMinHHMM(c.heure_debut_min)} – ${formatMinHHMM(c.heure_fin_min)}${isMultiLane ? ' · multi-lane' : ''}`}
      >
        <span
          className="font-semibold truncate"
          style={{ color: 'var(--txt)', minWidth: 0 }}
        >
          {titrePrefix}{titre}
        </span>
        <span
          className="whitespace-nowrap shrink-0 text-[10px]"
          style={{ color }}
        >
          {formatMinHHMM(c.heure_debut_min)}
        </span>
      </button>
    )
  }

  const dureeStr =
    dureeMin >= 60
      ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
      : `${dureeMin}min`

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute overflow-hidden text-left"
      style={{
        ...blockStyle,
        padding: '4px 8px',
        fontSize: 11,
      }}
      title={`${titre} · ${formatMinHHMM(c.heure_debut_min)} – ${formatMinHHMM(c.heure_fin_min)} · ${dureeStr}${c.lieu_text ? ' · ' + c.lieu_text : ''}${isMultiLane ? ' · multi-lane' : ''}`}
    >
      <div
        className="font-semibold leading-tight truncate"
        style={{ color: 'var(--txt)' }}
      >
        {titrePrefix}{titre}
      </div>
      <div
        className="text-[10px] leading-tight mt-0.5 flex items-center gap-1.5 flex-wrap"
        style={{ color: 'var(--txt-2)' }}
      >
        <span style={{ color }}>
          {formatMinHHMM(c.heure_debut_min)} – {formatMinHHMM(c.heure_fin_min)}
        </span>
        {c.lieu_text && (
          <span className="truncate" style={{ color: 'var(--txt-3)' }}>
            · {c.lieu_text}
          </span>
        )}
      </div>
      {memberIds.length > 0 && height >= 48 && (
        <div className="flex gap-0.5 mt-1">
          {memberIds.slice(0, 4).map((mid) => {
            const m = membreById.get(mid)
            return (
              <div
                key={mid}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: `${color}55`,
                  color,
                  fontSize: 8,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={m?.fullName || ''}
              >
                {m?.ini || '?'}
              </div>
            )
          })}
          {memberIds.length > 4 && (
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
                fontSize: 8,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +{memberIds.length - 4}
            </div>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Popover détail créneau (SHARE-5 / SHARE-10) ────────────────────────────
//
// Refonte du drawer plein-écran latéral en :
//   - Desktop : popover ancré au bloc cliqué (à droite par défaut, basculé à
//               gauche si overflow, clampé dans le viewport). Sans overlay
//               sombre — le contexte de la timeline reste visible derrière.
//   - Mobile  : bottom-sheet qui remonte du bas (max-height 80vh), avec
//               overlay sombre tap-to-close.
//
// Rendu via React.createPortal sur document.body pour échapper au containing
// block créé par les parents animés (`.share-fade-in` utilise transform). Sans
// portal, position:fixed se comporte comme position:absolute relativement à
// l'animation parent — c'est ce qui causait le bug "le drawer reste collé au
// haut de la page quand on a scrollé".
//
// Fermeture : clic outside, Esc, bouton X, scroll window (desktop) pour
// éviter que le popover dérive de son ancre.

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(max-width: 639px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(max-width: 639px)')
    const onChange = (e) => setIsMobile(e.matches)
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // Safari < 14
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])
  return isMobile
}

const POPOVER_WIDTH = 340
const POPOVER_MARGIN = 12

function CreneauDetailPopover({
  creneau: c,
  anchorRect,
  lane,
  totalLanes,
  membreById,
  showSensitive,
  onClose,
}) {
  const color = effectiveCouleurCreneau(c)
  const dureeMin = creneauDureeMin(c)
  const dureeStr =
    dureeMin >= 60
      ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
      : `${dureeMin}min`
  const memberIds = Array.isArray(c.member_ids) ? c.member_ids : []
  const laneLibelle = c.multi_lane
    ? `↔ Multi (${totalLanes})`
    : lane?.libelle || (lane ? defaultLaneLibelle(lane.sort_order) : '—')

  const isMobile = useIsMobile()
  const popoverRef = useRef(null)
  const [position, setPosition] = useState(null) // { top, left } once measured

  // Esc to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Click outside to close. setTimeout(0) pour ne pas attraper l'event du
  // click qui a ouvert le popover (même tick).
  useEffect(() => {
    function onPointer(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose()
      }
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onPointer)
      document.addEventListener('touchstart', onPointer, { passive: true })
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [onClose])

  // [Desktop] Calcul position après render. Préférence right-of-anchor,
  // fallback left-of-anchor si overflow, sinon clamp horizontal au centre
  // du viewport. Idem vertical (clamp top et bottom).
  useLayoutEffect(() => {
    if (isMobile) return
    if (!popoverRef.current || !anchorRect) return
    const popRect = popoverRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = anchorRect.right + POPOVER_MARGIN
    let top = anchorRect.top

    if (left + popRect.width > vw - POPOVER_MARGIN) {
      const leftAlt = anchorRect.left - popRect.width - POPOVER_MARGIN
      if (leftAlt >= POPOVER_MARGIN) {
        left = leftAlt
      } else {
        // Pas la place sur les côtés, centrer horizontalement.
        left = Math.max(POPOVER_MARGIN, (vw - popRect.width) / 2)
      }
    }
    if (top + popRect.height > vh - POPOVER_MARGIN) {
      top = vh - popRect.height - POPOVER_MARGIN
    }
    if (top < POPOVER_MARGIN) top = POPOVER_MARGIN

    setPosition({ top, left })
  }, [isMobile, anchorRect])

  // [Desktop] Fermer au scroll window — le popover est fixed donc reste à
  // sa position viewport pendant que le bloc anchor se déplace, c'est laid.
  useEffect(() => {
    if (isMobile) return
    function onScroll() {
      onClose()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isMobile, onClose])

  // Contenu interne (header + body) partagé entre desktop popover et mobile
  // bottom-sheet. Identique au drawer précédent — c'est juste le contenant
  // qui change.
  const content = (
    <>
      <header
        className="flex items-start gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="flex-1 min-w-0">
          <h3
            className="text-base font-bold leading-tight"
            style={{
              color: 'var(--txt)',
              textDecoration: c.statut === 'annule' ? 'line-through' : 'none',
            }}
          >
            {c.titre || '(sans titre)'}
          </h3>
          <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span style={{ color }}>{labelForType(c.type || 'autre')}</span>
            {c.statut === 'fait' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                Fait
              </span>
            )}
            {c.statut === 'en_cours' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: `${color}22`, color }}
              >
                En cours
              </span>
            )}
            {c.statut === 'annule' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
              >
                Annulé
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--txt)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
          title="Fermer (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        <DetailRow
          icon={<Clock className="w-3.5 h-3.5" style={{ color }} />}
          label="Horaires"
        >
          <div className="font-semibold" style={{ color: 'var(--txt)' }}>
            {formatMinHHMM(c.heure_debut_min)} – {formatMinHHMM(c.heure_fin_min)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {dureeStr}
          </div>
        </DetailRow>

        <DetailRow
          icon={
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: color }}
            />
          }
          label="Lane"
        >
          <span
            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{
              background: c.multi_lane
                ? 'rgba(136,135,128,0.2)'
                : `${color}22`,
              color: c.multi_lane ? 'var(--txt-2)' : color,
            }}
          >
            {laneLibelle}
          </span>
        </DetailRow>

        {c.lieu_text && (
          <DetailRow
            icon={<MapPin className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />}
            label="Lieu"
          >
            <span style={{ color: 'var(--txt)' }}>{c.lieu_text}</span>
          </DetailRow>
        )}

        {memberIds.length > 0 && (
          <DetailRow
            icon={<Users className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />}
            label={`Équipe (${memberIds.length})`}
          >
            <div className="flex flex-col gap-1">
              {memberIds.map((mid) => {
                const m = membreById.get(mid)
                if (!m) return null
                return (
                  <div key={mid} className="flex items-center gap-2">
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: `${color}55`,
                        color,
                        fontSize: 10,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {m.ini}
                    </div>
                    <div className="text-xs min-w-0" style={{ color: 'var(--txt)' }}>
                      <div className="truncate">{m.fullName}</div>
                      {m.specialite && (
                        <div
                          className="text-[10px] truncate"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          {m.specialite}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </DetailRow>
        )}

        {c.description && (
          <DetailRow label="Description">
            <p
              className="text-xs leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--txt-2)' }}
            >
              {c.description}
            </p>
          </DetailRow>
        )}

        {showSensitive && c.notes && (
          <DetailRow label="Notes">
            <p
              className="text-xs leading-relaxed italic whitespace-pre-wrap"
              style={{ color: 'var(--txt-3)' }}
            >
              {c.notes}
            </p>
          </DetailRow>
        )}
      </div>
    </>
  )

  // [Mobile] Bottom-sheet : overlay sombre + sheet qui remonte du bas.
  if (isMobile) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-end share-fade-in"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          ref={popoverRef}
          className="w-full max-h-[80vh] flex flex-col rounded-t-2xl shadow-2xl"
          style={{
            background: 'var(--bg-surf)',
            borderTop: `4px solid ${color}`,
          }}
        >
          {/* Petite poignée visuelle pour suggérer "tu peux fermer" */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'var(--brd)',
              }}
            />
          </div>
          {content}
        </div>
      </div>,
      document.body,
    )
  }

  // [Desktop] Popover ancré, sans overlay. Rendu off-screen tant que la
  // position n'est pas mesurée (opacity 0) pour éviter le flash.
  return createPortal(
    <div
      ref={popoverRef}
      className="share-fade-in flex flex-col rounded-lg shadow-2xl"
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: POPOVER_WIDTH,
        maxHeight: '80vh',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderTop: `4px solid ${color}`,
        opacity: position ? 1 : 0,
        transition: 'opacity 80ms ease',
        zIndex: 50,
      }}
    >
      {content}
    </div>,
    document.body,
  )
}

function DetailRow({ icon, label, children }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-widest font-bold mb-1 flex items-center gap-1.5"
        style={{ color: 'var(--txt-3)' }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div className="ml-5 text-xs">{children}</div>
    </div>
  )
}

// Label affiché pour un type de créneau (utilisé dans légende + drawer).
function labelForType(type) {
  const labels = {
    install: 'Installation',
    repas: 'Repas',
    prise: 'Prise',
    pause: 'Pause',
    transport: 'Transport',
    brief: 'Briefing',
    live: 'Live',
    autre: 'Autre',
  }
  return labels[type] || type
}

// ─── Liste des créneaux (vue principale) ────────────────────────────────────

function CreneauxList({ creneaux, laneById, currentLanes, membreById, showSensitive }) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <ul>
        {creneaux.map((c, i) => (
          <CreneauRow
            key={c.id}
            creneau={c}
            zebra={i % 2 === 1}
            laneById={laneById}
            currentLanes={currentLanes}
            membreById={membreById}
            showSensitive={showSensitive}
            isLast={i === creneaux.length - 1}
          />
        ))}
      </ul>
    </div>
  )
}

function CreneauRow({
  creneau: c,
  zebra,
  laneById,
  currentLanes,
  membreById,
  showSensitive,
  isLast,
}) {
  const color = effectiveCouleurCreneau(c)
  const lane = c.multi_lane ? null : laneById.get(c.lane_id)
  const laneLibelle = lane?.libelle || (lane ? defaultLaneLibelle(lane.sort_order) : null)
  const dureeMin = creneauDureeMin(c)
  const dureeStr =
    dureeMin >= 60
      ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
      : `${dureeMin}min`
  const memberIds = Array.isArray(c.member_ids) ? c.member_ids : []

  return (
    <li
      className="px-3 sm:px-4 py-3"
      style={{
        background: zebra ? 'var(--bg-elev)' : 'transparent',
        borderBottom: isLast ? 'none' : '1px solid var(--brd-sub)',
        opacity: c.statut === 'annule' ? 0.5 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Bandeau couleur + heures */}
        <div
          className="shrink-0 rounded-md py-1.5 px-2 text-center"
          style={{
            background: `${color}22`,
            color,
            minWidth: 68,
            border: `1px solid ${color}33`,
          }}
        >
          <div className="text-xs font-bold leading-tight whitespace-nowrap">
            {formatMinHHMM(c.heure_debut_min)}
          </div>
          <div className="text-[10px] opacity-80 leading-tight">
            {formatMinHHMM(c.heure_fin_min)}
          </div>
          <div className="text-[9px] uppercase tracking-wider opacity-70 mt-0.5">
            {dureeStr}
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          {/* Titre + statut */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: color }}
            />
            <span
              className="text-sm font-semibold"
              style={{
                color: 'var(--txt)',
                textDecoration: c.statut === 'annule' ? 'line-through' : 'none',
              }}
            >
              {c.titre || '(sans titre)'}
            </span>
            {c.statut === 'fait' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                Fait
              </span>
            )}
            {c.statut === 'en_cours' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: `${color}22`, color }}
              >
                En cours
              </span>
            )}
            {c.statut === 'annule' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
              >
                Annulé
              </span>
            )}
          </div>

          {/* Meta : lane + lieu (le type est déduit de la couleur, pas de chip
              redondant — décision Hugo : "pas besoin d'afficher le chip type"). */}
          <div
            className="text-[11px] mt-1 flex items-center gap-3 flex-wrap"
            style={{ color: 'var(--txt-3)' }}
          >
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{
                background: c.multi_lane
                  ? 'rgba(136,135,128,0.2)'
                  : `${color}1a`,
                color: c.multi_lane ? 'var(--txt-2)' : color,
                fontWeight: 600,
              }}
            >
              {c.multi_lane
                ? `↔ Multi (${currentLanes.length})`
                : laneLibelle || '—'}
            </span>
            {c.lieu_text && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {c.lieu_text}
              </span>
            )}
          </div>

          {/* Membres assignés */}
          {memberIds.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {memberIds.map((id) => {
                const m = membreById.get(id)
                if (!m) return null
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: `${color}14`,
                      color: 'var(--txt-2)',
                      border: `1px solid ${color}26`,
                    }}
                    title={m.fullName}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[8px] font-bold"
                      style={{ background: `${color}33`, color }}
                    >
                      {m.ini}
                    </span>
                    <span className="hidden sm:inline">{m.fullName}</span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Description / notes */}
          {c.description && (
            <p
              className="text-[11px] mt-1.5 leading-relaxed"
              style={{ color: 'var(--txt-2)' }}
            >
              {c.description}
            </p>
          )}
          {showSensitive && c.notes && (
            <p
              className="text-[11px] mt-1 italic leading-relaxed"
              style={{ color: 'var(--txt-3)' }}
            >
              {c.notes}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

// ─── Empty / Status ─────────────────────────────────────────────────────────

function EmptyDeroulesState() {
  return (
    <div
      className="mt-6 rounded-xl p-12 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Clock
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucun déroulé planifié pour ce projet.
      </p>
    </div>
  )
}

function EmptyDayState() {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Inbox
        className="w-9 h-9 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucun créneau planifié sur cette journée.
      </p>
    </div>
  )
}

function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3 p-8"
      style={{ background: 'var(--bg)', color: 'var(--txt-2)' }}
    >
      {icon}
      <p className="text-sm">{children}</p>
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || ''
  const isInvalid = /invalid|expired|28000/i.test(msg)
  return (
    <FullScreenStatus
      icon={<AlertCircle className="w-7 h-7" style={{ color: 'var(--red)' }} />}
    >
      {isInvalid
        ? "Ce lien n'est plus valide ou a expiré."
        : 'Impossible de charger le déroulé.'}
    </FullScreenStatus>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDateIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function dayLabel(d) {
  if (!d) return ''
  return ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'][d.getDay()] || ''
}

function monthShort(d) {
  if (!d) return ''
  const months = [
    'janv', 'févr', 'mars', 'avr', 'mai', 'juin',
    'juil', 'août', 'sept', 'oct', 'nov', 'déc',
  ]
  return months[d.getMonth()] || ''
}


// ─── Réutilisation par le portail projet ─────────────────────────────────────
// PROJECT-SHARE : on expose ShareContent sous le nom DerouleShareView pour
// que la sous-page /share/projet/:token/deroule puisse le réutiliser avec
// le payload retourné par share_projet_deroule_fetch (même shape).
export { ShareContent as DerouleShareView }
