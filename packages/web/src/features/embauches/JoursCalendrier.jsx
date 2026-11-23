// ════════════════════════════════════════════════════════════════════════════
// JoursCalendrier — calendrier multi-sélection des jours d'embauche
// ════════════════════════════════════════════════════════════════════════════
//
// Reprend le geste de Movinmotion : on clique les jours travaillés dans un
// calendrier mensuel. Les dimanches sont grisés et les fériés signalés, pour
// que la majoration ne soit jamais une surprise au moment de la paie.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { feriesSet, natureForDate } from '../../lib/embauches'

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

export default function JoursCalendrier({
  selection = [],
  onToggle,
  onToggleMany,
  feriesExtra = [],
  moisInitial = null,
}) {
  const depart = useMemo(() => {
    const ref = moisInitial || selection[0]
    if (ref) {
      const [y, m] = ref.split('-').map(Number)
      return { annee: y, mois: m - 1 }
    }
    const now = new Date()
    return { annee: now.getFullYear(), mois: now.getMonth() }
  }, [moisInitial, selection])

  const [vue, setVue] = useState(depart)
  const selected = useMemo(() => new Set(selection), [selection])

  const { cases, feries } = useMemo(() => {
    const premier = new Date(vue.annee, vue.mois, 1)
    const nbJours = new Date(vue.annee, vue.mois + 1, 0).getDate()
    // getDay() : 0 = dimanche. On veut une semaine qui commence le lundi.
    const decalage = (premier.getDay() + 6) % 7

    const toutes = []
    for (let i = 1; i <= nbJours; i++) toutes.push(iso(vue.annee, vue.mois, i))
    const f = feriesSet(toutes, feriesExtra)

    const out = []
    for (let i = 0; i < decalage; i++) out.push(null)
    for (const d of toutes) out.push(d)
    return { cases: out, feries: f }
  }, [vue, feriesExtra])

  function bouger(delta) {
    setVue((v) => {
      const d = new Date(v.annee, v.mois + delta, 1)
      return { annee: d.getFullYear(), mois: d.getMonth() }
    })
  }

  // Tous les jours ouvrés du mois affiché, pour l'ajout en un geste.
  function semaineComplete() {
    const ouvres = cases.filter((c) => c && natureForDate(c, feries) === 'normal')
    const manquants = ouvres.filter((d) => !selected.has(d))
    onToggleMany?.(manquants.length ? manquants : ouvres, manquants.length > 0)
  }

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => bouger(-1)}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          aria-label="Mois précédent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
          {MOIS[vue.mois]} {vue.annee}
        </span>
        <button
          type="button"
          onClick={() => bouger(1)}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          aria-label="Mois suivant"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {JOURS.map((j, i) => (
          <div
            key={`${j}-${i}`}
            className="text-center text-[10px] font-semibold py-1"
            style={{ color: 'var(--txt-3)' }}
          >
            {j}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cases.map((d, i) => {
          if (!d) return <div key={`vide-${i}`} />
          const nature = natureForDate(d, feries)
          const actif = selected.has(d)
          const jour = Number(d.slice(8))

          const fond = actif
            ? 'var(--blue)'
            : nature === 'ferie'
              ? 'rgba(255,159,10,.14)'
              : nature === 'dimanche'
                ? 'var(--bg-elev)'
                : 'transparent'
          const couleur = actif
            ? '#fff'
            : nature === 'ferie'
              ? 'var(--amber)'
              : nature === 'dimanche'
                ? 'var(--txt-3)'
                : 'var(--txt-2)'

          return (
            <button
              key={d}
              type="button"
              onClick={() => onToggle?.(d)}
              title={
                nature === 'ferie'
                  ? 'Jour férié'
                  : nature === 'dimanche'
                    ? 'Dimanche'
                    : undefined
              }
              className="h-8 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: fond,
                color: couleur,
                border: actif ? 'none' : '1px solid var(--brd-sub)',
              }}
            >
              {jour}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={semaineComplete}
        className="w-full mt-2 py-1.5 rounded-lg text-[11px] font-medium"
        style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
      >
        Tous les jours ouvrés du mois
      </button>
    </div>
  )
}
