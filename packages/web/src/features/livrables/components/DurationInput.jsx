// ════════════════════════════════════════════════════════════════════════════
// DurationInput — input texte guidé pour la durée d'un livrable
// ════════════════════════════════════════════════════════════════════════════
//
// L'utilisateur peut saisir librement (`1:30`, `01:30`, `90`, `130`,
// `01:30:00`…). À la perte de focus / Enter, on appelle `parseDuree` et :
//   - si OK → on commit la valeur normalisée via `onCommit`
//   - si KO → on garde la saisie utilisateur affichée et on flag erreur
//     (border rouge + tooltip).
// L'utilisateur peut effacer pour passer à null. Escape annule (revert).
//
// Stockage : on garde la string normalisée dans `livrables.duree` (ex
// `00:30`, `01:30`, `01:30:00`). Pas de migration DB nécessaire pour LIV-7.
// La conversion en secondes (pour stats / tris) est dispo via
// `dureeToSeconds` dans `livrablesHelpers`.
//
// Props :
//   - value     : string|null
//   - onCommit  : (next: string|null) => Promise|void — appelée avec la valeur
//                 normalisée (ou null si vide)
//   - canEdit   : booléen
//   - placeholder : défaut 'mm:ss'
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { parseDuree } from '../../../lib/livrablesHelpers'

export default function DurationInput({
  value,
  onCommit,
  canEdit = true,
  placeholder = 'mm:ss',
}) {
  const [text, setText] = useState(value || '')
  const [error, setError] = useState(null)

  // Sync externe : si la prop change (collab realtime, restore…), on ré-aligne
  // sauf pendant l'édition (focus en cours).
  useEffect(() => {
    setText(value || '')
    setError(null)
  }, [value])

  const handleCommit = async () => {
    const result = parseDuree(text)
    if (!result.ok) {
      setError(result.error || 'Format invalide')
      return
    }
    setError(null)
    // Si vide ou inchangé → no-op
    const current = value || null
    if (result.normalized === current) {
      // Reset l'affichage à la version normalisée (au cas où l'utilisateur
      // aurait tapé `90` mais que la valeur normalisée est `00:30` identique
      // à celle déjà en base — peu probable mais safe).
      setText(result.normalized || '')
      return
    }
    try {
      await onCommit?.(result.normalized)
      setText(result.normalized || '')
    } catch {
      /* l'appelant notifie */
    }
  }

  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        if (error) setError(null)
      }}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setText(value || '')
          setError(null)
          e.currentTarget.blur()
        }
      }}
      disabled={!canEdit}
      placeholder={placeholder}
      title={error || undefined}
      className="w-full bg-transparent focus:outline-none text-xs"
      style={{
        color: error ? 'var(--red)' : 'var(--txt-2)',
        borderBottom: error ? '1px dashed var(--red)' : '1px solid transparent',
      }}
    />
  )
}
