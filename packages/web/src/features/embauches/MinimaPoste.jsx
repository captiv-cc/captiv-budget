// ════════════════════════════════════════════════════════════════════════════
// MinimaPoste — les minima publiés pour le poste, proposés d'un clic
// ════════════════════════════════════════════════════════════════════════════
//
// Movinmotion propose les minima du poste au moment où on le choisit ; la
// première version se contentait d'alerter après coup, et seulement si le
// type d'œuvre était déjà renseigné. On montre maintenant tout ce que la
// grille publie, et cliquer un montant renseigne le taux ET le type d'œuvre.
//
// Deux grilles, deux formes :
//   · 2642 : `minimas_convention`, un montant par type d'œuvre (fiction,
//     flux, hors fiction et flux), par unité, avec variante « spécialisé ».
//   · 3252 : `minimas_etsce`, un seul taux horaire CDDU, ramené à l'unité
//     choisie (heures supplémentaires comprises au-delà du seuil).
//
// Sans grille pour la convention du dossier, on n'affiche rien : un plancher
// emprunté à l'autre convention serait un chiffre faux.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import {
  TYPES_OEUVRE,
  UNITES_TAUX,
  conventionKey,
  minimumPourUnite,
} from '../../lib/embauches'
import { fetchMinimasPoste } from '../../lib/embauchesData'
import { fmtEur } from '../../lib/cotisations'

function Puce({ actif, titre, montant, sous, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1.5 rounded-lg text-left"
      style={{
        background: actif ? 'var(--blue-bg)' : 'var(--bg-elev)',
        border: `1px solid ${actif ? 'var(--blue)' : 'var(--brd)'}`,
      }}
    >
      <span
        className="block text-[10px] leading-tight"
        style={{ color: actif ? 'var(--blue)' : 'var(--txt-3)' }}
      >
        {titre}
      </span>
      <span
        className="block text-xs font-semibold tabular-nums leading-tight"
        style={{ color: 'var(--txt)' }}
      >
        {fmtEur(montant)}
      </span>
      {sous && (
        <span className="block text-[9px] leading-tight" style={{ color: 'var(--txt-3)' }}>
          {sous}
        </span>
      )}
    </button>
  )
}

export default function MinimaPoste({
  poste,
  convention,
  unite,
  typeOeuvre,
  taux,
  params,
  onPick,
}) {
  const cle = conventionKey(convention)
  const [grille, setGrille] = useState(null)
  const [chargement, setChargement] = useState(false)

  useEffect(() => {
    if (!poste) {
      setGrille(null)
      return undefined
    }
    let annule = false
    setChargement(true)
    fetchMinimasPoste(cle, poste).then((g) => {
      if (annule) return
      setGrille(g)
      setChargement(false)
    })
    return () => {
      annule = true
    }
  }, [cle, poste])

  const uniteLabel = UNITES_TAUX.find((u) => u.key === unite)?.label || unite

  // Une proposition par type d'œuvre et par variante, pour l'unité choisie.
  const propositions = useMemo(() => {
    if (!grille) return []

    if (cle === '3252') {
      const th = grille.tauxHoraire
      if (th == null) return []
      const montant = unite === 'heure' ? th : minimumPourUnite(th, unite, params)
      if (montant == null) return []
      return [
        {
          id: '3252',
          titre: uniteLabel,
          montant,
          sous: `taux horaire CDDU ${fmtEur(th)}`,
          typeOeuvre: null,
        },
      ]
    }

    const pourUnite = grille.lignes.filter((l) => l.unite === unite)
    const ordre = TYPES_OEUVRE.map((t) => t.key)
    return pourUnite
      .slice()
      .sort(
        (a, b) =>
          ordre.indexOf(a.typeOeuvre) - ordre.indexOf(b.typeOeuvre) ||
          Number(a.specialise) - Number(b.specialise),
      )
      .map((l) => ({
        id: `${l.typeOeuvre}-${l.specialise}`,
        titre: TYPES_OEUVRE.find((t) => t.key === l.typeOeuvre)?.label || 'Autre',
        montant: l.montant,
        sous: l.specialise ? 'spécialisé' : null,
        typeOeuvre: l.typeOeuvre,
        specialise: l.specialise,
      }))
  }, [grille, cle, unite, params, uniteLabel])

  // Le plancher opposable : celui du type d'œuvre retenu, sans la variante
  // spécialisée (qui ne s'impose qu'aux postes concernés). Sans type d'œuvre,
  // le plus bas de la grille, seul à valoir dans tous les cas.
  const plancher = useMemo(() => {
    if (propositions.length === 0) return null
    const candidats = typeOeuvre
      ? propositions.filter((p) => p.typeOeuvre === typeOeuvre && !p.specialise)
      : propositions
    const pool = candidats.length ? candidats : propositions
    return pool.reduce((min, p) => (p.montant < min.montant ? p : min), pool[0])
  }, [propositions, typeOeuvre])

  if (!poste || chargement) return null

  if (propositions.length === 0) {
    if (!grille) return null
    return (
      <p className="text-[11px] mt-1.5" style={{ color: 'var(--txt-3)' }}>
        La grille ne publie pas de montant pour ce poste en {uniteLabel.toLowerCase()}.
      </p>
    )
  }

  const sousMinimum = Number(taux) > 0 && plancher && Number(taux) < plancher.montant

  return (
    <div className="mt-2">
      <p className="text-[10px] mb-1.5" style={{ color: 'var(--txt-3)' }}>
        Minima de la grille pour ce poste, en {uniteLabel.toLowerCase()}. Un clic
        renseigne le taux.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {propositions.map((p) => (
          <Puce
            key={p.id}
            actif={p.typeOeuvre != null && p.typeOeuvre === typeOeuvre}
            titre={p.titre}
            montant={p.montant}
            sous={p.sous}
            onClick={() => onPick?.({ montant: p.montant, typeOeuvre: p.typeOeuvre })}
          />
        ))}
      </div>

      {Number(taux) > 0 && (
        <p
          className="flex items-center gap-1.5 text-[11px] mt-1.5"
          style={{ color: sousMinimum ? 'var(--red)' : 'var(--txt-3)' }}
        >
          {sousMinimum ? (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green)' }} />
          )}
          {sousMinimum
            ? `Le taux saisi est sous le minimum ${plancher.titre.toLowerCase()} (${fmtEur(plancher.montant)}).`
            : 'Le taux saisi tient le minimum conventionnel.'}
        </p>
      )}
    </div>
  )
}
