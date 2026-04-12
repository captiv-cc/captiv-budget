/**
 * useFormValidation — hook React pour valider un formulaire avec un schéma Zod.
 *
 * Usage :
 *   const { errors, validate, clearErrors, clearField } = useFormValidation(schema)
 *
 *   function handleSubmit(e) {
 *     e.preventDefault()
 *     const result = validate(form)
 *     if (!result) return  // errors est automatiquement rempli
 *     // result contient les données validées et transformées par Zod
 *     await supabase.from('x').insert(result)
 *   }
 *
 * Dans le JSX :
 *   <input ... onChange={(e) => { setForm(...); clearField('email') }} />
 *   <FieldError error={errors.email} />
 */
import { useState, useCallback } from 'react'

/**
 * @param {import('zod').ZodSchema} schema
 * @returns {{ errors, validate, clearErrors, clearField }}
 */
export function useFormValidation(schema) {
  const [errors, setErrors] = useState({})

  /**
   * Valide `data` contre le schéma.
   * - Si valide → retourne les données transformées, vide les erreurs
   * - Si invalide → remplit errors, retourne null
   */
  const validate = useCallback(
    (data) => {
      const result = schema.safeParse(data)
      if (result.success) {
        setErrors({})
        return result.data
      }
      // Transformer les erreurs Zod en { field: message }
      const fieldErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0]
        if (key && !fieldErrors[key]) {
          fieldErrors[key] = issue.message
        }
      }
      setErrors(fieldErrors)
      return null
    },
    [schema],
  )

  /** Efface toutes les erreurs */
  const clearErrors = useCallback(() => setErrors({}), [])

  /** Efface l'erreur d'un champ spécifique (utile au onChange) */
  const clearField = useCallback(
    (field) =>
      setErrors((prev) => {
        if (!prev[field]) return prev
        const next = { ...prev }
        delete next[field]
        return next
      }),
    [],
  )

  return { errors, validate, clearErrors, clearField }
}
