// ════════════════════════════════════════════════════════════════════════════
// PresenceCalendarModal — Présence & logistique d'une persona (P1.6)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale qui regroupe :
//   - Calendrier des jours de présence (multi-mois, avec sélection rapide
//     par période du projet : Tournage, Prépa, etc.)
//   - Section logistique : jour d'arrivée (souvent ≠ du 1er jour de
//     présence), heure d'arrivée libre, notes logistique (transport,
//     contraintes…)
//
// Toutes les valeurs sont persona-level → propagées à toutes les rows de
// la même personne via updatePersona.
//
// Usage :
//   <PresenceCalendarModal
//     open={open}
//     onClose={...}
//     personaName="Hugo Martin"
//     persona={{ presence_days, arrival_date, arrival_time, logistique_notes }}
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
  StickyNote,
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

export default function PresenceCalendarModal({
  open,
  onClose,
  personaName = '—',
  persona = null, // { presence_days, arrival_date, arrival_time, logistique_notes }
  onSave,
  periodes = null,
  anchorDate = null,
}) {
  const initialPresence = persona?.presence_days || []
  const initialArrivalDate = persona?.arrival_date || ''
  const initialArrivalTime = persona?.arrival_time || ''
  const initialDepartureDate = persona?.departure_date || ''
  const initialDepartureTime = persona?.departure_time || ''
  const initialLogistique = persona?.logistique_notes || ''

  const [selected, setSelected] = useState(new Set(initialPresence))
  const [arrivalDate, setArrivalDate] = useState(initialArrivalDate)
  const [arrivalTime, setArrivalTime] = useState(initialArrivalTime)
  const [departureDate, setDepartureDate] = useState(initialDepartureDate)
  const [departureTime, setDepartureTime] = useState(initialDepartureTime)
  const [logistique, setLogistique] = useState(initialLogistique)

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

  // Reset à l'ouverture
  useEffect(() => {
    if (open) {
      setSelected(new Set(persona?.presence_days || []))
      setArrivalDate(persona?.arrival_date || '')
      setArrivalTime(persona?.arrival_time || '')
      setDepartureDate(persona?.departure_date || '')
      setDepartureTime(persona?.departure_time || '')
      setLogistique(persona?.logistique_notes || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
    await onSave?.({
      presence_days,
      arrival_date: arrivalDate || null,
      arrival_time: arrivalTime.trim() || null,
      departure_date: departureDate || null,
      departure_time: departureTime.trim() || null,
      logistique_notes: logistique.trim() || null,
    })
    onClose?.()
  }

  // Pour les boutons "aligner sur 1er/dernier jour de présence"
  const sortedDays = selected.size ? [...selected].sort() : []
  const firstPresenceDay = sortedDays[0] || null
  const lastPresenceDay = sortedDays[sortedDays.length - 1] || null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
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
              Présence &amp; logistique
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
                let boxShadow = 'none'

                if (!inMonth) {
                  textColor = 'var(--txt-3)'
                } else if (isSelected) {
                  bgColor = 'var(--blue)'
                  textColor = '#fff'
                  borderColor = 'var(--blue)'
                  if (periodMeta) {
                    boxShadow = `inset 0 0 0 2px ${periodMeta.color}`
                  }
                } else if (periodMeta) {
                  bgColor = periodMeta.bg
                  textColor = periodMeta.color
                  borderColor = periodMeta.color
                }

                // Tooltip enrichi
                const tooltipParts = [`${d.getDate()}`]
                if (periodMeta) tooltipParts.push(periodMeta.label)
                if (isArrival) tooltipParts.push('Arrivée')
                if (isDeparture) tooltipParts.push('Retour')

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className="aspect-square rounded-md text-sm flex items-center justify-center transition-all relative"
                    style={{
                      background: bgColor,
                      color: textColor,
                      border: `1px solid ${borderColor}`,
                      boxShadow,
                      fontWeight: isSelected ? 600 : 400,
                      opacity: inMonth ? 1 : 0.5,
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

          {/* ── Logistique : arrivée / retour / notes ──────────────────── */}
          <div
            className="rounded-md p-3 space-y-3"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            <div
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--txt-2)' }}
            >
              <PlaneLanding className="w-3.5 h-3.5" />
              Logistique
            </div>

            {/* Arrivée */}
            <LogistiqueRow
              icon={<PlaneLanding className="w-3 h-3" />}
              label="Arrivée"
              date={arrivalDate}
              time={arrivalTime}
              onDateChange={setArrivalDate}
              onTimeChange={setArrivalTime}
              alignTarget={firstPresenceDay}
              alignLabel="aligner sur 1er jour"
              alignTitle="Aligner sur le 1er jour de présence"
            />

            {/* Retour */}
            <LogistiqueRow
              icon={<PlaneTakeoff className="w-3 h-3" />}
              label="Retour"
              date={departureDate}
              time={departureTime}
              onDateChange={setDepartureDate}
              onTimeChange={setDepartureTime}
              alignTarget={lastPresenceDay}
              alignLabel="aligner sur dernier jour"
              alignTitle="Aligner sur le dernier jour de présence"
            />

            {/* Notes logistique (transport, contraintes, n° vol/train, etc.) */}
            <div>
              <label
                className="flex items-center gap-1 text-[10px] font-semibold mb-1"
                style={{ color: 'var(--txt-3)' }}
              >
                <StickyNote className="w-2.5 h-2.5" />
                Notes logistique
              </label>
              <textarea
                value={logistique}
                onChange={(e) => setLogistique(e.target.value)}
                rows={3}
                placeholder="Train Lyon Part-Dieu 12h50, retour TGV 18h45, voiture / parking demandé…"
                className="w-full text-xs px-2 py-1 rounded outline-none resize-none"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>
          </div>
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
 * LogistiqueRow — Une ligne arrivée/retour : icône + label + date + heure.
 * Affiche un mini-bouton "aligner sur ..." quand alignTarget est défini ET
 * différent de la date actuelle.
 */
function LogistiqueRow({
  icon,
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
  alignTarget,
  alignLabel,
  alignTitle,
}) {
  const showAlign = alignTarget && alignTarget !== date
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-end">
      <div
        className="flex flex-col items-center justify-center text-[10px] font-semibold uppercase tracking-wide pb-1"
        style={{ color: 'var(--purple)', minWidth: 50 }}
      >
        <span style={{ color: 'var(--purple)' }}>{icon}</span>
        <span className="mt-0.5">{label}</span>
      </div>

      <div>
        <input
          type="date"
          value={date || ''}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
        {showAlign && (
          <button
            type="button"
            onClick={() => onDateChange(alignTarget)}
            className="mt-0.5 text-[10px] underline transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
            title={alignTitle}
          >
            {alignLabel}
          </button>
        )}
      </div>

      <input
        type="text"
        value={time || ''}
        onChange={(e) => onTimeChange(e.target.value)}
        placeholder="12h50, matin…"
        className="w-full text-xs px-2 py-1 rounded outline-none"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          color: 'var(--txt)',
        }}
      />
    </div>
  )
}
