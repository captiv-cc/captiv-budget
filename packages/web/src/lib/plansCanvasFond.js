// ════════════════════════════════════════════════════════════════════════════
// plansCanvasFond — fonds de plan + assets tldraw résolus côté client
// ════════════════════════════════════════════════════════════════════════════
//
// Principe : on ne met JAMAIS d'URL (signée, expirable) ni de base64 dans le
// document Yjs. Les assets tldraw synchronisés portent uniquement un chemin
// storage dans meta (captivStoragePath) ; chaque client télécharge le fichier
// (authentifié via RLS storage) et le résout en object URL local via le
// TLAssetStore custom (makeCaptivAssetStore).
//
// Fonds PDF : rasterisés page 1 via pdfjs-dist (lazy import, même pattern que
// plansThumbnail) à une échelle bornée (~2500px max) — chaque client
// rasterise localement, le doc ne contient que le chemin.
//
// Ce module vit dans le chunk PlanEditor (importé uniquement par lui).
// ════════════════════════════════════════════════════════════════════════════

import { AssetRecordType, createShapeId } from 'tldraw'
import { supabase } from './supabase'

const BUCKET = 'plans'
const PDF_MAX_DIM = 2500

// Cache par chemin storage : Promise<{ url, w, h, mime }> — un seul download
// / rasterisation par session même si resolve() est rappelé (zoom, re-render).
const mediaCache = new Map()

/* ─── pdfjs lazy (même pattern que plansThumbnail) ──────────────────────── */

let pdfjsLibPromise = null
async function getPdfJs() {
  if (pdfjsLibPromise) return pdfjsLibPromise
  pdfjsLibPromise = (async () => {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })()
  return pdfjsLibPromise
}

/* ─── Téléchargement + mesure ───────────────────────────────────────────── */

async function loadMedia(storagePath, kind) {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw error

  if (kind === 'pdf') {
    const pdfjs = await getPdfJs()
    const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
    try {
      const page = await pdf.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.max(0.5, Math.min(2, PDF_MAX_DIM / Math.max(base.width, base.height)))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return {
        url: URL.createObjectURL(png),
        w: canvas.width,
        h: canvas.height,
        mime: 'image/png',
      }
    } finally {
      try {
        pdf.destroy()
      } catch {
        /* noop */
      }
    }
  }

  // Image native (png/jpg)
  const url = URL.createObjectURL(blob)
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = url
  })
  return { url, w: img.naturalWidth, h: img.naturalHeight, mime: blob.type || 'image/png' }
}

/** Média d'un chemin storage, mémoïsé. kind: 'image' | 'pdf'. */
export function getMediaForPath(storagePath, kind = 'image') {
  const key = `${kind}:${storagePath}`
  if (!mediaCache.has(key)) {
    const p = loadMedia(storagePath, kind).catch((err) => {
      mediaCache.delete(key) // retry possible au prochain resolve
      throw err
    })
    mediaCache.set(key, p)
  }
  return mediaCache.get(key)
}

/* ─── TLAssetStore custom ───────────────────────────────────────────────── */

/**
 * Asset store branché sur le bucket plans.
 * - resolve : les assets portant meta.captivStoragePath sont téléchargés et
 *   résolus en object URL locale (fond de plan, images collées).
 * - upload : une image collée/déposée dans le canvas est stockée dans le
 *   bucket sous <project_id>/canvas/<canvas_id>/ (RLS : 1er segment =
 *   project_id) ; seul le chemin circule dans le doc.
 *
 * getContext() est un getter (la row canvas charge après la création du
 * store) : () => ({ projectId, canvasId }).
 */
export function makeCaptivAssetStore(getContext) {
  return {
    async upload(asset, file) {
      const { projectId, canvasId } = getContext() || {}
      if (!projectId || !canvasId) throw new Error('Plan non chargé, réessaie dans un instant')
      const safeName = (file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      const path = `${projectId}/canvas/${canvasId}/${crypto.randomUUID()}-${safeName}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
      })
      if (error) throw error
      return { src: null, meta: { captivStoragePath: path, captivKind: 'image' } }
    },

    resolve(asset) {
      const path = asset.meta?.captivStoragePath
      if (!path) return asset.props.src ?? null
      return getMediaForPath(path, asset.meta?.captivKind || 'image').then((m) => m.url)
    },
  }
}

/* ─── Fond de plan : shape image verrouillée en arrière-plan ────────────── */

export const FOND_SHAPE_ID = createShapeId('fond')
export const FOND_ASSET_ID = AssetRecordType.createId('fond')

/**
 * Insère le fond de plan (fichier de la bibliothèque plans) dans le canvas :
 * asset (chemin storage en meta) + shape image verrouillée envoyée derrière.
 * Idempotent : ids déterministes ('shape:fond' / 'asset:fond') — si deux
 * clients ouvrent en même temps, le CRDT converge sur des records identiques.
 *
 * @param {Editor} editor — instance tldraw (onMount)
 * @param {object} fondRow — row de la table plans (storage_path, file_type, name)
 */
export async function ensureFondShape(editor, fondRow) {
  if (!editor || !fondRow?.storage_path) return
  if (editor.getShape(FOND_SHAPE_ID)) return

  const kind = fondRow.file_type === 'pdf' ? 'pdf' : 'image'
  const media = await getMediaForPath(fondRow.storage_path, kind)

  // Re-check après l'await : la sync Yjs a pu apporter le fond entre-temps.
  if (editor.getShape(FOND_SHAPE_ID)) return

  editor.createAssets([
    {
      id: FOND_ASSET_ID,
      typeName: 'asset',
      type: 'image',
      props: {
        name: fondRow.name || 'Fond de plan',
        src: null,
        w: media.w,
        h: media.h,
        mimeType: media.mime,
        isAnimated: false,
      },
      meta: { captivStoragePath: fondRow.storage_path, captivKind: kind },
    },
  ])
  editor.createShape({
    id: FOND_SHAPE_ID,
    type: 'image',
    x: 0,
    y: 0,
    props: { w: media.w, h: media.h, assetId: FOND_ASSET_ID },
  })
  editor.sendToBack([FOND_SHAPE_ID])
  // Verrouillé APRÈS le sendToBack (les shapes verrouillées ignorent les
  // opérations de réordonnancement).
  editor.updateShape({ id: FOND_SHAPE_ID, type: 'image', isLocked: true })
  editor.zoomToFit()
}
