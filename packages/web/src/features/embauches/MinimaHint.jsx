// ════════════════════════════════════════════════════════════════════════════
// MinimaHint — minimum conventionnel du poste, et alerte s'il n'est pas tenu
// ════════════════════════════════════════════════════════════════════════════
//
// La grille CCNTA est déjà en base (`minimas_convention`, alimentée pour le
// devis). On la relit ici pour reproduire ce que Movinmotion affiche sous le
// champ de rémunération, plutôt que de faire ressaisir le minimum.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { conventionAGrille, typeOeuvreGrille } from '../../lib/embauches'
import { fmtEur } from '../../lib/cotisations'

export default function MinimaHint({ poste, typeOeuvre, unite, taux, convention, onApply }) {
  const [minimum, setMinimum] = useState(null)
  const [cherche, setCherche] = useState(false)

  useEffect(() => {
    const grille = typeOeuvreGrille(typeOeuvre)
    // La grille en base est celle de la CCN production audiovisuelle. Sous une
    // autre convention, afficher ses planchers donnerait un chiffre faux.
    if (!conventionAGrille(convention) || !poste || !grille || !unite || unite === 'heure') {
      setMinimum(null)
      return
    }
    let annule = false
    setCherche(true)
    supabase
      .from('minimas_convention')
      .select('montant_brut, is_specialise')
      .eq('type_oeuvre', grille)
      .eq('poste', poste)
      .eq('unite', unite)
      .order('montant_brut')
      .then(({ data, error }) => {
        if (annule) return
        setCherche(false)
        if (error || !data?.length) {
          setMinimum(null)
          return
        }
        // Plusieurs variantes (spécialisé ou non) : on retient la plus basse,
        // la seule qui constitue un plancher opposable dans tous les cas.
        setMinimum(Number(data[0].montant_brut))
      })
    return () => {
      annule = true
    }
  }, [poste, typeOeuvre, unite, convention])

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
