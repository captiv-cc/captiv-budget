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
import { useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Inbox,
  Info,
  LayoutGrid,
  Loader2,
  MapPin,
  Users,
  X,
} from 'lucide-react'
import { useDerouleShareSession } from '../hooks/useDerouleShareSession'
import { shareSetCreneauStatut } from '../lib/derouleShare'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import RichEditor from '../components/rich-editor'
import {
  effectiveCouleurCreneau,
  formatMinHHMM,
  sortCreneauxByTime,
  defaultLaneLibelle,
  creneauDureeMin,
  enrichCreneauxWithImplicitMembers,
  findMembreOverlaps,
  effectiveAlerte,
  ALERTE_COLORS,
  ALERTE_LABELS,
} from '../lib/deroule'
import DerouleCadreurView from '../features/deroule/DerouleCadreurView'
import { buildDerouleMultiJourPdf } from '../features/deroule/export/exportPDF'
import { buildDerouleCadreurPng } from '../features/deroule/export/exportPNG'
import { getProjectCreneauTypes } from '../lib/creneauTypes'
import { readShareIdentity, writeShareIdentity } from '../lib/shareIdentity'

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
  // Sprint B : overrides locaux des statuts créneaux (cochage cadreur via
  // la RPC publique share_deroule_set_creneau_statut). On garde les patches
  // en mémoire pour évite un refetch complet à chaque toggle. Si la RPC
  // échoue, on revert le patch.
  const [statutOverrides, setStatutOverrides] = useState(() => new Map())

  // Migration localStorage : si l'utilisateur avait sauvegardé 'liste'
  // (vue supprimée), bascule en 'timeline' au premier chargement.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(VIEW_STORAGE_KEY) === 'liste') {
      localStorage.setItem(VIEW_STORAGE_KEY, 'timeline')
    }
  }, [])

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

  return (
    <ShareContent
      payload={payload}
      theme={theme}
      setTheme={setTheme}
      token={token}
      statutOverrides={statutOverrides}
      setStatutOverrides={setStatutOverrides}
    />
  )
}

// ─── Contenu principal ──────────────────────────────────────────────────────

function ShareContent({
  payload,
  theme,
  setTheme,
  token,
  statutOverrides,
  setStatutOverrides,
}) {
  const share = payload.share || {}
  // useMemo pour stabiliser la référence (sinon la fonction qui dépend de
  // project recalcule à chaque render) — payload.project est une nouvelle
  // référence à chaque fetch même si le contenu est identique.
  const project = useMemo(() => payload.project || {}, [payload.project])
  const org = payload.org || null
  // Types V2 : merge core + custom (lus depuis project.creneau_types côté
  // share RPC, exposé via migration 20260608b_share_creneau_types.sql).
  // Sert à résoudre les couleurs des types personnalisés dans les blocs
  // de la timeline, le popover de détail, la vue cadreur et les exports.
  const projectTypes = useMemo(
    () => getProjectCreneauTypes(project),
    [project],
  )
  const deroules = useMemo(() => payload.deroules || [], [payload.deroules])
  const lanes = useMemo(() => payload.lanes || [], [payload.lanes])
  // Sprint B : on applique les overrides locaux (cochage cadreur via RPC
  // publique). Si un créneau a un override, on remplace son statut serveur
  // par celui de l'override jusqu'au prochain refetch.
  const creneaux = useMemo(() => {
    const raw = payload.creneaux || []
    if (!statutOverrides || statutOverrides.size === 0) return raw
    return raw.map((c) =>
      statutOverrides.has(c.id)
        ? { ...c, statut: statutOverrides.get(c.id) }
        : c,
    )
  }, [payload.creneaux, statutOverrides])
  const membres = useMemo(() => payload.membres || [], [payload.membres])
  const showSensitive = share.show_sensitive !== false

  // Sprint B : handler du toggle statut depuis la page share. Optimistic
  // update via statutOverrides, revert si RPC fail.
  const handleToggleStatut = async (creneauId, nextStatut) => {
    // Snapshot du statut précédent (serveur, hors override) pour revert.
    const prevServerCreneau = (payload.creneaux || []).find(
      (c) => c.id === creneauId,
    )
    const prevStatut = statutOverrides.get(creneauId)
      ?? prevServerCreneau?.statut
      ?? 'planifie'

    // Optimistic
    setStatutOverrides((prev) => {
      const next = new Map(prev)
      next.set(creneauId, nextStatut)
      return next
    })

    try {
      await shareSetCreneauStatut(token, creneauId, nextStatut)
    } catch (e) {
      console.error('[DerouleShareSession] toggle statut failed', e)
      // Revert
      setStatutOverrides((prev) => {
        const next = new Map(prev)
        next.set(creneauId, prevStatut)
        return next
      })
    }
  }

  // Sprint mobile-cadreur : state du créneau sélectionné (popover détail)
  // lifté ici pour être partagé entre la vue Timeline ET la vue Cadreur.
  // Le popover CreneauDetailPopover est rendu une seule fois en bas du
  // JSX. selected = { creneau, anchorRect } | null
  const [selectedCreneau, setSelectedCreneau] = useState(null)

  // Sprint mobile-export : state du sheet d'export (preview + télécharger).
  // exportRequest = { type: 'pdf' | 'png' } | null. Quand non-null, la
  // génération se déclenche et le sheet s'affiche (loader puis preview).
  const [exportRequest, setExportRequest] = useState(null)
  const handleSelectCreneau = (creneau, anchorRectOrEvent) => {
    if (!creneau) {
      setSelectedCreneau(null)
      return
    }
    // Le caller passe soit un DOMRect direct (CreneauxTimeline → ReadOnlyBlock),
    // soit un React event (DerouleCadreurView). On normalise.
    let rect = null
    if (anchorRectOrEvent && typeof anchorRectOrEvent.getBoundingClientRect === 'function') {
      rect = anchorRectOrEvent
    } else if (anchorRectOrEvent?.currentTarget?.getBoundingClientRect) {
      rect = anchorRectOrEvent.currentTarget.getBoundingClientRect()
    } else if (anchorRectOrEvent && 'top' in anchorRectOrEvent) {
      rect = anchorRectOrEvent
    }
    setSelectedCreneau({ creneau, anchorRect: rect })
  }

  // FEST-5 : on lit `?cadreur=<membre_id>` dans l'URL pour permettre des
  // liens directs vers la vue Cadreur d'un membre spécifique. Si le param
  // est présent, on force view='cadreur' et selectedCadreurId.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlCadreurId = searchParams.get('cadreur') || null

  // Vue active : 'timeline' / 'liste' / 'cadreur' (FEST-5).
  // Persistée par-tab dans localStorage. Sprint mobile : vue 'liste'
  // supprimée car redondante avec timeline + ambiguë (créneaux dupliqués
  // par lane). On reste sur 'timeline' / 'cadreur'.
  // Si ?cadreur=<id> dans l'URL → force 'cadreur'.
  const [view, setView] = useState(() => {
    if (urlCadreurId) return 'cadreur'
    if (typeof localStorage === 'undefined') return 'timeline'
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    if (stored === 'cadreur') return 'cadreur'
    // 'liste' (vue supprimée) ou autre → fallback timeline
    return 'timeline'
  })
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  // Cadreur sélectionné (synchronisé avec ?cadreur=<id> dans l'URL).
  // À défaut d'un id dans l'URL, on reprend l'identité que la personne a
  // déjà déclarée sur une autre page publique du projet (logistique) —
  // mémorisée par projet, cf. lib/shareIdentity. Elle reste modifiable et
  // ne change PAS la vue active : on ne bascule jamais en vue Cadreur
  // tout seul (principe posé sur l'export PNG).
  const [selectedCadreurId, setSelectedCadreurId] = useState(
    () => urlCadreurId || readShareIdentity(project.id),
  )
  useEffect(() => {
    // Sync URL → state quand l'URL change (cas back/forward navigation)
    if (urlCadreurId) {
      setSelectedCadreurId(urlCadreurId)
      setView('cadreur')
    }
  }, [urlCadreurId])
  function handleSelectCadreur(membreId) {
    setSelectedCadreurId(membreId)
    // Ce choix vaut identité pour les autres pages publiques du projet.
    writeShareIdentity(project.id, membreId)
    const next = new URLSearchParams(searchParams)
    if (membreId) next.set('cadreur', membreId)
    else next.delete('cadreur')
    setSearchParams(next, { replace: true })
  }

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
  // Index complet (tous jours) — utilisé par effectiveAlerte pour résoudre
  // l'héritage d'alerte via source_creneau_id. Le source peut être dans
  // un autre jour théoriquement, donc on indexe tous les créneaux.
  const creneauxById = useMemo(() => {
    const m = new Map()
    for (const c of creneaux) m.set(c.id, c)
    return m
  }, [creneaux])
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

  // FEST-5 : conflits par créneau pour la vue Cadreur.
  //
  // BUG FIX (mobile-2 follow-up) : on doit calculer les conflits PAR JOUR
  // (deroule_id). Avant : findMembreOverlaps sur l'ensemble du projet, ce
  // qui faisait apparaître en conflit un "Brief 17:15" du jeu 4 juin avec
  // un "Micro trottoir 18:30" du ven 13 juin (overlaps horaires sans
  // tenir compte de la date). Maintenant on groupe les créneaux par
  // deroule_id puis on calcule les overlaps dans chaque groupe.
  //
  // Côté admin (DerouleTab) ce bug n'existe pas car useDeroule(projectId,
  // selectedDate) ne charge que les créneaux du jour courant.
  const shareConflictsByCreneau = useMemo(() => {
    const map = new Map()
    if (!Array.isArray(creneaux) || creneaux.length === 0) return map
    if (!Array.isArray(membres) || membres.length === 0) return map

    // Group creneaux by deroule_id
    const byDay = new Map()
    for (const c of creneaux) {
      if (!c.deroule_id) continue
      let arr = byDay.get(c.deroule_id)
      if (!arr) {
        arr = []
        byDay.set(c.deroule_id, arr)
      }
      arr.push(c)
    }

    // Per-day overlap detection — chaque jour est isolé, donc deux créneaux
    // de jours différents ne peuvent plus matcher.
    for (const [, dayCreneaux] of byDay) {
      // Filter lanes for this day (enrichissement implicite par lane perso)
      const dayLanes = lanes.filter((l) =>
        dayCreneaux.some((c) => c.lane_id === l.id) ||
        // garde aussi les lanes type='personne' du même déroulé (utile pour
        // l'enrichissement implicite des cadreurs sans créneau direct)
        dayCreneaux.some((c) => c.deroule_id === l.deroule_id),
      )
      const enriched = enrichCreneauxWithImplicitMembers(dayCreneaux, dayLanes)
      for (const m of membres) {
        const pairs = findMembreOverlaps(m.id, enriched)
        for (const [a, b] of pairs) {
          const arrA = map.get(a.id) || []
          arrA.push({ creneau: b, membre: m })
          map.set(a.id, arrA)
          const arrB = map.get(b.id) || []
          arrB.push({ creneau: a, membre: m })
          map.set(b.id, arrB)
        }
      }
    }
    return map
  }, [creneaux, membres, lanes])
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

  // Cadreurs du jour (lane perso ou assignation) — liste du sous-menu
  // « Planning cadreur (PNG) ». Fallback lane : un id absent du payload
  // membres (fiche fusionnée, filtre RPC) est listé via le libellé de sa
  // lane perso — même logique que le sélecteur de la vue Cadreur.
  const cadreurOptions = useMemo(() => {
    const ids = new Set()
    const laneByMembre = new Map()
    for (const l of currentLanes) {
      if (l.type === 'personne' && l.membre_id) {
        ids.add(l.membre_id)
        laneByMembre.set(l.membre_id, l)
      }
    }
    for (const c of currentCreneaux) {
      for (const id of c.member_ids || []) ids.add(id)
    }
    return [...ids]
      .map((id) => {
        const m = membreById.get(id)
        if (m) {
          return {
            id,
            nom:
              `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.trim() || '?',
          }
        }
        const lane = laneByMembre.get(id)
        return lane ? { id, nom: lane.libelle || '?' } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }))
  }, [currentLanes, currentCreneaux, membreById])

  // En vue Cadreur, l'export PNG porte directement sur le cadreur affiché.
  const currentCadreur =
    view === 'cadreur'
      ? cadreurOptions.find((m) => m.id === selectedCadreurId) || cadreurOptions[0] || null
      : null

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

        {/* ── Sélecteur de jour + toggle vue — STICKY au scroll ──────────── */}
        {deroules.length === 0 ? (
          <EmptyDeroulesState />
        ) : (
          <>
            <div
              className="sticky z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-2.5 mt-5 flex items-start justify-between gap-3 flex-wrap share-sticky-bar"
              style={{
                top: 0,
                background: 'var(--bg)',
                borderBottom: '1px solid var(--brd-sub)',
              }}
            >
              <DaySelector
                deroules={deroules}
                selectedId={selectedDeroleId}
                onSelect={setSelectedDeroleId}
                todayIso={todayIso}
              />
              <div className="flex items-stretch gap-2 shrink-0">
                <ViewToggle view={view} onChange={setView} />
                <ExportButtons
                  cadreurs={cadreurOptions}
                  currentCadreur={currentCadreur}
                  onExport={(type, membreId = null) =>
                    setExportRequest({ type, membreId })
                  }
                />
              </div>
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

            {/* ── Vue active : timeline / liste / cadreur (FEST-5) ───────── */}
            <div className="mt-4">
              {currentCreneaux.length === 0 ? (
                <EmptyDayState />
              ) : view === 'cadreur' ? (
                <DerouleCadreurView
                  project={project}
                  deroule={currentDeroule}
                  lanes={currentLanes}
                  creneaux={currentCreneaux}
                  membres={membres}
                  conflictsByCreneau={shareConflictsByCreneau}
                  selectedMembreId={selectedCadreurId}
                  setSelectedMembreId={handleSelectCadreur}
                  /* Sprint mobile-cadreur : tap → drawer détail créneau
                     (partagé avec la vue Timeline via setSelectedCreneau). */
                  onSelectCreneau={handleSelectCreneau}
                  onToggleStatut={handleToggleStatut}
                  /* Force le layout 1-colonne (vue share = pas de programme
                     festival à droite, redondant avec la vue Timeline). */
                  singleColumn
                />
              ) : (
                <CreneauxTimeline
                  deroule={currentDeroule}
                  creneaux={currentCreneaux}
                  lanes={currentLanes}
                  membreById={membreById}
                  creneauxById={creneauxById}
                  projectTypes={projectTypes}
                  todayIso={todayIso}
                  onSelectCreneau={handleSelectCreneau}
                />
              )}
            </div>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <SharePageFooter />
      </div>

      {/* Popover détail créneau — partagé entre vue Timeline et vue Cadreur.
          Visible quand un créneau est sélectionné (tap sur bloc / mission). */}
      {selectedCreneau && (
        <CreneauDetailPopover
          creneau={selectedCreneau.creneau}
          anchorRect={selectedCreneau.anchorRect}
          lane={
            selectedCreneau.creneau.multi_lane
              ? null
              : lanes.find((l) => l.id === selectedCreneau.creneau.lane_id) || null
          }
          totalLanes={lanes.length}
          membreById={membreById}
          creneauxById={creneauxById}
          projectTypes={projectTypes}
          showSensitive={showSensitive}
          onClose={() => setSelectedCreneau(null)}
        />
      )}

      {/* Sheet d'export (preview + télécharger) — visible quand
          exportRequest != null. Génère le fichier puis affiche un aperçu
          plein écran (iframe pour PDF, img pour PNG). */}
      {exportRequest && (
        <ExportSharePreviewSheet
          type={exportRequest.type}
          project={project}
          deroule={currentDeroule}
          lanes={currentLanes}
          creneaux={currentCreneaux}
          membres={membres}
          membreId={exportRequest.membreId || selectedCadreurId}
          onClose={() => setExportRequest(null)}
        />
      )}
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
  // [SHARE-11] Auto-scroll horizontal du selector pour centrer le jour actif
  // au mount. Sinon, sur mobile étroit, le jour sélectionné peut être hors
  // viewport (ex : VEN 15 caché à droite quand on n'affiche que MAR/MER/JEU).
  // Le scroll ne se déclenche qu'une fois — on ne veut PAS re-scroller à
  // chaque clic utilisateur, ça créerait des sauts désorientants.
  const containerRef = useRef(null)
  const activeChipRef = useRef(null)
  const didScrollRef = useRef(false)
  useEffect(() => {
    if (didScrollRef.current) return
    if (!selectedId) return
    const container = containerRef.current
    const chip = activeChipRef.current
    if (!container || !chip) return
    didScrollRef.current = true

    // Centrage horizontal du chip actif dans le container scrollable.
    // chip.offsetLeft / container.clientWidth donnent les coordonnées
    // relatives au container scrollable. On vise chip-center == container-center.
    const targetScroll =
      chip.offsetLeft + chip.offsetWidth / 2 - container.clientWidth / 2
    container.scrollLeft = Math.max(0, targetScroll)
  }, [selectedId])

  return (
    <div
      ref={containerRef}
      className="-mx-1 overflow-x-auto flex-1 min-w-0"
    >
      <div className="inline-flex items-center gap-2 px-1 pb-1">
        {deroules.map((d) => {
          const isActive = d.id === selectedId
          const isToday = d.date_jour === todayIso
          const date = parseDateIso(d.date_jour)
          return (
            <button
              key={d.id}
              ref={isActive ? activeChipRef : null}
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
  // Sprint mobile : vue Liste supprimée (redondante avec timeline +
  // ambiguë car les créneaux multi-lane apparaissaient dupliqués). On
  // garde Timeline + Cadreur. Layout vertical (2 boutons empilés) pour
  // gagner de la place horizontale — laisse de la marge pour les
  // boutons d'export PDF/PNG à droite.
  return (
    <div
      className="inline-flex flex-col rounded-md p-0.5 shrink-0"
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
        <span>Timeline</span>
      </ToggleBtn>
      <ToggleBtn
        active={view === 'cadreur'}
        onClick={() => onChange('cadreur')}
        title="Vue par cadreur"
      >
        <Camera className="w-3.5 h-3.5" />
        <span>Cadreur</span>
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

// ─── Export buttons (PDF / PNG) ─────────────────────────────────────────────
//
// V1 : 2 boutons empilés "PDF" + "PNG" prenaient ~100px de largeur. Sur
// festival 5 jours, ça mangeait l'espace des chips jours.
// V2 : un seul bouton icône Download (~36px) qui ouvre un petit menu
// déroulant juste en-dessous avec les 2 options. Tap-out = close.

function ExportButtons({ cadreurs = [], currentCadreur = null, onExport }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef(null)
  const pngDisabled = cadreurs.length === 0
  // Sous-menu : liste des cadreurs du jour, dépliée au clic sur l'item PNG
  // (le choix du cadreur est toujours explicite — jamais de sélection auto).
  const [pngListOpen, setPngListOpen] = useState(false)

  // Replie le sous-menu cadreurs à chaque (ré)ouverture du menu
  useEffect(() => {
    setPngListOpen(false)
  }, [menuOpen])

  // Close au clic outside
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setMenuOpen(false)
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
  }, [menuOpen])

  // Esc to close
  useEffect(() => {
    if (!menuOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title="Télécharger"
        aria-label="Télécharger le déroulé"
        aria-expanded={menuOpen}
        className="rounded-md inline-flex items-center justify-center transition-colors"
        style={{
          width: 36,
          height: '100%',
          minHeight: 36,
          background: menuOpen ? ACCENT : 'var(--bg-surf)',
          border: '1px solid var(--brd-sub)',
          color: menuOpen ? '#fff' : 'var(--txt-2)',
        }}
      >
        <Download className="w-4 h-4" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute rounded-md shadow-2xl"
          style={{
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 200,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            zIndex: 40,
            padding: 4,
          }}
        >
          <ExportMenuItem
            icon={<FileText className="w-4 h-4" />}
            label="Planning déroulé (PDF)"
            sublabel="Tout le jour, toutes les lanes"
            onClick={() => {
              setMenuOpen(false)
              onExport('pdf')
            }}
          />
          <ExportMenuItem
            icon={<ImageIcon className="w-4 h-4" />}
            label="Planning cadreur (PNG)"
            sublabel={
              pngDisabled
                ? 'Aucun cadreur sur ce jour'
                : currentCadreur
                  ? `Format mobile · ${currentCadreur.nom}`
                  : 'Format mobile, choisis le cadreur'
            }
            disabled={pngDisabled}
            onClick={() => {
              if (pngDisabled) return
              // Vue Cadreur : exporte directement la personne affichée.
              if (currentCadreur) {
                setMenuOpen(false)
                onExport('png', currentCadreur.id)
                return
              }
              setPngListOpen((v) => !v)
            }}
          />
          {pngListOpen &&
            !currentCadreur &&
            cadreurs.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setPngListOpen(false)
                  onExport('png', m.id)
                }}
                className="w-full text-left rounded transition-colors"
                style={{
                  padding: '6px 10px 6px 36px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--txt)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {m.nom}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function ExportMenuItem({ icon, label, sublabel, onClick, disabled = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left flex items-start gap-2.5 rounded transition-colors"
      style={{
        padding: '8px 10px',
        color: disabled ? 'var(--txt-3)' : 'var(--txt)',
        background: 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: 44,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <div className="shrink-0 mt-0.5" style={{ color: disabled ? 'var(--txt-3)' : 'var(--txt-2)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate">{label}</div>
        <div
          className="text-[10px] truncate mt-0.5"
          style={{ color: 'var(--txt-3)' }}
        >
          {sublabel}
        </div>
      </div>
    </button>
  )
}

// ─── Sheet d'export PDF/PNG (preview + télécharger) ─────────────────────────
//
// Plein écran sur mobile (background opaque), modal centrée sur desktop.
// Workflow :
//   1. Mount → génère le fichier via buildDerouleMultiJourPdf ou
//      buildDerouleCadreurPng (selon type)
//   2. Loading spinner pendant la génération
//   3. Affiche l'aperçu (iframe pour PDF, <img> pour PNG)
//   4. Bouton "Télécharger" en bas
//   5. Au close, revoke() de l'URL du blob pour éviter les leaks
//
// Pas de configuration : on prend le jour courant + le cadreur sélectionné
// (déjà choisi par l'utilisateur dans la vue Cadreur).

function ExportSharePreviewSheet({
  type, // 'pdf' | 'png'
  project,
  deroule,
  lanes,
  creneaux,
  membres,
  membreId,
  onClose,
}) {
  const [result, setResult] = useState(null) // { url, filename, download, revoke }
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(true)

  // Génération au mount. On encapsule dans un useEffect avec cleanup pour
  // revoke l'URL si l'utilisateur ferme avant la fin.
  useEffect(() => {
    let cancelled = false
    let cleanupResult = null

    async function generate() {
      try {
        const deroulesData = [
          {
            deroule,
            lanes,
            creneaux,
            membres,
          },
        ]
        let r
        if (type === 'pdf') {
          r = await buildDerouleMultiJourPdf({
            project,
            deroulesData,
            generatedAt: new Date(),
          })
        } else {
          r = await buildDerouleCadreurPng({
            project,
            deroulesData,
            membreId,
            generatedAt: new Date(),
          })
        }
        if (cancelled) {
          r.revoke?.()
          return
        }
        cleanupResult = r
        setResult(r)
      } catch (e) {
        console.error('[ExportSharePreviewSheet] generation failed', e)
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setGenerating(false)
      }
    }
    generate()

    return () => {
      cancelled = true
      cleanupResult?.revoke?.()
    }
  }, [type, project, deroule, lanes, creneaux, membres, membreId])

  // Esc to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label =
    type === 'pdf' ? 'Planning déroulé (PDF)' : 'Planning cadreur (PNG)'

  // Sheet rendu via Portal pour échapper aux container constraints
  // (z-index, overflow, etc.).
  return createPortal(
    <div
      role="dialog"
      aria-label={`Aperçu ${label}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(4px)',
        animation: 'shareSheetFadeIn 200ms ease-out',
      }}
      onClick={(e) => {
        // Click sur le fond → close
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3"
        style={{
          background: 'var(--bg-surf)',
          borderBottom: '1px solid var(--brd-sub)',
          color: 'var(--txt)',
        }}
      >
        <div className="flex items-center gap-2">
          {type === 'pdf' ? (
            <FileText className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
          ) : (
            <ImageIcon className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
          )}
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--txt)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body : loader / erreur / preview */}
      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4"
        style={{ background: 'var(--bg)' }}
      >
        {generating ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--txt-3)' }} />
            <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Génération…
            </div>
          </div>
        ) : error ? (
          <div className="text-center max-w-sm">
            <AlertCircle className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--red)' }} />
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--txt)' }}>
              Erreur de génération
            </div>
            <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {error.message || String(error)}
            </div>
          </div>
        ) : result && type === 'pdf' ? (
          <iframe
            src={result.url}
            title={label}
            style={{
              width: '100%',
              height: '100%',
              border: '1px solid var(--brd)',
              borderRadius: 4,
              background: '#fff',
            }}
          />
        ) : result && type === 'png' ? (
          <img
            src={result.url}
            alt={label}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 4,
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
            }}
          />
        ) : null}
      </div>

      {/* Footer : bouton Télécharger */}
      <div
        className="shrink-0 px-4 py-3"
        style={{
          background: 'var(--bg-surf)',
          borderTop: '1px solid var(--brd-sub)',
        }}
      >
        <button
          type="button"
          onClick={() => result?.download()}
          disabled={!result}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-colors"
          style={{
            background: result ? ACCENT : 'var(--bg-hov)',
            color: result ? '#fff' : 'var(--txt-3)',
            cursor: result ? 'pointer' : 'not-allowed',
            opacity: result ? 1 : 0.6,
          }}
        >
          <Download className="w-4 h-4" />
          Télécharger
        </button>
        {result?.filename && (
          <div
            className="text-[10px] text-center mt-1.5 truncate"
            style={{ color: 'var(--txt-3)' }}
          >
            {result.filename}
          </div>
        )}
      </div>
    </div>,
    document.body,
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

function CreneauxTimeline({ deroule, creneaux, lanes, membreById, creneauxById, projectTypes = null, todayIso, onSelectCreneau }) {
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

  // Partition créneaux : par lane (mono) + multi_lane (overlay sur tout).
  // Les multi-colonnes (lane_ids 2+) sont rendus à part en blocs FUSIONNÉS
  // (cf. multiColsByAnchor plus bas).
  const creneauxByLane = useMemo(() => {
    const map = new Map()
    for (const lane of lanes) map.set(lane.id, [])
    for (const c of creneaux) {
      if (c.multi_lane) continue
      if (Array.isArray(c.lane_ids) && c.lane_ids.length >= 2) continue
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

  // Multi-colonnes : segments par lane ANCRE (mêmes règles que la timeline
  // desk) — plages contiguës dans l'ordre des colonnes = un bloc fusionné
  // (les colonnes sont en flex égal → largeur = spanCount × 100 %), lanes
  // non voisines = copies liées avec badge ⧉ N.
  const multiColsByAnchor = useMemo(() => {
    const idxById = new Map(sortedLanes.map((l, i) => [l.id, i]))
    const map = new Map()
    for (const c of creneaux) {
      if (c.multi_lane) continue
      if (!Array.isArray(c.lane_ids) || c.lane_ids.length < 2) continue
      const idxs = c.lane_ids
        .map((id) => idxById.get(id))
        .filter((i) => i !== undefined)
        .sort((a, b) => a - b)
      if (idxs.length === 0) continue
      const runs = []
      let run = [idxs[0]]
      for (let k = 1; k < idxs.length; k += 1) {
        if (idxs[k] === idxs[k - 1] + 1) run.push(idxs[k])
        else {
          runs.push(run)
          run = [idxs[k]]
        }
      }
      runs.push(run)
      runs.forEach((r, ri) => {
        const anchor = sortedLanes[r[0]].id
        const arr = map.get(anchor) || []
        arr.push({ creneau: c, spanCount: r.length, segCount: runs.length, segIndex: ri })
        map.set(anchor, arr)
      })
    }
    return map
  }, [creneaux, sortedLanes])

  // [SHARE-3] Légende — uniquement les types présents dans le jour, mais
  // résolus via projectTypes (core + custom) pour avoir libellé + couleur
  // côté types personnalisés.
  const presentTypes = useMemo(() => {
    const set = new Set()
    for (const c of creneaux) set.add(c.type || 'autre')
    const all = Array.isArray(projectTypes) && projectTypes.length > 0
      ? projectTypes
      : []
    // Ordre déterministe = ordre de projectTypes (core en premier, custom à la suite).
    // Fallback : si projectTypes est vide (vieux share sans creneau_types),
    // on construit à la volée depuis les keys présents avec gris fallback.
    if (all.length > 0) {
      return all.filter((t) => set.has(t.key))
    }
    return [...set].map((key) => ({
      key,
      libelle: labelForType(key),
      couleur: '#6B7280',
    }))
  }, [creneaux, projectTypes])

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

  // Sprint mobile-cadreur : le state du popover détail (selected) a été
  // lifté au niveau ShareContent (handleSelectCreneau + selectedCreneau)
  // pour être partagé avec la vue Cadreur. Le rendu du popover se fait
  // également en haut. Ici on s'occupe juste de propager l'event au
  // parent via la prop onSelectCreneau.

  // ─── Sprint mobile : indicateur de scroll horizontal ────────────────────
  // Sur mobile, 6 lanes sur 360px = ~60px/lane et la moitié est cachée à
  // droite sans aucun indice visuel. On ajoute :
  //   - fade gradient à gauche/droite quand des lanes sont hors viewport
  //   - chevron tappable qui scroll d'environ 1 lane (~150px)
  // Le wrapperRef sert aussi de scrollable (overflow-x-auto), donc on tracke
  // sa position via scroll listener + ResizeObserver (re-evalue au resize).
  const [scrollState, setScrollState] = useState({ left: false, right: false })
  const updateScrollState = () => {
    const el = wrapperRef.current
    if (!el) return
    const left = el.scrollLeft > 5
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 5
    setScrollState((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    )
  }
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateScrollState)
      ro.observe(el)
    }
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro?.disconnect()
    }
    // sortedLanes change => scrollWidth change => relistener; on inclut sa
    // longueur pour update au cas où.
  }, [sortedLanes.length])
  const scrollByOne = (direction) => {
    const el = wrapperRef.current
    if (!el) return
    // ~1 lane à la fois. Lane min-width est 120 ; scroll de 150 → couvre
    // un peu de marge confortable.
    const delta = direction === 'right' ? 150 : -150
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

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
        creneauxById={creneauxById}
        projectTypes={projectTypes}
        isMultiLane={isMultiLane}
        onClick={(rect) => onSelectCreneau?.(c, rect)}
      />
    )
  }

  return (
    <>
      {/* Container relatif pour overlays fade + chevrons.
          Fade : full-height absolute à gauche/droite quand des lanes hors viewport.
          Chevrons : sticky-positionnés au niveau du lane header (top:104) pour
          rester visibles pendant qu'on scrolle verticalement. */}
      <div className="relative">
        {scrollState.left && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none z-20"
            style={{
              top: 0,
              bottom: 0,
              left: 0,
              width: 28,
              background:
                'linear-gradient(to right, var(--bg-surf) 0%, transparent 100%)',
              borderTopLeftRadius: 8,
              borderBottomLeftRadius: 8,
            }}
          />
        )}
        {scrollState.right && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none z-20"
            style={{
              top: 0,
              bottom: 0,
              right: 0,
              width: 28,
              background:
                'linear-gradient(to left, var(--bg-surf) 0%, transparent 100%)',
              borderTopRightRadius: 8,
              borderBottomRightRadius: 8,
            }}
          />
        )}
        {/* Chevrons sticky : container 0-height pour ne pas pousser de
            layout, sticky au top de viewport (sous le sticky bar + lane
            header). pointer-events:none sur le container, auto sur les
            boutons eux-mêmes. */}
        <div
          className="sticky pointer-events-none"
          style={{ top: 104, height: 0, zIndex: 25 }}
        >
          {scrollState.left && (
            <button
              type="button"
              onClick={() => scrollByOne('left')}
              aria-label="Voir les lanes précédentes"
              className="pointer-events-auto flex items-center justify-center rounded-full shadow-md"
              style={{
                position: 'absolute',
                top: 4,
                left: 6,
                width: 32,
                height: 32,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt-2)',
              }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {scrollState.right && (
            <button
              type="button"
              onClick={() => scrollByOne('right')}
              aria-label="Voir plus de lanes"
              className="pointer-events-auto flex items-center justify-center rounded-full shadow-md"
              style={{
                position: 'absolute',
                top: 4,
                right: 6,
                width: 32,
                height: 32,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt-2)',
              }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      <div
        ref={wrapperRef}
        className="rounded-lg overflow-x-auto"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        {/* Header lanes — au top du wrapper en flow naturel.
            NB : on avait tenté `position: sticky; top: 96` pour garder
            les noms visibles au scroll vertical, mais le wrapper a
            overflow-x: auto, ce qui (per CSS spec) force overflow-y:
            auto et crée un scroll context vertical local. Du coup le
            sticky shiftait le header de 96px DANS le wrapper au lieu
            de suivre le scroll de la page → headers flottants au
            milieu de la timeline. Le sticky day selector (top de page)
            couvre l'essentiel du besoin nav. */}
        {/* Wrapper commun header + body : impose la MÊME largeur aux deux
            rangées flex. Sans lui, chaque rangée calcule sa largeur seule
            dans le scroller — les noms longs des lanes personne gonflent
            l'intrinsèque du header au-delà du body (56 + n×120) et les
            colonnes dérivent par rapport aux traits verticaux. */}
        <div style={{ minWidth: 'fit-content' }}>
        <div
          className="flex"
          style={{
            background: 'var(--bg-elev)',
            borderBottom: '1px solid var(--brd)',
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
                {/* Créneaux multi-colonnes ancrés ici : bloc fusionné qui
                    couvre spanCount colonnes (colonnes en flex égal). */}
                {(multiColsByAnchor.get(lane.id) || []).map(
                  ({ creneau: c, spanCount, segCount, segIndex }) => (
                    <ReadOnlyBlock
                      key={`${c.id}-seg${segIndex}`}
                      creneau={c}
                      top={minToDisplayY(c.heure_debut_min)}
                      height={durationToDisplayHeight(c.heure_debut_min, c.heure_fin_min)}
                      membreById={membreById}
                      creneauxById={creneauxById}
                      projectTypes={projectTypes}
                      spanCount={spanCount}
                      spanBadge={segCount > 1 ? `⧉${c.lane_ids.length}` : null}
                      onClick={(rect) => onSelectCreneau?.(c, rect)}
                    />
                  ),
                )}
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
            {presentTypes.map((t) => (
              <span
                key={t.key}
                className="inline-flex items-center gap-1"
                style={{ color: 'var(--txt-2)' }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: t.couleur,
                    borderRadius: 2,
                    display: 'inline-block',
                  }}
                />
                {t.libelle}
              </span>
            ))}
          </div>
        )}
      </div>
      </div>{/* /relative — fade & chevron overlays */}

      {/* Popover détail créneau : rendu au niveau ShareContent (parent)
          pour pouvoir être déclenché depuis la vue Timeline ET la vue
          Cadreur. Voir ShareContent. */}
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

function ReadOnlyBlock({ creneau: c, top, height, membreById, creneauxById, projectTypes = null, isMultiLane = false, spanCount = 1, spanBadge = null, onClick }) {
  const color = effectiveCouleurCreneau(c, projectTypes)
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
    left: 4,
    // Multi-colonnes : les colonnes sont en flex égal → un bloc couvrant
    // spanCount colonnes = spanCount × 100 % (+ bordures intermédiaires).
    ...(spanCount > 1
      ? { width: `calc(${spanCount * 100}% + ${spanCount - 1}px - 8px)` }
      : { right: 4 }),
    height: renderedHeight,
    background: `${color}26`,
    borderLeft: `3px solid ${color}`,
    border: `1px solid ${color}55`,
    borderRadius: 4,
    color: 'var(--txt)',
    opacity: isCancel ? 0.5 : 1,
    textDecoration: isCancel ? 'line-through' : 'none',
    pointerEvents: 'auto',
    zIndex: isMultiLane ? 5 : spanCount > 1 ? 4 : 2,
    cursor: 'pointer',
  }

  const titrePrefix = isMultiLane ? '↔ ' : spanBadge ? `${spanBadge} ` : ''
  const titre = c.titre || '(sans titre)'

  // Sprint mobile-cadreur : indicateur d'alerte sur les blocs timeline.
  // Triangle orange (important) ou ⓘ bleu (info) en haut-droite, visible
  // dès qu'un alerte est présent. Le détail s'affiche au tap (popover).
  // effectiveAlerte() résout aussi l'héritage soft-link (créneau source).
  const effAlerte = effectiveAlerte(c, creneauxById)
  const showAlerteIcon = Boolean(effAlerte)
  const alerteNiveau = effAlerte?.niveau || 'important'
  const alerteColor = ALERTE_COLORS[alerteNiveau] || ALERTE_COLORS.important
  const AlertIconCmp = alerteNiveau === 'info' ? Info : AlertTriangle

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
        title={`${titre} · ${formatMinHHMM(c.heure_debut_min)} – ${formatMinHHMM(c.heure_fin_min)}${isMultiLane ? ' · multi-lane' : ''}${effAlerte ? ' · ⚠ ' + effAlerte.text : ''}`}
      >
        {showAlerteIcon && (
          <AlertIconCmp
            className="shrink-0"
            style={{ width: 11, height: 11, color: alerteColor }}
          />
        )}
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
      title={`${titre} · ${formatMinHHMM(c.heure_debut_min)} – ${formatMinHHMM(c.heure_fin_min)} · ${dureeStr}${c.lieu_text ? ' · ' + c.lieu_text : ''}${isMultiLane ? ' · multi-lane' : ''}${effAlerte ? ' · ⚠ ' + effAlerte.text : ''}`}
    >
      {/* Icône alerte en haut-droite si présente */}
      {showAlerteIcon && (
        <AlertIconCmp
          className="absolute"
          style={{
            top: 3,
            right: 4,
            width: 12,
            height: 12,
            color: alerteColor,
          }}
        />
      )}
      <div
        className="font-semibold leading-tight truncate"
        style={{
          color: 'var(--txt)',
          paddingRight: showAlerteIcon ? 14 : 0,
        }}
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
  creneauxById,
  projectTypes = null,
  showSensitive,
  onClose,
}) {
  const color = effectiveCouleurCreneau(c, projectTypes)
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

        {/* Alertes (info ou important) avec héritage soft-link.
            effectiveAlerte() retourne aussi l'alerte du parent si l'enfant
            n'en a pas — ex: "Hamza @ cadreur" hérite de "3P CRASHS" venant
            de "Hamza @ scène". */}
        {(() => {
          const ea = effectiveAlerte(c, creneauxById)
          if (!ea) return null
          const alertColor = ALERTE_COLORS[ea.niveau] || ALERTE_COLORS.important
          const AlertIcon = ea.niveau === 'info' ? Info : AlertTriangle
          return (
            <DetailRow
              icon={<AlertIcon className="w-3.5 h-3.5" style={{ color: alertColor }} />}
              label={ALERTE_LABELS[ea.niveau] || 'Alerte'}
            >
              <div
                className="text-xs px-2 py-1.5 rounded leading-relaxed"
                style={{
                  background: `${alertColor}22`,
                  borderLeft: `3px solid ${alertColor}`,
                  color: 'var(--txt)',
                }}
              >
                {ea.text}
                {ea.inheritedFrom && (
                  <div
                    className="text-[10px] mt-1 italic"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    (hérité du créneau source)
                  </div>
                )}
              </div>
            </DetailRow>
          )
        })()}

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
            <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>
              <RichEditor value={c.notes} readOnly minHeight={0} />
            </div>
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
// Sprint types V2 : aligné sur CRENEAU_TYPE_LABELS de lib/deroule.js.
// Côté share, on n'a pas accès aux types custom du projet (pas dans le
// payload), donc on retombe sur la clé brute si pas de match. Pour V2,
// on pourra exposer project.creneau_types dans share_deroule_fetch.
function labelForType(type) {
  const labels = {
    install: 'Installation',
    brief: 'Briefing',
    tournage: 'Tournage',
    captation: 'Live',
    show: 'Show',
    interview: 'Interview',
    drone: 'Drone',
    ambiance: 'Ambiance',
    repas: 'Repas',
    pause: 'Pause',
    transport: 'Transport',
    postprod: 'Post-prod',
    autre: 'Autre',
    indispo: 'Indispo',
    // Legacy values for old data not yet migrated
    prise: 'Tournage',
    live: 'Show',
  }
  return labels[type] || type
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
