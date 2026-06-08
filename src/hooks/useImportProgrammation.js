// ════════════════════════════════════════════════════════════════════════════
// useImportProgrammation (MUS-1.10) — Hook client pour l'import affiche IA
// ════════════════════════════════════════════════════════════════════════════
//
// Encapsule l'appel à l'Edge Function `import-programmation` :
//   - Encode le fichier (File ou Blob) en base64
//   - Invoque la function via supabase.functions.invoke
//   - Gère états loading / error / result
//   - Renvoie { festival_name, dates, artistes[] } prêt à être previewé
//
// Cousin de useImportDeroule (FEST-4.2) mais pour les affiches/line-up :
// pas d'horaires, juste la liste artistes (avec jour/scène/headliner
// optionnels si Claude les détecte).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

export function useImportProgrammation() {
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
   * Renvoie { festival_name, dates, artistes, meta } en cas de succès.
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
      const file_name = file.name || 'affiche'

      const { data, error: fnError } = await supabase.functions.invoke(
        'import-programmation',
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
        festival_name: extracted.festival_name || null,
        dates: extracted.dates || null,
        artistes: Array.isArray(extracted.artistes) ? extracted.artistes : [],
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

export default useImportProgrammation
