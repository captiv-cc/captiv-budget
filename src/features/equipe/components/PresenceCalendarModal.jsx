// ════════════════════════════════════════════════════════════════════════════
// PresenceCalendarModal — Présence sur le projet (P4-LOGISTIQUE-CLEANUP)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale qui regroupe :
//   - Calendrier des jours de présence (multi-mois, avec sélection rapide
//     par période du projet : Tournage, Prépa, etc.)
//   - Date d'arrivée (souvent ≠ du 1er jour de présence)
//   - Date de retour (souvent ≠ du dernier jour de présence)
//
// Tout le reste (heures d'arrivée/retour, hébergement, chauffeur, notes
// logistique) est désormais géré dans la future tab Logistique. Les
// colonnes correspondantes sur projet_membres restent en DB et seront
// éditées depuis là — décision Hugo P4-LOGISTIQUE-CLEANUP.
//
// Toutes les valeurs sont persona-level → propagées à toutes les rows de
// la même personne via updatePersona.
//
// Usage :
//   <PresenceCalendarModal
//     open={open}
//     onClose={...}
//     personaName="Hugo Martin"
//     persona={{ presence_days, arrival_date, departure_date }}
//     onSave={(fields) => updatePersona(key, fields)}
//     periodes={extractPeriodes(project.metadata)}
//     anchorDate={firstTournageDay}
//   />
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Calendar,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Users,
  Edit2,
  MapPin,
} from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  MONTHS_FR,
  getMonthGrid,
  addMonths,
  fmtDateKey,
  isSameMonth,
  startOfMonth,
} from '../../planning/dateUtils'
import { PERIODE_KEYS, PERIODE_META, expandDays, hasAnyRange } from '../../../lib/projectPeriodes'
import {
  effectiveCouleur,
  effectiveLabel,
  findMatchingSession,
  sortSessionsByDate,
} from '../../../lib/sessions'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'

export default function PresenceCalendarModal({
  open,
  onClose,
  personaName = '—',
  persona = null, // { presence_days, arrival_date, arrival_time, logistique_notes }
  // Sessions Phase 0b — quand cette prop est fournie, la modale édite UNE
  // session à la fois (sélectionnable si 2+) au lieu d'écrire sur le
  // persona agrégé. onSave reçoit alors la sessionId en 2ᵉ argument et
  // l'appelant route vers updateMemberSession plutôt que updatePersona.
  // Si non fournie ou vide → fallback comportement legacy (persona-level).
  sessions = null,
  // Templates de sessions disponibles ailleurs sur le projet (= sessions
  // d'autres membres pas encore chez le membre courant). Boutons "+ <Label>"
  // affichés en faible opacité dans la barre du sélecteur. Click → crée
  // une copie chez le membre courant via onCreateSession.
  // Format : [{ label, lieu, presence_days, arrival_date, departure_date }]
  projectSessionTemplates = [],
  // Crée une session pour le membre courant. Reçoit un payload partiel
  // (label, lieu_principal_text, presence_days, arrival/departure). Doit
  // retourner la session créée (avec son id) pour qu'on puisse l'activer.
  // Si non fournie → les boutons d'ajout sont cachés.
  onCreateSession = null,
  // Phase A/3 — fait rejoindre le membre courant à une session globale
  // existante du projet. Reçoit sessionId + payload optionnel d'override.
  // Utilisé par les boutons "+ Template" en faible opacité (chaque
  // template a un session_id de la session globale matchée).
  // Si non fournie → fallback sur onCreateSession (= duplication legacy).
  onJoinSession = null,
  // Update méta de la session active (label + lieu). Édité inline dans
  // un mini-panneau sous le sélecteur. Modifier le label/lieu touche la
  // session GLOBALE → propage à tous les participants (cf. lib split).
  // Si non fourni, le panneau d'édition n'est pas affiché.
  onUpdateSessionMeta = null,
  // Map<sessionId, count> — nombre de participants distincts par
  // session globale du projet. Sert à afficher l'indicateur "session
  // partagée à N membres" sous le sélecteur (nudge UX critique pour
  // la sécurité des données : modifier label/lieu ici affecte tout
  // le monde, l'admin doit en être conscient).
  sessionParticipantsCount = null,
  // Phase A — supprimer la session active directement depuis la modale
  // (× sur la chip active). Reçoit le participationId (= activeSessionId).
  // Si non fournie, le bouton × n'apparaît pas (ex: contexte read-only).
  // L'auto-switch sur une session restante se fait côté modale après
  // succès du delete.
  onRemoveSession = null,
  onSave,
  periodes = null,
  anchorDate = null,
}) {
  // Sessions triées chronologiquement (1ʳᵉ par date) — la session
  // par défaut sera donc la plus tôt dans le temps, plus naturel
  // qu'une "session 1" historique au sort_order arbitraire.
  const sortedSessions = useMemo(() => sortSessionsByDate(sessions || []), [sessions])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const activeSession = useMemo(
    () => sortedSessions.find((s) => s.id === activeSessionId) || null,
    [sortedSessions, activeSessionId],
  )

  // ─── Création d'une nouvelle session (mini-form inline) ───────────
  // Quand l'admin clique "+ Nouvelle", on transforme le bouton en un
  // petit form (label + lieu + valider) au lieu de créer une session
  // anonyme "Session N". Plus rapide que d'ouvrir le drawer pour
  // renommer après création.
  //
  // Phase A/3c — détection de doublon : si l'admin tape un (label, lieu)
  // qui matche une session globale existante du projet, on propose de
  // REJOINDRE plutôt que de créer un doublon. `pendingMatchTemplate`
  // contient le template matchant si on est en mode confirmation.
  const [creatingSession, setCreatingSession] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newLieu, setNewLieu] = useState('')
  const [pendingMatchTemplate, setPendingMatchTemplate] = useState(null)

  // Source de vérité affichée : la session active si fournie, sinon le
  // persona agrégé (comportement legacy).
  const effectiveData = activeSession || persona
  const initialPresence = effectiveData?.presence_days || []
  const initialArrivalDate = effectiveData?.arrival_date || ''
  const initialDepartureDate = effectiveData?.departure_date || ''

  const [selected, setSelected] = useState(new Set(initialPresence))
  const [arrivalDate, setArrivalDate] = useState(initialArrivalDate)
  const [departureDate, setDepartureDate] = useState(initialDepartureDate)
  // pickerMode : 'presence' (default) | 'arrival' | 'departure'
  // En mode 'arrival'/'departure', click sur un jour assigne la date
  // correspondante au lieu de toggler la présence.
  const [pickerMode, setPickerMode] = useState('presence')
  // Cellule survolée — utilisée pour le hover violet en mode picker
  // (plutôt qu'un ring violet permanent sur toutes les cellules).
  const [hoveredIso, setHoveredIso] = useState(null)

  const [viewMonth, setViewMonth] = useState(() => {
    if (anchorDate instanceof Date) return startOfMonth(anchorDate)
    if (periodes?.tournage && hasAnyRange(periodes.tournage)) {
      const days = expandDays(periodes.tournage)
      if (days.length) {
        const [y, m] = days[0].split('-').map(Number)
        return new Date(y, m - 1, 1)
      }
    }
    return startOfMonth(new Date())
  })

  // ─── Autosave (Phase A/4) ─────────────────────────────────────────
  // Plus de bouton "Enregistrer" : chaque changement local (toggle d'un
  // jour, set d'une arrivée/retour) déclenche un save debounced. Le
  // bouton "Fermer" se contente de fermer la modale et flush les
  // changements pending au passage.
  //
  // Mécanique :
  //   - savedSnapshotRef : snapshot du dernier état "synchronisé" avec
  //     le serveur (init ou save réussi). Sert de référence de comparaison.
  //   - saveTimerRef + pendingPayloadRef : timer de debounce + payload
  //     à envoyer si la modale se ferme avant qu'il ne fire (flushPending).
  //   - initializingRef : flag synchrone pour skipper l'autosave
  //     immédiatement après un reset depuis le src (sinon on saverait
  //     l'ancien selected sur la nouvelle sessionId — bug critique vu
  //     pendant l'écriture).
  const savedSnapshotRef = useRef(null)
  const saveTimerRef = useRef(null)
  const pendingPayloadRef = useRef(null)
  const initializingRef = useRef(false)

  // Effet 1 — sélection initiale de la session active à l'ouverture
  // (séparé du reset de state pour ne pas re-binder le state local sur
  // chaque changement de ref de sortedSessions, ce qui écraserait les
  // saisies en cours quand un realtime / save optimistic arrive).
  useEffect(() => {
    if (!open) return
    if (sortedSessions.length && !activeSessionId) {
      setActiveSessionId(sortedSessions[0].id)
    }
  }, [open, sortedSessions, activeSessionId])

  // Effet 2 — reset du state local quand la session active change (ou
  // quand la modale s'ouvre sans session). Ne dépend QUE de open et
  // activeSessionId : on ne veut pas écraser l'input courant à chaque
  // changement de ref props (realtime, optimistic update).
  useEffect(() => {
    if (!open) return
    // Si activeSessionId pas encore initialisé mais qu'il devrait l'être
    // (sortedSessions non vide), on attend l'effet 1.
    if (sortedSessions.length && !activeSessionId) return
    // Flush pending changes pour la session précédente avant de réinitialiser
    flushPending()
    initializingRef.current = true
    const src = activeSession || persona
    const snap = buildSnapshot(src)
    savedSnapshotRef.current = snap
    setSelected(new Set(snap.presence_days))
    setArrivalDate(snap.arrival_date)
    setDepartureDate(snap.departure_date)
    setPickerMode('presence')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSessionId])

  // Helpers snapshots
  function buildSnapshot(src) {
    return {
      presence_days: (src?.presence_days || []).slice().sort(),
      arrival_date: src?.arrival_date || '',
      departure_date: src?.departure_date || '',
    }
  }
  function snapshotsMatch(a, b) {
    if (!a || !b) return false
    if (a.arrival_date !== b.arrival_date) return false
    if (a.departure_date !== b.departure_date) return false
    if (a.presence_days.length !== b.presence_days.length) return false
    for (let i = 0; i < a.presence_days.length; i++) {
      if (a.presence_days[i] !== b.presence_days[i]) return false
    }
    return true
  }

  // Save un payload immédiatement (sans debounce). Utilisé par :
  //   - le timer de debounce (autosave)
  //   - flushPending (à la fermeture / au changement de session)
  //
  // En cas d'erreur (RLS denied, réseau, migration manquante…) on
  // RESTAURE pendingPayloadRef pour permettre une nouvelle tentative au
  // prochain toggle (sinon l'utilisateur croit que c'est sauvegardé alors
  // que la diff est perdue côté front). Audit 2026-05-06.
  async function performSave(fields, sessionId) {
    try {
      await onSave?.(fields, sessionId)
      // Met à jour le snapshot pour refléter ce qui a été sauvegardé
      // (uniquement si on est toujours sur la même session — sinon le
      // reset effect aura écrasé savedSnapshotRef avec la nouvelle src).
      if (sessionId === activeSessionId) {
        savedSnapshotRef.current = {
          presence_days: fields.presence_days,
          arrival_date: fields.arrival_date || '',
          departure_date: fields.departure_date || '',
        }
      }
    } catch (err) {
      console.error('[PresenceCalendarModal] autosave error:', err)
      // Restaure pending pour qu'un retry soit possible (ex. l'utilisateur
      // bouge un autre jour → la nouvelle diff écrase le pending mais au
      // moins le savedSnapshot reste l'ancien et la prochaine save sera
      // déclenchée). On NE met PAS à jour savedSnapshotRef pour que la
      // diff reste détectable au prochain toggle.
      if (sessionId === activeSessionId) {
        pendingPayloadRef.current = { fields, sessionId }
      }
      const msg = err?.message || String(err)
      const colMissing = /column\s+[\w."]+\s+does not exist/i.exec(msg)
      if (colMissing) {
        notify.error(
          `Enregistrement impossible : ${colMissing[0]}. La migration SQL n'a probablement pas été passée — vérifiez les fichiers supabase/migrations/ avec votre admin.`,
        )
      } else {
        notify.error('Enregistrement échoué : ' + msg)
      }
    }
  }

  // Annule le timer pending et exécute immédiatement le save (si pending).
  // Utilisé à la fermeture et au changement de session.
  function flushPending() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingPayloadRef.current
    pendingPayloadRef.current = null
    if (!pending) return
    // Fire-and-forget : on ne bloque pas la fermeture de la modale sur
    // le retour du serveur. performSave gère ses propres erreurs.
    performSave(pending.fields, pending.sessionId)
  }

  // Effet d'autosave — réagit aux changements de selected/arrivalDate/
  // departureDate. Compare au snapshot ; si diff, schedule un save dans 500ms.
  useEffect(() => {
    if (!open) return undefined
    // Skip immédiatement après un reset (le state local n'a pas encore
    // appliqué les nouvelles valeurs setSelected/setArrivalDate, donc une
    // comparaison maintenant donnerait un faux diff).
    if (initializingRef.current) {
      initializingRef.current = false
      return undefined
    }
    if (!savedSnapshotRef.current) return undefined

    const localSnap = {
      presence_days: [...selected].sort(),
      arrival_date: arrivalDate,
      departure_date: departureDate,
    }

    if (snapshotsMatch(localSnap, savedSnapshotRef.current)) {
      // Pas de diff : annule un éventuel save en attente (cas où l'utilisateur
      // a fait/défait la même action dans la fenêtre de debounce).
      pendingPayloadRef.current = null
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      return undefined
    }

    const fields = {
      presence_days: localSnap.presence_days,
      arrival_date: localSnap.arrival_date || null,
      departure_date: localSnap.departure_date || null,
    }
    pendingPayloadRef.current = { fields, sessionId: activeSessionId }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const pending = pendingPayloadRef.current
      pendingPayloadRef.current = null
      if (pending) performSave(pending.fields, pending.sessionId)
    }, 500)

    // Pas de cleanup : on gère le timer manuellement (sinon une re-render
    // intermédiaire annulerait le save avant qu'il ne fire).
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, arrivalDate, departureDate, activeSessionId])

  // Reset l'activeSessionId + le mini-form de création à la fermeture
  // (sinon en réouvrant on afficherait l'ancienne session active même si
  // la liste a changé, et le form de création resterait ouvert).
  useEffect(() => {
    if (!open) {
      // EQUIPE-AUDIT-FIX-C : flush AVANT de reset les refs. Sans ça, si la
      // modale est fermée par un changement de prop parent (et non via le
      // X ou le backdrop qui passent par handleClose), la dernière modif
      // pending est silencieusement perdue.
      flushPending()
      setActiveSessionId(null)
      setCreatingSession(false)
      setNewLabel('')
      setNewLieu('')
      setPendingMatchTemplate(null)
      // Reset des refs autosave pour éviter qu'un payload pending d'une
      // session précédente ne soit envoyé sur la prochaine ouverture.
      savedSnapshotRef.current = null
      pendingPayloadRef.current = null
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
    // flushPending est défini in-scope, pas besoin dans les deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // EQUIPE-AUDIT-FIX-C : flush sur unmount complet (changement de page,
  // démontage parent). flushPending lit les refs courantes — OK avec [].
  useEffect(() => {
    return () => {
      flushPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fermeture propre : on flush les changements pending avant d'appeler
  // onClose. handleClose remplace le bouton "Enregistrer" + "Annuler" du
  // précédent design (autosave = pas de différence sémantique).
  function handleClose() {
    flushPending()
    onClose?.()
  }

  // ESC en mode picker → annule le picker (sans fermer la modale).
  // EQUIPE-AUDIT-FIX-K : ESC en mode presence → ferme la modale (cohérent
  // avec MembreDrawer). handleClose flush l'autosave avant de fermer.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (pickerMode !== 'presence') {
        setPickerMode('presence')
      } else {
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
    // handleClose est défini in-scope, capturé par closure ; même chose
    // pour pickerMode et open via useEffect deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerMode, open])

  // Map jour → liste de périodes qui le couvrent
  const dayToPeriodes = useMemo(() => {
    const m = new Map()
    if (!periodes) return m
    for (const key of PERIODE_KEYS) {
      const p = periodes[key]
      if (!hasAnyRange(p)) continue
      for (const day of expandDays(p)) {
        if (!m.has(day)) m.set(day, [])
        m.get(day).push(key)
      }
    }
    return m
  }, [periodes])

  if (!open) return null

  const grid = getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth())

  function toggleDay(d) {
    const iso = fmtDateKey(d)
    // En mode picker arrival/departure : assigne la date et sort du mode
    if (pickerMode === 'arrival') {
      setArrivalDate(iso)
      setPickerMode('presence')
      return
    }
    if (pickerMode === 'departure') {
      setDepartureDate(iso)
      setPickerMode('presence')
      return
    }
    // Mode presence : toggle la sélection comme avant
    const next = new Set(selected)
    if (next.has(iso)) next.delete(iso)
    else next.add(iso)
    setSelected(next)
  }

  function selectPeriode(key) {
    if (!periodes?.[key]) return
    const days = expandDays(periodes[key])
    const next = new Set(selected)
    for (const d of days) next.add(d)
    setSelected(next)
  }

  function clearAll() {
    setSelected(new Set())
  }

  // Pour les boutons "aligner sur 1er/dernier jour de présence"
  const sortedDays = selected.size ? [...selected].sort() : []
  const firstPresenceDay = sortedDays[0] || null
  const lastPresenceDay = sortedDays[sortedDays.length - 1] || null

  return (
    // z-[60] : doit passer au-dessus du MembreDrawer (z-50) quand on
    // l'ouvre depuis le drawer (sinon le panel droit recouvre la modale).
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="relative w-full max-w-md max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header — compact 1 ligne. Titre et nom du membre côte à côte
            (séparateur " · ") au lieu de stack vertical, réduit la
            hauteur de la modale de ~30 px. */}
        <header
          className="flex items-center gap-2.5 px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <Calendar
            className="w-4 h-4 shrink-0"
            style={{ color: 'var(--blue)' }}
          />
          <h2
            className="text-sm font-semibold truncate flex-1 min-w-0"
            style={{ color: 'var(--txt)' }}
          >
            <span>Présence</span>
            <span style={{ color: 'var(--txt-3)' }}>{' · '}</span>
            <span style={{ color: 'var(--txt-2)', fontWeight: 400 }}>
              {personaName}
            </span>
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Fermer (sauvegarde automatique)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Sélecteur de session (Phase 0b) — visible si :
            - 2+ sessions (sélection multi)
            - OU il y a des templates / un onCreateSession (zones d'ajout)
            Permet à l'admin de choisir quelle session il édite, ou d'en
            créer une nouvelle (vide ou clonée depuis une session existante
            d'un autre membre du projet). */}
        {(sortedSessions.length >= 2 ||
          (onCreateSession && (sortedSessions.length >= 1 || projectSessionTemplates.length > 0))) && (
          <div
            className="flex items-center gap-2 px-5 py-3 border-b shrink-0 overflow-x-auto"
            style={{ borderColor: 'var(--brd-sub)' }}
          >
            <span
              className="text-[10px] uppercase tracking-widest font-bold shrink-0"
              style={{ color: 'var(--txt-3)' }}
            >
              Session
            </span>
            {sortedSessions
              // Cas mono-session anonyme (pas de label) : on cache la
              // chip — pas de "Sans nom" affiché à un admin qui n'a
              // qu'un séjour standard. Multi-session : on garde tout.
              .filter((s) => {
                if (sortedSessions.length !== 1) return true
                const rawLabel = (s.label || '').trim()
                return Boolean(rawLabel)
              })
              .map((s) => {
              const isActive = s.id === activeSessionId
              const couleur = effectiveCouleur(s)
              // Indicateur "session partagée" — uniquement sur la chip
              // ACTIVE, pour ne pas allonger les chips inactives et
              // déclencher du scroll horizontal sur des projets multi-
              // sessions. L'admin voit l'info dès qu'il sélectionne, et
              // le tooltip (sur l'icône Users) explique le warning.
              const sharedCount = s.session_id
                ? sessionParticipantsCount?.get?.(s.session_id) || 0
                : 0
              const isShared = sharedCount >= 2
              const baseTitle = s.lieu_principal_text
                ? `${effectiveLabel(s)} · ${s.lieu_principal_text}`
                : effectiveLabel(s)
              const title = isShared
                ? `${baseTitle}\n— Partagée avec ${sharedCount - 1} autre${sharedCount - 1 > 1 ? 's' : ''} membre${sharedCount - 1 > 1 ? 's' : ''}. Modifier le nom ou le lieu affecte tout le monde.`
                : baseTitle
              // Le bouton × n'apparaît que sur la chip ACTIVE — sinon il
              // faudrait nester un button-dans-button pour déclencher
              // delete sans déclencher activate. Sur l'active, le clic
              // sur la chip = no-op, donc on peut sereinement mettre
              // le delete à côté avec stopPropagation pour la sécurité.
              const showDelete = isActive && Boolean(onRemoveSession)
              return (
                <span
                  key={s.id}
                  className="inline-flex items-center shrink-0 rounded-md transition-colors"
                  style={{
                    background: isActive ? `#${couleur}22` : 'transparent',
                    border: `1px solid ${isActive ? `#${couleur}` : 'var(--brd-sub)'}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveSessionId(s.id)}
                    className="text-xs pl-2.5 pr-2 py-1 inline-flex items-center gap-1.5"
                    style={{
                      background: 'transparent',
                      color: isActive ? `#${couleur}` : 'var(--txt-2)',
                      fontWeight: isActive ? 600 : 400,
                      border: 'none',
                    }}
                    title={title}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: `#${couleur}` }}
                    />
                    {effectiveLabel(s)}
                    {isActive && isShared && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] shrink-0"
                        style={{ opacity: 0.85, marginLeft: 2 }}
                      >
                        <Users style={{ width: 10, height: 10 }} />
                        {sharedCount}
                      </span>
                    )}
                  </button>
                  {showDelete && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const ok = await confirm({
                          title: `Retirer « ${effectiveLabel(s)} » de ce membre ?`,
                          message: isShared
                            ? `La session restera pour les ${sharedCount - 1} autre${sharedCount - 1 > 1 ? 's' : ''} membre${sharedCount - 1 > 1 ? 's' : ''} qui y participent. Seules les dates et infos perso de ce membre seront supprimées.`
                            : 'La session sera supprimée et les dates / lieu perdus. Action irréversible.',
                          confirmLabel: 'Retirer',
                          destructive: true,
                        })
                        if (!ok) return
                        // Annule un éventuel save autosave en attente — on
                        // ne veut pas écrire pendant qu'on supprime.
                        if (saveTimerRef.current) {
                          clearTimeout(saveTimerRef.current)
                          saveTimerRef.current = null
                        }
                        pendingPayloadRef.current = null
                        try {
                          await onRemoveSession(s.id)
                          // Auto-switch : si d'autres sessions restent, on
                          // active la 1ʳᵉ ; sinon on ferme la modale.
                          const remaining = sortedSessions.filter((x) => x.id !== s.id)
                          if (remaining.length) {
                            setActiveSessionId(remaining[0].id)
                          } else {
                            onClose?.()
                          }
                          notify.success('Session retirée du membre')
                        } catch (err) {
                          console.error('[PresenceCalendarModal] remove error:', err)
                          notify.error('Suppression échouée : ' + (err?.message || err))
                        }
                      }}
                      className="px-1.5 py-1 transition-colors"
                      style={{
                        background: 'transparent',
                        color: `#${couleur}`,
                        opacity: 0.6,
                        border: 'none',
                        borderLeft: `1px solid ${isActive ? `#${couleur}66` : 'var(--brd-sub)'}`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.color = 'var(--red)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.6'
                        e.currentTarget.style.color = `#${couleur}`
                      }}
                      title="Retirer cette session du membre"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              )
            })}

            {/* Boutons d'ajout rapide — visibles seulement quand
                onCreateSession est branché (= contexte d'édition admin). */}
            {onCreateSession && (
              <>
                {/* Templates des autres membres du projet (faible opacité).
                    Click = duplique la session chez le membre courant
                    (label + lieu + dates), équivalent UX d'un futur
                    "join shared session" (option a). */}
                {projectSessionTemplates
                  // Phase A/3 — affichage : on cache les chips de
                  // sessions où le membre courant est DÉJÀ participant
                  // (= pas de sens de proposer Rejoindre).
                  .filter((t) => !t.member_already_in)
                  .map((t, i) => {
                  const display = t.lieu ? `${t.label} (${t.lieu})` : t.label
                  const canJoin = Boolean(t.session_id && onJoinSession)
                  return (
                    <button
                      key={`tpl-${i}-${t.label}-${t.lieu}`}
                      type="button"
                      onClick={async () => {
                        try {
                          let created
                          if (canJoin) {
                            // Phase A/3 : VRAI join — on rejoint la session
                            // globale existante. Pas de payload override :
                            // on hérite des dates / presence_days de la
                            // session côté serveur (joinSession le fait).
                            created = await onJoinSession(t.session_id)
                          } else {
                            // Fallback (cas dégradé : template sans
                            // session_id, ou pas de onJoinSession). Crée
                            // un doublon comme avant.
                            created = await onCreateSession({
                              label: t.label,
                              lieu_principal_text: t.lieu || null,
                              arrival_date: t.arrival_date || null,
                              departure_date: t.departure_date || null,
                              presence_days: Array.isArray(t.presence_days)
                                ? [...t.presence_days]
                                : [],
                            })
                          }
                          if (created?.id) setActiveSessionId(created.id)
                        } catch (err) {
                          console.error('[PresenceCalendarModal] template add error:', err)
                          notify.error('Ajout impossible : ' + (err?.message || err))
                        }
                      }}
                      className="text-xs px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 shrink-0 transition-opacity"
                      style={{
                        background: 'transparent',
                        color: 'var(--txt-3)',
                        border: '1px dashed var(--brd-sub)',
                        opacity: 0.7,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                      title={
                        canJoin
                          ? `Rejoindre la session "${display}" (partagée avec d'autres membres)`
                          : `Ajouter une session "${display}" (recopie dates et lieu)`
                      }
                    >
                      <Plus className="w-3 h-3" />
                      {display}
                    </button>
                  )
                })}

                {/* Bouton "Nouvelle session" / mini-form / confirmation de
                    doublon. 3 états :
                    - bouton "+ Nouvelle" (creatingSession = false)
                    - form inline label+lieu (creatingSession + pas de match)
                    - bloc de confirmation Rejoindre/Créer doublon (match
                      détecté sur le label+lieu tapé) */}
                {creatingSession && pendingMatchTemplate ? (
                  // ── Confirmation doublon (Phase A/3c) ──────────────
                  // 2 cas selon que le membre est déjà dans la session
                  // matchée ou non :
                  //  - already_in = false → propose Rejoindre (vraie
                  //    fusion via onJoinSession) + Créer doublon
                  //  - already_in = true  → seul "Créer doublon" est
                  //    proposé (UNIQUE constraint empêche de joindre 2x)
                  <div
                    className="inline-flex items-center gap-2 shrink-0 rounded-md px-2 py-1"
                    style={{
                      background: 'var(--amber-bg)',
                      border: '1px solid var(--amber-brd)',
                      color: 'var(--amber)',
                    }}
                  >
                    <span className="text-[11px] font-medium">
                      « {pendingMatchTemplate.label}
                      {pendingMatchTemplate.lieu ? ` (${pendingMatchTemplate.lieu})` : ''} »
                      {' '}
                      {pendingMatchTemplate.member_already_in
                        ? 'est déjà attribuée à ce membre.'
                        : `existe déjà${
                            pendingMatchTemplate.member_count > 0
                              ? ` chez ${pendingMatchTemplate.member_count} membre${pendingMatchTemplate.member_count > 1 ? 's' : ''}`
                              : ''
                          }.`}
                    </span>
                    {!pendingMatchTemplate.member_already_in && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            let created
                            if (pendingMatchTemplate.session_id && onJoinSession) {
                              created = await onJoinSession(pendingMatchTemplate.session_id)
                            } else {
                              created = await onCreateSession({
                                label: pendingMatchTemplate.label,
                                lieu_principal_text: pendingMatchTemplate.lieu || null,
                                arrival_date: null,
                                departure_date: null,
                                presence_days: [],
                              })
                            }
                            setCreatingSession(false)
                            setNewLabel('')
                            setNewLieu('')
                            setPendingMatchTemplate(null)
                            if (created?.id) setActiveSessionId(created.id)
                          } catch (err) {
                            console.error('[PresenceCalendarModal] join error:', err)
                            notify.error('Ajout impossible : ' + (err?.message || err))
                          }
                        }}
                        className="text-[11px] px-2 py-0.5 rounded transition-colors"
                        style={{
                          background: 'var(--blue)',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                        title="Ajouter ce membre comme participant à la session existante"
                      >
                        Rejoindre
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        // Skippe la détection : on crée un doublon en
                        // copiant les dates et le lieu du template
                        // (= comportement original des "+ Template").
                        // Sera fusionnable manuellement plus tard.
                        try {
                          const created = await onCreateSession({
                            label: pendingMatchTemplate.label,
                            lieu_principal_text: pendingMatchTemplate.lieu || null,
                            arrival_date: pendingMatchTemplate.arrival_date || null,
                            departure_date: pendingMatchTemplate.departure_date || null,
                            presence_days: Array.isArray(pendingMatchTemplate.presence_days)
                              ? [...pendingMatchTemplate.presence_days]
                              : [],
                          })
                          setCreatingSession(false)
                          setNewLabel('')
                          setNewLieu('')
                          setPendingMatchTemplate(null)
                          if (created?.id) setActiveSessionId(created.id)
                        } catch (err) {
                          console.error('[PresenceCalendarModal] force-create error:', err)
                          notify.error('Création impossible : ' + (err?.message || err))
                        }
                      }}
                      className="text-[11px] px-2 py-0.5 rounded transition-colors"
                      style={{
                        background: 'transparent',
                        color: 'var(--amber)',
                        border: '1px solid var(--amber)',
                      }}
                      title="Créer une session doublon (à éviter, mais possible)"
                    >
                      Créer doublon
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Annule la confirmation pour revenir au form
                        setPendingMatchTemplate(null)
                      }}
                      className="text-[11px] px-1 py-0.5"
                      style={{ color: 'var(--txt-3)' }}
                      title="Modifier le nom"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : creatingSession ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const labelTrim = newLabel.trim()
                      const lieuTrim = newLieu.trim()
                      // Garde-fou anti-fantôme (audit 2026-05-07) : on
                      // refuse de créer une session avec label ET lieu
                      // vides — c'est exactement le cas qui produit les
                      // sessions "Sans nom" qui polluent l'UI ensuite.
                      // Le bouton submit est désactivé visuellement aussi.
                      if (!labelTrim && !lieuTrim) return
                      // Phase A/3c — détection de doublon avant création.
                      // Si on trouve une session existante avec le même
                      // (label, lieu), on bascule en mode confirmation.
                      const match = findMatchingSession(
                        // On cherche dans tous les templates du projet
                        // (qui contiennent déjà le member_count + session_id).
                        projectSessionTemplates,
                        labelTrim,
                        lieuTrim,
                      )
                      if (match) {
                        setPendingMatchTemplate(match)
                        return
                      }
                      // Pas de match → création directe comme avant.
                      ;(async () => {
                        try {
                          const created = await onCreateSession({
                            label: labelTrim || null,
                            lieu_principal_text: lieuTrim || null,
                            arrival_date: null,
                            departure_date: null,
                            presence_days: [],
                          })
                          setCreatingSession(false)
                          setNewLabel('')
                          setNewLieu('')
                          if (created?.id) setActiveSessionId(created.id)
                        } catch (err) {
                          console.error('[PresenceCalendarModal] create error:', err)
                          notify.error('Création impossible : ' + (err?.message || err))
                        }
                      })()
                    }}
                    className="inline-flex items-center gap-1 shrink-0 rounded-md p-0.5"
                    style={{
                      background: 'var(--blue-bg)',
                      border: '1px solid var(--blue-brd)',
                    }}
                  >
                    <input
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setCreatingSession(false)
                          setNewLabel('')
                          setNewLieu('')
                        }
                      }}
                      autoFocus
                      placeholder="Nom (Essais…)"
                      className="text-xs px-1.5 py-0.5 rounded outline-none"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--txt)',
                        width: 110,
                      }}
                    />
                    <span style={{ color: 'var(--txt-3)' }}>·</span>
                    <input
                      type="text"
                      value={newLieu}
                      onChange={(e) => setNewLieu(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setCreatingSession(false)
                          setNewLabel('')
                          setNewLieu('')
                        }
                      }}
                      placeholder="Lieu"
                      className="text-xs px-1.5 py-0.5 rounded outline-none"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--txt)',
                        width: 90,
                      }}
                    />
                    {(() => {
                      // Garde-fou anti-fantôme : on ne peut soumettre que
                      // si au moins le label OU le lieu est saisi. Évite
                      // les sessions "Sans nom" 100% vides qui polluent
                      // la liste après création.
                      const canSubmit = Boolean(newLabel.trim() || newLieu.trim())
                      return (
                        <button
                          type="submit"
                          disabled={!canSubmit}
                          className="text-xs px-1.5 py-0.5 rounded inline-flex items-center transition-opacity"
                          style={{
                            background: 'var(--blue)',
                            color: '#fff',
                            opacity: canSubmit ? 1 : 0.4,
                            cursor: canSubmit ? 'pointer' : 'not-allowed',
                          }}
                          title={
                            canSubmit
                              ? 'Créer la session (Entrée)'
                              : 'Saisis au moins un nom ou un lieu pour créer la session'
                          }
                        >
                          <CheckCircle className="w-3 h-3" />
                        </button>
                      )
                    })()}
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingSession(false)
                        setNewLabel('')
                        setNewLieu('')
                      }}
                      className="text-xs px-1 py-0.5 rounded transition-colors"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                      title="Annuler (Esc)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreatingSession(true)}
                    className="text-xs px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 shrink-0 transition-colors"
                    style={{
                      background: 'transparent',
                      color: 'var(--blue)',
                      border: '1px dashed var(--blue-brd)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    title="Créer une nouvelle session pour ce membre"
                  >
                    <Plus className="w-3 h-3" />
                    Nouvelle
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Bandeau partage — supprimé en commit 3 : l'info migre sur la
            chip active (badge `Users + count` + tooltip détaillé). Plus
            discret, plus contextualisé. Voir le rendu dans la chip ci-
            dessus. */}

        {/* Barre d'édition méta de la session active (Nom + Lieu).
            Rendu type "titre éditable" : pas de visuel formulaire, juste
            le nom de la session avec une icône crayon pour l'affordance.
            Click sur le texte → mode input. Esc/Enter/blur → commit.
            Les raccourcis Prépa/Tournage ont été déplacés au-dessus du
            calendrier (ils agissent sur le calendrier, pas sur la
            session — c'était la confusion principale du commit 2). */}
        {activeSession && onUpdateSessionMeta && (
          <div
            className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
            style={{ borderColor: 'var(--brd-sub)' }}
          >
            <SessionMetaEditor
              session={activeSession}
              onUpdate={(fields) => onUpdateSessionMeta(activeSession.id, fields)}
            />
          </div>
        )}

        {/* Calendrier + logistique (scroll si débordement) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Banner de mode picker (arrival / departure) */}
          {pickerMode !== 'presence' && (
            <div
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs"
              style={{
                background: 'var(--purple-bg)',
                color: 'var(--purple)',
                border: '1px solid var(--purple-brd)',
              }}
            >
              <div className="flex items-center gap-1.5">
                {pickerMode === 'arrival' ? (
                  <PlaneLanding className="w-3.5 h-3.5" />
                ) : (
                  <PlaneTakeoff className="w-3.5 h-3.5" />
                )}
                <span>
                  Cliquez sur un jour du calendrier pour définir{' '}
                  <strong>
                    {pickerMode === 'arrival' ? "l'arrivée" : 'le retour'}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPickerMode('presence')}
                className="text-[10px] underline"
                style={{ color: 'var(--purple)' }}
                title="Esc"
              >
                Annuler
              </button>
            </div>
          )}

          {/* Calendrier */}
          <div>
            {/* Nav mois — sur 1 ligne avec les raccourcis "Cocher période"
                à droite. Plus de confusion possible avec l'édition de la
                session : ici on agit clairement sur le calendrier (cf.
                retour Hugo commit 3, "boutons Prépa/Tournage qui se
                confondent avec rename"). */}
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                className="p-1 rounded transition-colors shrink-0"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold shrink-0" style={{ color: 'var(--txt)' }}>
                {MONTHS_FR[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </div>
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                className="p-1 rounded transition-colors shrink-0"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {periodes && (
                <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                  <span
                    className="text-[10px] uppercase tracking-wider shrink-0"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Cocher
                  </span>
                  {PERIODE_KEYS.filter((k) => hasAnyRange(periodes[k])).map((k) => {
                    const meta = PERIODE_META[k]
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => selectPeriode(k)}
                        className="text-[11px] px-1.5 py-0.5 rounded-md transition-opacity inline-flex items-center gap-1 shrink-0"
                        style={{
                          background: meta.bg,
                          color: meta.color,
                          border: `1px solid ${meta.color}`,
                        }}
                        title={`Cocher tous les jours ${meta.label.toLowerCase()}`}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                      >
                        {meta.label}
                      </button>
                    )
                  })}
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="text-[11px] px-1 py-0.5 rounded-md transition-colors shrink-0"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                      title="Effacer tous les jours sélectionnés"
                    >
                      Effacer
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Headers jours */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS_SHORT_FR.map((d) => (
                <div
                  key={d}
                  className="text-[10px] text-center font-semibold uppercase py-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Grille mois */}
            <div className="grid grid-cols-7 gap-1">
              {grid.map((d, i) => {
                const iso = fmtDateKey(d)
                const inMonth = isSameMonth(d, viewMonth)
                const isSelected = selected.has(iso)
                const periodKeys = dayToPeriodes.get(iso) || []
                const primaryPeriod = periodKeys[0]
                const periodMeta = primaryPeriod ? PERIODE_META[primaryPeriod] : null
                const isArrival = arrivalDate && iso === arrivalDate
                const isDeparture = departureDate && iso === departureDate

                // Style de base
                let bgColor = 'var(--bg-elev)'
                let textColor = 'var(--txt)'
                let borderColor = 'var(--brd-sub)'
                let borderStyle = 'solid'
                let boxShadow = 'none'

                if (!inMonth) {
                  textColor = 'var(--txt-3)'
                } else if (isSelected) {
                  // Jour réellement sélectionné par l'utilisateur :
                  // fond plein bleu, et si la cellule est aussi en période,
                  // un ring inset de la couleur de la période pour rappeler
                  // le contexte (sans surcharger).
                  bgColor = 'var(--blue)'
                  textColor = '#fff'
                  borderColor = 'var(--blue)'
                  borderStyle = 'solid'
                  if (periodMeta) {
                    boxShadow = `inset 0 0 0 2px ${periodMeta.color}`
                  }
                } else if (periodMeta) {
                  // Jour en période MAIS pas (encore) sélectionné :
                  // on signale "jour disponible / suggéré" via une bordure
                  // POINTILLÉE colorée + fond neutre (pas de remplissage).
                  // Distinct visuellement d'un jour sélectionné (fond plein).
                  // Cf. retour Hugo P4.5 : éviter de donner l'impression
                  // que les jours de tournage sont déjà cochés.
                  bgColor = 'var(--bg-elev)'
                  textColor = periodMeta.color
                  borderColor = periodMeta.color
                  borderStyle = 'dashed'
                }

                // Tooltip enrichi
                const tooltipParts = [`${d.getDate()}`]
                if (periodMeta) tooltipParts.push(periodMeta.label)
                if (isArrival) tooltipParts.push('Arrivée')
                if (isDeparture) tooltipParts.push('Retour')
                if (pickerMode === 'arrival') tooltipParts.push('→ définir comme arrivée')
                if (pickerMode === 'departure') tooltipParts.push('→ définir comme retour')

                // Mode picker → cursor crosshair + ring violet UNIQUEMENT
                // sur la cellule survolée (le banner + le cursor suffisent
                // à indiquer le mode, pas besoin de saturer le calendrier).
                const cellCursor = pickerMode === 'presence' ? 'pointer' : 'crosshair'
                const isHoveredInPicker =
                  pickerMode !== 'presence' && inMonth && hoveredIso === iso
                const pickerRing = isHoveredInPicker ? '0 0 0 2px var(--purple)' : ''
                const finalBoxShadow =
                  [boxShadow, pickerRing].filter((s) => s && s !== 'none').join(', ') ||
                  'none'

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(d)}
                    onMouseEnter={() => {
                      if (pickerMode !== 'presence' && inMonth) setHoveredIso(iso)
                    }}
                    onMouseLeave={() => {
                      if (hoveredIso === iso) setHoveredIso(null)
                    }}
                    className="aspect-square rounded-md text-sm flex items-center justify-center transition-all relative"
                    style={{
                      background: bgColor,
                      color: textColor,
                      border: `1px ${borderStyle} ${borderColor}`,
                      boxShadow: finalBoxShadow,
                      fontWeight: isSelected ? 600 : 400,
                      opacity: inMonth ? 1 : 0.5,
                      cursor: cellCursor,
                    }}
                    title={tooltipParts.join(' — ')}
                  >
                    {/* Indicateur arrivée (coin haut-gauche) */}
                    {isArrival && (
                      <span
                        className="absolute top-0 left-0 rounded-tl-md rounded-br-md flex items-center justify-center"
                        style={{
                          width: 12,
                          height: 12,
                          background: 'var(--purple)',
                          color: '#fff',
                        }}
                        aria-label="Arrivée"
                      >
                        <PlaneLanding style={{ width: 8, height: 8 }} />
                      </span>
                    )}
                    {/* Indicateur retour (coin haut-droit) */}
                    {isDeparture && (
                      <span
                        className="absolute top-0 right-0 rounded-tr-md rounded-bl-md flex items-center justify-center"
                        style={{
                          width: 12,
                          height: 12,
                          background: 'var(--purple)',
                          color: '#fff',
                        }}
                        aria-label="Retour"
                      >
                        <PlaneTakeoff style={{ width: 8, height: 8 }} />
                      </span>
                    )}
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer fusionné : chips Arrivée/Retour à gauche + compteur de
            jours + bouton Fermer à droite. Plus de bouton Enregistrer
            (autosave) ni d'Annuler (= incohérent avec autosave). En cas
            de mobile / chips multiples, flex-wrap pour éviter le squish. */}
        <footer
          className="flex items-center justify-between gap-2 px-4 py-2.5 border-t shrink-0 flex-wrap"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <ArrivalDepartureSection
              arrivalDate={arrivalDate}
              departureDate={departureDate}
              firstPresenceDay={firstPresenceDay}
              lastPresenceDay={lastPresenceDay}
              pickerMode={pickerMode}
              onPickArrival={() =>
                setPickerMode((m) => (m === 'arrival' ? 'presence' : 'arrival'))
              }
              onPickDeparture={() =>
                setPickerMode((m) => (m === 'departure' ? 'presence' : 'departure'))
              }
              onClearArrival={() => setArrivalDate('')}
              onClearDeparture={() => setDepartureDate('')}
              onSetArrivalDate={setArrivalDate}
              onSetDepartureDate={setDepartureDate}
            />
          </div>
          <div className="flex items-center gap-2 ml-auto pl-3 shrink-0"
            style={{ borderLeft: '1px solid var(--brd-sub)' }}
          >
            <span className="text-[11px] shrink-0" style={{ color: 'var(--txt-3)' }}>
              {selected.size > 0
                ? `${selected.size} j`
                : '—'}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              title="Fermer (les modifications sont sauvegardées automatiquement)"
            >
              Fermer
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

/**
 * ArrivalDepartureSection — Saisie des dates d'arrivée + retour.
 *
 *   - État initial (rien de défini) : 2 boutons compacts [+ Arrivée] [+ Retour].
 *   - Click sur [+ Arrivée] → entre en mode picker (état parent), banner
 *     s'affiche au-dessus du calendrier, click sur un jour assigne la date.
 *   - Une fois la date définie : la chip se transforme en
 *     [↘ 11/05  ✕] (cliquer pour modifier, croix pour effacer).
 *
 * Pas d'heures, d'hébergement, de chauffeur ni de notes — tout cela part
 * dans la future tab Logistique (cleanup P4).
 *
 * @param pickerMode  'presence' | 'arrival' | 'departure'
 */
function ArrivalDepartureSection({
  arrivalDate,
  departureDate,
  firstPresenceDay,
  lastPresenceDay,
  pickerMode,
  onPickArrival,
  onPickDeparture,
  onClearArrival,
  onClearDeparture,
  onSetArrivalDate,
  onSetDepartureDate,
}) {
  const hasArrival = Boolean(arrivalDate)
  const hasDeparture = Boolean(departureDate)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasArrival ? (
        <ArrivalDepartureChip
          icon={<PlaneLanding className="w-3 h-3" />}
          label="Arrivée"
          date={arrivalDate}
          onPick={onPickArrival}
          onClear={onClearArrival}
          isPicking={pickerMode === 'arrival'}
          alignTarget={firstPresenceDay}
          alignLabel="aligner 1er jour"
          onAlign={() => onSetArrivalDate(firstPresenceDay)}
        />
      ) : (
        <PickButton
          icon={<PlaneLanding className="w-3 h-3" />}
          label="Arrivée"
          isActive={pickerMode === 'arrival'}
          onClick={onPickArrival}
        />
      )}

      {hasDeparture ? (
        <ArrivalDepartureChip
          icon={<PlaneTakeoff className="w-3 h-3" />}
          label="Retour"
          date={departureDate}
          onPick={onPickDeparture}
          onClear={onClearDeparture}
          isPicking={pickerMode === 'departure'}
          alignTarget={lastPresenceDay}
          alignLabel="aligner dernier jour"
          onAlign={() => onSetDepartureDate(lastPresenceDay)}
        />
      ) : (
        <PickButton
          icon={<PlaneTakeoff className="w-3 h-3" />}
          label="Retour"
          isActive={pickerMode === 'departure'}
          onClick={onPickDeparture}
        />
      )}
    </div>
  )
}

/**
 * Bouton compact pour activer le picker (état "rien de défini").
 */
function PickButton({ icon, label, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-all"
      style={{
        background: isActive ? 'var(--purple-bg)' : 'transparent',
        color: isActive ? 'var(--purple)' : 'var(--txt-2)',
        border: `1px dashed ${isActive ? 'var(--purple)' : 'var(--brd)'}`,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--purple)'
          e.currentTarget.style.borderColor = 'var(--purple)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-2)'
          e.currentTarget.style.borderColor = 'var(--brd)'
        }
      }}
      title={`Définir le jour d'${label.toLowerCase()}`}
    >
      <span style={{ color: isActive ? 'var(--purple)' : 'var(--txt-3)' }}>+</span>
      {icon}
      {label}
    </button>
  )
}

/**
 * Chip représentant une date d'arrivée/retour définie. Click sur la date
 * (ou sur la chip elle-même) → réactive le mode picker pour modifier.
 * Croix pour effacer. Lien "aligner 1er/dernier jour" si la date diverge.
 *
 * Cleanup P4 : plus de champ heure inline (les heures partent en
 * Logistique tab).
 */
function ArrivalDepartureChip({
  icon,
  label,
  date,
  onPick,
  onClear,
  isPicking,
  alignTarget,
  alignLabel,
  onAlign,
}) {
  // Format date FR compact : "11/05/26"
  const dateLabel = formatDateCompactFr(date)
  const showAlign = alignTarget && alignTarget !== date

  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2 py-1"
      style={{
        background: isPicking ? 'var(--purple-bg)' : 'var(--bg-elev)',
        border: `1px solid ${isPicking ? 'var(--purple)' : 'var(--brd-sub)'}`,
        color: 'var(--txt)',
      }}
      title={`${label} : ${dateLabel}`}
    >
      <span style={{ color: 'var(--purple)' }}>{icon}</span>
      <span
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--purple)' }}
      >
        {label}
      </span>

      <button
        type="button"
        onClick={onPick}
        className="text-xs font-medium px-1.5 py-0.5 rounded transition-colors"
        style={{
          color: 'var(--txt)',
          background: 'transparent',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        title="Cliquer pour modifier la date"
      >
        {dateLabel}
      </button>

      {showAlign && (
        <button
          type="button"
          onClick={onAlign}
          className="text-[9px] underline transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          title={`Aligner sur ${alignLabel}`}
        >
          {alignLabel}
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        className="p-0.5 rounded transition-colors"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--red)'
          e.currentTarget.style.background = 'var(--red-bg)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--txt-3)'
          e.currentTarget.style.background = 'transparent'
        }}
        title={`Retirer ${label.toLowerCase()}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

/** "2026-05-11" → "11/05/26" */
function formatDateCompactFr(iso) {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`
}

// ─── SessionMetaEditor — Édition inline du nom + lieu de la session ───────
//
// Mini-panneau affiché sous le sélecteur de session quand une session est
// active et qu'on est en mode admin (canEdit). Permet de renommer une
// session "Sans nom" en "Plateau" ou de changer son lieu sans avoir à
// fermer la modale et passer par le drawer.
//
// Modifier label/lieu touche la SESSION GLOBALE (cf. lib split) → propage
// à tous les participants. Le commit est sur onBlur (= classique).

function SessionMetaEditor({ session, onUpdate }) {
  const [labelDraft, setLabelDraft] = useState(session?.label || '')
  const [lieuDraft, setLieuDraft] = useState(session?.lieu_principal_text || '')

  // Sync drafts si la session active change (switch via les chips)
  useEffect(() => {
    setLabelDraft(session?.label || '')
  }, [session?.id, session?.label])
  useEffect(() => {
    setLieuDraft(session?.lieu_principal_text || '')
  }, [session?.id, session?.lieu_principal_text])

  function commitLabel() {
    const trimmed = labelDraft.trim()
    const next = trimmed || null
    if (next === (session?.label || null)) return
    onUpdate({ label: next })
  }

  function commitLieu() {
    const trimmed = lieuDraft.trim()
    const next = trimmed || null
    if (next === (session?.lieu_principal_text || null)) return
    onUpdate({ lieu_principal_text: next })
  }

  // Rendu "titre éditable" — pas de visuel formulaire (qui faisait
  // penser à un panneau de paramètres et créait la confusion avec les
  // raccourcis Prépa/Tournage). À la place :
  //   - Nom : grosse police semi-bold, texte plat, soulignement subtil
  //     au focus pour signaler l'éditable.
  //   - Lieu : petite police avec icône MapPin pour marquer le rôle.
  //   - Icône crayon Edit2 à droite (toujours visible) → affordance
  //     que cette ligne est éditable.
  // Comportement : focus → souligne, blur/Enter → commit, Esc → revert.
  // Click sur le crayon → focus le 1er input vide (ou le label).
  const labelInputRef = useRef(null)
  const lieuInputRef = useRef(null)

  function focusFirstEmpty() {
    if (!labelDraft && labelInputRef.current) {
      labelInputRef.current.focus()
    } else if (lieuInputRef.current) {
      lieuInputRef.current.focus()
    }
  }

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <input
        ref={labelInputRef}
        type="text"
        value={labelDraft}
        onChange={(e) => setLabelDraft(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setLabelDraft(session?.label || '')
            e.currentTarget.blur()
          }
        }}
        placeholder="Nom de la session"
        className="text-sm font-semibold outline-none min-w-0 px-1 py-0.5 rounded transition-colors"
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: '1px dashed transparent',
          color: 'var(--txt)',
          flex: '1 1 55%',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottom = '1px solid var(--blue)'
          e.currentTarget.style.background = 'var(--bg-elev)'
        }}
        onMouseEnter={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.borderBottom = '1px dashed var(--brd)'
          }
        }}
        onMouseLeave={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.borderBottom = '1px dashed transparent'
          }
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderBottom = '1px dashed transparent'
          e.currentTarget.style.background = 'transparent'
        }}
        title="Cliquer pour modifier le nom de la session"
      />
      <span
        className="inline-flex items-center gap-1 shrink-0 min-w-0"
        style={{ flex: '1 1 45%' }}
      >
        <MapPin
          style={{ width: 11, height: 11, color: 'var(--txt-3)' }}
          className="shrink-0"
        />
        <input
          ref={lieuInputRef}
          type="text"
          value={lieuDraft}
          onChange={(e) => setLieuDraft(e.target.value)}
          onBlur={commitLieu}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setLieuDraft(session?.lieu_principal_text || '')
              e.currentTarget.blur()
            }
          }}
          placeholder="Lieu"
          className="text-xs outline-none min-w-0 px-1 py-0.5 rounded transition-colors flex-1"
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px dashed transparent',
            color: 'var(--txt-2)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderBottom = '1px solid var(--blue)'
            e.currentTarget.style.background = 'var(--bg-elev)'
          }}
          onMouseEnter={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.borderBottom = '1px dashed var(--brd)'
            }
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.borderBottom = '1px dashed transparent'
            }
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderBottom = '1px dashed transparent'
            e.currentTarget.style.background = 'transparent'
          }}
          title="Cliquer pour modifier le lieu"
        />
      </span>
      <button
        type="button"
        onClick={focusFirstEmpty}
        className="p-1 rounded transition-colors shrink-0"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--blue)'
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--txt-3)'
          e.currentTarget.style.background = 'transparent'
        }}
        title="Renommer la session"
      >
        <Edit2 className="w-3 h-3" />
      </button>
    </div>
  )
}
