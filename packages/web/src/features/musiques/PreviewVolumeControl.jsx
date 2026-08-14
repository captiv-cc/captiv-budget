// ════════════════════════════════════════════════════════════════════════════
// PreviewVolumeControl — volume des previews (MusiquesTab + portail RP)
// ════════════════════════════════════════════════════════════════════════════
//
// Pastille compacte : icône (muet / bas / haut) + slider stylé (.volume-slider
// dans index.css). Persiste via lib/previewVolume et applique en direct au
// player courant via onApply(v).

import { useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { getPreviewVolume, setPreviewVolume } from '../../lib/previewVolume'

export default function PreviewVolumeControl({ onApply }) {
  const [volume, setVolume] = useState(getPreviewVolume)
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <label
      className="flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full shrink-0"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
      title={`Volume des previews : ${Math.round(volume * 100)} %`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(e) => {
          const v = setPreviewVolume(parseFloat(e.target.value))
          setVolume(v)
          onApply?.(v)
        }}
        className="volume-slider w-20"
      />
    </label>
  )
}
