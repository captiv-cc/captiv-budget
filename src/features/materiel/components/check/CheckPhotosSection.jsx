/**
 * CheckPhotosSection — bloc photos générique (MAT-11C).
 *
 * Utilisé à deux endroits de la checklist terrain :
 *   - dans l'expansion d'un CheckItemRow (kind='probleme', ancrage item)
 *   - dans l'en-tête d'un CheckBlockCard     (kind='pack',     ancrage bloc)
 *
 * Responsabilités :
 *   - Uploader : bouton "+ Photo" → <input type="file" multiple> + toggle
 *     "qualité originale" (saute la compression). Accepte HEIC : la lib
 *     matosItemPhotos le transcode toujours en JPEG avant upload.
 *   - Grille de vignettes carrées (signed URLs via transform=240px côté
 *     Supabase Storage, avec fallback full-size si le transform n'est pas
 *     dispo). Tap → ouvre le lightbox plein écran.
 *   - Lightbox (yet-another-react-lightbox) : navigation ← →, pinch-zoom,
 *     caption éditable, delete si le user est le propriétaire ou admin.
 *
 * Props :
 *   - photos : Array<matos_item_photos row>  (pre-filtered for this anchor,
 *     tri chrono ASC de preference)
 *   - kind : 'probleme' | 'pack'             (XOR anchor implied)
 *   - anchor : { itemId } | { blockId }      (exactement l'un des deux)
 *   - userName : string                      (identité anon/authed pour
 *                                             ownership matching)
 *   - isAdmin : boolean                      (true en mode authed check admin ;
 *                                             false sur /check/:token → on
 *                                             tombe sur le match uploaded_by_name)
 *   - onUpload : ({itemId?, blockId?, kind, file, caption, originalQuality}) => Promise<photo>
 *   - onDelete : ({photoId}) => Promise
 *   - onUpdateCaption : ({photoId, caption}) => Promise
 *   - compact : boolean (optionnel)          si true, rendu inline plus dense
 *                                             (header de bloc). Par défaut false
 *                                             (panneau item élargi).
 *   - emptyLabel : string (optionnel)        message si 0 photo.
 *   - hideUploader : boolean (optionnel)     si true, cache la checkbox Orig.
 *                                             ET le bouton "Ajouter". Utile en
 *                                             mode "preview" au-dessus du bloc
 *                                             (MAT-23E) où l'ajout se fait via
 *                                             le menu ⋯ dans une section
 *                                             éditable dédiée.
 *
 * Pas de gestion d'état photos elle-même : le parent (hook useCheck*Session)
 * est source de vérité. L'uploader appelle `onUpload` → le hook append dans
 * `session.photos` → re-render avec la nouvelle photo.
 *
 * Limite 10 photos par ancrage : enforcée côté DB (fonction
 * `_matos_photo_enforce_limit`). Ici on affiche juste un message + disable
 * le bouton quand on atteint la limite pour éviter la RPC qui lèverait.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'

import {
  MAX_PHOTOS_PER_ANCHOR,
  ACCEPTED_MIME_TYPES,
  getPhotoThumbnailUrl,
  getPhotoUrl,
  isPhotoOwnedBy,
  validatePhotoFile,
} from '../../../../lib/matosItemPhotos'

const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(',') + ',.heic,.heif'

export default function CheckPhotosSection({
  photos = [],
  kind,
  anchor = {},
  userName = null,
  isAdmin = false,
  onUpload,
  onDelete,
  onUpdateCaption,
  compact = false,
  emptyLabel = null,
  hideUploader = false,
}) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [originalQuality, setOriginalQuality] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(-1) // -1 = fermé
  const [captionDraft, setCaptionDraft] = useState(null) // photoId en cours d'edit OU null
  const [captionBody, setCaptionBody] = useState('')

  const count = photos.length
  const atLimit = count >= MAX_PHOTOS_PER_ANCHOR
  const { itemId = null, blockId = null } = anchor

  // ─── Signed URLs (thumbs + full) ────────────────────────────────────────
  //
  // Les URLs signées Supabase ont une durée de vie (1h par défaut, cf.
  // getPhotoUrl). On les recharge en un batch au mount + à chaque change de
  // la liste photos. Map photo.id → { thumb, full }. Un `refreshKey` permet
  // de re-générer à la demande (si on a eu un 403 / lien expiré — rare).
  const [urls, setUrls] = useState(new Map())
  const [urlsLoading, setUrlsLoading] = useState(false)
  // `refreshKey` reste un hook à part pour permettre un reload manuel
  // (ex. si on ajoute un bouton "recharger" suite à des 403 liés à un
  // token expiré). Le setter n'est pas exposé pour l'instant — on le
  // préfixe `_` pour le documenter sans faire râler le linter.
  const [refreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (photos.length === 0) {
        setUrls(new Map())
        return
      }
      setUrlsLoading(true)
      try {
        const entries = await Promise.all(
          photos.map(async (p) => {
            try {
              const [thumb, full] = await Promise.all([
                getPhotoThumbnailUrl(p.storage_path, { size: 320 }),
                getPhotoUrl(p.storage_path),
              ])
              return [p.id, { thumb, full }]
            } catch {
              return [p.id, { thumb: null, full: null }]
            }
          }),
        )
        if (!cancelled) setUrls(new Map(entries))
      } finally {
        if (!cancelled) setUrlsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // `refreshKey` sert à forcer un reload manuel. On dépend aussi des id
    // uniquement (pas des rows complètes) pour éviter un reload à chaque
    // patchPhoto (ex. édition de caption).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.map((p) => p.id).join('|'), refreshKey])

  // ─── Slides pour le lightbox ────────────────────────────────────────────
  //
  // Format YARL : { src, alt, description }. On tombe sur un placeholder
  // transparent 1x1 si l'URL n'est pas encore prête (loading).
  const slides = useMemo(() => {
    return photos.map((p) => {
      const url = urls.get(p.id)?.full || null
      return {
        src: url || TRANSPARENT_PIXEL,
        alt: p.caption || 'Photo',
        description: p.caption || '',
        // Métadonnées custom (pas utilisées par YARL mais utiles à nos
        // handlers : on retrouve l'id de la photo courante).
        photoId: p.id,
        uploadedByName: p.uploaded_by_name,
        createdAt: p.created_at,
      }
    })
  }, [photos, urls])

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handlePick = useCallback(() => {
    if (atLimit || uploading) return
    fileInputRef.current?.click()
  }, [atLimit, uploading])

  const handleFilesSelected = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || [])
      event.target.value = '' // permet de re-choisir le même fichier plus tard
      if (files.length === 0) return
      // On borne la sélection : si on a déjà 7 photos et que l'user pique 5,
      // on n'upload que les 3 premiers. Simple, pas de toast intrusif.
      const remaining = Math.max(0, MAX_PHOTOS_PER_ANCHOR - count)
      const toUpload = files.slice(0, remaining)
      if (files.length > remaining) {
        toast(
          `Limite de ${MAX_PHOTOS_PER_ANCHOR} photos atteinte. ${toUpload.length}/${files.length} seront ajoutées.`,
          { icon: 'ℹ️' },
        )
      }
      if (toUpload.length === 0) return

      setUploading(true)
      let successCount = 0
      for (const file of toUpload) {
        // Validation locale (taille + MIME) avant d'embêter le pipeline image.
        const validationError = validatePhotoFile(file)
        if (validationError) {
          toast.error(`${file.name} : ${validationError}`)
          continue
        }
        try {
          await onUpload({
            itemId,
            blockId,
            kind,
            file,
            caption: null,
            originalQuality,
          })
          successCount += 1
        } catch (err) {
          console.error('[CheckPhotosSection] upload failed', err)
          toast.error(`${file.name} : ${err?.message || 'Upload échoué'}`)
        }
      }
      setUploading(false)
      if (successCount > 0) {
        toast.success(
          successCount === 1
            ? '1 photo ajoutée'
            : `${successCount} photos ajoutées`,
        )
      }
    },
    // `atLimit` est dérivé de `count` — `count` est déjà dans les deps donc
    // atLimit l'est implicitement (lint ne veut pas le voir nommé 2 fois).
    [blockId, count, itemId, kind, onUpload, originalQuality],
  )

  const handleOpenLightbox = useCallback((index) => {
    setLightboxIndex(index)
  }, [])

  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(-1)
    setCaptionDraft(null)
  }, [])

  const handleDeletePhoto = useCallback(
    async (photo) => {
      const confirmed = window.confirm(
        'Supprimer cette photo ? Cette action est irréversible.',
      )
      if (!confirmed) return
      try {
        await onDelete({ photoId: photo.id })
        toast.success('Photo supprimée')
        // Si on supprimait la dernière photo du lightbox, on ferme.
        if (photos.length === 1) handleCloseLightbox()
      } catch (err) {
        console.error('[CheckPhotosSection] delete failed', err)
        toast.error(err?.message || 'Suppression échouée')
      }
    },
    [onDelete, photos.length, handleCloseLightbox],
  )

  const handleBeginCaptionEdit = useCallback((photo) => {
    setCaptionDraft(photo.id)
    setCaptionBody(photo.caption || '')
  }, [])

  const handleSaveCaption = useCallback(
    async (photo) => {
      const next = captionBody.trim() || null
      if (next === (photo.caption || null)) {
        setCaptionDraft(null)
        return
      }
      try {
        await onUpdateCaption({ photoId: photo.id, caption: next })
        setCaptionDraft(null)
        toast.success('Légende enregistrée')
      } catch (err) {
        console.error('[CheckPhotosSection] updateCaption failed', err)
        toast.error(err?.message || 'Légende non enregistrée')
      }
    },
    [captionBody, onUpdateCaption],
  )

  // Photo active dans le lightbox (pour l'overlay actions)
  const activePhoto = lightboxIndex >= 0 ? photos[lightboxIndex] : null
  const canManageActive = activePhoto
    ? isAdmin || isPhotoOwnedBy(activePhoto, userName)
    : false

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className={compact ? 'px-4 py-2' : 'px-4 py-3'}
      style={{
        background: compact ? 'transparent' : 'var(--bg)',
        borderTop: compact ? 'none' : '1px solid var(--brd-sub)',
      }}
    >
      {/* Header (label + counter + uploader) ───────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs font-medium uppercase tracking-wide flex items-center gap-1.5"
          style={{ color: 'var(--txt-2)' }}
        >
          <Camera className="w-3.5 h-3.5" />
          {kind === 'pack' ? 'Photos pack' : 'Photos problème'}
          {count > 0 && (
            <span className="tabular-nums" style={{ color: 'var(--txt-3)' }}>
              · {count}/{MAX_PHOTOS_PER_ANCHOR}
            </span>
          )}
        </span>

        <div className="flex-1" />

        {/* Uploader (Orig. + Ajouter + file input) — caché si hideUploader.
            Utilisé en mode preview au-dessus du bloc (MAT-23E) : l'ajout
            se fait via le menu ⋯ dans une section éditable dédiée. */}
        {!hideUploader && (
          <>
            {/* Toggle qualité originale (petit, subtil) */}
            <label
              className="text-[11px] flex items-center gap-1 cursor-pointer select-none"
              style={{ color: 'var(--txt-3)' }}
              title="Préserver la qualité originale (pas de compression). Taille fichier plus grande."
            >
              <input
                type="checkbox"
                checked={originalQuality}
                onChange={(e) => setOriginalQuality(e.target.checked)}
                className="w-3 h-3"
              />
              <Sparkles className="w-3 h-3" />
              Orig.
            </label>

            {/* Bouton upload */}
            <button
              type="button"
              onClick={handlePick}
              disabled={atLimit || uploading}
              className="text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 transition"
              style={{
                background: atLimit ? 'var(--bg-surf)' : 'var(--blue-bg)',
                color: atLimit ? 'var(--txt-3)' : 'var(--blue)',
                border: `1px solid ${atLimit ? 'var(--brd-sub)' : 'var(--blue-brd)'}`,
                opacity: uploading ? 0.6 : 1,
                cursor: atLimit || uploading ? 'not-allowed' : 'pointer',
              }}
              aria-label="Ajouter une photo"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
              {uploading ? 'Envoi…' : atLimit ? 'Limite atteinte' : 'Ajouter'}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
          </>
        )}
      </div>

      {/* Grille de vignettes ou empty state ─────────────────────────────── */}
      {count === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          {emptyLabel ||
            (kind === 'pack'
              ? 'Aucune photo pack. Servent à documenter le contenu des flight cases (usage interne).'
              : 'Aucune photo. Photographier un défaut ou une remarque.')}
        </p>
      ) : (
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
          }}
        >
          {photos.map((photo, index) => {
            const thumbUrl = urls.get(photo.id)?.thumb
            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => handleOpenLightbox(index)}
                className="relative rounded-md overflow-hidden"
                style={{
                  aspectRatio: '1 / 1',
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd-sub)',
                }}
                aria-label={
                  photo.caption
                    ? `Photo : ${photo.caption}`
                    : `Photo ${index + 1}`
                }
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={photo.caption || ''}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    {urlsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                  </div>
                )}
                {/* Badge caption tronquée si présente */}
                {photo.caption && (
                  <span
                    className="absolute bottom-0 left-0 right-0 text-[9px] px-1 py-0.5 truncate"
                    style={{
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                    }}
                  >
                    {photo.caption}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Lightbox plein écran ──────────────────────────────────────────── */}
      {lightboxIndex >= 0 && (
        <Lightbox
          open
          close={handleCloseLightbox}
          slides={slides}
          index={lightboxIndex}
          on={{
            view: ({ index }) => setLightboxIndex(index),
          }}
          // Overlay custom pour actions (delete / caption) — rendu dans le
          // toolbar YARL. On n'utilise pas de plugin externe pour rester léger.
          toolbar={{
            buttons: [
              canManageActive && activePhoto ? (
                <button
                  key="delete"
                  type="button"
                  className="yarl__button"
                  onClick={() => handleDeletePhoto(activePhoto)}
                  aria-label="Supprimer cette photo"
                  title="Supprimer"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              ) : null,
              'close',
            ].filter(Boolean),
          }}
          styles={{
            // z-index max pour couvrir le shell /check (qui a un header sticky).
            container: { zIndex: 9999 },
          }}
          render={{
            // Légende custom sous chaque slide. Éditable si owner/admin.
            slideFooter: ({ slide }) => {
              const p = photos.find((x) => x.id === slide.photoId)
              if (!p) return null
              const editing = captionDraft === p.id
              const canEditCaption = isAdmin || isPhotoOwnedBy(p, userName)
              return (
                <div
                  className="absolute bottom-0 left-0 right-0 px-4 py-3 pointer-events-auto"
                  style={{
                    background:
                      'linear-gradient(transparent, rgba(0,0,0,0.75))',
                    color: '#fff',
                  }}
                >
                  {editing ? (
                    <div className="flex items-end gap-2 max-w-2xl mx-auto">
                      <textarea
                        value={captionBody}
                        onChange={(e) => setCaptionBody(e.target.value)}
                        placeholder="Légende…"
                        rows={2}
                        className="flex-1 px-2 py-1.5 rounded text-sm resize-none"
                        style={{
                          background: 'rgba(0,0,0,0.6)',
                          border: '1px solid rgba(255,255,255,0.3)',
                          color: '#fff',
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveCaption(p)}
                        className="px-3 py-1.5 rounded text-xs font-medium"
                        style={{
                          background: 'var(--blue)',
                          color: '#fff',
                        }}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptionDraft(null)}
                        className="p-1.5 rounded"
                        style={{
                          background: 'rgba(255,255,255,0.1)',
                          color: '#fff',
                        }}
                        aria-label="Annuler"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="max-w-2xl mx-auto text-center text-sm">
                      {p.caption ? (
                        <p className="whitespace-pre-wrap">{p.caption}</p>
                      ) : (
                        <p className="italic opacity-70">
                          {canEditCaption
                            ? 'Aucune légende — clic pour en ajouter'
                            : 'Aucune légende'}
                        </p>
                      )}
                      <p
                        className="text-xs mt-1"
                        style={{ opacity: 0.7 }}
                      >
                        {p.uploaded_by_name}
                        {p.created_at
                          ? ` · ${formatDateShort(p.created_at)}`
                          : ''}
                      </p>
                      {canEditCaption && (
                        <button
                          type="button"
                          onClick={() => handleBeginCaptionEdit(p)}
                          className="mt-1 text-xs underline opacity-70 hover:opacity-100"
                        >
                          {p.caption ? 'Modifier la légende' : 'Ajouter une légende'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            },
          }}
        />
      )}
    </div>
  )
}

/* ═══ Helpers ═══════════════════════════════════════════════════════════ */

// 1x1 transparent GIF inline — placeholder pendant le chargement de l'URL
// signée pour un slide YARL (évite un broken-image icon).
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function formatDateShort(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
