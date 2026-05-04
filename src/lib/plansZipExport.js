/**
 * plansZipExport.js — Export ZIP de tous les plans d'un projet.
 *
 * Use case : sortie de tournage, archivage d'un projet, transmission à un
 * tiers d'un dossier complet "Plans techniques" sans avoir à télécharger
 * un par un depuis l'UI.
 *
 * Stratégie :
 *   1. Pour chaque plan, on génère une signed URL temporaire (10 min).
 *   2. On fetch le binaire via fetch() sur la signed URL.
 *   3. On l'ajoute au ZIP avec un path structuré par catégorie :
 *        Caméra/01-plan-camera.pdf
 *        Lumière/02-plan-light.pdf
 *        Sans catégorie/03-divers.png
 *   4. JSZip génère le blob final + on déclenche le download navigateur.
 *
 * Concurrence : on parallélise par lots de 4 pour éviter de saturer le
 * réseau / Storage en cas de gros projet (50+ plans).
 *
 * Lazy import de jszip : on déclenche l'import dynamique uniquement à
 * l'appel — pas de cost initial pour les utilisateurs qui n'exportent
 * jamais.
 */

import { getSignedUrl } from './plans'

const PARALLEL_FETCHES = 4 // limite la concurrence pour éviter rate limits

/**
 * Sanitise un fragment de path (catégorie ou nom de plan) pour être
 * utilisable dans un nom de fichier ZIP : retire les accents, remplace
 * les caractères dangereux (slash, backslash, etc) par des tirets.
 */
function sanitizePathFragment(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'sans-nom'
}

/**
 * Détermine l'extension à partir du file_type stocké en DB.
 * file_type ∈ {'pdf', 'png', 'jpg'}.
 */
function extensionFor(plan) {
  const t = (plan.file_type || '').toLowerCase()
  if (t === 'pdf') return 'pdf'
  if (t === 'png') return 'png'
  if (t === 'jpg' || t === 'jpeg') return 'jpg'
  // Fallback : essaye d'extraire depuis storage_path.
  const path = plan.storage_path || ''
  const m = /\.([a-z0-9]+)$/i.exec(path)
  return m ? m[1].toLowerCase() : 'bin'
}

/**
 * Construit le path interne dans le ZIP pour un plan :
 *   <Catégorie>/<NN>-<nom>.<ext>
 * Le préfixe NN (sort_order indexé) garantit l'ordre alphanumérique
 * dans le ZIP cohérent avec l'ordre admin.
 */
function buildZipPath(plan, categoryLabel, indexInCategory) {
  const cat = sanitizePathFragment(categoryLabel || 'Sans catégorie')
  const name = sanitizePathFragment(plan.name)
  const ver = plan.current_version > 1 ? ` (V${plan.current_version})` : ''
  const idx = String(indexInCategory + 1).padStart(2, '0')
  const ext = extensionFor(plan)
  return `${cat}/${idx}-${name}${ver}.${ext}`
}

/**
 * Fetch un plan en blob via sa signed URL. Retourne null si erreur (le
 * caller décide quoi faire — typiquement skip + erreur partielle).
 */
async function fetchPlanBlob(plan) {
  if (!plan.storage_path || plan.storage_path === 'pending') {
    throw new Error(`Plan "${plan.name}" : fichier non disponible`)
  }
  const url = await getSignedUrl(plan.storage_path)
  if (!url) throw new Error(`Plan "${plan.name}" : signed URL introuvable`)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Plan "${plan.name}" : HTTP ${res.status}`)
  }
  return await res.blob()
}

/**
 * Process un lot en parallèle (concurrence limitée).
 */
async function processBatch(items, fn) {
  const results = []
  for (let i = 0; i < items.length; i += PARALLEL_FETCHES) {
    const slice = items.slice(i, i + PARALLEL_FETCHES)
    const settled = await Promise.allSettled(slice.map(fn))
    results.push(...settled)
  }
  return results
}

/**
 * Génère un ZIP contenant tous les plans fournis, structuré par catégorie.
 *
 * @param {object}   options
 * @param {Array}    options.plans              — plans à exporter (déjà filtrés
 *                                                 côté caller : non archivés,
 *                                                 categorie filtrée, etc.).
 * @param {Map}      options.categoriesById     — id → category {label, color}
 * @param {string}   options.projectName        — pour le nom de fichier ZIP
 * @param {(idx, total, name) => void} [options.onProgress] — callback
 *                                                progression (utilisé par UI).
 * @returns {Promise<{blob: Blob, filename: string, errors: Array}>}
 */
export async function exportPlansAsZip({
  plans,
  categoriesById,
  projectName,
  onProgress = null,
}) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error('Aucun plan à exporter.')
  }

  // Lazy import jszip (pattern aligné sur matos exports).
  let JSZip
  try {
    const mod = await import('jszip')
    JSZip = mod.default || mod
  } catch {
    throw new Error(
      "La lib jszip n'est pas installée. Lance `npm install jszip` puis recharge la page.",
    )
  }

  const zip = new JSZip()

  // Group par catégorie pour calculer les indexInCategory + bon ordre.
  // On garde l'ordre original des plans (sort_order admin).
  const byCategory = new Map() // catId|null → array de plans dans l'ordre
  for (const p of plans) {
    const key = p.category_id || '__none__'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(p)
  }

  // Construit la liste de tâches { plan, zipPath } à traiter.
  const tasks = []
  for (const [catKey, plansInCat] of byCategory) {
    const cat = catKey === '__none__' ? null : categoriesById?.get(catKey)
    plansInCat.forEach((plan, idx) => {
      tasks.push({
        plan,
        zipPath: buildZipPath(plan, cat?.label, idx),
      })
    })
  }

  const total = tasks.length
  let done = 0
  const errors = []

  // Process par lots avec progression.
  await processBatch(tasks, async ({ plan, zipPath }) => {
    try {
      const blob = await fetchPlanBlob(plan)
      zip.file(zipPath, blob)
    } catch (err) {
      errors.push({ plan, error: err })
    } finally {
      done++
      onProgress?.(done, total, plan.name)
    }
  })

  // Finalise le ZIP.
  const blob = await zip.generateAsync({ type: 'blob' })
  const safeProjectName = sanitizePathFragment(projectName || 'projet')
  const date = new Date().toISOString().slice(0, 10)
  const filename = `plans-${safeProjectName}-${date}.zip`

  return { blob, filename, errors }
}

/**
 * Helper : déclenche le download d'un Blob côté navigateur.
 */
export function triggerZipDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Libère le blob après un tick pour laisser au navigateur le temps de
  // déclencher le download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
