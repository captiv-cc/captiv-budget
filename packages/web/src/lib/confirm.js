// ════════════════════════════════════════════════════════════════════════════
// confirm — API impérative pour les dialogues de confirmation
// ════════════════════════════════════════════════════════════════════════════
//
// Remplace `window.confirm(...)` par une UI cohérente avec le design system.
// S'inspire du pattern de react-hot-toast : un émetteur global (ce module) et
// un unique composant <ConfirmHost /> monté une seule fois dans App.jsx qui
// écoute les demandes et rend le dialog.
//
// Usage depuis n'importe où :
//   import { confirm } from '@/lib/confirm'
//
//   const ok = await confirm({
//     title: 'Supprimer le bloc',
//     message: 'Cette action est irréversible.',
//     confirmLabel: 'Supprimer',
//     cancelLabel: 'Annuler',
//     danger: true,
//   })
//   if (!ok) return
//
// Le dialog gère : backdrop click = cancel, Escape = cancel, Enter = confirm,
// focus automatique sur le bouton confirm, portal pour échapper aux overflow.
// ════════════════════════════════════════════════════════════════════════════

let nextId = 1
const listeners = new Set()

/**
 * Ouvre un dialog de confirmation. Résout la promise avec `true` si l'utilisateur
 * clique OK, `false` s'il annule (clic cancel, Escape, clic backdrop).
 *
 * @param {object} opts
 * @param {string} [opts.title]        - Titre (optionnel, bold en haut)
 * @param {string} opts.message        - Question principale (obligatoire)
 * @param {string} [opts.confirmLabel] - Texte du bouton OK (défaut: "Confirmer")
 * @param {string} [opts.cancelLabel]  - Texte du bouton annuler (défaut: "Annuler")
 * @param {boolean} [opts.danger]      - Style rouge pour le bouton OK (suppression)
 * @returns {Promise<boolean>}
 */
export function confirm(opts = {}) {
  return new Promise((resolve) => {
    const id = nextId++
    const req = {
      id,
      type: 'confirm',
      title: opts.title || '',
      message: opts.message || 'Confirmer cette action ?',
      confirmLabel: opts.confirmLabel || 'Confirmer',
      cancelLabel: opts.cancelLabel || 'Annuler',
      danger: Boolean(opts.danger),
      resolve,
    }
    listeners.forEach((fn) => fn(req))
  })
}

/**
 * Ouvre un dialog avec un champ texte (remplace `window.prompt`). Résout avec
 * la string saisie (qui peut être vide si le champ est facultatif) quand
 * l'utilisateur confirme, ou `null` s'il annule.
 *
 * @param {object} opts
 * @param {string} [opts.title]          - Titre (bold en haut)
 * @param {string} opts.message          - Question/consigne principale
 * @param {string} [opts.placeholder]    - Placeholder du champ
 * @param {string} [opts.initialValue]   - Valeur initiale pré-remplie
 * @param {boolean} [opts.required]      - Si true, bouton OK désactivé tant que vide
 * @param {boolean} [opts.multiline]     - Textarea au lieu d'input (défaut false)
 * @param {string} [opts.confirmLabel]   - Défaut "Confirmer"
 * @param {string} [opts.cancelLabel]    - Défaut "Annuler"
 * @param {boolean} [opts.danger]        - Style rouge sur le bouton OK
 * @returns {Promise<string|null>}
 */
export function prompt(opts = {}) {
  return new Promise((resolve) => {
    const id = nextId++
    const req = {
      id,
      type: 'prompt',
      title: opts.title || '',
      message: opts.message || '',
      placeholder: opts.placeholder || '',
      initialValue: opts.initialValue || '',
      required: Boolean(opts.required),
      multiline: Boolean(opts.multiline),
      confirmLabel: opts.confirmLabel || 'Confirmer',
      cancelLabel: opts.cancelLabel || 'Annuler',
      danger: Boolean(opts.danger),
      resolve,
    }
    listeners.forEach((fn) => fn(req))
  })
}

/**
 * Souscription interne — appelée uniquement par <ConfirmHost />.
 * Retourne une fonction d'unsubscribe.
 */
export function subscribeConfirm(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export default confirm
