// ════════════════════════════════════════════════════════════════════════════
// LivrableDetailsDrawer — drawer right-side avec tabs Versions / Étapes (LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Successeur du `LivrableVersionsDrawer` (LIV-8) — on ajoute un onglet
// "Étapes" pour piloter le pipeline post-prod (montage, étalo, son, livraison…).
// L'ancien fichier est remplacé par celui-ci ; le contenu Versions est extrait
// dans `LivrableVersionsPanel`, le contenu Étapes dans `LivrableEtapesPanel`.
//
// Slide-over 560px (desktop) / plein écran (mobile via min(560px, 100vw)).
// Header avec titre + sous-titre dynamique selon l'onglet actif.
// Tabs sous le header. Contenu scrollable (chaque panel gère son footer).
// Backdrop semi-transparent + close on click / Escape / bouton X.
//
// Pattern : aucun portal — on est rendu au niveau racine de `LivrablesTab`,
// pas d'ancêtre overflow:auto.
//
// Props :
//   - livrable     : livrable courant (objet ou null = drawer fermé)
//   - versions     : Array<livrable_version> du livrable
//   - etapes       : Array<livrable_etape> du livrable
//   - eventTypes   : Array<event_type> de l'org (pour le dropdown étape)
//   - actions      : `useLivrables.actions`
//   - canEdit      : booléen
//   - onClose      : () => void
//   - initialTab   : 'versions' | 'etapes' (optionnel, défaut 'versions')
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { History, ListTodo, X } from 'lucide-react'
import LivrableVersionsPanel from './LivrableVersionsPanel'
import LivrableEtapesPanel from './LivrableEtapesPanel'

const TABS = [
  { key: 'versions', label: 'Versions', icon: History },
  { key: 'etapes', label: 'Étapes', icon: ListTodo },
]

export default function LivrableDetailsDrawer({
  livrable,
  versions = [],
  etapes = [],
  eventTypes = [],
  actions,
  canEdit = true,
  onClose,
  initialTab = 'versions',
}) {
  const open = Boolean(livrable)
  const [activeTab, setActiveTab] = useState(initialTab)

  // Reset l'onglet actif à l'ouverture si l'appelant a changé `initialTab`.
  useEffect(() => {
    if (open) setActiveTab(initialTab)
  }, [open, initialTab, livrable?.id])

  // ─── Escape pour fermer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const subtitle =
    activeTab === 'versions'
      ? versions.length === 0
        ? 'Aucune version envoyée'
        : `${versions.length} version${versions.length > 1 ? 's' : ''} envoyée${versions.length > 1 ? 's' : ''}`
      : etapes.length === 0
        ? 'Aucune étape'
        : `${etapes.length} étape${etapes.length > 1 ? 's' : ''}`

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over */}
      <aside
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(560px, 100vw)',
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--brd)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.2)',
        }}
        role="dialog"
        aria-label={`Détails livrable — ${livrable?.nom || 'Livrable'}`}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            {activeTab === 'versions' ? (
              <History className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            ) : (
              <ListTodo className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-bold truncate"
              style={{ color: 'var(--txt)' }}
            >
              {livrable?.nom || livrable?.numero || 'Livrable'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer (Escape)"
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Tabs */}
        <div
          className="flex items-center gap-1 px-3"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          {TABS.map((t) => {
            const Icon = t.icon
            const isActive = activeTab === t.key
            const count = t.key === 'versions' ? versions.length : etapes.length
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors relative"
                style={{
                  color: isActive ? 'var(--txt)' : 'var(--txt-3)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--txt-2)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--txt-3)'
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {count > 0 && (
                  <span
                    className="text-[10px] px-1.5 rounded-full font-semibold tabular-nums"
                    style={{
                      background: isActive ? 'var(--blue-bg)' : 'var(--bg-2)',
                      color: isActive ? 'var(--blue)' : 'var(--txt-3)',
                      minWidth: 18,
                      textAlign: 'center',
                    }}
                  >
                    {count}
                  </span>
                )}
                {isActive && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      bottom: -1,
                      left: 8,
                      right: 8,
                      height: 2,
                      background: 'var(--blue)',
                      borderRadius: '2px 2px 0 0',
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Contenu (le panel gère son scroll + footer) */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'versions' ? (
            <LivrableVersionsPanel
              livrable={livrable}
              versions={versions}
              actions={actions}
              canEdit={canEdit}
            />
          ) : (
            <LivrableEtapesPanel
              livrable={livrable}
              etapes={etapes}
              eventTypes={eventTypes}
              actions={actions}
              canEdit={canEdit}
            />
          )}
        </div>
      </aside>
    </>
  )
}
