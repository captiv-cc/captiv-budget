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
 *   - kind : 'probleme' | 'pack' | 'retour'  (XOR anchor implied)
 *     — 'retour' est MAT-13D, utilisé uniquement en phase rendu
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
 *   - readOnly : boolean (optionnel)         mode consultation pure (MAT-13D).
 *                                             En rendu, on affiche les photos
 *                                             essais (pack + problème) pour
 *                                             traçabilité sans permettre d'ajout,
 *                                             ni suppression, ni édition de
 *                                             légende. Implique hideUploader,
 *                                             et désactive les actions dans le
 *                                             lightbox (delete + caption edit).
 *                                             Le lightbox et la grille restent
 *                                             ouvrables (consultation vignettes
 *                                             + plein écran).
 *
 * Pas de gestion d'état photos elle-même : le parent (hook useCheck*Session)
 * est source de vérité. L'uploader appelle `onUpload` → le hook append dans
 * `session.photos` → re-render avec la nouvelle photo.
 *
 * Limite 10 photos par ancrage : enforcée côté DB (fonction
 * `_matos_photo_enforce_limit`). Ici on affiche juste un message + disable
 * le bouton quand on atteint la limite pour éviter la RPC qui lèverait.
 *
 * Polish MAT-11F :
 *   - Toutes les erreurs (upload, delete, caption) passent par
 *     `humanizePhotoError` → messages FR lisibles au lieu du brut
 *     PostgrestError / StorageError.
 *   - Skeleton shimmer pendant le chargement des signed URLs (gradient
 *     animate-pulse au lieu d'un loader centré).
 *   - Bandeau "Aperçus indisponibles + Recharger" quand TOUTES les signed
 *     URLs foirent (réseau down, token expiré, bucket KO).
 *   - Compteur `count/MAX` coloré : orange à partir de 8/10, rouge à 10/10
 *     pour signaler l'approche de la limite avant le blocage.
 *   - Double-barrière sur `atLimit` : disable le bouton + check au submit
 *     (si jamais le bouton était bypassé).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Loader2, RefreshCcw, Sparkles, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'

import {
  MAX_PHOTOS_PER_ANCHOR,
  ACCEPTED_MIME_TYPES,
  getPhotoThumbnailUrl,
  getPhotoUrl,
  humanizePhotoError,
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
  readOnly = false,
}) {
  // En mode readOnly (MAT-13D, consultation essais depuis la phase rendu),
  // on force hideUploader et on désactive toutes les actions destructives du
  // lightbox. L'user peut toujours tap sur une vignette pour voir la photo
  // plein écran (usage principal de la consultation).
  const uploaderHidden = hideUploader || readOnly
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
  // la liste photos. Map photo.id → { thumb, full }. `refreshKey` permet
  // de re-générer à la demande (si on a eu un 403 / lien expiré — rare).
  const [urls, setUrls] = useState(new Map())
  const [urlsLoading, setUrlsLoading] = useState(false)
  // `urlsError` : true si le batch de signed URLs s'est entièrement vautré
  // (ex. token storage expiré, réseau coupé, bucket indispo). Permet d'afficher
  // un petit bouton "recharger les aperçus" au lieu d'un grid de placeholders
  // gris. Reset à chaque reload effectif.
  const [urlsError, setUrlsError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRetryUrls = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (photos.length === 0) {
        setUrls(new Map())
        setUrlsError(false)
        return
      }
      setUrlsLoading(true)
      setUrlsError(false)
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
        if (!cancelled) {
          const map = new Map(entries)
          setUrls(map)
          // Signale une erreur globale si AUCUNE url n'a pu être générée
          // alors qu'on avait des photos (problème réseau / bucket / token).
          const allFailed = photos.length > 0 && [...map.values()].every(
            (v) => !v?.thumb && !v?.full,
          )
          setUrlsError(allFailed)
        }
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
      // Défense en profondeur : si le bouton a été cliqué par bypass JS alors
      // qu'on est déjà au quota (atLimit recalculé au render), on bloque net.
      if (count >= MAX_PHOTOS_PER_ANCHOR) {
        toast.error(
          `Limite de ${MAX_PHOTOS_PER_ANCHOR} photos atteinte sur cet élément.`,
        )
        return
      }
      // On borne la sélection : si on a déjà 7 photos et que l'user pique 5,
      // on n'upload que les 3 premiers. Toast info (pas d'erreur).
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
      let rejectedCount = 0
      for (const file of toUpload) {
        // Validation locale (taille + MIME) avant d'embêter le pipeline image.
        const validationError = validatePhotoFile(file)
        if (validationError) {
          toast.error(
            humanizePhotoError(validationError, { prefix: file.name || 'Photo' }),
          )
          rejectedCount += 1
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
          toast.error(
            humanizePhotoError(err, { prefix: file.name || 'Photo' }),
            { duration: 5000 },
          )
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
      // Si on a tout rejeté et rien n'est passé, un hint final : l'user voit
      // que la sélection n'a abouti à rien (évite une impression de silence).
      if (successCount === 0 && rejectedCount > 0 && toUpload.length > 1) {
        toast(
          `${rejectedCount} fichier${rejectedCount > 1 ? 's' : ''} non ajouté${
            rejectedCount > 1 ? 's' : ''
          }.`,
          { icon: '⚠️' },
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
        toast.error(humanizePhotoError(err))
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
        toast.error(humanizePhotoError(err))
      }
    },
    [captionBody, onUpdateCaption],
  )

  // Photo active dans le lightbox (pour l'overlay actions). En readOnly
  // (consultation rendu, MAT-13D-bis) on ne peut jamais "gérer" la photo
  // même si on en est propriétaire : pas de bouton delete, pas d'édition
  // de légende — juste visionnage plein écran.
  const activePhoto = lightboxIndex >= 0 ? photos[lightboxIndex] : null
  const canManageActive =
    activePhoto && !readOnly
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
          {kind === 'pack'
            ? 'Photos pack'
            : kind === 'retour'
              ? 'Photos retour'
              : 'Photos problème'}
          {count > 0 && (
            <span
              className="tabular-nums"
              // Passe en orange quand on est proche (>=80%) et en rouge plein
              // quand on est à la limite exacte — signal visuel pour anticiper.
              style={{
                color: atLimit
                  ? 'var(--red, #c0392b)'
                  : count >= MAX_PHOTOS_PER_ANCHOR - 2
                    ? 'var(--orange, #c47f17)'
                    : 'var(--txt-3)',
              }}
            >
              · {count}/{MAX_PHOTOS_PER_ANCHOR}
            </span>
          )}
        </span>

        <div className="flex-1" />

        {/* Uploader (Orig. + Ajouter + file input) — caché si hideUploader
            OU readOnly. Utilisé en mode preview au-dessus du bloc (MAT-23E)
            ou en consultation pure depuis la phase rendu (MAT-13D). */}
        {!uploaderHidden && (
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
              : kind === 'retour'
                ? "Aucune photo retour. Photographier l'état du matériel au retour loueur."
                : 'Aucune photo. Photographier un défaut ou une remarque.')}
        </p>
      ) : (
        <>
          {/* Bandeau d'erreur batch URLs + bouton retry — affiché SEULEMENT
              quand aucun thumb n'a pu être généré. Pour un échec partiel
              (certains thumbs OK) on laisse juste les placeholders par photo
              pour ne pas polluer l'UI. */}
          {urlsError && !urlsLoading && (
            <div
              className="flex items-center gap-2 px-2 py-1.5 mb-2 rounded-md text-xs"
              style={{
                background: 'var(--orange-bg, rgba(230, 138, 0, 0.1))',
                border: '1px solid var(--orange-brd, rgba(230, 138, 0, 0.3))',
                color: 'var(--orange, #c47f17)',
              }}
            >
              <span className="flex-1">
                Aperçus indisponibles. Lien expiré ou réseau interrompu.
              </span>
              <button
                type="button"
                onClick={handleRetryUrls}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
                style={{
                  background: 'transparent',
                  border: '1px solid currentColor',
                  color: 'inherit',
                }}
                aria-label="Recharger les aperçus"
              >
                <RefreshCcw className="w-3 h-3" />
                Recharger
              </button>
            </div>
          )}

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
                className={`relative rounded-md overflow-hidden ${
                  !thumbUrl && urlsLoading ? 'animate-pulse' : ''
                }`}
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
                    // Si la CDN drop l'image (rare : lien signé expiré entre
                    // render et onload), on laisse le bg-surf + icône prendre
                    // le dessus via display:none — pas de broken-image icon
                    // disgracieux.
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                ) : urlsLoading ? (
                  // Skeleton shimmer : gradient subtil qui pulse pendant le
                  // chargement des signed URLs. Aucun icône — le animate-pulse
                  // sur le bouton parent donne le feedback de chargement.
                  <div
                    className="w-full h-full"
                    style={{
                      background:
                        'linear-gradient(135deg, var(--bg-surf) 0%, var(--bg-hov, rgba(128,128,128,0.1)) 50%, var(--bg-surf) 100%)',
                    }}
                    aria-label="Chargement de l'aperçu"
                  />
                ) : (
                  // Fallback final : URL non générée ET pas en loading
                  // → probablement échec de la signed URL pour cette photo.
                  // Icône camera + fond neutre.
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ color: 'var(--txt-3)' }}
                    title="Aperçu indisponible — photo toujours stockée"
                  >
                    <Camera className="w-4 h-4" />
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
        </>
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
            // Légende custom sous chaque slide. Éditable si owner/admin —
            // jamais en readOnly (consultation essais depuis rendu).
            slideFooter: ({ slide }) => {
              const p = photos.find((x) => x.id === slide.photoId)
              if (!p) return null
              const editing = captionDraft === p.id
              const canEditCaption =
                !readOnly && (isAdmin || isPhotoOwnedBy(p, userName))
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
