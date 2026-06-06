// ════════════════════════════════════════════════════════════════════════════
// DerouleTimelineView — Vue principale desktop (timeline verticale + lanes)
// ════════════════════════════════════════════════════════════════════════════
//
// Axe Y = heures (graduées par display_step_min, default 15min)
// Axe X = lanes (Global + 1..4 équipes parallèles)
//
// Les blocs sont positionnés en absolute selon leur heure_debut/heure_fin.
// Les blocs multi_lane sont rendus PAR-DESSUS toutes les lanes, sur toute
// la largeur de la zone créneaux (mais respectent l'espace réservé à
// l'axe heures à gauche).
//
// Now line : trait rouge horizontal qui marque l'heure courante, visible
// uniquement si la conduite affichée correspond à aujourd'hui.
//
// V1 : pas de drag/resize ici (Phase C). Click sur un bloc → onSelectCreneau.
// Click sur zone vide d'une lane → onCreateCreneauAt(lane, heure).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  AlertTriangle,
  Info as InfoIcon,
  MapPin,
  Camera,
  Users,
  Clipboard,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  Check,
} from 'lucide-react'
import {
  formatMinHHMM,
  effectiveCouleurCreneau,
  defaultLaneLibelle,
  snapToStep,
  CRENEAU_TYPE_COLORS,
  MAX_LANES_LIVE,
  MAX_MIN,
  effectiveLaneColor,
  isCreneauUnavailable,
  hasAlerte,
  ALERTE_COLORS,
} from '../../lib/deroule'
import { notify } from '../../lib/notify'
import { colorFromUserId } from '../../hooks/useProjectPresence'
import QuickCreateMenu from './QuickCreateMenu'
import AssignCadreurMenu from './AssignCadreurMenu'
import GoldenHourOverlay from './GoldenHourOverlay'
import {
  useLaneWidths,
  LANE_WIDTH_MIN,
  LANE_WIDTH_MAX,
} from '../../hooks/useLaneWidths'

const PX_PER_HOUR = 60 // 60px = 1h, donc 15px = 15min, 1px ≈ 1min
const LANE_HEADER_H = 36
const TIME_COL_W = 56

/**
 * @param {Object}  deroule
 * @param {Array}   lanes
 * @param {Map}     creneauxByLane
 * @param {Array}   creneauxMultiLane
 * @param {Array}   membres                   techlist du projet
 * @param {Map}     conflictsByCreneau        creneauId → [{creneau, membre}, ...]
 *                                             Phase D — overlap warnings
 * @param {boolean} canEdit
 * @param {Function} onSelectCreneau          (creneau) => void — ouvre l'inspecteur
 * @param {Function} onCreateCreneauAt        ({ lane_id, multi_lane, heure_debut, heure_fin }) => void
 * @param {Function} onAddLane                (libelle?) => void
 * @param {Function} onUpdateLane             (laneId, fields) => void
 * @param {Function} onDeleteLane             (laneId) => void
 * @param {Function} onMoveCreneau            (creneauId, fields) => Promise — Phase C
 */
export default function DerouleTimelineView({
  projectId = null,
  deroule,
  lanes,
  creneauxByLane,
  creneauxMultiLane,
  membres,
  conflictsByCreneau,
  canEdit,
  hasOpenInspector = false,
  creatingDraft = null,
  onSelectCreneau,
  onCreateCreneauAt,
  onAddLane,
  onUpdateLane,
  onDeleteLane,
  onReorderLane, // (laneId, neighborLaneId) → swap sort_order
  onMoveCreneau,
  // FEST-5.1d : overlay golden hour optionnel
  sunTimes = null,
  showGoldenHour = false,
}) {
  const containerRef = useRef(null)
  const bodyRef = useRef(null) // pour calcul lane sous mouseX en drag horizontal

  // FEST-5.5.4 : largeur des lanes par type, persistée localStorage
  const {
    getWidth: getLaneWidth,
    setWidth: setLaneWidth,
    resetWidth: resetLaneWidth,
  } = useLaneWidths(projectId)
  // État local du resize : { type, currentWidth } pendant le drag actif
  const [resizing, setResizing] = useState(null)

  // FEST-5.5.4 : démarre un resize global pour toutes les lanes du type
  // donné. Pendant le drag on update juste le state local (preview live
  // synchronisé sur header + body). Au mouseup on commit dans localStorage.
  function startLaneResize(type, initialWidth, startX) {
    let lastWidth = initialWidth
    function onMove(e) {
      const delta = e.clientX - startX
      const newWidth = Math.max(
        LANE_WIDTH_MIN,
        Math.min(LANE_WIDTH_MAX, initialWidth + delta),
      )
      lastWidth = newWidth
      setResizing({ type, currentWidth: newWidth })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLaneWidth(type, lastWidth)
      setResizing(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    setResizing({ type, currentWidth: initialWidth })
  }

  // Mapping membre_id → initiales pour les avatars
  const membreInitiales = useMemo(() => {
    const map = new Map()
    for (const m of membres || []) {
      // Priorité contact lié (live) sur surcharge membre. Cf. crew.js#fullNameFromPersona.
      const prenom = m.contact?.prenom || m.prenom || ''
      const nom = m.contact?.nom || m.nom || ''
      const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
      map.set(m.id, { initiales: ini, fullName: `${prenom} ${nom}`.trim() || '—' })
    }
    return map
  }, [membres])

  // Bornes timeline (V0.5 : déjà en minutes INTEGER côté DB)
  // FIX : étendre dynamiquement heureFinMin au max entre la borne configurée
  // du déroulé ET le créneau le plus tardif. Sinon un créneau qui déborde
  // sur le lendemain (ex: live 23:00 → 02:30 +1j) est tracé hors viewport.
  const heureDebutMin = deroule?.heure_debut_min ?? 0
  const heureFinMinConfig = deroule?.heure_fin_min ?? 1439
  // Récupère le max heure_fin_min de tous les créneaux (multi_lane + lanes)
  const allCreneaux = useMemo(() => {
    const arr = []
    for (const lane of lanes || []) {
      const cs = creneauxByLane.get(lane.id) || []
      for (const c of cs) arr.push(c)
    }
    for (const c of creneauxMultiLane || []) arr.push(c)
    return arr
  }, [lanes, creneauxByLane, creneauxMultiLane])

  // FEST-5.2 : détecte si un nouveau créneau (ou un déplacement) chevauche
  // une plage d'indisponibilité (type='indispo') dans la lane cible. Si oui,
  // on refuse le drop pour ne pas affecter un cadreur pendant son sommeil/off.
  // - excludeId : id à exclure de la vérification (pour le move d'un bloc lui-même)
  function findIndispoOverlap(laneId, debutMin, finMin, excludeId = null) {
    if (!laneId) return null
    const candidates = creneauxByLane.get(laneId) || []
    for (const c of candidates) {
      if (!isCreneauUnavailable(c)) continue
      if (c.id === excludeId) continue
      if (c.heure_debut_min < finMin && c.heure_fin_min > debutMin) {
        return c
      }
    }
    return null
  }
  const maxCreneauFin = useMemo(() => {
    let max = heureFinMinConfig
    for (const c of allCreneaux) {
      if (typeof c.heure_fin_min === 'number' && c.heure_fin_min > max) {
        max = c.heure_fin_min
      }
    }
    return max
  }, [allCreneaux, heureFinMinConfig])
  const heureFinMin = maxCreneauFin
  const totalMin = Math.max(60, heureFinMin - heureDebutMin)
  const totalHeight = (totalMin / 60) * PX_PER_HOUR
  const stepMin = deroule?.display_step_min || 15

  // Hugo : auto-scroll au mount vers 1h avant le premier événement de la
  // journée, pour éviter d'arriver à 00:00 et de devoir descendre à la main.
  // Ne se déclenche qu'au premier render avec des créneaux (puis on mémorise
  // l'ID du deroule pour reset si l'utilisateur change de jour).
  const firstEventMin = useMemo(() => {
    let min = Infinity
    for (const c of allCreneaux) {
      if (typeof c.heure_debut_min === 'number' && c.heure_debut_min < min) {
        min = c.heure_debut_min
      }
    }
    return Number.isFinite(min) ? min : null
  }, [allCreneaux])
  const lastAutoScrolledRef = useRef(null)
  useEffect(() => {
    if (!containerRef.current) return
    if (firstEventMin === null) return
    // Re-scroll seulement si on a changé de déroulé (autre jour)
    if (lastAutoScrolledRef.current === deroule?.id) return
    lastAutoScrolledRef.current = deroule?.id
    const target = Math.max(0, ((firstEventMin - 60 - heureDebutMin) / 60) * PX_PER_HOUR)
    // Pas de behavior smooth : instantané pour ne pas voir l'effet de "swoop"
    containerRef.current.scrollTo({ top: target, left: 0, behavior: 'auto' })
  }, [deroule?.id, firstEventMin, heureDebutMin])

  // Génère les graduations heures (chaque heure pleine est labelée).
  // V0.5 : formatMinHHMM gère le suffixe "+1j" pour les heures > 24h.
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

  // Now line — visible uniquement si déroulé = aujourd'hui
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000) // refresh chaque minute
    return () => clearInterval(timer)
  }, [])

  const isToday = useMemo(() => {
    if (!deroule?.date_jour) return false
    // FIX V0 : comparer en local time (cohérent avec selectedDate côté
    // DerouleTab qui utilise isoDate(new Date()) local). Avant : toISOString()
    // était UTC → décalage potentiel en soirée tardive ou tôt le matin.
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}` === deroule.date_jour
  }, [deroule?.date_jour, now])

  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null
  const nowVisible = nowMin !== null && nowMin >= heureDebutMin && nowMin <= heureFinMin

  // Calcul position en px d'un instant
  function minToTop(min) {
    return ((min - heureDebutMin) / 60) * PX_PER_HOUR
  }

  function durationToHeight(durMin) {
    return (durMin / 60) * PX_PER_HOUR
  }

  // ─── Phase C — Drag & drop + resize ────────────────────────────────────
  // dragState capture le créneau en cours de manipulation et les deltas
  // souris depuis le début du drag. Pendant le drag, le bloc concerné
  // est rendu avec une position dérivée + visuel "ghost" (opacity, outline).
  // Au mouseup, on commit via onMoveCreneau(creneauId, fields).
  //
  // mode :
  //   - 'move'         : déplace le bloc (heure_debut + heure_fin shift de
  //                       deltaMin, durée préservée). Drag horizontal aussi
  //                       pour changer de lane.
  //   - 'resize-top'   : ajuste heure_debut_min sans toucher heure_fin_min.
  //   - 'resize-bottom': ajuste heure_fin_min sans toucher heure_debut_min.
  //
  // Snap : 15 min par défaut, 5 min si Alt enfoncé pendant le drag.
  const [dragState, setDragState] = useState(null)
  // FEST-3.2 : menu de création rapide au clic simple (sans drag).
  // shape : { anchorRect, lane, heureCible, heureFin, overlappingCreneaux }
  const [quickMenu, setQuickMenu] = useState(null)
  // FEST-3.3 : menu d'attribution au right-click sur un bloc show.
  // shape : { sourceCreneau (avec _mouseX/_mouseY), cadreurs }
  const [assignMenu, setAssignMenu] = useState(null)
  const dragStateRef = useRef(null)
  dragStateRef.current = dragState

  // FIX V0 : flag qui empêche le `click` natif post-drag de fire l'onClick
  // du bloc (qui ouvrirait l'inspector). Set à true au mouseup APRÈS commit
  // d'un drag réel, reset au prochain tick (suffisant car le `click` event
  // est dispatché juste après `mouseup` dans la même tâche).
  const justDraggedRef = useRef(false)

  // FEST-3.3 : right-click sur un bloc d'une lane type 'lieu' → ouvre le
  // menu d'attribution avec les cadreurs filtrés par dispo.
  function handleBlockContextMenu(e, creneau) {
    if (!canEdit) return
    const lane = lanes.find((l) => l.id === creneau.lane_id)
    // On n'active le right-click que sur les blocs de lanes 'lieu' (shows).
    // Pour les autres types (global, equipe, personne), on laisse le menu
    // contextuel browser natif.
    if (lane?.type !== 'lieu') return
    e.preventDefault()
    e.stopPropagation()
    // Compose la liste des cadreurs avec leur état :
    //   - lane (la lane du cadreur)
    //   - busyCreneau (s'il a un créneau qui chevauche)
    //   - alreadyAssigned (s'il est déjà attribué à ce show via un enfant
    //     existant dans sa lane lié à source_creneau_id=creneau.id)
    const cadreurLanes = lanes.filter((l) => l.type === 'personne')
    const cadreurs = cadreurLanes.map((lane) => {
      const creneauxLane = creneauxByLane.get(lane.id) || []
      // Déjà attribué : un créneau de cette lane a source_creneau_id pointant
      // sur le show source.
      const existing = creneauxLane.find(
        (c) => c.source_creneau_id === creneau.id,
      )
      // Occupé : a un créneau qui chevauche les horaires du show (autre que
      // celui déjà lié au show)
      const busy = creneauxLane.find((c) => {
        if (existing && c.id === existing.id) return false
        return (
          c.heure_debut_min < creneau.heure_fin_min &&
          c.heure_fin_min > creneau.heure_debut_min
        )
      })
      return {
        lane,
        busyCreneau: busy || null,
        alreadyAssigned: Boolean(existing),
      }
    })
    setAssignMenu({
      sourceCreneau: {
        ...creneau,
        _mouseX: e.clientX,
        _mouseY: e.clientY,
      },
      cadreurs,
    })
  }

  function handleBlockClick(creneau, eventOrRect) {
    // FIX V0 : si on vient juste de finir un drag commité, on ignore le
    // click natif (sinon l'inspector s'ouvre tout seul après chaque drag).
    if (justDraggedRef.current) return
    // POP-1 : propagation du rect/event au handler parent pour ancrer
    // le popover sur le bloc cliqué.
    onSelectCreneau?.(creneau, eventOrRect)
  }

  function handleBlockMouseDown(e, creneau, mode) {
    if (!canEdit) return
    if (e.button !== 0) return // left click only
    e.stopPropagation()
    e.preventDefault()
    setDragState({
      creneauId: creneau.id,
      mode,
      initialMouseY: e.clientY,
      initialMouseX: e.clientX,
      initialDebutMin: creneau.heure_debut_min,
      initialFinMin: creneau.heure_fin_min,
      initialLaneId: creneau.lane_id,
      multiLane: creneau.multi_lane,
      // valeurs courantes pendant le drag (override visuel + commit final)
      currentDebutMin: creneau.heure_debut_min,
      currentFinMin: creneau.heure_fin_min,
      currentLaneId: creneau.lane_id,
      hasMoved: false,
      altKey: e.altKey,
    })
  }

  // ─── Click-and-drag pour création (façon Google Calendar vue jour) ─────
  // mouseDown sur zone vide d'une lane → on enregistre le point de départ.
  // mouseMove → on étend la "preview" entre [debutMin, mouseMin].
  // mouseUp → si on a draggé (delta > 5 min), on ouvre l'inspector en mode
  // création avec les heures choisies. Sinon (clic simple), comportement
  // par défaut : créneau de 30 min à l'heure cliquée.
  function handleLaneMouseDown(e, laneId, isMultiLaneZone = false) {
    if (!canEdit) return
    if (e.button !== 0) return
    if (e.target !== e.currentTarget) return // ne pas déclencher si on clique sur un bloc enfant
    // Hugo : si une modale est ouverte, click sur zone vide = juste fermer
    // la modale (Google Calendar style). Le click-outside du popover s'en
    // occupera ; ici on bloque juste la création parasite.
    if (hasOpenInspector) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutesFromTop = (y / PX_PER_HOUR) * 60
    const startMin = Math.round((heureDebutMin + minutesFromTop) / 15) * 15
    const clamped = Math.max(heureDebutMin, Math.min(heureFinMin - 5, startMin))
    setDragState({
      creneauId: null,
      mode: 'create',
      multiLane: isMultiLaneZone,
      initialMouseY: e.clientY,
      initialMouseX: e.clientX,
      initialDebutMin: clamped,
      initialFinMin: clamped + 30,
      initialLaneId: isMultiLaneZone ? null : laneId,
      currentDebutMin: clamped,
      currentFinMin: clamped + 30,
      currentLaneId: isMultiLaneZone ? null : laneId,
      hasMoved: false,
      altKey: e.altKey,
      // Hugo : rect de la lane cliquée → utilisé au mouseup pour calculer
      // le rect du futur bloc et l'ancrer correctement au popover.
      laneRect: rect,
    })
  }

  // Listener global mouseMove + mouseUp pendant un drag actif
  useEffect(() => {
    if (!dragState) return undefined

    function pixelsToMin(deltaPx) {
      return (deltaPx / PX_PER_HOUR) * 60
    }

    function findLaneIdAtX(clientX) {
      // Trouve la lane sous mouseX en parcourant les rect des colonnes lane
      // (les divs lane ont un attribut data-lane-id pour les retrouver).
      if (!bodyRef.current) return null
      const laneEls = bodyRef.current.querySelectorAll('[data-lane-id]')
      for (const el of laneEls) {
        const r = el.getBoundingClientRect()
        if (clientX >= r.left && clientX <= r.right) {
          return el.getAttribute('data-lane-id')
        }
      }
      return null
    }

    function onMove(e) {
      const s = dragStateRef.current
      if (!s) return
      const step = e.altKey ? 5 : 15
      const deltaY = e.clientY - s.initialMouseY
      const deltaMin = pixelsToMin(deltaY)
      let nextDebut = s.initialDebutMin
      let nextFin = s.initialFinMin
      let nextLaneId = s.initialLaneId

      if (s.mode === 'move') {
        const snapped = snapToStep(deltaMin, step)
        nextDebut = s.initialDebutMin + snapped
        nextFin = s.initialFinMin + snapped
        // Clamp dans les bornes
        if (nextDebut < heureDebutMin) {
          const correction = heureDebutMin - nextDebut
          nextDebut += correction
          nextFin += correction
        }
        if (nextFin > MAX_MIN) {
          const correction = nextFin - MAX_MIN
          nextDebut -= correction
          nextFin -= correction
        }
        // Drag horizontal entre lanes (uniquement pour les blocs non multi-lane)
        if (!s.multiLane) {
          const laneId = findLaneIdAtX(e.clientX)
          if (laneId) nextLaneId = laneId
        }
      } else if (s.mode === 'resize-top') {
        const snapped = snapToStep(deltaMin, step)
        nextDebut = s.initialDebutMin + snapped
        // Pas plus haut que heureDebutMin, pas plus bas que finMin - 5
        nextDebut = Math.max(heureDebutMin, Math.min(s.initialFinMin - 5, nextDebut))
      } else if (s.mode === 'resize-bottom') {
        const snapped = snapToStep(deltaMin, step)
        nextFin = s.initialFinMin + snapped
        nextFin = Math.min(MAX_MIN, Math.max(s.initialDebutMin + 5, nextFin))
      } else if (s.mode === 'create') {
        // Click-and-drag depuis zone vide : on étend la "preview" entre
        // initialDebutMin et la position courante du curseur.
        // Si l'utilisateur drag vers le BAS, fin = initialDebut + delta.
        // Si vers le HAUT, on swap (debut = position curseur, fin = initial).
        const snapped = snapToStep(deltaMin, step)
        if (snapped >= 0) {
          nextDebut = s.initialDebutMin
          nextFin = Math.min(MAX_MIN, s.initialDebutMin + Math.max(5, snapped + 30))
        } else {
          nextFin = s.initialDebutMin + 30
          nextDebut = Math.max(heureDebutMin, s.initialDebutMin + snapped)
        }
      }

      const hasChanged =
        nextDebut !== s.initialDebutMin ||
        nextFin !== s.initialFinMin ||
        nextLaneId !== s.initialLaneId
      const hasMoved = s.hasMoved || Math.abs(deltaY) > 3 || Math.abs(e.clientX - s.initialMouseX) > 3

      setDragState({
        ...s,
        currentDebutMin: nextDebut,
        currentFinMin: nextFin,
        currentLaneId: nextLaneId,
        altKey: e.altKey,
        hasMoved: hasMoved && hasChanged,
      })
    }

    async function onUp() {
      const s = dragStateRef.current
      setDragState(null)
      if (!s) return

      // Mode 'create' (click-and-drag depuis zone vide).
      // FEST-3.2 : si DRAG (hasMoved) → création direct comme avant.
      // Si CLICK simple → ouvre le menu rapide QuickCreateMenu pour proposer
      // des actions pré-remplies + créneaux à lier.
      if (s.mode === 'create') {
        // Marque pour éviter qu'un click handler parasite ne tire derrière
        justDraggedRef.current = true
        setTimeout(() => {
          justDraggedRef.current = false
        }, 0)
        const debut = s.hasMoved ? s.currentDebutMin : s.initialDebutMin
        const fin = Math.min(MAX_MIN, s.hasMoved ? s.currentFinMin : s.initialDebutMin + 30)
        // Calcule le rect du futur bloc dans le viewport pour ancrer le
        // popover correctement (cf. fix Hugo : sinon le popover s'ancrait
        // au point cliqué et se décalait au recalcul usePopoverPosition).
        let anchorRect = null
        if (s.laneRect) {
          const laneRect = s.laneRect
          const offsetTopMin = debut - heureDebutMin
          const durMin = fin - debut
          const blockTop = laneRect.top + (offsetTopMin / 60) * PX_PER_HOUR
          const blockHeight = (durMin / 60) * PX_PER_HOUR
          anchorRect = {
            top: blockTop,
            left: laneRect.left + 4,
            right: laneRect.right - 4,
            bottom: blockTop + blockHeight,
            width: laneRect.width - 8,
            height: blockHeight,
          }
        }

        if (s.hasMoved) {
          // FEST-5.2 : refuse la création si la zone chevauche une indispo
          // (sauf si on crée multi-lane, par design transversal).
          if (!s.multiLane) {
            const indispo = findIndispoOverlap(s.initialLaneId, debut, fin)
            if (indispo) {
              notify.error(
                `Plage d'indispo (${formatMinHHMM(indispo.heure_debut_min)}–${formatMinHHMM(indispo.heure_fin_min)}) — création refusée`,
              )
              return
            }
          }
          // Drag → création directe avec horaires choisis (créneau libre)
          onCreateCreneauAt?.(
            {
              lane_id: s.multiLane ? null : s.initialLaneId,
              multi_lane: s.multiLane,
              heure_debut_min: debut,
              heure_fin_min: fin,
            },
            anchorRect,
          )
        } else {
          // Click simple → ouvre QuickCreateMenu. Compose la liste des
          // créneaux qui chevauchent l'heure cliquée dans les AUTRES lanes
          // (proposés en "Lié à ce moment").
          const overlapping = allCreneaux
            .filter((c) => {
              if (c.lane_id === s.initialLaneId) return false
              if (c.multi_lane) return false
              const overlap = c.heure_debut_min < fin && c.heure_fin_min > debut
              return overlap
            })
            // FEST-3.2 raffinement Hugo : enrichir avec un lieu inféré
            // depuis la lane source (si la lane est de type 'lieu', son
            // libelle EST le lieu — ex: "Scène Médiator").
            .map((c) => {
              const sourceLane = lanes.find((l) => l.id === c.lane_id)
              const lieuInferred =
                sourceLane?.type === 'lieu'
                  ? sourceLane.libelle
                  : c.lieu_text || ''
              return { ...c, _lieuInferred: lieuInferred }
            })
          // Tri par heure de début pour scan visuel
          overlapping.sort((a, b) => a.heure_debut_min - b.heure_debut_min)
          // FEST-5.2 : récupère le type de la lane cliquée pour permettre
          // au QuickCreateMenu d'afficher "Indispo / Sommeil" si cadreur.
          const clickedLane = lanes.find((l) => l.id === s.initialLaneId)
          setQuickMenu({
            anchorRect,
            laneId: s.initialLaneId,
            laneType: clickedLane?.type || null,
            multiLane: s.multiLane,
            heureCible: debut,
            heureFin: fin,
            overlappingCreneaux: overlapping,
          })
        }
        return
      }

      // Si le drag n'a pas vraiment bougé → c'est un click, on laisse passer
      // (le onClick du bloc s'appliquera via l'événement parallèle).
      if (!s.hasMoved) return
      // Marque que le click natif qui suit le mouseup ne doit PAS ouvrir
      // l'inspector (sinon ouverture parasite après chaque drag réussi).
      justDraggedRef.current = true
      setTimeout(() => {
        justDraggedRef.current = false
      }, 0)

      // FEST-3.1 : drag d'un bloc d'une lane LIEU vers une lane PERSONNE
      // → on CRÉE un tournage lié au lieu de DÉPLACER le show.
      if (
        s.mode === 'move' &&
        !s.multiLane &&
        s.currentLaneId !== s.initialLaneId
      ) {
        const movedCreneau = allCreneaux.find((c) => c.id === s.creneauId)
        const sourceLane = lanes.find((l) => l.id === s.initialLaneId)
        const destLane = lanes.find((l) => l.id === s.currentLaneId)
        if (
          sourceLane?.type === 'lieu' &&
          destLane?.type === 'personne' &&
          movedCreneau
        ) {
          // FEST-5.2 : refuse le cross-lane-assign si la lane cadreur a une
          // indispo sur la plage demandée (cadreur en sommeil/off).
          const indispo = findIndispoOverlap(
            destLane.id,
            s.currentDebutMin,
            s.currentFinMin,
          )
          if (indispo) {
            notify.error(
              `${destLane.libelle || 'Cadreur'} indispo ${formatMinHHMM(indispo.heure_debut_min)}–${formatMinHHMM(indispo.heure_fin_min)} — attribution refusée`,
            )
            return
          }
          // Cross-lane-assign : créer un tournage lié dans la lane cadreur,
          // sans bouger le show source. Mêmes horaires que le drop (peut
          // être décalé si l'utilisateur a déplacé le bloc dans le temps
          // pendant le drag).
          const lieuInferred = sourceLane.libelle || movedCreneau.lieu_text || null
          onCreateCreneauAt?.(
            {
              lane_id: destLane.id,
              multi_lane: false,
              heure_debut_min: s.currentDebutMin,
              heure_fin_min: s.currentFinMin,
              type: 'prise',
              titre: movedCreneau.titre || '',
              lieu_text: lieuInferred,
              notes: movedCreneau.notes || null,
              source_creneau_id: movedCreneau.id,
              source_anchor: {
                fields: ['titre', 'lieu_text', 'heure_debut_min', 'notes'],
              },
              member_ids: destLane.membre_id ? [destLane.membre_id] : [],
              _skipInspector: true,
            },
            null,
          )
          return
        }
      }

      const fields = {
        heure_debut_min: s.currentDebutMin,
        heure_fin_min: s.currentFinMin,
      }
      if (s.mode === 'move' && !s.multiLane && s.currentLaneId !== s.initialLaneId) {
        fields.lane_id = s.currentLaneId
      }
      // Skip le call si rien n'a changé
      const noChange =
        fields.heure_debut_min === s.initialDebutMin &&
        fields.heure_fin_min === s.initialFinMin &&
        !('lane_id' in fields)
      if (noChange) return
      // FEST-5.2 : refuse le déplacement s'il chevauche une indispo dans la
      // lane cible (sauf pour le créneau lui-même s'il EST une indispo).
      // - On exclut le créneau déplacé de la vérif (excludeId) car bien sûr
      //   il "se chevauche lui-même".
      const movedC = allCreneaux.find((c) => c.id === s.creneauId)
      const targetLaneId = fields.lane_id || s.initialLaneId
      if (!s.multiLane && !isCreneauUnavailable(movedC)) {
        const indispo = findIndispoOverlap(
          targetLaneId,
          fields.heure_debut_min,
          fields.heure_fin_min,
          s.creneauId,
        )
        if (indispo) {
          const targetLane = lanes.find((l) => l.id === targetLaneId)
          notify.error(
            `${targetLane?.libelle || 'Lane'} indispo ${formatMinHHMM(indispo.heure_debut_min)}–${formatMinHHMM(indispo.heure_fin_min)} — déplacement refusé`,
          )
          return
        }
      }
      try {
        await onMoveCreneau?.(s.creneauId, fields)
      } catch (err) {
        console.error('[DerouleTimelineView] move/resize commit error', err)
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        setDragState(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.creneauId])

  // (handleEmptyClick / handleMultiLaneClick supprimés en Phase C — la
  // création se fait désormais via handleLaneMouseDown qui gère click +
  // click-and-drag, façon Google Calendar.)

  // Sort lanes by sort_order (lane 0 d'abord)
  const sortedLanes = useMemo(
    () => [...(lanes || [])].sort((a, b) => a.sort_order - b.sort_order),
    [lanes],
  )

  // FEST-1 : plus de cap dur 5 lanes. Le scroll horizontal gère N lanes.
  // On garde un hint visuel "live recommande max 5" au-delà de ce seuil.
  const isOverLiveCap = sortedLanes.length > MAX_LANES_LIVE

  // FEST-2 : menu d'ajout de lane (choix du type). Replié par défaut.
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  return (
    <div
      ref={containerRef}
      key={deroule?.id || 'empty'}
      className="rounded-lg overflow-x-auto overflow-y-auto deroule-day-fade"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        // FEST-2 : scroll horizontal natif quand le nb de lanes dépasse
        // la largeur viewport. Hugo : scroll VERTICAL interne au container
        // pour que le header lanes reste sticky en haut, et permettre un
        // auto-scroll initial vers le premier événement.
        maxHeight: 'calc(100vh - 220px)',
      }}
    >
      {/* Header lanes */}
      <div
        className="flex sticky top-0 z-20"
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
        {sortedLanes.map((lane, idx) => {
          const leftNeighbor = idx > 0 ? sortedLanes[idx - 1] : null
          const rightNeighbor =
            idx < sortedLanes.length - 1 ? sortedLanes[idx + 1] : null
          // FEST-5.5.4 : largeur dynamique (pendant resize : preview live)
          const headerWidth =
            resizing && resizing.type === lane.type
              ? resizing.currentWidth
              : getLaneWidth(lane.type)
          return (
            <LaneHeader
              key={lane.id}
              lane={lane}
              canEdit={canEdit}
              onUpdate={onUpdateLane}
              onDelete={onDeleteLane}
              onMoveLeft={
                leftNeighbor ? () => onReorderLane?.(lane.id, leftNeighbor.id) : null
              }
              onMoveRight={
                rightNeighbor ? () => onReorderLane?.(lane.id, rightNeighbor.id) : null
              }
              membres={membres}
              width={headerWidth}
              onStartResize={(startX) => startLaneResize(lane.type, headerWidth, startX)}
              onResetWidth={() => resetLaneWidth(lane.type)}
              isResizing={Boolean(resizing && resizing.type === lane.type)}
            />
          )
        })}
        {canEdit && (
          <div style={{ position: 'relative', minWidth: 96, width: 96 }}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              className="flex items-center justify-center text-xs gap-1 transition-colors w-full h-full"
              style={{
                borderLeft: '1px dashed var(--brd-sub)',
                color: addMenuOpen ? 'var(--blue)' : 'var(--txt-3)',
                background: addMenuOpen ? 'var(--bg-surf)' : 'transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
              onMouseLeave={(e) => {
                if (!addMenuOpen) e.currentTarget.style.color = 'var(--txt-3)'
              }}
              title={
                isOverLiveCap
                  ? `${sortedLanes.length} lanes — mode festival`
                  : 'Ajouter une lane'
              }
            >
              <Plus className="w-3 h-3" />
              <span>Lane</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {addMenuOpen && (
              <AddLaneMenu
                membres={membres}
                existingMembreIds={sortedLanes
                  .filter((l) => l.type === 'personne' && l.membre_id)
                  .map((l) => l.membre_id)}
                onClose={() => setAddMenuOpen(false)}
                onAdd={(payload) => {
                  setAddMenuOpen(false)
                  onAddLane?.(payload)
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Body timeline */}
      <div
        ref={bodyRef}
        className="relative flex"
        style={{ height: totalHeight + 16, minHeight: 200 }}
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
                top: minToTop(g.minutes),
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

        {/* Lanes */}
        {sortedLanes.map((lane) => {
          const creneauxLane = creneauxByLane.get(lane.id) || []
          // FEST-5.5.4 : largeur dynamique par type (resize partagé par groupe)
          const laneBodyWidth =
            resizing && resizing.type === lane.type
              ? resizing.currentWidth
              : getLaneWidth(lane.type)
          return (
            <div
              key={lane.id}
              data-lane-id={lane.id}
              onMouseDown={(e) => handleLaneMouseDown(e, lane.id, false)}
              className="relative"
              style={{
                borderRight: '1px solid var(--brd-sub)',
                cursor: canEdit ? 'crosshair' : 'default',
                width: laneBodyWidth,
                minWidth: laneBodyWidth,
                flexShrink: 0,
                flexGrow: 0,
              }}
            >
              {/* Graduations de fond */}
              {graduations.map((g) => (
                <div
                  key={g.minutes}
                  style={{
                    position: 'absolute',
                    top: minToTop(g.minutes),
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
              {creneauxLane
                .filter((c) => {
                  // Pendant un drag horizontal vers une autre lane, on
                  // affiche le créneau dans la lane de destination courante.
                  // Le créneau est masqué dans sa lane d'origine.
                  if (
                    dragState &&
                    dragState.creneauId === c.id &&
                    dragState.mode === 'move' &&
                    !dragState.multiLane &&
                    dragState.currentLaneId !== lane.id
                  ) {
                    return false
                  }
                  return true
                })
                .map((c) => {
                  const isThisDragging = dragState?.creneauId === c.id
                  const debut = isThisDragging ? dragState.currentDebutMin : c.heure_debut_min
                  const fin = isThisDragging ? dragState.currentFinMin : c.heure_fin_min
                  return (
                    <CreneauBlock
                      key={c.id}
                      creneau={c}
                      top={minToTop(debut)}
                      height={durationToHeight(fin - debut)}
                      membreInitiales={membreInitiales}
                      onClick={(_c, rect) => handleBlockClick(c, rect)}
                      canEdit={canEdit}
                      onMouseDownDrag={handleBlockMouseDown}
                      isDragging={isThisDragging && dragState.hasMoved}
                      conflicts={conflictsByCreneau?.get?.(c.id) || []}
                      isLinked={Boolean(c.source_creneau_id)}
                      laneType={lane.type}
                      laneWidth={laneBodyWidth}
                      onContextMenu={(e) => handleBlockContextMenu(e, c)}
                    />
                  )
                })}
              {/* Preview visuel pendant un click-and-drag de création
                  (mode 'create') : un rectangle pointillé entre les heures
                  choisies, affiché dans la lane d'origine du drag. */}
              {dragState &&
                dragState.mode === 'create' &&
                dragState.initialLaneId === lane.id &&
                dragState.hasMoved && (
                  <div
                    className="absolute rounded pointer-events-none"
                    style={{
                      top: minToTop(dragState.currentDebutMin),
                      left: 4,
                      right: 4,
                      height: durationToHeight(
                        dragState.currentFinMin - dragState.currentDebutMin,
                      ) - 2,
                      background: 'rgba(55, 138, 221, 0.18)',
                      border: '1.5px dashed var(--blue)',
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--blue)',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      zIndex: 4,
                    }}
                  >
                    {formatMinHHMM(dragState.currentDebutMin)} – {formatMinHHMM(dragState.currentFinMin)}
                    <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>
                      Nouveau créneau
                    </div>
                  </div>
                )}

              {/* FEST-3.2 : placeholder visible tant que le QuickCreateMenu
                  est ouvert. Hugo : "ajouter un mini preview de l'endroit
                  cliqué pour voir où on est". Couleur bleue (action en
                  cours) pour distinguer du placeholder de creatingDraft
                  (gris, créneau déjà en BDD pas encore confirmé). */}
              {quickMenu &&
                !quickMenu.multiLane &&
                quickMenu.laneId === lane.id && (
                  <div
                    className="absolute rounded pointer-events-none"
                    style={{
                      top: minToTop(quickMenu.heureCible),
                      left: 4,
                      right: 4,
                      height:
                        durationToHeight(
                          quickMenu.heureFin - quickMenu.heureCible,
                        ) - 2,
                      background: 'rgba(59, 130, 246, 0.18)',
                      border: '1.5px dashed var(--blue, #3B82F6)',
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--blue, #3B82F6)',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      zIndex: 4,
                    }}
                  >
                    {formatMinHHMM(quickMenu.heureCible)} – {formatMinHHMM(quickMenu.heureFin)}
                    <div style={{ fontSize: 10, opacity: 0.8, marginTop: 1 }}>
                      Nouveau créneau ici
                    </div>
                  </div>
                )}

              {/* POP-2 / Hugo : placeholder PERSISTANT tant que la modale
                  création est ouverte (creatingDraft set). Montre où le
                  bloc va être créé, avec ses heures choisies. */}
              {creatingDraft &&
                !creatingDraft.multi_lane &&
                creatingDraft.lane_id === lane.id && (
                  <div
                    className="absolute rounded pointer-events-none"
                    style={{
                      top: minToTop(creatingDraft.heure_debut_min),
                      left: 4,
                      right: 4,
                      height:
                        durationToHeight(
                          creatingDraft.heure_fin_min - creatingDraft.heure_debut_min,
                        ) - 2,
                      background: 'rgba(120, 120, 120, 0.15)',
                      border: '1.5px dashed var(--brd)',
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--txt-3)',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      zIndex: 3,
                    }}
                  >
                    {formatMinHHMM(creatingDraft.heure_debut_min)} – {formatMinHHMM(creatingDraft.heure_fin_min)}
                    <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1, fontStyle: 'italic' }}>
                      En cours de création…
                    </div>
                  </div>
                )}

              {/* Créneau "fantôme" affiché dans la lane DESTINATION pendant
                  un drag horizontal. Il représente où le créneau atterrira.
                  FEST-3.1 : si on drag d'une lane lieu vers une lane personne,
                  le ghost devient "Créer mission ici" (bleu) au lieu de
                  l'apparence move classique — l'utilisateur voit que c'est
                  une CRÉATION, pas un déplacement. */}
              {dragState &&
                dragState.mode === 'move' &&
                !dragState.multiLane &&
                dragState.currentLaneId === lane.id &&
                dragState.initialLaneId !== lane.id &&
                dragState.hasMoved && (() => {
                  const draggedCreneau =
                    [...creneauxByLane.values()].flat().find((c) => c.id === dragState.creneauId)
                  if (!draggedCreneau) return null
                  const sourceLane = lanes.find((l) => l.id === dragState.initialLaneId)
                  const isCrossLaneAssign =
                    sourceLane?.type === 'lieu' && lane.type === 'personne'
                  if (isCrossLaneAssign) {
                    return (
                      <div
                        key={`ghost-assign-${dragState.creneauId}`}
                        className="absolute rounded pointer-events-none"
                        style={{
                          top: minToTop(dragState.currentDebutMin),
                          left: 4,
                          right: 4,
                          height:
                            durationToHeight(
                              dragState.currentFinMin - dragState.currentDebutMin,
                            ) - 2,
                          background: 'rgba(59, 130, 246, 0.2)',
                          border: '2px dashed var(--blue, #3B82F6)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--blue, #3B82F6)',
                          lineHeight: 1.2,
                          overflow: 'hidden',
                          zIndex: 5,
                        }}
                      >
                        🎬 Mission : {draggedCreneau.titre || '(sans titre)'}
                        <div style={{ fontSize: 10, opacity: 0.85, marginTop: 1, fontWeight: 500 }}>
                          {formatMinHHMM(dragState.currentDebutMin)} – {formatMinHHMM(dragState.currentFinMin)}
                        </div>
                      </div>
                    )
                  }
                  return (
                    <CreneauBlock
                      key={`ghost-${dragState.creneauId}`}
                      creneau={draggedCreneau}
                      top={minToTop(dragState.currentDebutMin)}
                      height={durationToHeight(
                        dragState.currentFinMin - dragState.currentDebutMin,
                      )}
                      membreInitiales={membreInitiales}
                      onClick={() => {}}
                      canEdit={false}
                      isDragging
                    />
                  )
                })()}
            </div>
          )
        })}

        {/* Spacer 96px à droite pour matcher la colonne "+ Lane" du header.
            Sans ce spacer, les lanes flex-1 du body s'étalent sur 96px de
            plus que celles du header → décalage croissant vers la droite.
            FEST-2 : bouton header passé à 96px (+ Lane ▾). */}
        {canEdit && (
          <div
            style={{
              width: 96,
              minWidth: 96,
              borderLeft: '1px dashed var(--brd-sub)',
              opacity: 0.4,
            }}
          />
        )}

        {/* Couche multi-lane : par-dessus toutes les lanes (left: TIME_COL_W).
            pointer-events: none sur le container → seuls les blocs enfants
            (qui ont pointerEvents: 'auto') reçoivent les events. La création
            d'un bloc multi-lane se fait via le toggle "Bloc multi-lane" dans
            l'inspector au lieu d'un click-and-drag dédié (cas peu commun). */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: TIME_COL_W,
            right: canEdit ? 96 : 0,
            bottom: 0,
          }}
        >
          {creneauxMultiLane.map((c) => {
            const isThisDragging = dragState?.creneauId === c.id
            const debut = isThisDragging ? dragState.currentDebutMin : c.heure_debut_min
            const fin = isThisDragging ? dragState.currentFinMin : c.heure_fin_min
            return (
              <CreneauBlock
                key={c.id}
                creneau={c}
                top={minToTop(debut)}
                height={durationToHeight(fin - debut)}
                membreInitiales={membreInitiales}
                onClick={(_c, rect) => handleBlockClick(c, rect)}
                isMultiLane
                canEdit={canEdit}
                onMouseDownDrag={handleBlockMouseDown}
                isDragging={isThisDragging && dragState.hasMoved}
                conflicts={conflictsByCreneau?.get?.(c.id) || []}
              />
            )
          })}
        </div>

        {/* FEST-5.1d : Overlay golden hour (matin + soir).
            Calé en pointer-events:none + zIndex:1 (sous les blocs) pour ne
            pas gêner l'interaction. */}
        <GoldenHourOverlay
          sunTimes={sunTimes}
          heureDebutMin={heureDebutMin}
          heureFinMin={heureFinMin}
          minToTop={minToTop}
          timeColWidth={TIME_COL_W}
          visible={showGoldenHour}
        />

        {/* Now line */}
        {nowVisible && (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              top: minToTop(nowMin),
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

      {/* Légende types de créneau */}
      <div
        className="flex flex-wrap gap-3 px-3 py-2 text-[10px] items-center"
        style={{
          borderTop: '1px solid var(--brd-sub)',
          color: 'var(--txt-3)',
          background: 'var(--bg-elev)',
        }}
      >
        <span style={{ fontWeight: 500 }}>Légende</span>
        {Object.entries(CRENEAU_TYPE_COLORS).map(([type, color]) => (
          <span
            key={type}
            className="inline-flex items-center gap-1"
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: color,
                borderRadius: 2,
                display: 'inline-block',
              }}
            />
            {labelForType(type)}
          </span>
        ))}
      </div>

      {/* FEST-3.3 : menu d'attribution au right-click sur bloc show */}
      {assignMenu && (
        <AssignCadreurMenu
          sourceCreneau={assignMenu.sourceCreneau}
          cadreurs={assignMenu.cadreurs}
          onChoose={({ laneId, membreId }) => {
            const src = assignMenu.sourceCreneau
            const sourceLane = lanes.find((l) => l.id === src.lane_id)
            const lieuInferred =
              sourceLane?.type === 'lieu'
                ? sourceLane.libelle
                : src.lieu_text || null
            // Crée le tournage lié dans la lane du cadreur. On passe par
            // onCreateCreneauAt (DerouleTab) avec un draft pré-rempli
            // incluant member_ids = [cadreur].
            onCreateCreneauAt?.(
              {
                lane_id: laneId,
                multi_lane: false,
                heure_debut_min: src.heure_debut_min,
                heure_fin_min: src.heure_fin_min,
                type: 'prise',
                titre: src.titre || '',
                lieu_text: lieuInferred,
                notes: src.notes || null,
                source_creneau_id: src.id,
                source_anchor: {
                  fields: ['titre', 'lieu_text', 'heure_debut_min', 'notes'],
                },
                member_ids: membreId ? [membreId] : [],
                _skipInspector: true, // FEST-3.3 : save direct sans ouvrir l'inspector
              },
              null,
            )
            setAssignMenu(null)
          }}
          onClose={() => setAssignMenu(null)}
        />
      )}

      {/* FEST-3.2 : menu de création rapide au clic simple */}
      {quickMenu && (
        <QuickCreateMenu
          anchorRect={quickMenu.anchorRect}
          heureCible={quickMenu.heureCible}
          heureFin={quickMenu.heureFin}
          overlappingCreneaux={quickMenu.overlappingCreneaux}
          laneType={quickMenu.laneType}
          onChoose={({ draftOverride }) => {
            // Compose le draft final : horaires + lane + overrides du menu
            const finalDraft = {
              lane_id: quickMenu.multiLane ? null : quickMenu.laneId,
              multi_lane: quickMenu.multiLane,
              heure_debut_min: quickMenu.heureCible,
              heure_fin_min: quickMenu.heureFin,
              ...(draftOverride || {}),
            }
            onCreateCreneauAt?.(finalDraft, quickMenu.anchorRect)
            setQuickMenu(null)
          }}
          onClose={() => setQuickMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * Initiales pour un nom complet : "Hugo Martin" → "HM", "Samuel Chibon" →
 * "SC". Utilisé pour les lanes cadreurs en mode étroit (FEST-5.5.5).
 */
function getInitials(fullName) {
  if (!fullName || typeof fullName !== 'string') return '?'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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

// ─── LaneHeader (titre éditable + bouton supprimer pour lanes 1+) ──────────

function LaneHeader({
  lane,
  canEdit,
  onUpdate,
  onDelete,
  onMoveLeft,
  onMoveRight,
  membres = [],
  // FEST-5.5.4 : largeur dynamique + resize
  width = null,
  onStartResize = null,
  onResetWidth = null,
  isResizing = false,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(lane.libelle)

  // FEST-1 : la lane "Global" est identifiée par type (plus précis que
  // sort_order=0 qui était la convention historique). Backward compat
  // pour les déroulés legacy : sort_order=0 et type vide → considérer global.
  const type = lane.type || (lane.sort_order === 0 ? 'global' : 'equipe')

  // Couleur effective de la lane (hérite du type, override possible).
  const color = `#${effectiveLaneColor(lane)}`

  // Icône selon le type
  const IconForType = {
    global: Clipboard,
    equipe: Users,
    lieu: MapPin,
    personne: Camera,
  }[type] || Users

  // Si type='personne', on affiche le nom du membre (et désactive
  // l'édition inline du libellé — il vient du membre).
  const membreForLane =
    type === 'personne' && lane.membre_id
      ? membres.find((m) => m.id === lane.membre_id)
      : null
  const personneFullName = membreForLane
    ? `${membreForLane.contact?.prenom || membreForLane.prenom || ''} ${membreForLane.contact?.nom || membreForLane.nom || ''}`.trim()
    : null

  function commitEdit() {
    setEditing(false)
    const next = draft.trim() || defaultLaneLibelle(lane.sort_order)
    if (next !== lane.libelle) onUpdate?.(lane.id, { libelle: next })
  }

  // Pour les lanes type='personne', le libellé n'est pas éditable inline
  // (vient du membre). On pourrait permettre un nickname plus tard.
  const isLibelleEditable = canEdit && type !== 'personne'

  // FEST-2-bis : largeur lane réduite (100px au lieu de 120) pour densité
  // festival. Les boutons de réordonnancement (← →) et de suppression (×)
  // n'apparaissent qu'au hover via la classe `group` pour éviter d'écraser
  // le libellé en mode repos.
  // FEST-5.5.4 : largeur effective (prop si fournie, sinon fallback 100px)
  const effectiveWidth = Number.isFinite(width) ? width : 100
  return (
    <div
      className="group flex items-center gap-1 px-1.5 text-xs"
      style={{
        height: LANE_HEADER_H,
        borderRight: '1px solid var(--brd-sub)',
        borderTop: `2px solid ${color}`,
        fontWeight: 500,
        color: 'var(--txt-2)',
        width: effectiveWidth,
        minWidth: effectiveWidth,
        flexShrink: 0,
        flexGrow: 0,
        position: 'relative',
        background: type !== 'equipe' && type !== 'global' ? `${color}0d` : 'transparent',
      }}
      title={`Type : ${type}`}
    >
      <IconForType
        className="w-3.5 h-3.5 shrink-0"
        style={{ color, opacity: 0.85 }}
      />

      {/* FEST-5.5.4 : poignée de resize à droite, partage la largeur entre
          toutes les lanes du même type. Hover → curseur ew-resize visible.
          Pendant le drag : badge px flottant juste au-dessus du header. */}
      {onStartResize && (
        <>
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onStartResize(e.clientX)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onResetWidth?.()
            }}
            title="Glisser pour redimensionner toutes les lanes de ce type · Double-clic pour réinitialiser"
            style={{
              position: 'absolute',
              top: 0,
              right: -3,
              width: 6,
              height: '100%',
              cursor: 'ew-resize',
              zIndex: 5,
              background: isResizing ? 'rgba(59,130,246,0.55)' : 'transparent',
              transition: isResizing ? 'none' : 'background 0.12s',
            }}
            onMouseEnter={(e) => {
              if (!isResizing) {
                e.currentTarget.style.background = 'rgba(59,130,246,0.30)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizing) {
                e.currentTarget.style.background = 'transparent'
              }
            }}
          />
          {isResizing && (
            <div
              style={{
                position: 'absolute',
                top: -22,
                right: -16,
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 6px',
                background: 'var(--blue, #3B82F6)',
                color: 'white',
                borderRadius: 4,
                pointerEvents: 'none',
                zIndex: 10,
                whiteSpace: 'nowrap',
              }}
            >
              {effectiveWidth}px
            </div>
          )}
        </>
      )}
      {editing && isLibelleEditable ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(lane.libelle)
              setEditing(false)
            }
          }}
          className="flex-1 px-1 outline-none"
          style={{
            background: 'var(--bg-surf)',
            color: 'var(--txt)',
            border: '1px solid var(--blue)',
            borderRadius: 3,
            fontSize: 12,
            minWidth: 0,
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => isLibelleEditable && setEditing(true)}
          className="truncate text-left flex-1"
          style={{
            background: 'transparent',
            color: 'var(--txt-2)',
            cursor: isLibelleEditable ? 'text' : 'default',
            minWidth: 0,
          }}
          title={
            isLibelleEditable
              ? `Cliquer pour renommer · ${personneFullName || lane.libelle}`
              : personneFullName || lane.libelle
          }
        >
          {/* FEST-5.5.5 : nom adaptatif selon la largeur de la lane.
              - >= 110px : nom complet (tronqué naturel)
              - 80-110px : initiales (HM, SC) si type='personne', sinon
                 nom tronqué normal
              - < 80px   : icône+pastille suffit, on cache le texte */}
          {effectiveWidth < 80
            ? null
            : effectiveWidth < 110 && type === 'personne'
            ? getInitials(personneFullName || lane.libelle)
            : personneFullName || lane.libelle}
        </button>
      )}
      {/* Mini actions : ← → ×. Visibles uniquement au hover du header
          pour ne pas surcharger en mode repos. */}
      {canEdit && !editing && (
        <div className="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onMoveLeft && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMoveLeft()
              }}
              className="p-0.5 rounded transition-colors"
              style={{ color: 'var(--txt-3)', background: 'transparent' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
                e.currentTarget.style.color = 'var(--txt)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
              title="Déplacer à gauche"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
          )}
          {onMoveRight && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMoveRight()
              }}
              className="p-0.5 rounded transition-colors"
              style={{ color: 'var(--txt-3)', background: 'transparent' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
                e.currentTarget.style.color = 'var(--txt)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
              title="Déplacer à droite"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {/* FEST-5.5.1 : suppression désormais ouverte à toutes les lanes,
              y compris Global. Si la lane contient des créneaux, le caller
              demande une 2e confirmation avant cascade-delete. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(lane.id)
            }}
            className="p-0.5 rounded transition-colors"
            style={{ color: 'var(--txt-3)', background: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--red-bg)'
              e.currentTarget.style.color = 'var(--red)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Supprimer cette lane"
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── AddLaneMenu — choix de type lors de l'ajout d'une lane ────────────────
//
// FEST-2 : remplace le simple bouton "+ Lane" par un menu qui demande
// le type. Pour 'personne', affiche un sub-picker des membres du projet
// (filtrés : pas de doublon avec une lane perso existante).
//
// Esc pour fermer, click-outside aussi.

function AddLaneMenu({ membres = [], existingMembreIds = [], onClose, onAdd }) {
  const [picking, setPicking] = useState(false) // 'personne' sub-step
  const menuRef = useRef(null)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    // Délai pour ne pas attraper le clic qui a ouvert le menu
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onClickOutside)
    }, 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [onClose])

  const existingSet = new Set(existingMembreIds)
  const availableMembres = (membres || [])
    .filter((m) => !existingSet.has(m.id))
    .sort((a, b) => {
      const an = (a.contact?.nom || a.nom || '').toLowerCase()
      const bn = (b.contact?.nom || b.nom || '').toLowerCase()
      return an.localeCompare(bn, 'fr')
    })

  function addOfType(type, libelle) {
    onAdd?.({ type, libelle })
  }

  function addPersonne(membre) {
    const fullName =
      `${membre.contact?.prenom || membre.prenom || ''} ${membre.contact?.nom || membre.nom || ''}`.trim() ||
      'Cadreur'
    onAdd?.({ type: 'personne', membre_id: membre.id, libelle: fullName })
  }

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 rounded-md shadow-xl"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        width: 260,
        zIndex: 50,
        padding: 4,
      }}
    >
      {!picking ? (
        <>
          <MenuItem
            icon={MapPin}
            colorHex="#7F77DD"
            title="Lieu / Scène"
            subtitle="Programmation par scène (festival)"
            onClick={() => addOfType('lieu', 'Scène')}
          />
          <MenuItem
            icon={Camera}
            colorHex="#378ADD"
            title="Cadreur"
            subtitle={
              availableMembres.length === 0
                ? 'Tous les membres déjà ajoutés'
                : `Choisir parmi ${availableMembres.length} membre${availableMembres.length > 1 ? 's' : ''}`
            }
            disabled={availableMembres.length === 0}
            onClick={() => setPicking(true)}
          />
          <MenuItem
            icon={Users}
            colorHex="#888780"
            title="Équipe"
            subtitle="Lane générique (mode live)"
            onClick={() => addOfType('equipe', null)}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="w-full text-left text-[10px] uppercase tracking-widest font-semibold px-2 py-1 mb-1"
            style={{ color: 'var(--txt-3)' }}
          >
            ← Retour
          </button>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {availableMembres.map((m) => {
              const prenom = m.contact?.prenom || m.prenom || ''
              const nom = m.contact?.nom || m.nom || ''
              const spec = m.specialite || m.contact?.specialite || ''
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addPersonne(m)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                  style={{
                    background: 'transparent',
                    color: 'var(--txt)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Camera className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                  <span className="flex-1 min-w-0 truncate">
                    <span style={{ fontWeight: 500 }}>{`${prenom} ${nom}`.trim()}</span>
                    {spec && (
                      <span className="ml-1 opacity-70 text-[10px]">· {spec}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, colorHex, title, subtitle, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="w-full text-left flex items-start gap-2 px-2 py-2 rounded transition-colors disabled:opacity-40"
      style={{
        background: 'transparent',
        color: 'var(--txt)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
        style={{ background: `${colorHex}1f` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: colorHex }} />
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)' }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 1 }}>{subtitle}</div>
      </div>
    </button>
  )
}

// ─── CreneauBlock — rectangle cliquable ────────────────────────────────────

function CreneauBlock({
  creneau,
  top,
  height,
  membreInitiales,
  onClick,
  onContextMenu,
  isMultiLane,
  canEdit,
  onMouseDownDrag,
  isDragging,
  conflicts = [],
  isLinked = false,
  laneType = null,
  // FEST-5.5.5 : largeur de la lane (utilisée pour rendu adaptatif)
  laneWidth = null,
}) {
  const color = effectiveCouleurCreneau(creneau)
  const minH = 24
  const HANDLE_PX = 6 // zone de resize en haut/bas du bloc
  const isFait = creneau.statut === 'fait'
  const isEnCours = creneau.statut === 'en_cours'
  // FEST-5.2 : bloc d'indisponibilité (sommeil/repos cadreur). Rendu hachuré
  // gris, contenu allégé (juste "Indispo" + horaires), opacité réduite pour
  // s'effacer visuellement par rapport aux vrais créneaux artiste.
  const isIndispo = creneau.type === 'indispo'
  // FEST-5.4 : alerte / point d'attention.
  const showAlerte = hasAlerte(creneau)
  const alerteColor = showAlerte ? ALERTE_COLORS[creneau.alerte_niveau] : null
  const alerteIsImportant = creneau.alerte_niveau === 'important'

  // FEST-5.5.5 : rendu adaptatif selon la largeur de la lane.
  // Hugo : "Le plus important est : Titre + Horaires. Il faut les voir presque
  // absolument et en entier si pas trop long. Les avatars peuvent disparaître
  // si trop court/fin."
  //
  // 3 paliers de largeur :
  //  - WIDE   (>= 130px ou multi-lane)  : layout complet (1 ligne titre + horaires
  //                                       + lieu + avatars)
  //  - NARROW (90-130px)                : titre wrap 2 lignes si height >= 60,
  //                                       horaires compactes (16:50–18:35),
  //                                       lieu caché, avatars ≤ 2, police 11
  //  - V_NARROW (< 90px)                : titre wrap 3 lignes si height >= 80,
  //                                       horaires VERTICALES (16:50 / 18:35),
  //                                       alerte icône seule, avatars "+N",
  //                                       badge durée + link icon cachés
  const isMulti = Boolean(isMultiLane)
  const effectiveWidth = isMulti
    ? 9999 // multi-lane couvre tout, comme wide
    : Number.isFinite(laneWidth)
    ? laneWidth
    : 130
  const isWide = effectiveWidth >= 130
  const isVeryNarrow = effectiveWidth < 90
  const isNarrow = !isVeryNarrow && !isWide

  // Combien de lignes max pour le titre (calculé selon height dispo)
  const titleMaxLines = isWide
    ? 1
    : isVeryNarrow
    ? height >= 80
      ? 3
      : height >= 50
      ? 2
      : 1
    : height >= 60
    ? 2
    : 1

  // Hide badges (durée, link icon) sous 80px
  const hideBadges = effectiveWidth < 80
  // Cacher le lieu en mode narrow et plus
  const hideLieu = !isWide
  // Avatars limités
  const maxAvatars = isVeryNarrow ? 0 : isNarrow ? 2 : 4
  // Réduire la police titre sous 110px
  const titleFontSize = effectiveWidth >= 110 ? (height >= 60 ? 12 : 11) : 11
  const horairesFontSize = effectiveWidth >= 110 ? 10 : 9
  // Horaires sur 2 lignes verticales si very narrow
  const horairesVertical = isVeryNarrow

  // Logique alerte (FEST-5.4) ajustée pour le mode étroit : si very narrow,
  // on n'a pas la place pour la ligne d'alerte → icône seule à côté du titre
  const showAlerteLine = showAlerte && height >= 52 && !isVeryNarrow
  const showAlerteIconOnly = showAlerte && !showAlerteLine

  // Phase D — conflit d'assignation : un même membre est dans 2+ créneaux
  // qui se chevauchent. On surligne ces blocs en rouge avec un tooltip
  // détaillé (membres en conflit + créneaux concernés).
  const hasConflict = Array.isArray(conflicts) && conflicts.length > 0
  // Dédupe les membres en conflit (un même membre peut apparaître plusieurs
  // fois si overlap multi-créneaux) et compose un tooltip lisible.
  const conflictTooltip = useMemo(() => {
    if (!hasConflict) return ''
    const byMembre = new Map()
    for (const { creneau: other, membre } of conflicts) {
      if (!byMembre.has(membre.id)) {
        const fn = `${membre.contact?.prenom || membre.prenom || ''} ${membre.contact?.nom || membre.nom || ''}`.trim() || '?'
        byMembre.set(membre.id, { fn, others: [] })
      }
      byMembre.get(membre.id).others.push(other)
    }
    const lines = []
    for (const { fn, others } of byMembre.values()) {
      const titres = others
        .map((o) => `${o.titre || '(sans titre)'} (${formatMinHHMM(o.heure_debut_min)}–${formatMinHHMM(o.heure_fin_min)})`)
        .join(', ')
      lines.push(`⚠ ${fn} : conflit avec ${titres}`)
    }
    return lines.join('\n')
  }, [hasConflict, conflicts])

  function handleMouseDown(e) {
    if (!canEdit || !onMouseDownDrag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    let mode = 'move'
    if (y < HANDLE_PX) mode = 'resize-top'
    else if (y > rect.height - HANDLE_PX) mode = 'resize-bottom'
    onMouseDownDrag(e, creneau, mode)
  }

  function getCursor(e) {
    if (!canEdit) return 'pointer'
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < HANDLE_PX || y > rect.height - HANDLE_PX) return 'ns-resize'
    return 'grab'
  }

  return (
    <div
      onClick={(e) => {
        // Pendant un drag avec hasMoved, le mouseup reset dragState avant
        // que le click ne tire — donc on n'ouvre pas l'inspector. OK.
        e.stopPropagation()
        if (isDragging) return
        // POP-1 : extraire le DOMRect immédiatement et le passer au parent
        // (au plus près du DOM, avant tout pooling/release React event).
        const rect = e.currentTarget.getBoundingClientRect()
        onClick?.(creneau, rect)
      }}
      onContextMenu={onContextMenu}
      onMouseDown={handleMouseDown}
      onMouseMove={canEdit ? (e) => {
        e.currentTarget.style.cursor = getCursor(e)
      } : undefined}
      className={isEnCours && !isDragging ? 'absolute creneau-block-pulse' : 'absolute'}
      style={{
        top,
        left: 4,
        right: 4,
        height: Math.max(minH, height - 2),
        // FEST-5.2 : indispo = pattern hachures gris diagonales 45° par-dessus
        // un fond gris sombre semi-transparent. Bordure gauche fine vs
        // bordure pleine pour les autres types.
        background: isIndispo
          ? 'repeating-linear-gradient(45deg, rgba(150,150,150,0.18) 0 4px, transparent 4px 8px), rgba(60,60,60,0.35)'
          : hexToBgFill(color),
        borderLeft: isIndispo
          ? '2px dashed rgba(160,160,160,0.55)'
          : `3px solid ${color}`,
        borderRadius: '0 6px 6px 0',
        padding: '4px 8px',
        cursor: canEdit ? 'grab' : 'pointer',
        overflow: 'hidden',
        pointerEvents: 'auto',
        // UX-2 : opacité réduite si annulé OU fait (mais reste lisible)
        opacity: isDragging
          ? 0.55
          : creneau.statut === 'annule'
          ? 0.4
          : isFait
          ? 0.7
          : isIndispo
          ? 0.85
          : 1,
        textDecoration: creneau.statut === 'annule' ? 'line-through' : 'none',
        // UX-2 : color pour la pulse animation (currentColor dans la keyframe)
        color: '#3B82F6',
        // Phase D — bordure rouge si conflit (override le boxShadow hover)
        outline: isDragging
          ? `2px solid ${color}`
          : hasConflict
          ? '1.5px solid #E24B4A'
          : 'none',
        outlineOffset: isDragging ? 1 : 0,
        zIndex: isDragging ? 5 : 'auto',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s, opacity 0.15s',
        // UX-2 : shadow subtile pour profondeur
        boxShadow: isDragging ? 'none' : '0 1px 3px rgba(0,0,0,0.12)',
      }}
      onMouseEnter={(e) => {
        if (!isDragging && !hasConflict) e.currentTarget.style.boxShadow = '0 0 0 1px ' + color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none'
      }}
      aria-label={
        hasConflict
          ? `${creneau.titre} · ${formatMinHHMM(creneau.heure_debut_min)} – ${formatMinHHMM(creneau.heure_fin_min)} — ${conflictTooltip}`
          : `${creneau.titre} · ${formatMinHHMM(creneau.heure_debut_min)} – ${formatMinHHMM(creneau.heure_fin_min)}`
      }
    >
      {/* Top-right : badge durée + indicateur lié (UX-2). FEST-5.5.5 :
          caché en mode étroit (< 80px) pour laisser la place au titre. */}
      {height >= 40 && !hideBadges && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            pointerEvents: 'none',
            color: hexToTextColor(color),
            opacity: 0.75,
          }}
        >
          {isLinked && <LinkIcon size={10} />}
          <span
            style={{
              fontSize: 9,
              fontWeight: 500,
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.15)',
            }}
          >
            {formatDureeShort(creneau.heure_fin_min - creneau.heure_debut_min)}
          </span>
        </div>
      )}

      {/* Bottom-right : check vert si Fait (UX-2) */}
      {creneau.statut === 'fait' && height >= 40 && (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            right: 6,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#22C55E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Check size={10} style={{ color: 'white' }} strokeWidth={3} />
        </div>
      )}

      {/* Titre — gras, taille + wrap adaptatifs (FEST-5.5.5).
          Wrap multi-ligne via -webkit-line-clamp (compat tous browsers
          modernes), tronqué proprement avec "…" à la fin de la dernière
          ligne autorisée. */}
      <div
        style={{
          fontSize: titleFontSize,
          fontWeight: 600,
          color: hexToTextColor(color),
          lineHeight: 1.2,
          // Mode 1 ligne : nowrap + ellipsis classique.
          // Mode multi-ligne : line-clamp.
          ...(titleMaxLines === 1
            ? {
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }
            : {
                display: '-webkit-box',
                WebkitLineClamp: titleMaxLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }),
          paddingRight: height >= 40 && !hideBadges ? 50 : 0,
        }}
      >
        {isMultiLane && (
          <span style={{ marginRight: 4, opacity: 0.6 }}>↔</span>
        )}
        {hasConflict && (
          <AlertTriangle
            className="inline-block"
            style={{
              width: 11,
              height: 11,
              marginRight: 4,
              color: '#E24B4A',
              verticalAlign: '-1px',
            }}
          />
        )}
        {/* FEST-5.4 : icône alerte inline pour les petits blocs où le bandeau
            ne tient pas. Tooltip = texte de l'alerte. */}
        {showAlerteIconOnly && (
          alerteIsImportant ? (
            <AlertTriangle
              className="inline-block"
              title={creneau.alerte_text}
              style={{
                width: 11,
                height: 11,
                marginRight: 4,
                color: alerteColor,
                verticalAlign: '-1px',
              }}
            />
          ) : (
            <InfoIcon
              className="inline-block"
              title={creneau.alerte_text}
              style={{
                width: 11,
                height: 11,
                marginRight: 4,
                color: alerteColor,
                verticalAlign: '-1px',
              }}
            />
          )
        )}
        {creneau.titre || '(sans titre)'}
      </div>

      {/* Horaires + lieu (visible si height >= 36).
          FEST-5.5.5 : adaptatif.
          - WIDE   : "16:50 – 18:35 · Lieu" (1 ligne, format actuel)
          - NARROW : "16:50–18:35" (compact, lieu caché)
          - V_NARROW : "16:50" / "18:35" sur 2 lignes verticales */}
      {height >= 36 && (
        horairesVertical ? (
          <div
            style={{
              fontSize: horairesFontSize,
              color: hexToTextColor(color),
              opacity: 0.65,
              marginTop: 1,
              lineHeight: 1.15,
            }}
          >
            <div>{formatMinHHMM(creneau.heure_debut_min)}</div>
            <div>{formatMinHHMM(creneau.heure_fin_min)}</div>
          </div>
        ) : (
          <div
            style={{
              fontSize: horairesFontSize,
              color: hexToTextColor(color),
              opacity: 0.65,
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              paddingRight: height >= 40 && !hideBadges ? 50 : 0,
            }}
          >
            {/* En mode NARROW : sans espace autour du tiret pour gagner de la place */}
            {isNarrow
              ? `${formatMinHHMM(creneau.heure_debut_min)}–${formatMinHHMM(creneau.heure_fin_min)}`
              : `${formatMinHHMM(creneau.heure_debut_min)} – ${formatMinHHMM(creneau.heure_fin_min)}`}
            {!hideLieu && creneau.lieu_text && <> · {creneau.lieu_text}</>}
          </div>
        )
      )}

      {/* FEST-5.4 : Ligne alerte APRÈS horaires — texte coloré seul, pas
          de background. Discret mais lisible. Tooltip = texte complet. */}
      {showAlerteLine && (
        <div
          title={creneau.alerte_text}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 500,
            color: alerteColor,
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            paddingRight: height >= 40 ? 50 : 0,
          }}
        >
          {alerteIsImportant ? (
            <AlertTriangle size={10} style={{ flexShrink: 0 }} />
          ) : (
            <InfoIcon size={10} style={{ flexShrink: 0 }} />
          )}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {creneau.alerte_text}
          </span>
        </div>
      )}

      {/* Avatars équipe (visible si height >= 60). Couleur déterministe par
          membre (PRES-1 colorFromUserId) → identification visuelle stable.
          FEST-3.2 raffinement Hugo : ne PAS afficher les avatars sur les
          blocs des lanes de type 'personne' (cadreur) → l'info est
          redondante (le bloc est déjà dans la lane du cadreur, on sait
          qu'il est attitré).
          FEST-5.5.5 : maxAvatars adaptatif selon la largeur (0 si very
          narrow, 2 si narrow, 4 si wide). Si maxAvatars=0 mais des
          membres existent → affiche juste un compteur compact "+N". */}
      {height >= 60 &&
        creneau.member_ids &&
        creneau.member_ids.length > 0 &&
        laneType !== 'personne' &&
        (maxAvatars > 0 ? (
        <div className="flex gap-0 mt-1.5" style={{ pointerEvents: 'none' }}>
          {creneau.member_ids.slice(0, maxAvatars).map((mid, idx) => {
            const m = membreInitiales.get(mid)
            const avatarColor = colorFromUserId(mid)
            return (
              <div
                key={mid}
                aria-label={m?.fullName || ''}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: avatarColor,
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1.5px solid ' + hexToBgFill(color),
                  marginLeft: idx === 0 ? 0 : -5,
                }}
              >
                {m?.initiales || '?'}
              </div>
            )
          })}
          {creneau.member_ids.length > maxAvatars && (
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.35)',
                color: 'white',
                fontSize: 9,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1.5px solid ' + hexToBgFill(color),
                marginLeft: -5,
              }}
            >
              +{creneau.member_ids.length - maxAvatars}
            </div>
          )}
        </div>
        ) : (
          /* FEST-5.5.5 : mode very narrow → juste un compteur +N à la place
             des avatars individuels (qui ne tiennent pas). */
          <div
            className="mt-1.5"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: hexToTextColor(color),
              opacity: 0.75,
              pointerEvents: 'none',
            }}
          >
            +{creneau.member_ids.length}
          </div>
        ))}
    </div>
  )
}

// ─── Helpers UI ────────────────────────────────────────────────────────────

// UX-2 : format court de durée pour le badge en haut-droite du bloc.
//   < 60min → "30min" / "45min"
//   exactement 60 → "1h"
//   minutes en plus → "1h45" (pas d'espace)
function formatDureeShort(min) {
  if (typeof min !== 'number' || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

// ─── Helpers couleur ────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return [136, 135, 128]
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function hexToBgFill(hex) {
  const [r, g, b] = hexToRgb(hex)
  // FIX V0 : 0.18 (au lieu de 0.12) pour mieux ressortir sur dark mode.
  // Sur fond très foncé, 0.12 était presque invisible.
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

function hexToTextColor(hex) {
  // Texte = couleur saturée du type, pleine opacité (lisible sur fond pâle)
  return hex
}
