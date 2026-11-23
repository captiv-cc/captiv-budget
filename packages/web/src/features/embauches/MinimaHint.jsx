// ════════════════════════════════════════════════════════════════════════════
// MinimaHint — minimum conventionnel du poste, et alerte s'il n'est pas tenu
// ════════════════════════════════════════════════════════════════════════════
//
// Deux grilles, deux formes :
//   · 2642 (production audiovisuelle) : `minimas_convention`, déjà en base
//     pour le devis, avec un montant par poste, type d'œuvre et unité.
//   · 3252 (ETSCE) : `minimas_etsce`, qui ne publie qu'un taux horaire CDDU.
//     On le ramène à l'unité choisie, heures supplémentaires comprises
//     au-delà du seuil hebdomadaire.
//
// Sans grille pour la convention du dossier, on n'affiche rien : un plancher
// emprunté à l'autre convention serait un chiffre faux.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  conventionKey,
  minimumPourUnite,
  typeOeuvreGrille,
} from '../../lib/embauches'
import { fmtEur } from '../../lib/cotisations'

export default function MinimaHint({
  poste,
  typeOeuvre,
  unite,
  taux,
  convention,
  params,
  onApply,
}) {
  const [minimum, setMinimum] = useState(null)
  const [cherche, setCherche] = useState(false)

  useEffect(() => {
    const cle = conventionKey(convention)
    if (!poste || !unite) {
      setMinimum(null)
      return undefined
    }
    let annule = false
    setCherche(true)

    async function charger() {
      if (cle === '3252') {
        const { data, error } = await supabase
          .from('minimas_etsce')
          .select('taux_horaire_cddu')
          .eq('poste', poste)
          .maybeSingle()
        if (annule) return
        setCherche(false)
        const th = data?.taux_horaire_cddu
        if (error || th == null) {
          setMinimum(null)
          return
        }
        setMinimum(
          unite === 'heure' ? Number(th) : minimumPourUnite(Number(th), unite, params),
        )
        return
      }

      if (cle !== '2642') {
        if (!annule) {
          setCherche(false)
          setMinimum(null)
        }
        return
      }

      const grille = typeOeuvreGrille(typeOeuvre)
      if (!grille || unite === 'heure') {
        if (!annule) {
          setCherche(false)
          setMinimum(null)
        }
        return
      }
      const { data, error } = await supabase
        .from('minimas_convention')
        .select('montant_brut, is_specialise')
        .eq('type_oeuvre', grille)
        .eq('poste', poste)
        .eq('unite', unite)
        .order('montant_brut')
      if (annule) return
      setCherche(false)
      if (error || !data?.length) {
        setMinimum(null)
        return
      }
      // Plusieurs variantes (spécialisé ou non) : on retient la plus basse,
      // la seule qui constitue un plancher opposable dans tous les cas.
      setMinimum(Number(data[0].montant_brut))
    }

    charger()
    return () => {
      annule = true
    }
  }, [poste, typeOeuvre, unite, convention, params])

  if (cherche || minimum == null) return null

  const sousMinimum = Number(taux) > 0 && Number(taux) < minimum

  return (
    <div
      className="flex items-center gap-2 mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px]"
      style={{
        background: sousMinimum ? 'rgba(255,71,87,.10)' : 'var(--bg-elev)',
        color: sousMinimum ? 'var(--red)' : 'var(--txt-3)',
      }}
    >
      {sousMinimum ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green)' }} />
      )}
      <span>
        Minimum conventionnel : <strong>{fmtEur(minimum)}</strong>
        {sousMinimum ? ' (le taux saisi est en dessous)' : ''}
      </span>
      {sousMinimum && onApply && (
        <button
          type="button"
          onClick={() => onApply(minimum)}
          className="ml-auto px-2 py-0.5 rounded font-semibold shrink-0"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          Appliquer
        </button>
      )}
    </div>
  )
}
