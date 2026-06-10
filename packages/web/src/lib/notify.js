import toast from 'react-hot-toast'

/**
 * Helper centralisé pour les notifications (toasts).
 *
 * Pourquoi ce wrapper plutôt que d'importer `react-hot-toast` partout ?
 *  - Une seule API cohérente dans toute l'app (notify.success, notify.error…)
 *  - Les styles/durées par défaut sont gérés ici, on ne se répète pas
 *  - Si on change un jour de librairie de toasts, on ne modifie que ce fichier
 *
 * Usage :
 *   import { notify } from '@/lib/notify'   // ou chemin relatif
 *   notify.success('Devis enregistré')
 *   notify.error('Impossible de supprimer ce produit')
 *   notify.info('Export en cours…')
 *   notify.promise(monPromise, { loading: '…', success: 'OK', error: 'KO' })
 */

const DEFAULT_DURATION = 3500
const ERROR_DURATION = 5000

export const notify = {
  /** Succès — vert, 3.5 s */
  success(message, opts = {}) {
    return toast.success(message, { duration: DEFAULT_DURATION, ...opts })
  },

  /** Erreur — rouge, 5 s (plus long car l'utilisateur doit avoir le temps de lire) */
  error(message, opts = {}) {
    return toast.error(message, { duration: ERROR_DURATION, ...opts })
  },

  /** Info / neutre — gris */
  info(message, opts = {}) {
    return toast(message, { duration: DEFAULT_DURATION, icon: 'ℹ️', ...opts })
  },

  /** Avertissement — orange */
  warn(message, opts = {}) {
    return toast(message, {
      duration: DEFAULT_DURATION,
      icon: '⚠️',
      style: { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' },
      ...opts,
    })
  },

  /**
   * Promise — affiche "loading" puis "success" ou "error" automatiquement.
   * Très pratique pour les actions async : upload, sauvegarde Supabase…
   *
   * notify.promise(
   *   supabase.from('devis').insert(...),
   *   { loading: 'Enregistrement…', success: 'Devis créé', error: 'Échec' }
   * )
   */
  promise(promise, { loading, success, error }) {
    return toast.promise(promise, { loading, success, error })
  },

  /** Ferme tous les toasts ouverts (rarement utile, mais pratique en debug) */
  dismiss(toastId) {
    toast.dismiss(toastId)
  },
}

// Export par défaut pour ceux qui préfèrent `import notify from ...`
export default notify
