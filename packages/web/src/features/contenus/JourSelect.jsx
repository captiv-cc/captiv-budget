// ════════════════════════════════════════════════════════════════════════════
// JourSelect — choix d'un jour de festival plutôt que d'une date
// ════════════════════════════════════════════════════════════════════════════
//
// Sur un festival, on classe un contenu au « Jour 2 » avant de le classer au
// 21 août. On propose donc les journées du projet (issues du déroulé), tout
// en gardant une date libre pour ce qui tombe en dehors.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import SearchSelect from '../../components/SearchSelect'

const LIBRE = 'Autre date…'

function frDateCourte(iso) {
  const d = new Date(`${iso}T12:00:00`)
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Étiquette d'une date : le jour de festival s'il en fait partie. */
export function labelForDate(iso, jours = []) {
  if (!iso) return ''
  const found = jours.find((j) => j.date === iso)
  return found ? found.label : frDateCourte(iso)
}

export default function JourSelect({
  value, // ISO ou null
  jours = [], // [{ date, label }]
  canEdit = true,
  onChange,
  compact = false,
  className = '',
  style = null,
}) {
  const [libre, setLibre] = useState(false)

  // Aucun jour connu (projet sans déroulé) : on ne masque pas la saisie
  // derrière un menu vide, on montre directement le champ date.
  if (jours.length === 0 || libre) {
    return (
      <input
        type="date"
        value={value || ''}
        disabled={!canEdit}
        autoFocus={libre}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={() => setLibre(false)}
        className={`text-xs px-2.5 py-2 rounded-lg outline-none ${className}`}
        style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)', ...style }}
      />
    )
  }

  const options = [...jours.map((j) => j.label), LIBRE]
  const current = value ? labelForDate(value, jours) : null

  return (
    <SearchSelect
      value={current}
      options={options}
      placeholder="Jour"
      canEdit={canEdit}
      allowCreate={false}
      compact={compact}
      className={className}
      style={style}
      onChange={(label) => {
        if (label === LIBRE) {
          setLibre(true)
          return
        }
        const found = jours.find((j) => j.label === label)
        onChange(found ? found.date : null)
      }}
    />
  )
}
