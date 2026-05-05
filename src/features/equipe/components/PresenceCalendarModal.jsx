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

import { useState, useEffect, useMemo } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Calendar,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
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

  // Reset à l'ouverture + à chaque switch de session active. Quand on
  // ouvre la modale et qu'on a des sessions, on initialise la sélection
  // active sur la 1ʳᵉ session par sort_order.
  useEffect(() => {
    if (!open) return
    // Si on a des sessions et pas encore de session active sélectionnée,
    // on prend la 1ère par défaut.
    if (sortedSessions.length && !activeSessionId) {
      setActiveSessionId(sortedSessions[0].id)
      return // Le prochain run du même effect (avec activeSessionId set) fera le reset
    }
    // Reset des champs depuis la source courante (active session ou persona)
    const src = activeSession || persona
    setSelected(new Set(src?.presence_days || []))
    setArrivalDate(src?.arrival_date || '')
    setDepartureDate(src?.departure_date || '')
    setPickerMode('presence')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSessionId, sortedSessions])

  // Reset l'activeSessionId + le mini-form de création à la fermeture
  // (sinon en réouvrant on afficherait l'ancienne session active même si
  // la liste a changé, et le form de création resterait ouvert).
  useEffect(() => {
    if (!open) {
      setActiveSessionId(null)
      setCreatingSession(false)
      setNewLabel('')
      setNewLieu('')
      setPendingMatchTemplate(null)
    }
  }, [open])

  // ESC en mode picker → annule le picker (sans fermer la modale)
  useEffect(() => {
    if (pickerMode === 'presence') return undefined
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPickerMode('presence')
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [pickerMode])

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

  async function handleSave() {
    const presence_days = [...selected].sort()
    try {
      // Cleanup P4 : on ne save QUE les 3 champs gérés ici. Les champs
      // logistique (heures, hébergement, chauffeur, notes) restent gérés
      // par la future tab Logistique — on ne les touche plus depuis ici
      // pour éviter d'écraser des valeurs saisies ailleurs.
      // Phase 0b : si une session est active, on la passe en 2ᵉ argument
      // pour que l'appelant route vers updateMemberSession (sinon il
      // retombe sur updatePersona — chemin legacy).
      await onSave?.(
        {
          presence_days,
          arrival_date: arrivalDate || null,
          departure_date: departureDate || null,
        },
        activeSessionId,
      )
      onClose?.()
    } catch (err) {
      // Cause typique : migration SQL pas encore passée → "column X does
      // not exist". Sans ce try/catch, l'erreur était avalée silencieusement
      // et l'utilisateur voyait "tout s'annule" sans comprendre pourquoi.
      console.error('[PresenceCalendarModal] save error:', err)
      const msg = err?.message || String(err)
      // Détection migration manquante pour message plus parlant
      const colMissing = /column\s+[\w."]+\s+does not exist/i.exec(msg)
      if (colMissing) {
        notify.error(
          `Enregistrement impossible : ${colMissing[0]}. La migration SQL n'a probablement pas été passée — vérifiez les fichiers supabase/migrations/ avec votre admin.`,
        )
      } else {
        notify.error('Enregistrement échoué : ' + msg)
      }
      // On NE ferme PAS la modale → l'utilisateur peut réessayer ou copier
      // ses saisies avant de fermer manuellement.
    }
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
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Calendar className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              Présence sur le projet
            </h2>
            <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              {personaName}
            </p>
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
            title="Fermer"
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
            {sortedSessions.map((s) => {
              const isActive = s.id === activeSessionId
              const couleur = effectiveCouleur(s)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSessionId(s.id)}
                  className="text-xs px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 shrink-0 transition-colors"
                  style={{
                    background: isActive ? `#${couleur}22` : 'transparent',
                    color: isActive ? `#${couleur}` : 'var(--txt-2)',
                    border: `1px solid ${isActive ? `#${couleur}` : 'var(--brd-sub)'}`,
                    fontWeight: isActive ? 600 : 400,
                  }}
                  title={
                    s.lieu_principal_text
                      ? `${effectiveLabel(s)} · ${s.lieu_principal_text}`
                      : effectiveLabel(s)
                  }
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: `#${couleur}` }}
                  />
                  {effectiveLabel(s)}
                </button>
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
                {projectSessionTemplates.map((t, i) => {
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
                      {' '}existe déjà
                      {pendingMatchTemplate.member_count > 0
                        ? ` chez ${pendingMatchTemplate.member_count} membre${pendingMatchTemplate.member_count > 1 ? 's' : ''}`
                        : ''}
                      .
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          let created
                          if (pendingMatchTemplate.session_id && onJoinSession) {
                            created = await onJoinSession(pendingMatchTemplate.session_id)
                          } else {
                            // Fallback : pas de session_id (template
                            // dégradé) → on tombe sur create
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
                    <button
                      type="button"
                      onClick={async () => {
                        // Skippe la détection : on crée un doublon
                        // (sera fusionnable manuellement plus tard).
                        try {
                          const created = await onCreateSession({
                            label: pendingMatchTemplate.label,
                            lieu_principal_text: pendingMatchTemplate.lieu || null,
                            arrival_date: null,
                            departure_date: null,
                            presence_days: [],
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
                    <button
                      type="submit"
                      className="text-xs px-1.5 py-0.5 rounded inline-flex items-center"
                      style={{
                        background: 'var(--blue)',
                        color: '#fff',
                      }}
                      title="Créer la session (Entrée)"
                    >
                      <CheckCircle className="w-3 h-3" />
                    </button>
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

        {/* Sélection rapide par période */}
        {periodes && (
          <div
            className="flex flex-wrap gap-1.5 px-5 py-3 border-b shrink-0"
            style={{ borderColor: 'var(--brd-sub)' }}
          >
            {PERIODE_KEYS.filter((k) => hasAnyRange(periodes[k])).map((k) => {
              const meta = PERIODE_META[k]
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => selectPeriode(k)}
                  className="text-xs px-2 py-1 rounded-md transition-opacity"
                  style={{
                    background: meta.bg,
                    color: meta.color,
                    border: `1px solid ${meta.color}`,
                  }}
                  title={`Sélectionner tous les jours ${meta.label.toLowerCase()}`}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  + {meta.label}
                </button>
              )
            })}
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs px-2 py-1 rounded-md transition-colors ml-auto"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
              >
                Tout effacer
              </button>
            )}
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
            {/* Nav mois */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {MONTHS_FR[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </div>
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
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

          {/* ── Arrivée / Retour : UX progressive (sans heures, sans
              hébergement, sans chauffeur, sans notes — tout cela est géré
              dans la future tab Logistique). */}
          <ArrivalDepartureSection
            arrivalDate={arrivalDate}
            departureDate={departureDate}
            firstPresenceDay={firstPresenceDay}
            lastPresenceDay={lastPresenceDay}
            pickerMode={pickerMode}
            onPickArrival={() => setPickerMode((m) => (m === 'arrival' ? 'presence' : 'arrival'))}
            onPickDeparture={() => setPickerMode((m) => (m === 'departure' ? 'presence' : 'departure'))}
            onClearArrival={() => setArrivalDate('')}
            onClearDeparture={() => setDepartureDate('')}
            onSetArrivalDate={setArrivalDate}
            onSetDepartureDate={setDepartureDate}
          />
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-between gap-3 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div className="text-xs" style={{ color: 'var(--txt-2)' }}>
            <strong style={{ color: 'var(--txt)' }}>{selected.size}</strong> jour
            {selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                border: '1px solid var(--blue)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Enregistrer
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
