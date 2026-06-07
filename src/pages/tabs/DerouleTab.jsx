// ════════════════════════════════════════════════════════════════════════════
// DerouleTab — Page "Déroulé" d'un projet (CONDUITE V1 Phase B)
// ════════════════════════════════════════════════════════════════════════════
//
// Tab dédiée pour gérer le déroulé temporel d'une journée de tournage :
// qui fait quoi, à quelle heure, sur quelle équipe, à quel endroit.
//
// Cf. CHANTIER_DEROULE.md pour la roadmap complète. Phase B ajoute :
//   - Sélecteur jour (chips datés + bouton "+ Nouveau jour")
//   - Toggle Timeline / Liste (default Timeline desktop, Liste mobile)
//   - Vue Timeline avec multi-lanes + créneaux + now line
//   - Vue Liste compacte (lecture mobile-friendly)
//   - Side-panel inspecteur (création + édition + suppression)
//   - Bouton "Importer présences" depuis la techlist
//   - Empty state pédagogique si pas de déroulé pour ce jour
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  List as ListIcon,
  LayoutGrid,
  Download,
  Trash2,
  Lock,
  AlertCircle,
  Share2,
  Eye,
  Sparkles,
  Sun,
  Radio,
  Maximize2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import ProjectPresenceBadge from '../../components/ProjectPresenceBadge'
import DayPicker from '../../components/DayPicker'
import { useDeroule } from '../../hooks/useDeroule'
import useBreakpoint from '../../hooks/useBreakpoint'
// FIX V0 : on n'utilise plus membresPresentsJour pour filtrer le picker —
// décision Hugo "pas de contrainte dure". Le picker liste TOUS les membres
// du projet, avec un indicateur visuel sur ceux non présents ce jour.
// import { membresPresentsJour } from '../../lib/deroule'
import { findMembreOverlaps, enrichCreneauxWithImplicitMembers, MAX_MIN } from '../../lib/deroule'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import DerouleTimelineView from '../../features/deroule/DerouleTimelineView'
import DerouleListView from '../../features/deroule/DerouleListView'
import DerouleCadreurView from '../../features/deroule/DerouleCadreurView'
import CreneauInspector from '../../features/deroule/CreneauInspector'
import DerouleShareModal from '../../features/deroule/DerouleShareModal'
import ImportDerouleModal from '../../features/deroule/ImportDerouleModal'
import ImportPreviewModal from '../../features/deroule/ImportPreviewModal'
import ExportDerouleModal from '../../features/deroule/ExportDerouleModal'
import LiveModeOverlay from '../../features/deroule/LiveModeOverlay'
import * as DerouleLib from '../../lib/deroule'
import useGoldenHour from '../../hooks/useGoldenHour'
import { useLiveMode } from '../../hooks/useLiveMode'
import {
  getLinkedChildren,
  applySourceUpdate,
} from '../../lib/derouleSoftLinks'

const OUTIL_KEY = 'deroule'

export default function DerouleTab() {
  const { id: projectId } = useParams()
  // FEST-5.1d : récupère lat/lon depuis le project chargé par ProjetLayout
  // (utilisé pour le golden hour). Optional chaining car DerouleTab peut être
  // mounté dans d'autres contextes (preview public ?).
  const outletCtx = useOutletContext?.() || {}
  const project = outletCtx.project || null
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'sm' || breakpoint === 'md'

  // Date sélectionnée (ISO YYYY-MM-DD). Default : aujourd'hui.
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))
  // Vue active : 'timeline' (desktop default) / 'liste' (mobile default) / 'cadreur' (festival)
  const [view, setView] = useState(isMobile ? 'liste' : 'timeline')
  // FEST-3 : cadreur sélectionné en mode vue='cadreur'. Persisté localement
  // entre changements de jour pour la même session.
  const [selectedCadreurId, setSelectedCadreurId] = useState(null)
  // Inspecteur ouvert sur quel créneau (null = fermé). POP-1 : on stocke
  // aussi le DOMRect du bloc cliqué pour le popover anchored.
  const [inspectedCreneau, setInspectedCreneau] = useState(null)
  const [inspectedAnchor, setInspectedAnchor] = useState(null)
  const [creatingDraft, setCreatingDraft] = useState(null)
  const [creatingAnchor, setCreatingAnchor] = useState(null)

  // Handler unifié pour ouvrir l'inspecteur depuis n'importe quelle vue.
  // L'event peut être un MouseEvent React (on extrait le rect de currentTarget)
  // ou directement un DOMRect (passé manuellement).
  function openInspector(creneau, eventOrRect) {
    // POP-1 : accepte un DOMRect direct (passé par CreneauBlock après
    // extraction immédiate au click) OU un événement React (pour les
    // vues List/Cadreur qui passent l'event tel quel). On vérifie par
    // typeof des propriétés top/left/width plutôt que ('top' in) qui
    // peut faillir avec les getters de prototype DOMRect dans certains
    // environnements.
    let rect = null
    if (eventOrRect && typeof eventOrRect === 'object') {
      if (
        typeof eventOrRect.top === 'number' &&
        typeof eventOrRect.left === 'number' &&
        typeof eventOrRect.width === 'number'
      ) {
        rect = eventOrRect
      } else if (eventOrRect.currentTarget?.getBoundingClientRect) {
        rect = eventOrRect.currentTarget.getBoundingClientRect()
      }
    }
    setInspectedAnchor(rect)
    setInspectedCreneau(creneau)
  }
  function closeInspector() {
    setInspectedCreneau(null)
    setInspectedAnchor(null)
  }
  // Modale de partage (Vague 2)
  const [shareOpen, setShareOpen] = useState(false)
  // FEST-6 : modal d'export (PNG cadreur + PDF complet)
  const [exportOpen, setExportOpen] = useState(false)
  // FEST-4.2 : modal d'import IA (PDF/image → JSON via Claude Vision)
  const [importOpen, setImportOpen] = useState(false)
  // FEST-4.3 : résultat d'extraction Claude + preview modal + import en cours
  const [importExtracted, setImportExtracted] = useState(null)
  const [importPreviewOpen, setImportPreviewOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  // FEST-5.1d : toggle overlay golden hour, persisté localStorage par user
  const [showGoldenHour, setShowGoldenHour] = useState(() => {
    try {
      return localStorage.getItem('deroule.showGoldenHour') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('deroule.showGoldenHour', showGoldenHour ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showGoldenHour])
  // Calcul sunrise/sunset/golden depuis lat/lon projet + date du déroulé
  const sunTimes = useGoldenHour(
    selectedDate,
    project?.lat ? Number(project.lat) : null,
    project?.lon ? Number(project.lon) : null,
  )
  const hasProjectGeoloc = Boolean(sunTimes)

  // Bascule auto vers liste sur mobile (sauf si on est explicitement en mode Cadreur)
  useEffect(() => {
    if (isMobile && view === 'timeline') setView('liste')
  }, [isMobile, view])

  const {
    loading,
    error,
    deroules,
    deroule,
    lanes,
    creneaux,
    creneauxByLane,
    creneauxMultiLane,
    createDeroule,
    // updateDeroule, // exposé par le hook, sera utilisé en Sprint 2 (notes session)
    deleteDeroule,
    addLane,
    updateLane,
    deleteLane,
    swapLaneOrder,
    createCreneau,
    updateCreneau,
    deleteCreneau,
    setCreneauMembres,
    importPresences,
    reload,
  } = useDeroule(canRead ? projectId : null, selectedDate)

  // ─── Sprint A — Mode Régie live (FEST-live) ──────────────────────────
  // (Doit être déclaré APRÈS le destructure useDeroule car le hook
  // consomme creneaux/deroule/updateCreneau. Sinon TDZ ReferenceError.)
  // Le hook gère :
  //   - Détection du créneau en cours d'après l'heure (tick 30s)
  //   - Auto-transition planifie → en_cours (heure_debut)
  //   - Auto-transition en_cours → fait (heure_fin)
  //   - Override manuel "Suivant" / "Marquer fait"
  // Toggle persisté en localStorage par projet (vital si la régie ferme
  // l'onglet par accident pendant le festival).
  const liveMode = useLiveMode({
    projectId,
    creneaux,
    deroule,
    onUpdateStatut: (id, statut) => updateCreneau(id, { statut }),
  })
  // State du plein écran : ouvre LiveModeOverlay et requestFullscreen()
  const [liveFullscreen, setLiveFullscreen] = useState(false)
  useEffect(() => {
    if (!liveFullscreen) return undefined
    const el = document.documentElement
    // Best-effort fullscreen — si l'utilisateur refuse ou si le browser
    // ne supporte pas, on garde quand même l'overlay full-screen via CSS.
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    }
    // À la sortie : exit fullscreen + cleanup
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [liveFullscreen])

  // FEST-2 fix : sync inspectedCreneau avec la version fraîche de creneaux
  // quand realtime broadcast une mise à jour. Sans ça, le popover affiche
  // toujours la valeur figée au moment du clic même si on vient de la
  // modifier (real-time save) ou si un autre user l'a modifiée.
  useEffect(() => {
    if (!inspectedCreneau?.id) return
    const fresh = creneaux.find((c) => c.id === inspectedCreneau.id)
    if (fresh && fresh !== inspectedCreneau) {
      setInspectedCreneau(fresh)
    }
    // Si le créneau a été supprimé (par soi-même ou un autre user), on ferme.
    if (!fresh) {
      setInspectedCreneau(null)
      setInspectedAnchor(null)
    }
  }, [creneaux, inspectedCreneau])

  // ─── Charger les membres techlist du projet (pour assignation + import) ──
  const [membres, setMembres] = useState([])
  useEffect(() => {
    if (!canRead || !projectId) return
    let cancelled = false
    supabase
      .from('projet_membres')
      .select(
        '*, contact:contacts(nom, prenom, email, telephone, specialite, ville)',
      )
      .eq('project_id', projectId)
      .is('parent_membre_id', null)
      .then(({ data }) => {
        if (cancelled) return
        setMembres(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [canRead, projectId])

  // ─── Phase D — Détection des conflits d'assignation ─────────────────────
  // Pour chaque membre, on cherche les paires de créneaux qui se chevauchent
  // dans le temps. Si un membre est dans 2 créneaux qui overlappent, ces
  // créneaux sont marqués "en conflit" → la TimelineView/ListView les rend
  // avec un visuel d'alerte (bordure rouge + tooltip détaillé).
  const conflictsByCreneau = useMemo(() => {
    const map = new Map()
    if (!Array.isArray(creneaux) || creneaux.length === 0) return map
    if (!Array.isArray(membres) || membres.length === 0) return map
    // FEST-4 : enrichit les créneaux avec les membres implicites des lanes
    // type='personne'. Sans ça, un cadreur ayant 2 missions dans sa lane
    // perso qui se chevauchent ne serait pas détecté comme en conflit.
    const enriched = enrichCreneauxWithImplicitMembers(creneaux, lanes)
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
    return map
  }, [creneaux, membres, lanes])

  // ─── Tous les membres du projet, annotés "présent ce jour" ou non ────────
  // FIX V0 : on liste TOUS les membres (décision Hugo : pas de contrainte
  // dure), avec un flag `present_ce_jour` que le MembrePicker affiche en
  // indicateur visuel léger.
  const membresAvecPresence = useMemo(() => {
    if (!Array.isArray(membres)) return []
    return membres.map((m) => {
      const days = Array.isArray(m?.presence_days) ? m.presence_days : []
      return { ...m, present_ce_jour: days.includes(selectedDate) }
    })
  }, [membres, selectedDate])

  // ─── Handlers ────────────────────────────────────────────────────────────

  async function handleCreateDeroule(options = {}) {
    if (!canEdit) return
    const { copyLanesFromDerouleId = null } = options
    try {
      // V0.5 : minutes INTEGER (0 = 00:00, 1439 = 23:59, 1680 max = 04:00 J+1)
      const created = await createDeroule({
        date_jour: selectedDate,
        titre: null,
        heure_debut_min: 0,
        heure_fin_min: 1439,
      })
      // FEST-5.5.3 : copie des lanes cadreur/scène depuis un déroulé existant
      // (festival multi-jours : on veut Hugo Martin, Samuel Chibon, etc. dès
      // le jour 2 sans re-saisir).
      let copiedLanes = []
      if (copyLanesFromDerouleId && created?.deroule?.id) {
        try {
          copiedLanes = await DerouleLib.copyLanesFromDeroule(
            copyLanesFromDerouleId,
            created.deroule.id,
            ['personne', 'lieu'],
          )
        } catch (e) {
          console.warn('[handleCreateDeroule] copyLanes failed', e)
          notify.error(
            'Déroulé créé mais erreur copie lanes : ' + (e?.message || e),
          )
        }
      }
      if (copiedLanes.length > 0) {
        notify.success(
          `Déroulé créé · ${copiedLanes.length} lane${copiedLanes.length > 1 ? 's' : ''} reprise${copiedLanes.length > 1 ? 's' : ''}`,
        )
      } else {
        notify.success('Déroulé créé')
      }
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleDeleteDeroule() {
    if (!canEdit || !deroule?.id) return
    const nbCreneaux = creneaux.length
    const nbLanes = lanes.length
    const detail = nbCreneaux > 0
      ? `${nbCreneaux} créneau${nbCreneaux > 1 ? 'x' : ''} et ${nbLanes} lane${nbLanes > 1 ? 's' : ''} seront définitivement supprimé${nbCreneaux > 1 ? 's' : ''}.`
      : `${nbLanes} lane${nbLanes > 1 ? 's' : ''} seront définitivement supprimé${nbLanes > 1 ? 's' : ''} (déroulé vide).`
    const ok = await confirm({
      title: `Supprimer le déroulé du ${formatDate(selectedDate)}`,
      message: `${detail} Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteDeroule(deroule.id)
      notify.success('Déroulé supprimé')
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleImportPresences() {
    if (!canEdit || !deroule?.id) return
    try {
      const created = await importPresences(membres)
      if (created.length === 0) {
        notify.info('Aucune présence à importer (pas d\'horaires définis sur la techlist).')
      } else {
        notify.success(`${created.length} créneau(x) Présence importé(s).`)
      }
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  // POP-1 : accept (creneau, event|rect) — l'event peut être un MouseEvent
  // React dont currentTarget est l'élément bloc. Si seul `creneau` est passé,
  // l'inspecteur s'ouvre centré (fallback ancien comportement).
  function handleSelectCreneau(creneau, eventOrRect) {
    setCreatingDraft(null)
    setCreatingAnchor(null)
    openInspector(creneau, eventOrRect)
  }

  function handleCreateCreneauAt(draft, eventOrRect) {
    if (!canEdit) return
    closeInspector()
    // FEST-3.3 : si _skipInspector=true, on crée directement en BDD sans
    // ouvrir l'inspector (workflow "Attribuer à un cadreur" depuis le
    // right-click sur un show). Le draft est déjà complet (titre, type,
    // horaires, source_creneau_id, source_anchor, member_ids).
    if (draft._skipInspector && deroule?.id) {
      const payload = {
        deroule_id: deroule.id,
        lane_id: draft.lane_id || null,
        multi_lane: draft.multi_lane === true,
        heure_debut_min: draft.heure_debut_min,
        heure_fin_min: draft.heure_fin_min,
        type: draft.type ?? 'autre',
        titre: draft.titre ?? '',
        lieu_text: draft.lieu_text ?? null,
        notes: draft.notes ?? null,
        source_creneau_id: draft.source_creneau_id ?? null,
        source_anchor: draft.source_anchor ?? null,
        member_ids: Array.isArray(draft.member_ids) ? draft.member_ids : [],
      }
      createCreneau(payload)
        .then(() => notify.success('Tournage créé et attribué'))
        .catch((e) => notify.error('Erreur : ' + (e?.message || e)))
      return
    }
    // Force lane Global par défaut si rien
    const globalLane = lanes.find((l) => l.sort_order === 0)
    // FEST-3.2 : draft peut désormais inclure des overrides depuis
    // QuickCreateMenu : type, titre, source_creneau_id, source_anchor.
    // On les conserve ; les défauts ('' / 'autre') ne s'appliquent que
    // si absents dans le draft fourni.
    setCreatingDraft({
      lane_id: draft.lane_id || globalLane?.id || null,
      titre: draft.titre ?? '',
      type: draft.type ?? 'autre',
      // V0.5 : si appelé depuis le bouton flottant mobile sans heures,
      // défauts 09:00 → 09:30 (540 → 570 minutes).
      heure_debut_min: draft.heure_debut_min ?? 540,
      heure_fin_min: draft.heure_fin_min ?? 570,
      multi_lane: draft.multi_lane ?? false,
      // FEST-3.2 raffinements Hugo : lieu et notes hérités depuis le show
      // source via QuickCreateMenu (_lieuInferred + show.notes).
      lieu_text: draft.lieu_text ?? null,
      notes: draft.notes ?? null,
      // Overrides FEST-3.2 (peuvent être undefined → champs ignorés au save)
      ...(draft.source_creneau_id ? { source_creneau_id: draft.source_creneau_id } : {}),
      ...(draft.source_anchor ? { source_anchor: draft.source_anchor } : {}),
    })
    // Stocke aussi le rect du futur bloc (calculé par DerouleTimelineView
    // depuis les coords de la lane + heures) pour ancrer le popover.
    // Détection robuste : DOMRect natif OU plain rect avec top/left/width.
    let rect = null
    if (eventOrRect && typeof eventOrRect === 'object') {
      if (
        typeof eventOrRect.top === 'number' &&
        typeof eventOrRect.left === 'number' &&
        typeof eventOrRect.width === 'number'
      ) {
        rect = eventOrRect
      } else if (eventOrRect.currentTarget?.getBoundingClientRect) {
        rect = eventOrRect.currentTarget.getBoundingClientRect()
      }
    }
    setCreatingAnchor(rect)
  }

  async function handleSaveCreneau(fields) {
    await updateCreneau(inspectedCreneau.id, fields)
    // FEST-3.2 C : propagation auto aux enfants liés
    await propagateToChildren(inspectedCreneau, fields)
    closeInspector()
    notify.success('Créneau mis à jour')
  }

  // FEST-3.2 C : retourne true si un champ d'anchor doit être considéré
  // comme impacté par un patch (où les clés sont les colonnes BDD réelles).
  // Permet de skip la propagation si rien d'utile n'a changé.
  function isAnchorFieldImpactedByPatch(anchorField, modifiedFields) {
    if (!modifiedFields) return false
    switch (anchorField) {
      case 'duree_min':
        return (
          'heure_debut_min' in modifiedFields ||
          'heure_fin_min' in modifiedFields
        )
      case 'heure_debut_min':
        return 'heure_debut_min' in modifiedFields
      case 'cadreurs':
        return 'member_ids' in modifiedFields
      default:
        return anchorField in modifiedFields
    }
  }

  // FEST-2.7 + POP-2.B : save silencieux générique. Ne ferme PAS le drawer
  // et n'émet PAS de toast — utilisé pour les notes (auto-save debounced)
  // ET les modifs inline hover-to-edit (titre, horaires, lane, lieu, statut).
  // Accepte n'importe quel sous-ensemble de champs du créneau.
  // FEST-3.2 C : déclenche la propagation auto aux enfants liés.
  async function handleSavePartial(fields) {
    if (!inspectedCreneau?.id || !fields || typeof fields !== 'object') return
    try {
      await updateCreneau(inspectedCreneau.id, fields)
      await propagateToChildren(inspectedCreneau, fields)
    } catch (e) {
      console.warn('[DerouleTab] partial save failed', e)
    }
  }

  // FEST-3.2 C : propagation auto aux enfants liés. Quand un créneau source
  // est modifié, on update tous les créneaux enfants (source_creneau_id ===
  // sourceCreneau.id) pour les champs présents à la fois dans :
  //   - le anchor.fields de chaque enfant
  //   - les fields modifiés (intersection)
  // Silencieux (pas de toast, pas de fermeture). Si un enfant a override
  // un champ localement, il sera écrasé — c'est par design (FEST-3.2 C).
  async function propagateToChildren(sourceCreneau, modifiedFields) {
    if (!sourceCreneau?.id || !modifiedFields) return
    const linkedChildren = getLinkedChildren(creneaux, sourceCreneau.id)
    if (linkedChildren.length === 0) return
    // Source enrichie des modifs (pour applySourceUpdate)
    const updatedSource = { ...sourceCreneau, ...modifiedFields }
    for (const child of linkedChildren) {
      const anchor = child.source_anchor || { fields: [] }
      const fieldsToApply = (anchor.fields || []).filter((af) =>
        isAnchorFieldImpactedByPatch(af, modifiedFields),
      )
      if (fieldsToApply.length === 0) continue
      const patch = applySourceUpdate(
        updatedSource,
        child,
        { fields: fieldsToApply },
        // FEST-3.2 raffinement Hugo : passe l'ancien snapshot de la
        // source pour préserver l'offset enfant-source (ex: cadreur
        // à H+30min du show garde son offset au déplacement du show).
        { referenceSource: sourceCreneau },
      )
      // Cas spécial member_ids (cadreurs) → appel séparé via
      // setCreneauMembres car pas une colonne directe.
      const { member_ids, ...structured } = patch
      try {
        if (Object.keys(structured).length > 0) {
          await updateCreneau(child.id, structured)
        }
        if (member_ids) {
          await setCreneauMembres(child.id, member_ids)
        }
      } catch (e) {
        console.warn('[DerouleTab] propagate to child failed', child.id, e)
      }
    }
  }
  // Alias historique (FEST-2.7) pour ne pas casser la prop existante.
  async function handleAutoSaveCreneauNotes(notes) {
    await handleSavePartial({ notes })
  }

  // FEST-2.11 : save silencieux d'un AUTRE créneau (utilisé pour la
  // propagation source → enfants depuis la modal de propagation).
  async function handleSavePartialForCreneau(creneauId, fields) {
    if (!creneauId || !fields || typeof fields !== 'object') return
    try {
      await updateCreneau(creneauId, fields)
    } catch (e) {
      console.warn('[DerouleTab] propagation save failed', e)
    }
  }
  async function handleSetMembresForCreneau(creneauId, membreIds) {
    if (!creneauId) return
    try {
      await setCreneauMembres(creneauId, membreIds)
    } catch (e) {
      console.warn('[DerouleTab] propagation membres failed', e)
    }
  }

  async function handleCreateCreneauSubmit(fields) {
    const created = await createCreneau(fields)
    if (created && fields.member_ids?.length > 0) {
      // Les member_ids sont déjà passés dans createCreneau — mais on s'assure
      // pas de double-insert (createCreneau gère déjà)
    }
    setCreatingDraft(null)
    setCreatingAnchor(null)
    notify.success('Créneau créé')
  }

  // FEST-4.3 : Import effectif depuis la preview modal.
  // Reçoit la liste des shows cochés, la date cible et le mapping scènes
  // → lanes (existing or to-create). Workflow :
  //   1. Trouver / créer le déroulé pour targetDate
  //   2. Créer les lanes scène manquantes (type='lieu')
  //   3. Bulk-insert des créneaux
  //   4. Switch sur la date importée + close modals + reload
  async function handleImportConfirm(payload) {
    const {
      targetDate,
      scenesMapping,
      shows,
      // FEST-import-update : updates / deletes / propagation soft-link
      updates = [],
      deletes = [],
      propagateLinks = false,
      // FEST-5.5.3 : id du déroulé source pour copier les cadreurs
      copyCadreursFromDerouleId = null,
    } = payload
    if (
      !targetDate ||
      ((!Array.isArray(shows) || shows.length === 0) &&
        updates.length === 0 &&
        deletes.length === 0)
    ) {
      notify.error("Rien à importer")
      return
    }
    setImporting(true)
    try {
      // 1. Résoudre le déroulé cible
      //    a. Si targetDate === selectedDate et qu'un déroulé est chargé,
      //       on le réutilise directement (BDD à jour côté useDeroule).
      //    b. Sinon on cherche un déroulé existant pour cette date
      //       (fetchProjectDeroules) ou on le crée.
      let targetDerouleId = null
      let targetLanes = []
      let createdDeroule = false
      let copiedCadreurs = 0

      if (targetDate === selectedDate && deroule?.id) {
        targetDerouleId = deroule.id
        targetLanes = lanes
      } else {
        const all = await DerouleLib.fetchProjectDeroules(projectId)
        const existing = all.find((d) => d.date_jour === targetDate)
        if (existing) {
          const detail = await DerouleLib.fetchDerouleComplet(existing.id)
          targetDerouleId = detail.deroule.id
          targetLanes = detail.lanes || []
        } else {
          const created = await DerouleLib.createDeroule({
            project_id: projectId,
            date_jour: targetDate,
            titre: 'Importé via IA',
          })
          targetDerouleId = created.deroule.id
          targetLanes = created.lanes || []
          createdDeroule = true
          // FEST-5.5.3 : si demandé, copie les lanes cadreur d'un autre
          // jour avant l'insert des scènes/créneaux. On ne copie PAS les
          // lanes 'lieu' (les scènes sont déjà gérées par scenesMapping).
          if (copyCadreursFromDerouleId) {
            try {
              const newLanes = await DerouleLib.copyLanesFromDeroule(
                copyCadreursFromDerouleId,
                targetDerouleId,
                ['personne'],
              )
              copiedCadreurs = newLanes.length
              targetLanes = [...targetLanes, ...newLanes]
            } catch (e) {
              console.warn('[handleImportConfirm] copyLanes failed', e)
            }
          }
        }
      }

      // 2. Pour chaque scène : trouver une lane existante OU en créer une.
      //    On indexe par libellé lowercase pour la robustesse de matching.
      const sceneKeyToLaneId = {}
      for (const s of scenesMapping || []) {
        const key = (s.scene || '').trim().toLowerCase()
        if (!key) continue
        // Re-check parmi les lanes fraîches (cas où targetLanes contient déjà
        // la scène — important si on a switch de jour)
        const existing = targetLanes.find(
          (l) =>
            l.type === 'lieu' &&
            (l.libelle || '').trim().toLowerCase() === key,
        )
        if (existing) {
          sceneKeyToLaneId[key] = existing.id
          continue
        }
        try {
          const newLane = await DerouleLib.addLane(targetDerouleId, {
            type: 'lieu',
            libelle: s.scene,
          })
          sceneKeyToLaneId[key] = newLane.id
          targetLanes.push(newLane)
        } catch (e) {
          console.warn('[import] addLane error', s.scene, e)
        }
      }
      const globalLane =
        targetLanes.find((l) => l.type === 'global') || targetLanes[0]

      // 3. Insert des créneaux. Best-effort : on log les erreurs, on continue
      //    et on rapporte au final.
      let okCount = 0
      let errCount = 0
      let updCount = 0
      let delCount = 0
      let propagCount = 0
      for (const s of shows) {
        try {
          const sceneKey = (s.scene || '').trim().toLowerCase()
          const laneId = sceneKey
            ? sceneKeyToLaneId[sceneKey]
            : globalLane?.id
          if (!laneId) {
            console.warn('[import] pas de lane cible pour', s)
            errCount += 1
            continue
          }
          await DerouleLib.createCreneau({
            deroule_id: targetDerouleId,
            lane_id: laneId,
            heure_debut_min: s.debut_min,
            heure_fin_min: s.fin_min,
            type: 'prise',
            titre: s.titre,
          })
          okCount += 1
        } catch (e) {
          console.warn('[import] createCreneau error', s, e)
          errCount += 1
        }
      }

      // 3b. Mises à jour (mode update) — update du créneau source puis
      //     propagation soft-link aux enfants si demandé.
      for (const u of updates) {
        try {
          // Source créneau frais : on relit dans `creneaux` (state local)
          // pour disposer des champs source_anchor des enfants. Si non
          // trouvé, on prend l'existing du payload.
          const sourceCreneau =
            creneaux.find((c) => c.id === u.existingId) || null
          await updateCreneau(u.existingId, u.fields)
          updCount += 1
          // Propagation aux enfants liés (cadreur shoots)
          if (propagateLinks && sourceCreneau) {
            try {
              await propagateToChildren(sourceCreneau, u.fields)
              propagCount += 1
            } catch (e) {
              console.warn('[import-update] propagateToChildren failed', e)
            }
          }
        } catch (e) {
          console.warn('[import-update] update error', u, e)
          errCount += 1
        }
      }

      // 3c. Suppressions (mode update) — seuls les créneaux LIEU absents
      //     de la nouvelle prog ET cochés. Les enfants soft-link auront
      //     leur source_creneau_id mis à NULL via ON DELETE SET NULL.
      for (const d of deletes) {
        try {
          await DerouleLib.deleteCreneau(d.existingId)
          delCount += 1
        } catch (e) {
          console.warn('[import-update] delete error', d, e)
          errCount += 1
        }
      }

      // 4. Switch + close + reload
      if (targetDate !== selectedDate) {
        setSelectedDate(targetDate)
      } else {
        // Force reload du déroulé courant (sinon les nouveaux créneaux
        // arrivent via Supabase Realtime mais le déroulé fraîchement créé
        // n'est pas encore relié dans useDeroule).
        reload()
      }
      setImportPreviewOpen(false)
      setImportExtracted(null)

      const parts = []
      if (createdDeroule) parts.push('déroulé créé')
      if (copiedCadreurs > 0) {
        parts.push(
          `${copiedCadreurs} cadreur${copiedCadreurs > 1 ? 's' : ''} repris${copiedCadreurs > 1 ? '' : ''}`,
        )
      }
      if (okCount > 0) {
        parts.push(`${okCount} nouveau${okCount > 1 ? 'x' : ''}`)
      }
      if (updCount > 0) {
        parts.push(
          `${updCount} mis à jour${propagCount > 0 ? ` (+${propagCount} cascade${propagCount > 1 ? 's' : ''})` : ''}`,
        )
      }
      if (delCount > 0) {
        parts.push(`${delCount} supprimé${delCount > 1 ? 's' : ''}`)
      }
      if (errCount > 0) parts.push(`${errCount} en erreur`)
      if (parts.length === 0) parts.push('aucune action')
      notify.success(parts.join(' · '))
    } catch (e) {
      console.error('[import] global error', e)
      notify.error('Erreur import : ' + (e?.message || e))
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteCreneau() {
    await deleteCreneau(inspectedCreneau.id)
    closeInspector()
    notify.success('Créneau supprimé', false)
  }

  async function handleSetCreneauMembres(membreIds) {
    await setCreneauMembres(inspectedCreneau.id, membreIds)
    // FEST-3.2 C : propagation auto si l'équipe est dans l'anchor des enfants
    await propagateToChildren(inspectedCreneau, { member_ids: membreIds })
  }

  // FEST-3.4 : duplique un créneau juste après lui-même (H+durée) dans la
  // même lane. Clone titre/type/lieu/équipe/notes, statut réinitialisé à
  // 'planifie'. PAS de lien soft (vraie duplication, pas un alias).
  async function handleDuplicateCreneau() {
    if (!inspectedCreneau?.id || !deroule?.id) return
    const src = inspectedCreneau
    const duree = (src.heure_fin_min ?? 0) - (src.heure_debut_min ?? 0)
    if (duree <= 0) {
      notify.error('Impossible de dupliquer : créneau invalide')
      return
    }
    const newDebut = src.heure_fin_min
    const newFin = Math.min(newDebut + duree, MAX_MIN)
    if (newFin <= newDebut) {
      notify.error('Pas de place après ce créneau (dépasse le viewport)')
      return
    }
    try {
      await createCreneau({
        deroule_id: deroule.id,
        lane_id: src.lane_id,
        multi_lane: src.multi_lane === true,
        heure_debut_min: newDebut,
        heure_fin_min: newFin,
        type: src.type ?? 'autre',
        titre: src.titre ?? '',
        description: src.description ?? null,
        lieu_text: src.lieu_text ?? null,
        notes: src.notes ?? null,
        member_ids: Array.isArray(src.member_ids) ? src.member_ids : [],
        // Pas de source_creneau_id/source_anchor : duplication ≠ lien.
      })
      notify.success('Créneau dupliqué')
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  // FEST-3.2 C : wrapper sur updateCreneau pour le drag-and-drop (le bloc
  // est déplacé dans la timeline, pas via le popover). Sans ce wrapper, la
  // propagation auto aux enfants liés ne se faisait pas (Hugo signalé).
  async function handleMoveCreneau(creneauId, fields) {
    await updateCreneau(creneauId, fields)
    const source = creneaux.find((c) => c.id === creneauId)
    if (source) {
      await propagateToChildren(source, fields)
    }
  }

  async function handleAddLane(payload) {
    // FEST-2 : le menu d'ajout passe désormais un payload typé
    // { type, libelle?, membre_id? }. Sans payload = ancien comportement
    // (lane générique type='equipe').
    try {
      await addLane(payload || null)
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleReorderLane(laneId, direction) {
    // FEST-2-bis : déplace une lane d'un cran à gauche ou à droite.
    // Le composant timeline calcule le voisin et appelle ce handler.
    // direction : 'left' ou 'right' — mais le calcul du voisin se fait
    // côté DerouleTimelineView qui a accès aux sortedLanes. On reçoit
    // donc directement le couple { laneId, neighborId }.
    if (!laneId || !direction) return
    try {
      await swapLaneOrder(laneId, direction)
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleDeleteLane(laneId) {
    const lane = lanes.find((l) => l.id === laneId)
    const laneLabel = lane?.libelle || 'cette lane'
    const ok = await confirm({
      title: `Supprimer ${laneLabel} ?`,
      message:
        'Si la lane contient des créneaux, ils seront eux aussi supprimés.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      // 1er essai : sans force. Si lane vide → suppression directe.
      await deleteLane(laneId)
      notify.success(`Lane ${laneLabel} supprimée`)
    } catch (e) {
      // FEST-5.5.1 : si la lane contient des créneaux, demande une 2e
      // confirmation explicite avant de cascade-delete.
      if (e?.code === 'LANE_NOT_EMPTY') {
        const okForce = await confirm({
          title: `Supprimer aussi les ${e.creneauxCount} créneau(x) ?`,
          message: `La lane ${laneLabel} contient ${e.creneauxCount} créneau${e.creneauxCount > 1 ? 'x' : ''}. Ils seront définitivement supprimés.`,
          confirmLabel: 'Tout supprimer',
          cancelLabel: 'Annuler',
          danger: true,
        })
        if (!okForce) return
        try {
          await deleteLane(laneId, { force: true })
          notify.success(
            `Lane ${laneLabel} et ${e.creneauxCount} créneau(x) supprimés`,
          )
        } catch (e2) {
          notify.error('Erreur : ' + (e2?.message || e2))
        }
        return
      }
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  // ─── Garde permissions ───────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div className="p-8 text-center">
        <Lock className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
          Vous n&apos;avez pas accès au déroulé de ce projet.
        </p>
      </div>
    )
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div
          className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  // ─── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--red)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
          Impossible de charger le déroulé.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
          {error.message || 'Erreur inconnue'}
        </p>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DaySelector
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          deroules={deroules}
          canEdit={canEdit}
        />
        <div className="flex items-center gap-2">
          {/* FEST-2.8 : avatars des autres admins sur la page Déroulé
              (via useProjectPresence générique PRES-1). N'affiche rien si
              on est seul. */}
          <ProjectPresenceBadge outilKey="deroule" projectId={projectId} />
          {/* FEST-3 : toggle visible aussi sur mobile pour accéder à la vue
              Cadreur. Sur mobile, les labels sont masqués (hidden sm:inline
              dans ToggleBtn) pour ne garder que les icônes. */}
          {deroule && <ViewToggle view={view} onChange={setView} />}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Crée un lien public partageable du déroulé"
            >
              <Share2 className="w-3 h-3" />
              <span className="hidden sm:inline">Partager</span>
            </button>
          )}
          {/* FEST-6 : bouton Exporter (PNG cadreur + PDF complet) */}
          {deroule && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Exporter le déroulé en PDF ou PNG fond d'écran cadreur"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Exporter</span>
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Importe une programmation PDF/image via Claude Vision (FEST-4)"
            >
              <Sparkles className="w-3 h-3" />
              <span className="hidden sm:inline">Importer prog.</span>
            </button>
          )}
          {/* FEST-5.1d : toggle overlay golden hour (visible si projet géolocalisé) */}
          {hasProjectGeoloc && deroule && (
            <button
              type="button"
              onClick={() => setShowGoldenHour((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: showGoldenHour ? '#F59E0B' : 'var(--txt-2)',
                background: showGoldenHour
                  ? 'rgba(245,158,11,0.08)'
                  : 'transparent',
                border: `1px solid ${showGoldenHour ? 'rgba(245,158,11,0.45)' : 'var(--brd)'}`,
              }}
              title={
                showGoldenHour
                  ? 'Masquer les golden hours (lever/coucher du soleil)'
                  : 'Afficher les golden hours (lever/coucher du soleil)'
              }
            >
              <Sun className="w-3 h-3" />
              <span className="hidden sm:inline">Golden</span>
            </button>
          )}
          {/* Sprint A — Mode Régie live : toggle + plein écran.
              Le toggle est désactivé si le déroulé n'est pas aujourd'hui
              (on n'auto-transitionne pas un déroulé du passé/futur). */}
          {deroule && (
            <>
              <button
                type="button"
                onClick={() => liveMode.setEnabled((v) => !v)}
                disabled={!liveMode.isToday}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
                style={{
                  color: liveMode.enabled
                    ? '#FFFFFF'
                    : liveMode.isToday
                    ? 'var(--txt-2)'
                    : 'var(--txt-3)',
                  background: liveMode.enabled
                    ? '#E24B4A'
                    : 'transparent',
                  border: `1px solid ${
                    liveMode.enabled
                      ? '#E24B4A'
                      : liveMode.isToday
                      ? 'var(--brd)'
                      : 'var(--brd-sub)'
                  }`,
                  cursor: liveMode.isToday ? 'pointer' : 'not-allowed',
                  opacity: liveMode.isToday ? 1 : 0.55,
                }}
                title={
                  !liveMode.isToday
                    ? 'Mode live disponible uniquement le jour J'
                    : liveMode.enabled
                    ? 'Désactiver le mode régie live'
                    : 'Activer le mode régie live (auto-transitions statut)'
                }
              >
                <Radio
                  className="w-3 h-3"
                  style={{
                    animation: liveMode.enabled
                      ? 'live-radio-pulse 1.5s ease-in-out infinite'
                      : 'none',
                  }}
                />
                <span className="hidden sm:inline">Live</span>
              </button>
              {liveMode.enabled && liveMode.isToday && (
                <button
                  type="button"
                  onClick={() => setLiveFullscreen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
                  style={{
                    color: 'var(--txt-2)',
                    background: 'transparent',
                    border: '1px solid var(--brd)',
                  }}
                  title="Plein écran régie (écran de salle)"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Plein écran</span>
                </button>
              )}
            </>
          )}
          {deroule && canEdit && (
            <button
              type="button"
              onClick={handleImportPresences}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Crée des créneaux Présence sur la lane Global pour chaque membre techlist présent ce jour"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Importer présences</span>
            </button>
          )}
          {deroule && canEdit && (
            <button
              type="button"
              onClick={handleDeleteDeroule}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--red)',
                background: 'transparent',
                border: '1px solid var(--red-brd, rgba(226,75,74,0.3))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--red-bg)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              title={`Supprimer le déroulé du ${formatDate(selectedDate)} et tous ses créneaux`}
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden sm:inline">Supprimer</span>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!deroule ? (
        <EmptyState
          selectedDate={selectedDate}
          canEdit={canEdit}
          deroules={deroules}
          onCreate={handleCreateDeroule}
        />
      ) : view === 'cadreur' ? (
        <DerouleCadreurView
          deroule={deroule}
          lanes={lanes}
          creneaux={creneaux}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          selectedMembreId={selectedCadreurId}
          setSelectedMembreId={setSelectedCadreurId}
          onSelectCreneau={handleSelectCreneau}
          /* Sprint B : cochage statut depuis l'admin (réutilise le
             save partial générique). Si canEdit=false on désactive. */
          onToggleStatut={
            canEdit
              ? (id, statut) => handleSavePartialForCreneau(id, { statut })
              : null
          }
          /* Cohérence avec la vue share : single column (les ContextCards
             "programme festival" à droite étaient verbeuses sur Festival
             6+ lanes ; l'utilisateur a la vue Timeline pour le contexte). */
          singleColumn
        />
      ) : view === 'timeline' && !isMobile ? (
        <DerouleTimelineView
          projectId={projectId}
          deroule={deroule}
          lanes={lanes}
          creneauxByLane={creneauxByLane}
          creneauxMultiLane={creneauxMultiLane}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          canEdit={canEdit}
          hasOpenInspector={Boolean(inspectedCreneau || creatingDraft)}
          creatingDraft={creatingDraft}
          onSelectCreneau={handleSelectCreneau}
          onCreateCreneauAt={handleCreateCreneauAt}
          onAddLane={handleAddLane}
          onUpdateLane={updateLane}
          onDeleteLane={handleDeleteLane}
          onReorderLane={handleReorderLane}
          onMoveCreneau={handleMoveCreneau}
          sunTimes={sunTimes}
          showGoldenHour={showGoldenHour}
        />
      ) : (
        <DerouleListView
          lanes={lanes}
          creneaux={creneaux}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          onSelectCreneau={handleSelectCreneau}
        />
      )}

      {/* Bouton flottant "+ créneau" pour mobile / liste */}
      {deroule && canEdit && (view === 'liste' || isMobile) && (
        <button
          type="button"
          onClick={() =>
            handleCreateCreneauAt({
              lane_id: lanes.find((l) => l.sort_order === 0)?.id || null,
              multi_lane: false,
              heure_debut_min: 540,    // 09:00
              heure_fin_min: 570,      // 09:30
            })
          }
          className="fixed bottom-6 right-6 flex items-center gap-1 px-3 py-2 text-sm rounded-full shadow-lg z-30"
          style={{
            background: 'var(--blue)',
            color: 'white',
          }}
        >
          <Plus className="w-4 h-4" />
          Créneau
        </button>
      )}

      {/* Inspecteur popover anchored (POP-1) */}
      {inspectedCreneau && (
        <CreneauInspector
          creneau={inspectedCreneau}
          anchorRect={inspectedAnchor}
          lanes={lanes}
          allCreneaux={creneaux}
          membresPresents={membresAvecPresence}
          /* Pass les conflits du créneau courant pour affichage dans
             l'inspecteur (mode debug visuel : qui chevauche qui). */
          conflicts={conflictsByCreneau?.get?.(inspectedCreneau.id) || []}
          canEdit={canEdit}
          onClose={closeInspector}
          onSave={handleSaveCreneau}
          onAutoSaveNotes={handleAutoSaveCreneauNotes}
          onSavePartial={handleSavePartial}
          onSavePartialForCreneau={handleSavePartialForCreneau}
          onSetMembresForCreneau={handleSetMembresForCreneau}
          onDelete={handleDeleteCreneau}
          onDuplicate={handleDuplicateCreneau}
          onSetMembres={handleSetCreneauMembres}
        />
      )}
      {creatingDraft && (
        <CreneauInspector
          creneau={creatingDraft}
          anchorRect={creatingAnchor}
          isCreate
          lanes={lanes}
          membresPresents={membresAvecPresence}
          canEdit={canEdit}
          onClose={() => {
            setCreatingDraft(null)
            setCreatingAnchor(null)
          }}
          onCreate={handleCreateCreneauSubmit}
        />
      )}

      {/* Modale de partage (Vague 2) */}
      <DerouleShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        projectId={projectId}
      />

      {/* FEST-6 : Modale d'export (PDF complet + PNG cadreur) */}
      <ExportDerouleModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        project={project}
        projectId={projectId}
        deroules={deroules}
        currentDerouleId={deroule?.id || null}
        membres={membres}
      />

      {/* FEST-4.2 : modal d'upload (PDF/image → Claude Vision) */}
      <ImportDerouleModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onResult={(extracted) => {
          // Stocker le résultat + fermer modal upload + ouvrir preview
          setImportExtracted(extracted)
          setImportOpen(false)
          setImportPreviewOpen(true)
        }}
      />

      {/* FEST-4.3 : modal de preview + import effectif */}
      <ImportPreviewModal
        open={importPreviewOpen}
        extracted={importExtracted}
        selectedDate={selectedDate}
        existingLanes={lanes}
        existingCreneaux={creneaux}
        existingDeroule={deroule}
        allProjectDeroules={deroules}
        importing={importing}
        onClose={() => {
          if (importing) return
          setImportPreviewOpen(false)
          setImportExtracted(null)
        }}
        onConfirm={handleImportConfirm}
      />

      {/* Sprint A — Mode Régie live : overlay plein écran */}
      {liveFullscreen && liveMode.enabled && (
        <LiveModeOverlay
          currentCreneaux={liveMode.currentCreneaux}
          nextCreneau={liveMode.nextCreneau}
          nowMin={liveMode.nowMin}
          membreById={
            new Map(
              (membres || []).map((m) => {
                const prenom = m.contact?.prenom || m.prenom || ''
                const nom = m.contact?.nom || m.nom || ''
                return [
                  m.id,
                  {
                    ...m,
                    fullName: `${prenom} ${nom}`.trim() || '—',
                    ini:
                      `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() ||
                      '?',
                  },
                ]
              }),
            )
          }
          laneById={new Map((lanes || []).map((l) => [l.id, l]))}
          onSkipToNext={() => liveMode.skipToNext()}
          onMarkDone={() => liveMode.markCurrentDone()}
          onClose={() => setLiveFullscreen(false)}
        />
      )}

      {/* CSS keyframes pour le pulse de l'icône Live dans la toolbar */}
      <style>{`
        @keyframes live-radio-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

// ─── DaySelector — chips datés + bouton "Nouveau jour" ────────────────────

function DaySelector({ selectedDate, onSelectDate, deroules, canEdit: _canEdit }) {
  function shift(days) {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + days)
    onSelectDate(isoDate(d))
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--txt-2)', background: 'transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <DayPicker
        value={selectedDate}
        onChange={onSelectDate}
        markedDates={deroules.map((d) => d.date_jour)}
      />
      <button
        type="button"
        onClick={() => shift(1)}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--txt-2)', background: 'transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {/* Chips des jours déjà créés */}
      {deroules.length > 0 && (
        <div className="flex gap-1 ml-2 flex-wrap">
          {deroules.map((d) => {
            const active = d.date_jour === selectedDate
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelectDate(d.date_jour)}
                className="px-2 py-0.5 text-[11px] rounded transition-colors"
                style={{
                  background: active ? 'var(--blue)' : 'var(--bg-elev)',
                  color: active ? 'white' : 'var(--txt-2)',
                  border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
                  fontWeight: active ? 500 : 400,
                }}
              >
                {formatDateChip(d.date_jour)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── ViewToggle ────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }) {
  // FEST-3 : ajout du mode "Cadreur" en plus de Timeline / Liste.
  // Les 3 sont des modes mutuellement exclusifs. Mobile : tous accessibles
  // via les mêmes pills (pas de masquage label sur mobile pour cette V1).
  return (
    <div
      className="flex rounded overflow-hidden"
      style={{ border: '1px solid var(--brd)' }}
    >
      <ToggleBtn
        active={view === 'timeline'}
        onClick={() => onChange('timeline')}
        icon={LayoutGrid}
        label="Timeline"
      />
      <ToggleBtn
        active={view === 'liste'}
        onClick={() => onChange('liste')}
        icon={ListIcon}
        label="Liste"
        leftBorder
      />
      <ToggleBtn
        active={view === 'cadreur'}
        onClick={() => onChange('cadreur')}
        icon={Eye}
        label="Cadreur"
        leftBorder
      />
    </div>
  )
}

function ToggleBtn({ active, onClick, icon: Icon, label, leftBorder }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xs"
      style={{
        background: active ? 'var(--bg-elev)' : 'transparent',
        color: active ? 'var(--txt)' : 'var(--txt-3)',
        fontWeight: active ? 500 : 400,
        borderLeft: leftBorder ? '1px solid var(--brd)' : 'none',
        minHeight: 28,
      }}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ─── EmptyState ────────────────────────────────────────────────────────────

function EmptyState({ selectedDate, canEdit, deroules = [], onCreate }) {
  // FEST-5.5.3 : propose de reprendre les lanes du déroulé le plus récent
  // (autre que la date courante) → on évite de re-saisir cadreurs+scènes
  // chaque jour d'un festival.
  const mostRecentOther = useMemo(() => {
    const others = (deroules || []).filter((d) => d.date_jour !== selectedDate)
    if (others.length === 0) return null
    // Tri par date_jour DESC (le plus récent en premier)
    const sorted = [...others].sort((a, b) =>
      a.date_jour < b.date_jour ? 1 : -1,
    )
    return sorted[0]
  }, [deroules, selectedDate])

  const [copyLanes, setCopyLanes] = useState(true)

  return (
    <div
      className="rounded-lg p-12 text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <Clock className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.4 }} />
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
        Aucun déroulé pour le {formatDate(selectedDate)}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
        Créez un déroulé pour planifier la journée heure par heure.
      </p>

      {canEdit && mostRecentOther && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 16,
            padding: '6px 12px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--txt-2)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={copyLanes}
            onChange={(e) => setCopyLanes(e.target.checked)}
          />
          Reprendre la structure du{' '}
          <strong style={{ color: 'var(--txt)' }}>
            {formatDate(mostRecentOther.date_jour)}
          </strong>{' '}
          <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>
            (cadreurs + scènes)
          </span>
        </label>
      )}

      {canEdit && (
        <div>
          <button
            type="button"
            onClick={() =>
              onCreate({
                copyLanesFromDerouleId:
                  mostRecentOther && copyLanes ? mostRecentOther.id : null,
              })
            }
            className="mt-4 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
            style={{
              background: 'var(--blue)',
              color: 'white',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Créer le déroulé
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Helpers date ──────────────────────────────────────────────────────────

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function formatDateChip(iso) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
