/**
 * Helpers de chargement d'images pour les exports PDF.
 *
 * Pourquoi ce fichier : les exports PDF (devis, livrables, matériel)
 * partagent le même besoin :
 *   1. charger une image distante (Supabase Storage public ou asset local)
 *   2. la renormaliser en JPEG via canvas (le parser PNG strict de jsPDF
 *      crashe sur les variantes alpha / interlaced / etc.)
 *   3. en déduire les bonnes dimensions de rendu PDF en respectant le
 *      ratio naturel (sinon les logos pas exactement banner-shape sont
 *      écrasés)
 *
 * Centraliser ici évite la duplication et garantit que les 4-5 PDFs
 * de l'app affichent le logo de l'organisation de la même manière.
 */

/**
 * Charge une image et la renormalise en JPEG via canvas.
 *
 * Stratégie :
 *   - fetch + URL.createObjectURL pour gérer le cross-origin proprement
 *     (Supabase Storage). Évite le piège classique de Image.crossOrigin
 *     qui échoue silencieusement avec dimensions 0×0.
 *   - canvas avec fond blanc opaque (pour neutraliser la transparence —
 *     les PDFs sont sur fond blanc).
 *   - sortie JPEG (parser jsPDF plus tolérant que le PNG).
 *   - détection des data URL invalides ("data:," = canvas trop grand).
 *
 * @param {string} url - URL de l'image (https:// ou /chemin local)
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 *   La chaîne data URL JPEG + les dimensions naturelles de l'image.
 *   Reject si chargement / encoding échoue.
 */
export async function loadImageAsJpeg(url) {
  if (!url) throw new Error('loadImageAsJpeg: url manquante')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`loadImageAsJpeg: HTTP ${res.status} sur ${url}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 0
          const h = img.naturalHeight || img.height || 0
          if (!w || !h) {
            reject(new Error('loadImageAsJpeg: image vide (0x0)'))
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
          if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length < 100) {
            reject(new Error(
              `loadImageAsJpeg: toDataURL retourne un data URL invalide (${dataUrl?.length || 0} chars) ` +
              `pour image ${w}×${h}. L'image est probablement trop grande pour le canvas du navigateur ` +
              `(redimensionner < 4000 px).`
            ))
            return
          }
          resolve({ dataUrl, width: w, height: h })
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error(`loadImageAsJpeg: échec décodage ${url}`))
      img.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Calcule les dimensions de rendu PDF d'une image en respectant son
 * ratio naturel, contraint à une boîte max W × H.
 *
 * @param {number} naturalW - Largeur naturelle de l'image (px)
 * @param {number} naturalH - Hauteur naturelle de l'image (px)
 * @param {number} maxW - Largeur max de la boîte de rendu (mm)
 * @param {number} maxH - Hauteur max de la boîte de rendu (mm)
 * @returns {{width: number, height: number}} - Dimensions de rendu (mm)
 */
export function computeLogoBox(naturalW, naturalH, maxW, maxH) {
  const ratio = naturalW / naturalH
  if (ratio > maxW / maxH) {
    // Image plus large que la boîte → on contraint par la largeur
    return { width: maxW, height: maxW / ratio }
  }
  // Image plus carrée → on contraint par la hauteur
  return { width: maxH * ratio, height: maxH }
}
