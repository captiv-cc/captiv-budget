// ════════════════════════════════════════════════════════════════════════════
// UnifiedSearchBar — Barre de recherche unifiée Musiques
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.8
//
// Une seule barre de recherche qui détecte automatiquement le mode :
//   1. Texte libre        → search Deezer (Edge Function)
//   2. URL YouTube collée → oEmbed YouTube + lookup match Deezer
//   3. [Futur MVP5]       → recherche en langage naturel (Claude + Deezer)
//
// Le composant ne rend QUE le champ input. La gestion des résultats est
// laissée au parent (AddProposition modal), via le callback onResolve.
// Cette séparation permet de réutiliser la barre dans d'autres contextes
// futurs (search globale, ajout rapide depuis une autre vue, etc.).
//
// Props :
//   - value (string)         : valeur contrôlée
//   - onChange (text => void) : édition du texte
//   - onResolve (result => void) : appelé après debounce 300ms avec
//       { kind: 'empty' | 'deezer' | 'youtube' | 'error',
//         tracks?: [], video_id?, video_title?, artiste?, titre?, error? }
//   - autoFocus, placeholder, isBusy (optionnels)
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { Search, Sparkles, Loader2 } from 'lucide-react'
import { resolveQuery } from '../../lib/musiqueSearch'
import { isYouTubeUrl } from '../../lib/youtubeOEmbed'

const DEBOUNCE_MS = 300

export default function UnifiedSearchBar({
  value = '',
  onChange,
  onResolve,
  placeholder = 'Rechercher un titre, artiste, coller un lien YouTube…',
  autoFocus = false,
  // isBusy : permet au parent de signaler une op externe en cours (ex :
  // ajout d'une proposition après click sur un résultat) qui doit montrer
  // le spinner même si la recherche est idle.
  isBusy = false,
  disabled = false,
}) {
  // ─── État local pour le spinner pendant le debounce/résolution ──────────
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)

  // ─── Debounce + dispatch ─────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = (value || '').trim()
    if (!trimmed) {
      // Reset immédiat (pas de debounce)
      onResolve?.({ kind: 'empty' })
      return undefined
    }
    // Si c'est manifestement une URL YouTube, on déclenche tout de suite
    // (sans attendre la fin du typing — paste = action ponctuelle).
    const isUrl = isYouTubeUrl(trimmed)
    const delay = isUrl ? 0 : DEBOUNCE_MS
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current
      try {
        const result = await resolveQuery(trimmed)
        // On ignore le résultat si une nouvelle requête a été lancée
        // entre temps (anti-stale).
        if (reqId !== reqIdRef.current) return
        onResolve?.(result || { kind: 'empty' })
      } catch (err) {
        if (reqId !== reqIdRef.current) return
        onResolve?.({
          kind: 'error',
          error: err?.message || 'Erreur de recherche',
        })
      }
    }, delay)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // onResolve est intentionnellement omis des deps (sinon on re-déclenche
    // à chaque ré-render parent — le contrat est "appelle-moi quand value
    // change"). Le parent doit garder onResolve stable (useCallback) ou
    // s'attendre au comportement actuel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ─── Auto-focus au mount ────────────────────────────────────────────────
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 40,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Search
        size={15}
        style={{
          color: 'var(--txt-3)',
          flexShrink: 0,
        }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--txt)',
          fontSize: 14,
          minWidth: 0,
        }}
      />
      {isBusy ? (
        <Loader2
          size={14}
          style={{
            color: 'var(--blue, #3B82F6)',
            animation: 'spin 1s linear infinite',
            flexShrink: 0,
          }}
        />
      ) : (
        <Sparkles
          size={13}
          style={{
            color: 'var(--txt-3)',
            opacity: 0.4,
            flexShrink: 0,
          }}
          title="Recherche intelligente — bientôt (MVP5)"
        />
      )}
      {/* Animation spin déclarée localement pour ne pas dépendre du CSS global */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
