// ════════════════════════════════════════════════════════════════════════════
// PresenceCalendarModal — Sélection des jours de présence d'une persona
// ════════════════════════════════════════════════════════════════════════════
//
// Modale calendrier multi-mois (le mois de tournage par défaut). On peut
// toggler chaque jour individuellement. Les jours appartenant à une période
// du projet (tournage / prépa / etc.) sont peints en fond couleur pour
// guider l'admin.
//
// Le résultat est un Array<string> ISO 'YYYY-MM-DD' que le caller stocke
// dans `presence_days` (TEXT[] sur projet_membres).
//
// Usage :
//   <PresenceCalendarModal
//     open={open}
//     onClose={() => setOpen(false)}
//     personaName="Hugo Martin"
//     value={presenceDays}              // string[]
//     onSave={(days) => updatePersona(key, { presence_days: days })}
//     periodes={extractPeriodes(project.metadata)}
//     anchorDate={firstTournageDay}     // optional Date pour ouvrir sur ce mois
//   />
//
// Notes :
//  - On affiche 1 mois à la fois avec des flèches < > pour naviguer.
//  - Pas de borne dure : l'admin peut sélectionner n'importe quel jour
//    (parfois on a besoin de marquer des jours hors période, ex: repérages).
//  - "Sélection rapide" : un bouton par période disponible (Tournage / Prépa
//    / etc.) qui pré-coche tous les jours de cette période.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCircle, Calendar } from 'lucide-react'
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
  value = [],
  onSave,
  periodes = null,
  anchorDate = null,
}) {
  // État local : on travaille sur une copie pour pouvoir annuler.
  const [selected, setSelected] = useState(new Set(value))
  const [viewMonth, setViewMonth] = useState(() => {
    if (anchorDate instanceof Date) return startOfMonth(anchorDate)
    // Best effort : prendre le 1er jour de tournage si dispo
    if (periodes?.tournage && hasAnyRange(periodes.tournage)) {
      const days = expandDays(periodes.tournage)
      if (days.length) {
        const [y, m] = days[0].split('-').map(Number)
        return new Date(y, m - 1, 1)
      }
    }
    return startOfMonth(new Date())
  })

  // Reset à l'ouverture pour récupérer la valeur la plus à jour.
  useEffect(() => {
    if (open) setSelected(new Set(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Map jour → liste de périodes qui le couvrent (pour peindre le fond).
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
    const arr = [...selected].sort()
    await onSave?.(arr)
    onClose?.()
  }

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
              Jours de présence
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

        {/* Calendrier */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
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

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className="aspect-square rounded-md text-sm flex items-center justify-center transition-all relative"
                  style={{
                    background: isSelected
                      ? 'var(--blue)'
                      : periodMeta && inMonth
                      ? periodMeta.bg
                      : 'var(--bg-elev)',
                    color: isSelected
                      ? '#fff'
                      : !inMonth
                      ? 'var(--txt-3)'
                      : periodMeta
                      ? periodMeta.color
                      : 'var(--txt)',
                    border: isSelected
                      ? '1px solid var(--blue)'
                      : `1px solid ${periodMeta && inMonth ? periodMeta.color : 'var(--brd-sub)'}`,
                    fontWeight: isSelected ? 600 : 400,
                    opacity: inMonth ? 1 : 0.5,
                  }}
                >
                  {d.getDate()}
                </button>
              )
            })}
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
