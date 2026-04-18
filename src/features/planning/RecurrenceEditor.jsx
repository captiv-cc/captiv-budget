/**
 * RecurrenceEditor — Formulaire compact pour configurer la rrule d'un événement.
 *
 * Props :
 *   - value       : rrule (objet) ou null
 *   - onChange    : fn(rrule | null)
 *   - startDate   : Date — date de début du master (pour préremplir byweekday)
 */
import { useMemo } from 'react'
import { Repeat } from 'lucide-react'
import {
  RRULE_FREQS,
  RRULE_END_TYPES,
  WEEKDAY_LABELS_SHORT,
  defaultRrule,
} from '../../lib/rrule'

export default function RecurrenceEditor({ value, onChange, startDate }) {
  const enabled = Boolean(value)
  const rrule = value || null

  const untilValue = useMemo(() => {
    if (!rrule?.until) return ''
    try {
      const d = new Date(rrule.until)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    } catch {
      return ''
    }
  }, [rrule?.until])

  function toggle(on) {
    if (on) {
      onChange(defaultRrule(startDate || new Date()))
    } else {
      onChange(null)
    }
  }

  function patch(p) {
    onChange({ ...(rrule || {}), ...p })
  }

  function toggleDow(dow) {
    const current = Array.isArray(rrule?.byweekday) ? rrule.byweekday : []
    const next = current.includes(dow)
      ? current.filter((d) => d !== dow)
      : [...current, dow].sort((a, b) => a - b)
    patch({ byweekday: next })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Toggle principal */}
      <label
        className="flex items-center gap-2 text-sm cursor-pointer"
        style={{ color: 'var(--txt-2)' }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="w-4 h-4"
        />
        <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        Événement récurrent
      </label>

      {enabled && rrule && (
        <div
          className="rounded-lg p-3 flex flex-col gap-3"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
        >
          {/* Ligne : Fréquence + Intervalle */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>Tous/toutes les</span>
            <input
              type="number"
              min={1}
              max={99}
              value={rrule.interval || 1}
              onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
              className="w-16 px-2 py-1 rounded text-sm"
              style={inputStyle}
            />
            <select
              value={rrule.freq}
              onChange={(e) => {
                const freq = e.target.value
                const p = { freq }
                if (freq === 'weekly' && (!rrule.byweekday || !rrule.byweekday.length)) {
                  const dow = startDate ? (startDate.getDay() + 6) % 7 : 0
                  p.byweekday = [dow]
                }
                patch(p)
              }}
              className="px-2 py-1 rounded text-sm"
              style={inputStyle}
            >
              {Object.values(RRULE_FREQS).map((f) => (
                <option key={f.key} value={f.key}>
                  {freqShort(f.key, rrule.interval)}
                </option>
              ))}
            </select>
          </div>

          {/* Jours de la semaine (si weekly) */}
          {rrule.freq === 'weekly' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                Jours de la semaine
              </span>
              <div className="flex items-center gap-1">
                {WEEKDAY_LABELS_SHORT.map((lbl, i) => {
                  const active = Array.isArray(rrule.byweekday) && rrule.byweekday.includes(i)
                  return (
                    <button
                      key={`${lbl}-${i}`}
                      type="button"
                      onClick={() => toggleDow(i)}
                      className="w-8 h-8 rounded-full text-xs font-medium transition"
                      style={{
                        background: active ? 'var(--blue)' : 'var(--bg-surf)',
                        color:      active ? '#fff'        : 'var(--txt-2)',
                        border:     `1px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
                      }}
                      aria-label={`Toggle jour ${i}`}
                    >
                      {lbl}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Fin */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>Fin</span>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={rrule.end_type || 'never'}
                onChange={(e) => {
                  const end_type = e.target.value
                  const p = { end_type }
                  if (end_type === 'count' && !rrule.count) p.count = 10
                  if (end_type === 'until' && !rrule.until) {
                    const d = new Date(startDate || new Date())
                    d.setMonth(d.getMonth() + 3)
                    p.until = d.toISOString()
                  }
                  patch(p)
                }}
                className="px-2 py-1 rounded text-sm"
                style={inputStyle}
              >
                {Object.values(RRULE_END_TYPES).map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>

              {rrule.end_type === 'count' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={rrule.count || 1}
                    onChange={(e) => patch({ count: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-20 px-2 py-1 rounded text-sm"
                    style={inputStyle}
                  />
                  <span className="text-xs" style={{ color: 'var(--txt-3)' }}>occurrences</span>
                </div>
              )}

              {rrule.end_type === 'until' && (
                <input
                  type="date"
                  value={untilValue}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    const [y, m, d] = v.split('-').map(Number)
                    const date = new Date(y, m - 1, d, 23, 59, 0, 0)
                    patch({ until: date.toISOString() })
                  }}
                  className="px-2 py-1 rounded text-sm"
                  style={inputStyle}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function freqShort(key, interval) {
  const n = Number(interval) || 1
  if (key === 'daily')   return n === 1 ? 'jour(s)' : 'jours'
  if (key === 'weekly')  return n === 1 ? 'semaine(s)' : 'semaines'
  if (key === 'monthly') return n === 1 ? 'mois' : 'mois'
  return key
}

const inputStyle = {
  background: 'var(--bg-surf)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}
