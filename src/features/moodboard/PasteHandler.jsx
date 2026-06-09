// ════════════════════════════════════════════════════════════════════════════
// PasteHandler — Capture paste-anywhere + drop fichiers (MOD-1.8)
// ════════════════════════════════════════════════════════════════════════════
//
// Composant utilitaire SANS RENDU qui écoute au niveau document :
//   - paste (Ctrl+V) : URL texte → carte link (avec og-fetch)
//                       image clipboard → upload + carte image
//   - drop fichier : image/video → upload + carte
//                    texte URL → carte link
//
// Crée les cartes dans la 1re section (généralement "Vrac" auto-créée).
// Multi-URL : si on paste 5 URLs séparées par newlines, on crée 5 cartes.
//
// Aucune UI visible : juste un overlay d'indication "Glisse pour ajouter"
// quand un drag fichier survole la page.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  createCard,
  fetchUrlMetadata,
  uploadCardFile,
  extractUrlsFromText,
  isLikelyUrl,
} from '../../lib/moodboard'
import { notify } from '../../lib/notify'

export default function PasteHandler({ projectId, sections, onCreated }) {
  // On garde une ref vers la liste de sections (pour usage dans handlers
  // qui sont registered une seule fois)
  const sectionsRef = useRef(sections)
  useEffect(() => {
    sectionsRef.current = sections
  }, [sections])

  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Cherche la section par défaut (1re section, ou "Vrac" si présente)
  function defaultSection() {
    const list = sectionsRef.current || []
    if (list.length === 0) return null
    const vrac = list.find((s) => s.nom?.toLowerCase() === 'vrac')
    return vrac || list[0]
  }

  // Crée 1 carte link en fetchant les metadata (best-effort).
  async function createLinkCard(url) {
    const target = defaultSection()
    if (!target) {
      notify.error('Aucune section disponible — crée-en une d\'abord')
      return null
    }
    let meta = null
    try {
      meta = await fetchUrlMetadata(url)
    } catch (e) {
      console.warn('[PasteHandler] og-fetch KO', e)
      // Fallback : carte avec juste l'URL
    }
    try {
      const card = await createCard(target.id, {
        type: 'link',
        url,
        title: meta?.title || url,
        description: meta?.description || null,
        image_url: meta?.image_url || null,
        oembed_html: meta?.oembed_html || null,
        provider: meta?.provider || null,
      })
      return card
    } catch (e) {
      notify.error(e?.message || 'Création carte impossible')
      return null
    }
  }

  // Crée 1 carte image ou video à partir d'un File / Blob.
  async function createMediaCard(file) {
    const target = defaultSection()
    if (!target) {
      notify.error('Aucune section disponible — crée-en une d\'abord')
      return null
    }
    const mime = (file.type || '').toLowerCase()
    const isImage = mime.startsWith('image/')
    const isVideo = mime.startsWith('video/')
    if (!isImage && !isVideo) {
      notify.error(`Type non supporté : ${mime || 'inconnu'}`)
      return null
    }
    const type = isImage ? 'image' : 'video'
    // Cap taille : 50 Mo
    const MAX = 50 * 1024 * 1024
    if (file.size > MAX) {
      notify.error(
        `Fichier trop gros (${Math.round(file.size / 1024 / 1024)} Mo, max 50)`,
      )
      return null
    }
    try {
      // On crée la card d'abord (avec un file_path temporaire = on upload
      // ensuite et on patch). Plus simple : on commence par générer un
      // UUID côté JS, on upload, puis on crée la card avec la bonne URL.
      const tmpId = crypto.randomUUID()
      const { file_path, public_url } = await uploadCardFile(
        projectId,
        tmpId,
        file,
      )
      const card = await createCard(target.id, {
        type,
        title: file.name || null,
        file_path,
        image_url: public_url,
      })
      return card
    } catch (e) {
      notify.error(e?.message || 'Upload KO')
      return null
    }
  }

  // ─── Listeners ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined

    async function handlePaste(e) {
      // Si on est dans un input/textarea/contenteditable → ne PAS intercepter
      const target = e.target
      if (target && isEditableElement(target)) return

      const cd = e.clipboardData
      if (!cd) return

      // 1) Images dans le clipboard ?
      const items = Array.from(cd.items || [])
      const imageItems = items.filter((it) => it.type?.startsWith('image/'))
      if (imageItems.length > 0) {
        e.preventDefault()
        const created = []
        for (const it of imageItems) {
          const file = it.getAsFile()
          if (!file) continue
          // Nomme l'image pour qu'on ait une extension dans le path
          const ext = it.type.split('/')[1] || 'png'
          const renamed = new File(
            [file],
            file.name || `clipboard-${Date.now()}.${ext}`,
            { type: file.type },
          )
          const card = await createMediaCard(renamed)
          if (card) created.push(card)
        }
        if (created.length > 0) {
          notify.success(
            `${created.length} carte${created.length > 1 ? 's' : ''} ajoutée${created.length > 1 ? 's' : ''}`,
            false,
          )
          onCreated?.()
        }
        return
      }

      // 2) Texte avec URLs ?
      const text = cd.getData('text/plain')
      if (text) {
        const urls = extractUrlsFromText(text)
        if (urls.length === 0 && isLikelyUrl(text.trim())) {
          urls.push(text.trim())
        }
        if (urls.length > 0) {
          e.preventDefault()
          let ok = 0
          for (const url of urls) {
            const card = await createLinkCard(url)
            if (card) ok += 1
          }
          if (ok > 0) {
            notify.success(
              `${ok} carte${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`,
              false,
            )
            onCreated?.()
          }
        }
      }
    }

    function handleDragEnter(e) {
      // On compte les entrées pour gérer correctement dragenter/dragleave qui
      // se déclenchent sur les enfants
      if (!hasFiles(e)) return
      dragCounterRef.current += 1
      if (dragCounterRef.current === 1) setDragActive(true)
    }

    function handleDragOver(e) {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    function handleDragLeave(e) {
      if (!hasFiles(e)) return
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) setDragActive(false)
    }

    async function handleDrop(e) {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = 0
      setDragActive(false)
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length === 0) return
      let ok = 0
      for (const f of files) {
        const card = await createMediaCard(f)
        if (card) ok += 1
      }
      if (ok > 0) {
        notify.success(
          `${ok} carte${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`,
          false,
        )
        onCreated?.()
      }
    }

    document.addEventListener('paste', handlePaste)
    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('paste', handlePaste)
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (!dragActive) return null

  // ─── Overlay d'indication pendant un drag fichier ────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(59,130,246,0.10)',
        border: '4px dashed var(--blue, #3B82F6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '20px 36px',
          background: 'var(--bg-surf)',
          border: '1px solid var(--blue, #3B82F6)',
          borderRadius: 10,
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--blue, #3B82F6)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        Lâche pour ajouter au Moodboard
      </div>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isEditableElement(el) {
  if (!el) return false
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  // Tiptap monte un .ProseMirror contenteditable — couvert par isContentEditable
  return false
}

function hasFiles(e) {
  return (
    e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).includes('Files')
  )
}
