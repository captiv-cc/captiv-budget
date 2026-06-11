// ════════════════════════════════════════════════════════════════════════════
// LieuPoiPanel — panneau latéral : liste des POIs + éditeur du POI sélectionné
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Hexagon,
  MapPin,
  Search,
  Spline,
  Trash2,
  Loader2,
  Check,
} from 'lucide-react'

import DerouleLinkPicker from './DerouleLinkPicker'
import { POI_ICON_OPTIONS, emojiFor } from './poiIcons'

const KIND_META = {
  point: { label: 'Point', Icon: MapPin },
  zone: { label: 'Zone', Icon: Hexagon },
  line: { label: 'Ligne', Icon: Spline },
}

const POI_COLORS = [
  '#4d9fff', '#00c875', '#ff5ac4', '#ffce00', '#ff4757',
  '#9c5ffd', '#ff9f0a', '#5eead4', '#ffffff', '#94a3b8',
]

export default function LieuPoiPanel({
  pois = [],
  selectedPoi = null,
  projectId,
  saving = false,
  linkLabelFor,
  onSelect,
  onSave,
  onDelete,
}) {
  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ width: 300, border: '1px solid var(--brd)', background: 'var(--bg-elev)', height: 'min(72vh, 760px)' }}
    >
      {selectedPoi ? (
        <PoiEditor
          key={selectedPoi.id}
          poi={selectedPoi}
          projectId={projectId}
          saving={saving}
          onBack={() => onSelect(null)}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : (
        <PoiList pois={pois} onSelect={onSelect} linkLabelFor={linkLabelFor} />
      )}
    </div>
  )
}

function PoiList({ pois, onSelect, linkLabelFor }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return pois
    return pois.filter((p) => (p.label || '').toLowerCase().includes(s))
  }, [pois, q])

  return (
    <>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--brd)' }}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--txt)' }}>Points & zones</h3>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {pois.length} élément{pois.length > 1 ? 's' : ''}
        </p>
        {pois.length > 4 && (
          <div className="flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md" style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer…"
              className="flex-1 text-xs bg-transparent outline-none"
              style={{ color: 'var(--txt)' }}
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {pois.length === 0 ? (
          <p className="text-xs px-3 py-6 text-center" style={{ color: 'var(--txt-3)' }}>
            Choisis un outil ci-dessus (Point / Zone / Ligne) et clique sur la carte pour créer un repère.
          </p>
        ) : (
          filtered.map((p) => {
            const meta = KIND_META[p.kind] || KIND_META.point
            const link = linkLabelFor?.(p)
            const emoji = emojiFor(p.icon)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{ borderBottom: '1px solid var(--brd)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color || '#4d9fff' }} />
                {emoji ? (
                  <span className="text-sm shrink-0 leading-none">{emoji}</span>
                ) : (
                  <meta.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs truncate" style={{ color: 'var(--txt)' }}>
                    {p.label || <span style={{ color: 'var(--txt-3)' }}>(sans nom)</span>}
                  </span>
                  {link && (
                    <span className="block text-[10px] truncate" style={{ color: 'var(--blue)' }}>→ {link}</span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </>
  )
}

function PoiEditor({ poi, projectId, saving, onBack, onSave, onDelete }) {
  const [label, setLabel] = useState(poi.label || '')
  const [color, setColor] = useState(poi.color || '#4d9fff')
  const [icon, setIcon] = useState(poi.icon || '')
  const [notes, setNotes] = useState(poi.notes || '')
  const [link, setLink] = useState({
    deroule_id: poi.deroule_id || null,
    lane_id: poi.lane_id || null,
    creneau_id: poi.creneau_id || null,
  })

  // Resync si le POI change (sélection d'un autre).
  useEffect(() => {
    setLabel(poi.label || '')
    setColor(poi.color || '#4d9fff')
    setIcon(poi.icon || '')
    setNotes(poi.notes || '')
    setLink({ deroule_id: poi.deroule_id || null, lane_id: poi.lane_id || null, creneau_id: poi.creneau_id || null })
  }, [poi])

  const meta = KIND_META[poi.kind] || KIND_META.point

  const handleSave = () => {
    onSave(poi.id, { label, color, icon: icon || null, notes, ...link })
  }

  return (
    <>
      <div className="px-3 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--brd)' }}>
        <button type="button" onClick={onBack} className="p-1 rounded-md" style={{ color: 'var(--txt-2)' }} title="Retour à la liste">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <meta.Icon className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
        <span className="text-sm font-bold flex-1" style={{ color: 'var(--txt)' }}>{meta.label}</span>
        <button
          type="button"
          onClick={() => onDelete(poi.id)}
          className="p-1 rounded-md"
          style={{ color: '#ff6b6b' }}
          title="Supprimer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Nom */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>Nom</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex : Entrée, Régie, Scène A…"
            className="w-full text-sm px-2 py-1.5 rounded-md outline-none"
            style={{ background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--brd)' }}
          />
        </div>

        {/* Couleur */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>Couleur</label>
          <div className="flex flex-wrap gap-1.5">
            {POI_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full transition-transform"
                style={{
                  background: c,
                  border: color === c ? '2px solid var(--txt)' : '1px solid var(--brd)',
                  transform: color === c ? 'scale(1.12)' : 'none',
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Icône (affichée sur la carte + mobile) */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>Icône</label>
          <select
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={{ background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--brd)' }}
          >
            {POI_ICON_OPTIONS.map((o) => (
              <option key={o} value={o}>{o === '' ? '— Aucune —' : `${emojiFor(o)}  ${o}`}</option>
            ))}
          </select>
        </div>

        {/* Lien déroulé */}
        <DerouleLinkPicker projectId={projectId} value={link} onChange={setLink} />

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Infos d'accès, consignes…"
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none resize-none"
            style={{ background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--brd)' }}
          />
        </div>
      </div>

      <div className="p-3 border-t" style={{ borderColor: 'var(--brd)' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-md"
          style={{ background: 'var(--blue)', color: 'white', opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enregistrer le repère
        </button>
        <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--txt-3)' }}>
          Astuce : glisse le point sur la carte pour le repositionner.
        </p>
      </div>
    </>
  )
}
