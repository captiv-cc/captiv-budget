/**
 * safeSupabase — helpers centralisés pour les appels Supabase.
 *
 * Problème résolu :
 *   Partout dans l'app, les appels Supabase sont faits "à la main" avec des
 *   patterns incohérents (alert, console.error, rien du tout). Ce module
 *   fournit un wrapper unique qui :
 *   1. Vérifie automatiquement `error` dans la réponse Supabase
 *   2. Affiche un toast via notify.error() (jamais un alert())
 *   3. Loggue en console.error() pour le debug
 *   4. Retourne { data, error } — même signature que Supabase
 *
 * Usage :
 *   import { sbCheck, sbMutation } from '@/lib/safeSupabase'
 *
 *   // Lecture simple
 *   const { data } = await sbCheck(
 *     supabase.from('projects').select('*').eq('org_id', org.id),
 *     'Chargement des projets'
 *   )
 *
 *   // Mutation avec notification
 *   const { data, error } = await sbMutation(
 *     supabase.from('projects').insert({ ... }).select().single(),
 *     { loading: 'Création…', success: 'Projet créé', error: 'Échec de la création' }
 *   )
 */

import { notify } from './notify'

/**
 * Vérifie la réponse Supabase et notifie en cas d'erreur.
 *
 * @param {Promise} query  — le Promise Supabase (ex: supabase.from('x').select('*'))
 * @param {string}  label  — contexte humain pour le log/toast (ex: 'Chargement contacts')
 * @returns {{ data, error }} — même format que Supabase
 */
export async function sbCheck(query, label = 'Opération') {
  try {
    const result = await query
    if (result.error) {
      console.error(`[${label}]`, result.error)
      notify.error(`${label} : ${result.error.message}`)
      return { data: null, error: result.error }
    }
    return { data: result.data, error: null }
  } catch (err) {
    console.error(`[${label}] exception:`, err)
    notify.error(`${label} : ${err.message || 'Erreur inattendue'}`)
    return { data: null, error: err }
  }
}

/**
 * Mutation Supabase avec toast loading → success / error.
 *
 * @param {Promise} query
 * @param {{ loading?: string, success?: string, error?: string }} messages
 * @returns {{ data, error }}
 */
export async function sbMutation(query, messages = {}) {
  const { loading = 'En cours…', success = 'Fait', error: errMsg = 'Échec' } = messages
  const toastId = notify.info(loading)
  try {
    const result = await query
    if (result.error) {
      console.error(`[sbMutation]`, result.error)
      notify.dismiss(toastId)
      notify.error(`${errMsg} : ${result.error.message}`)
      return { data: null, error: result.error }
    }
    notify.dismiss(toastId)
    notify.success(success)
    return { data: result.data, error: null }
  } catch (err) {
    console.error(`[sbMutation] exception:`, err)
    notify.dismiss(toastId)
    notify.error(`${errMsg} : ${err.message || 'Erreur inattendue'}`)
    return { data: null, error: err }
  }
}
