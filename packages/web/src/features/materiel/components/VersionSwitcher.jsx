// ════════════════════════════════════════════════════════════════════════════
// VersionSwitcher — sélecteur de version active + gestion archives
// ════════════════════════════════════════════════════════════════════════════
//
// Dropdown compact qui affiche la version active (V1 / V2…) et propose :
//   - Switch direct vers une autre version active
//   - Sous-section "Archivées" repliable avec restore inline
//   - Action "Renommer" sur la version active
//   - Action "Supprimer" (archives uniquement) avec confirm
//
// Props :
//   - versions         : toutes les versions du projet
//   - activeVersion    : la version sélectionnée courante (peut être archivée)
//   - onSelect(id)     : switch
//   - onRestore(id)    : restaure une archivée (et l'active devient archivée)
//   - onRename(id, label)
//   - onDelete(id)
//   - canEdit          : boolean
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Edit3,
  GitBranch,
  Trash2,
} from 'lucide-react'
import { confirm } from '../../../lib/confirm'

function versionLabel(v) {
  return `V${v.numero}` + (v.label ? ` — ${v.label}` : '')
}

export default function VersionSwitcher({
  versions = [],
  activeVersion,
  onSelect,
  onRestore,
  onRename,
  onDelete,
  canEdit = true,
}) {
  const [open, setOpen] = useState(false)
  const [showArchives, setShowArchives] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const activeVersions = versions.filter((v) => !v.archived_at)
  const archivedVersions = versions.filter((v) => v.archived_at)

  const handleRename = useCallback(() => {
    if (!activeVersion || !canEdit) return

    const next = window.prompt('Nom de la version (optionnel)', activeVersion.label || '')
    if (next == null) return
    const trimmed = next.trim()
    onRename?.(activeVersion.id, trimmed || null)
    setOpen(false)
  }, [activeVersion, canEdit, onRename])

  const handleDelete = useCallback(
    async (v) => {
      const ok = await confirm({
        title: `Supprimer la ${versionLabel(v)} ?`,
        message: 'Cette action est irréversible. Tous les blocs et items de cette version seront supprimés.',
        confirmLabel: 'Supprimer',
        cancelLabel: 'Annuler',
        danger: true,
      })
      if (!ok) return
      onDelete?.(v.id)
    },
    [onDelete],
  )

  if (!activeVersion && versions.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--txt-3)' }}
      >
        <GitBranch className="w-3.5 h-3.5" />
        Aucune version
      </span>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-elev)'
        }}
      >
        <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        {activeVersion ? versionLabel(activeVersion) : 'Aucune'}
        {activeVersion?.archived_at && (
          <span
            className="text-[9px] px-1 py-0.5 rounded uppercase tracking-wider"
            style={{ background: 'var(--bg-hov)', color: 'var(--txt-3)' }}
          >
            archivée
          </span>
        )}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: '280px',
          }}
        >
          {/* Versions actives */}
          <div className="py-1">
            {activeVersions.length === 0 ? (
              <p
                className="px-3 py-2 text-xs italic text-center"
                style={{ color: 'var(--txt-3)' }}
              >
                Aucune version active
              </p>
            ) : (
              activeVersions.map((v) => {
                const selected = v.id === activeVersion?.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onSelect?.(v.id)
                      setOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                    style={{
                      background: selected ? 'var(--blue-bg)' : 'transparent',
                      color: selected ? 'var(--blue)' : 'var(--txt)',
                      fontWeight: selected ? 700 : 500,
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.background = 'var(--bg-hov)'
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">{versionLabel(v)}</span>
                    {v.is_active && (
                      <span
                        className="ml-auto text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--green)' }}
                      >
                        active
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Archives (repliable) */}
          {archivedVersions.length > 0 && (
            <div
              className="py-1"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <button
                type="button"
                onClick={() => setShowArchives((s) => !s)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                style={{ color: 'var(--txt-3)' }}
              >
                {showArchives ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Archivées ({archivedVersions.length})
              </button>
              {showArchives && (
                <div className="max-h-[200px] overflow-y-auto">
                  {archivedVersions.map((v) => {
                    const selected = v.id === activeVersion?.id
                    return (
                      <div
                        key={v.id}
                        className="flex items-center gap-1 px-2 py-1"
                        style={{
                          background: selected ? 'var(--bg-hov)' : 'transparent',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelect?.(v.id)
                            setOpen(false)
                          }}
                          className="flex-1 flex items-center gap-2 px-1.5 py-0.5 text-xs text-left rounded"
                          style={{ color: 'var(--txt-2)' }}
                        >
                          <GitBranch className="w-3 h-3 shrink-0 opacity-60" />
                          <span className="truncate">{versionLabel(v)}</span>
                        </button>
                        {canEdit && (
                          <>
                            <IconBtn
                              icon={ArchiveRestore}
                              label="Restaurer cette version"
                              onClick={() => {
                                onRestore?.(v.id)
                                setOpen(false)
                              }}
                            />
                            <IconBtn
                              icon={Trash2}
                              label="Supprimer définitivement"
                              onClick={() => handleDelete(v)}
                              danger
                            />
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions sur la version active */}
          {canEdit && activeVersion && (
            <div
              className="py-1"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <button
                type="button"
                onClick={handleRename}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{ color: 'var(--txt)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Edit3 className="w-3 h-3" />
                Renommer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function IconBtn({ icon: Icon, label, onClick, danger = false }) {
  const hoverColor = danger ? 'var(--red)' : 'var(--blue)'
  const hoverBg = danger ? 'var(--red-bg)' : 'var(--blue-bg)'
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1 rounded transition-all"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor
        e.currentTarget.style.background = hoverBg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--txt-3)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3 h-3" />
    </button>
  )
}
