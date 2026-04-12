/**
 * FieldError — affiche un message d'erreur de validation sous un champ.
 *
 * Usage :
 *   <input className="input" ... />
 *   <FieldError error={errors.email} />
 *
 * N'affiche rien si error est null/undefined/vide.
 */
export default function FieldError({ error }) {
  if (!error) return null
  return (
    <p className="text-xs mt-1 font-medium" style={{ color: 'var(--red)' }}>
      {error}
    </p>
  )
}
