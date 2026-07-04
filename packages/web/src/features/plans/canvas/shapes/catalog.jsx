// ════════════════════════════════════════════════════════════════════════════
// catalog — bibliothèque d'éléments Captiv (icônes vue de dessus) + layers
// ════════════════════════════════════════════════════════════════════════════
//
// V1 : glyphes SVG schématiques dessinés en code (vue de dessus). Passage à
// des icônes designées en V2 (il suffira de remplacer Glyph). Chaque item
// devient une shape 'captiv-item' (ou 'captiv-camera' pour les caméras) avec
// meta.layer pour le panneau Layers.
// ════════════════════════════════════════════════════════════════════════════

/* ─── Layers ────────────────────────────────────────────────────────────── */

export const LAYERS = [
  { key: 'fond', label: 'Fond de plan' },
  { key: 'zones', label: 'Zones' },
  { key: 'cameras', label: 'Caméras' },
  { key: 'lumiere', label: 'Éclairage' },
  { key: 'son', label: 'Son' },
  { key: 'personnes', label: 'Personnes' },
  { key: 'structures', label: 'Structures' },
  { key: 'annotations', label: 'Annotations' },
]

export const DEFAULT_LAYER = 'annotations'

/** Layer d'une shape (meta.layer, sinon annotations). */
export function shapeLayer(shape) {
  return shape?.meta?.layer || DEFAULT_LAYER
}

/* ─── Focale ↔ angle de vue (plein format, horizontal) ─────────────────── */

export const FOCALES = [14, 18, 24, 35, 50, 70, 85, 135]

export function focaleToAngleDeg(focale) {
  if (!focale || focale <= 0) return 54
  return Math.round((2 * Math.atan(36 / (2 * focale)) * 180) / Math.PI)
}

/* ─── Glyphes SVG (vue de dessus, viewBox 0 0 40 40) ───────────────────── */

const S = { fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }

const GLYPHS = {
  fresnel: (c) => (
    <>
      <circle cx="20" cy="22" r="9" stroke={c} {...S} />
      <path d="M13 12 L20 4 L27 12" stroke={c} {...S} />
    </>
  ),
  skypanel: (c) => (
    <>
      <rect x="8" y="14" width="24" height="14" rx="3" stroke={c} {...S} />
      <path d="M12 8 v3 M20 6 v5 M28 8 v3" stroke={c} {...S} />
    </>
  ),
  ledbar: (c) => (
    <>
      <rect x="4" y="16" width="32" height="8" rx="2" stroke={c} {...S} />
      <path d="M10 20 h0.1 M20 20 h0.1 M30 20 h0.1" stroke={c} strokeWidth="3.4" strokeLinecap="round" />
    </>
  ),
  par: (c) => (
    <>
      <circle cx="20" cy="20" r="11" stroke={c} {...S} />
      <circle cx="20" cy="20" r="4.5" stroke={c} {...S} />
    </>
  ),
  moving: (c) => (
    <>
      <circle cx="20" cy="20" r="10" stroke={c} {...S} />
      <path d="M20 10 v20 M10 20 h20" stroke={c} {...S} />
    </>
  ),
  poursuite: (c) => (
    <>
      <circle cx="14" cy="26" r="7" stroke={c} {...S} />
      <path d="M19 21 L34 6 M28 6 h6 v6" stroke={c} {...S} />
    </>
  ),
  perche: (c) => (
    <>
      <path d="M6 34 L30 10" stroke={c} {...S} />
      <circle cx="33" cy="7" r="4" stroke={c} {...S} />
    </>
  ),
  micro_hf: (c) => (
    <>
      <circle cx="20" cy="24" r="6" stroke={c} {...S} />
      <path d="M20 18 V6 M15 9 l5 -3 l5 3" stroke={c} {...S} />
    </>
  ),
  wedge: (c) => (
    <>
      <path d="M8 28 L32 28 L26 12 L14 12 Z" stroke={c} {...S} />
      <path d="M14 22 h12" stroke={c} {...S} />
    </>
  ),
  line_array: (c) => (
    <>
      <rect x="13" y="6" width="14" height="7" rx="1.5" stroke={c} {...S} />
      <rect x="13" y="16" width="14" height="7" rx="1.5" stroke={c} {...S} />
      <rect x="13" y="26" width="14" height="7" rx="1.5" stroke={c} {...S} />
    </>
  ),
  console: (c) => (
    <>
      <rect x="6" y="12" width="28" height="16" rx="2.5" stroke={c} {...S} />
      <path d="M12 18 h0.1 M20 18 h0.1 M28 18 h0.1 M12 23 h0.1 M20 23 h0.1 M28 23 h0.1" stroke={c} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  personne: (c) => (
    <>
      <circle cx="20" cy="14" r="6" stroke={c} {...S} />
      <path d="M8 34 a12 10 0 0 1 24 0" stroke={c} {...S} />
    </>
  ),
  public: (c) => (
    <>
      <circle cx="12" cy="14" r="4.5" stroke={c} {...S} />
      <circle cx="28" cy="14" r="4.5" stroke={c} {...S} />
      <circle cx="20" cy="27" r="4.5" stroke={c} {...S} />
    </>
  ),
  truss: (c) => (
    <>
      <rect x="4" y="14" width="32" height="12" stroke={c} {...S} />
      <path d="M10 14 L16 26 M16 14 L10 26 M24 14 L30 26 M30 14 L24 26" stroke={c} strokeWidth="1.6" />
    </>
  ),
  mat: (c) => (
    <>
      <circle cx="20" cy="20" r="4" fill={c} />
      <circle cx="20" cy="20" r="11" stroke={c} {...S} strokeDasharray="3 4" />
    </>
  ),
  grill: (c) => (
    <>
      <rect x="6" y="6" width="28" height="28" stroke={c} {...S} />
      <path d="M15 6 V34 M25 6 V34 M6 15 H34 M6 25 H34" stroke={c} strokeWidth="1.6" />
    </>
  ),
  podium: (c) => (
    <>
      <rect x="5" y="10" width="30" height="20" stroke={c} {...S} />
      <rect x="9" y="14" width="22" height="12" stroke={c} strokeWidth="1.6" fill="none" />
    </>
  ),
  ecran_led: (c) => (
    <>
      <rect x="4" y="12" width="32" height="16" rx="1.5" stroke={c} {...S} />
      <path d="M4 28 L36 12" stroke={c} strokeWidth="1.6" />
    </>
  ),
  barriere: (c) => (
    <>
      <path d="M6 20 H34" stroke={c} {...S} />
      <path d="M10 20 V28 M30 20 V28" stroke={c} {...S} />
    </>
  ),
  regie: (c) => (
    <>
      <rect x="6" y="10" width="28" height="20" rx="2.5" stroke={c} {...S} />
      <text x="20" y="25" textAnchor="middle" fontSize="12" fontWeight="700" fill={c}>R</text>
    </>
  ),
  moniteur: (c) => (
    <>
      <rect x="8" y="8" width="24" height="16" rx="2" stroke={c} {...S} />
      <path d="M20 24 v6 M13 32 h14" stroke={c} {...S} />
    </>
  ),
  elec: (c) => (
    <>
      <rect x="8" y="6" width="24" height="28" rx="2.5" stroke={c} {...S} />
      <path d="M22 11 L16 21 h5 L18 29 L25 19 h-5 Z" stroke={c} strokeWidth="1.8" fill="none" />
    </>
  ),
  extincteur: (c) => (
    <>
      <rect x="13" y="12" width="14" height="22" rx="5" stroke={c} {...S} />
      <path d="M20 12 V7 M20 7 L27 5" stroke={c} {...S} />
    </>
  ),
  sortie: (c) => (
    <>
      <rect x="4" y="8" width="32" height="24" rx="2.5" stroke={c} {...S} />
      <path d="M12 20 H28 M22 14 L28 20 L22 26" stroke={c} {...S} />
    </>
  ),
  secours: (c) => (
    <>
      <rect x="6" y="6" width="28" height="28" rx="3" stroke={c} {...S} />
      <path d="M20 12 V28 M12 20 H28" stroke={c} strokeWidth="3.4" strokeLinecap="round" />
    </>
  ),
}

/** Rend le glyphe d'un item (fallback : initiales dans un cadre). */
export function Glyph({ glyph, color = '#9ca3af', label = '' }) {
  const draw = GLYPHS[glyph]
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%">
      {draw ? (
        draw(color)
      ) : (
        <>
          <rect x="6" y="6" width="28" height="28" rx="4" stroke={color} fill="none" strokeWidth="2.4" />
          <text x="20" y="25" textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>
            {label.slice(0, 2).toUpperCase()}
          </text>
        </>
      )}
    </svg>
  )
}

/* ─── Catalogue ─────────────────────────────────────────────────────────── */
// kind unique par item. Les caméras (isCamera) deviennent des shapes
// 'captiv-camera' (cône de vue) ; le reste des 'captiv-item'.

const CAM = '#4d9fff'
const LUM = '#ffce00'
const SON = '#9c5ffd'
const PER = '#ff5ac4'
const STR = '#a8a8a8'
const REG = '#00c875'
const SEC = '#ff4757'

export const CATALOG = [
  {
    key: 'cameras',
    label: 'Caméras',
    layer: 'cameras',
    items: [
      { kind: 'cam_fx6', label: 'FX6', isCamera: true, color: CAM },
      { kind: 'cam_fx3', label: 'FX3', isCamera: true, color: CAM },
      { kind: 'cam_a7s', label: 'A7S', isCamera: true, color: CAM },
      { kind: 'cam_drone', label: 'Drone', isCamera: true, color: '#9c5ffd' },
      { kind: 'cam_ronin', label: 'Ronin', isCamera: true, color: CAM },
      { kind: 'cam_jib', label: 'Jib', isCamera: true, color: '#ff5ac4' },
      { kind: 'cam_epaule', label: 'Épaule', isCamera: true, color: CAM },
    ],
  },
  {
    key: 'lumiere',
    label: 'Éclairage',
    layer: 'lumiere',
    items: [
      { kind: 'fresnel', label: 'Fresnel', glyph: 'fresnel', color: LUM, w: 60, h: 60 },
      { kind: 'skypanel_s30', label: 'SkyPanel S30', glyph: 'skypanel', color: LUM, w: 70, h: 60 },
      { kind: 'skypanel_s60', label: 'SkyPanel S60', glyph: 'skypanel', color: LUM, w: 90, h: 74 },
      { kind: 'led_bar', label: 'LED bar', glyph: 'ledbar', color: LUM, w: 110, h: 40 },
      { kind: 'par64', label: 'PAR 64', glyph: 'par', color: LUM, w: 54, h: 54 },
      { kind: 'moving_head', label: 'Moving head', glyph: 'moving', color: LUM, w: 60, h: 60 },
      { kind: 'poursuite', label: 'Poursuite', glyph: 'poursuite', color: LUM, w: 70, h: 70 },
    ],
  },
  {
    key: 'son',
    label: 'Son',
    layer: 'son',
    items: [
      { kind: 'perche', label: 'Perche', glyph: 'perche', color: SON, w: 70, h: 70 },
      { kind: 'micro_hf', label: 'Micro HF', glyph: 'micro_hf', color: SON, w: 50, h: 56 },
      { kind: 'wedge', label: 'HP scène', glyph: 'wedge', color: SON, w: 64, h: 54 },
      { kind: 'line_array', label: 'Line array', glyph: 'line_array', color: SON, w: 50, h: 90 },
      { kind: 'console_son', label: 'Console son', glyph: 'console', color: SON, w: 90, h: 60 },
    ],
  },
  {
    key: 'personnes',
    label: 'Personnes',
    layer: 'personnes',
    items: [
      { kind: 'artiste', label: 'Artiste', glyph: 'personne', color: PER, w: 50, h: 56 },
      { kind: 'cadreur', label: 'Cadreur', glyph: 'personne', color: CAM, w: 50, h: 56 },
      { kind: 'regisseur', label: 'Régisseur', glyph: 'personne', color: REG, w: 50, h: 56 },
      { kind: 'public', label: 'Public', glyph: 'public', color: PER, w: 70, h: 62 },
    ],
  },
  {
    key: 'structures',
    label: 'Structures / Décor',
    layer: 'structures',
    items: [
      { kind: 'truss', label: 'Truss', glyph: 'truss', color: STR, w: 130, h: 46 },
      { kind: 'mat', label: 'Mât', glyph: 'mat', color: STR, w: 54, h: 54 },
      { kind: 'grill', label: 'Grill', glyph: 'grill', color: STR, w: 110, h: 110 },
      { kind: 'podium', label: 'Podium', glyph: 'podium', color: STR, w: 120, h: 80 },
      { kind: 'ecran_led', label: 'Écran LED', glyph: 'ecran_led', color: STR, w: 130, h: 60 },
      { kind: 'barriere', label: 'Barrière', glyph: 'barriere', color: STR, w: 90, h: 40 },
    ],
  },
  {
    key: 'regie',
    label: 'Régie / Tech',
    layer: 'structures',
    items: [
      { kind: 'regie', label: 'Régie', glyph: 'regie', color: REG, w: 110, h: 80 },
      { kind: 'moniteur', label: 'Moniteur', glyph: 'moniteur', color: REG, w: 56, h: 56 },
      { kind: 'coffret_elec', label: 'Coffret élec', glyph: 'elec', color: REG, w: 54, h: 66 },
    ],
  },
  {
    key: 'signaletique',
    label: 'Signalétique',
    layer: 'annotations',
    items: [
      { kind: 'extincteur', label: 'Extincteur', glyph: 'extincteur', color: SEC, w: 44, h: 54 },
      { kind: 'sortie_secours', label: 'Sortie secours', glyph: 'sortie', color: REG, w: 64, h: 50 },
      { kind: 'croix_secours', label: 'Poste secours', glyph: 'secours', color: REG, w: 54, h: 54 },
    ],
  },
]

/** Item du catalogue par kind (pour le rendu des shapes). */
const BY_KIND = new Map()
CATALOG.forEach((catGroup) => {
  catGroup.items.forEach((it) => BY_KIND.set(it.kind, { ...it, layer: catGroup.layer }))
})
export function catalogItem(kind) {
  return BY_KIND.get(kind) || null
}
