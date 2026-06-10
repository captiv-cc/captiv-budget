// ════════════════════════════════════════════════════════════════════════════
// useImportDeroule (FEST-4.2) — Hook client pour l'import IA de programmation
// ════════════════════════════════════════════════════════════════════════════
//
// Encapsule l'appel à l'Edge Function `import-deroule` :
//   - Encode le fichier (File ou Blob) en base64
//   - Invoque la function via supabase.functions.invoke
//   - Gère états loading / error / result
//   - Renvoie { date, shows[] } prêt à être previewé
//
// Usage :
//   const { extract, importing, error, result, reset } = useImportDeroule()
//   await extract(file)        // → result = { date, shows, meta }
//
// L'erreur est aussi exposée comme valeur de retour pour faciliter le
// traitement immédiat (.catch dans le caller).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Encode un File / Blob en base64 (sans le préfixe "data:...;base64,").
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result || ''
      const comma = String(result).indexOf(',')
      resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result))
    }
    reader.onerror = () => reject(reader.error || new Error('Lecture fichier KO'))
    reader.readAsDataURL(file)
  })
}

export function useImportDeroule() {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const reset = useCallback(() => {
    setError(null)
    setResult(null)
    setImporting(false)
  }, [])

  /**
   * Lance l'extraction IA sur un fichier (File ou Blob).
   * Renvoie { date, shows, meta } en cas de succès, throw sinon.
   */
  const extract = useCallback(async (file) => {
    if (!file) {
      const e = new Error('Aucun fichier fourni')
      setError(e.message)
      throw e
    }
    setImporting(true)
    setError(null)
    setResult(null)

    try {
      const file_data = await fileToBase64(file)
      const file_type = file.type || 'application/octet-stream'
      const file_name = file.name || 'capture'

      const { data, error: fnError } = await supabase.functions.invoke(
        'import-deroule',
        { body: { file_data, file_type, file_name } },
      )

      if (fnError) {
        let detailed = fnError.message || 'Erreur Edge Function'
        try {
          if (fnError.context && typeof fnError.context.json === 'function') {
            const body = await fnError.context.json()
            if (body?.error) detailed = body.error
          } else if (
            fnError.context &&
            typeof fnError.context.text === 'function'
          ) {
            const txt = await fnError.context.text()
            if (txt) detailed = txt
          }
        } catch {
          /* ignore */
        }
        throw new Error(detailed)
      }
      if (!data || !data.success) {
        throw new Error(data?.error || 'Réponse Edge Function invalide')
      }

      const extracted = data.extracted || {}
      const meta = data.meta || {}
      const finalResult = {
        date: extracted.date || null,
        shows: Array.isArray(extracted.shows) ? extracted.shows : [],
        meta,
      }
      setResult(finalResult)
      return finalResult
    } catch (e) {
      const msg = e?.message || String(e)
      setError(msg)
      throw e
    } finally {
      setImporting(false)
    }
  }, [])

  return { extract, importing, error, result, reset }
}

export default useImportDeroule
