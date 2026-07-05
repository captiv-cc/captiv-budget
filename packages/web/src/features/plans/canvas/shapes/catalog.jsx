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
  { key: 'cotations', label: 'Cotations' },
  { key: 'annotations', label: 'Annotations' },
]

export const DEFAULT_LAYER = 'annotations'

/** Layer d'une shape (meta.layer, sinon annotations). */
export function shapeLayer(shape) {
  // Compat : les fonds créés avant l'assignation meta.layer sont reconnus
  // par leur id déterministe (ensureFondShape → 'shape:fond').
  if (shape?.id === 'shape:fond') return 'fond'
  return shape?.meta?.layer || DEFAULT_LAYER
}

/* ─── Focale ↔ angle de vue (plein format, horizontal) ─────────────────── */

export const FOCALES = [14, 18, 24, 35, 50, 70, 85, 135]

/* ─── Modèles caméra Captiv (presets du champ Modèle, saisie libre possible) */

export const CAMERA_MODELES = [
  'FX3',
  'FX6',
  'FX9',
  'PLV100',
  'BURANO',
  'PTZ FR7',
  'PTZ UE100',
  'PTZ UE150',
  'PTZ UE160',
]

export function focaleToAngleDeg(focale) {
  if (!focale || focale <= 0) return 54
  return Math.round((2 * Math.atan(36 / (2 * focale)) * 180) / Math.PI)
}

/* ─── Glyphes SVG (vue de dessus, viewBox 0 0 40 40) ───────────────────── */

const S = { fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }

const GLYPHS = {
  // ── Caméras par type de support (le modèle est une propriété) ─────────────
  cam_plateau: (c) => (
    <>
      <path d="M20 20 L11 6 L29 6 Z" fill={c} fillOpacity="0.18" stroke={c} strokeWidth="1.6" strokeDasharray="3 2.5" />
      <circle cx="20" cy="22" r="5" fill={c} />
      <path d="M20 27 v6 M20 33 l-6 4 M20 33 l6 4" stroke={c} {...S} />
    </>
  ),
  cam_epaule: (c) => (
    <>
      <circle cx="16" cy="22" r="6" stroke={c} {...S} />
      <path d="M6 38 a10 9 0 0 1 20 0" stroke={c} {...S} />
      <rect x="22" y="10" width="12" height="8" rx="2" fill={c} />
      <path d="M22 14 l-4 3" stroke={c} {...S} />
    </>
  ),
  cam_steadicam: (c) => (
    <>
      <circle cx="15" cy="20" r="6" stroke={c} {...S} />
      <path d="M5 36 a10 9 0 0 1 20 0" stroke={c} {...S} />
      <path d="M23 26 C30 22 30 12 26 8" stroke={c} {...S} fill="none" />
      <circle cx="27" cy="6" r="4" fill={c} />
    </>
  ),
  cam_ronin: (c) => (
    <>
      <circle cx="20" cy="20" r="5" fill={c} />
      <path d="M8 20 a12 12 0 0 1 24 0" stroke={c} {...S} fill="none" />
      <path d="M8 20 v6 M32 20 v6" stroke={c} {...S} />
    </>
  ),
  cam_grue: (c) => (
    <>
      <rect x="6" y="28" width="10" height="8" rx="1.5" stroke={c} {...S} />
      <path d="M11 28 L30 9" stroke={c} {...S} />
      <path d="M11 20 v8" stroke={c} strokeWidth="1.6" />
      <circle cx="32" cy="7" r="4.5" fill={c} />
    </>
  ),
  cam_drone: (c) => (
    <>
      <circle cx="11" cy="11" r="4.5" stroke={c} {...S} />
      <circle cx="29" cy="11" r="4.5" stroke={c} {...S} />
      <circle cx="11" cy="29" r="4.5" stroke={c} {...S} />
      <circle cx="29" cy="29" r="4.5" stroke={c} {...S} />
      <rect x="16" y="16" width="8" height="8" rx="2" fill={c} />
    </>
  ),
  cam_ptz: (c) => (
    <>
      <circle cx="20" cy="20" r="11" stroke={c} {...S} />
      <circle cx="20" cy="20" r="4" fill={c} />
      <path d="M20 9 V4" stroke={c} {...S} />
    </>
  ),
  cam_pov: (c) => (
    <>
      <rect x="10" y="12" width="20" height="16" rx="4" stroke={c} {...S} />
      <circle cx="20" cy="20" r="4" fill={c} />
      <path d="M14 8 h12" stroke={c} {...S} />
    </>
  ),
  cam_lensbox: (c) => (
    <>
      <rect x="6" y="22" width="16" height="12" rx="2" stroke={c} {...S} />
      <path d="M22 26 L34 22 M22 30 L34 34 M34 22 V34" stroke={c} {...S} />
      <circle cx="14" cy="28" r="2.5" fill={c} />
    </>
  ),
  cam_cable: (c) => (
    <>
      <path d="M4 20 H36" stroke={c} {...S} strokeDasharray="4 3" />
      <rect x="2" y="17" width="6" height="6" fill={c} transform="rotate(45 5 20)" />
      <rect x="32" y="17" width="6" height="6" fill={c} transform="rotate(45 35 20)" />
      <circle cx="20" cy="20" r="5" fill={c} stroke="#fff" strokeWidth="1.4" />
    </>
  ),
  cam_spider: (c) => (
    <>
      <path d="M6 6 L34 34 M34 6 L6 34" stroke={c} {...S} strokeDasharray="4 3" />
      <rect x="3" y="3" width="6" height="6" fill={c} />
      <rect x="31" y="3" width="6" height="6" fill={c} />
      <rect x="3" y="31" width="6" height="6" fill={c} />
      <rect x="31" y="31" width="6" height="6" fill={c} />
      <circle cx="20" cy="20" r="5" fill={c} stroke="#fff" strokeWidth="1.4" />
    </>
  ),
  cam_travelling: (c) => (
    <>
      <path d="M4 24 C14 16 26 16 36 24" stroke={c} {...S} fill="none" />
      <path d="M9 25 l-2 4 M17 20.5 l-1.5 4.2 M25 20.5 l1.5 4.2 M31 25 l2 4" stroke={c} strokeWidth="1.6" />
      <circle cx="20" cy="19" r="5" fill={c} stroke="#fff" strokeWidth="1.4" />
    </>
  ),
  zone: (c) => (
    <>
      <rect x="5" y="8" width="30" height="24" rx="2" stroke={c} {...S} strokeDasharray="4 3" fill={c} fillOpacity="0.12" />
      <text x="20" y="24" textAnchor="middle" fontSize="9" fontWeight="700" fill={c}>ZONE</text>
    </>
  ),
  cote: (c) => (
    <>
      <path d="M6 20 H34" stroke={c} {...S} />
      <path d="M6 14 V26 M34 14 V26" stroke={c} {...S} />
      <text x="20" y="13" textAnchor="middle" fontSize="8" fontWeight="700" fill={c}>12 m</text>
    </>
  ),
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
    // Un item = un TYPE DE SUPPORT ; le modèle (FX6, BURANO…) se choisit
    // dans Propriétés (presets CAMERA_MODELES + saisie libre).
    // mobile: true → caméra qui se déplace (anneau pointillé, cône off par
    // défaut). variante: rendu spécifique dans CameraShapeUtil.
    items: [
      { kind: 'cam_plateau', label: 'Trépied / plateau', short: 'Trépied', camKind: 'box', glyph: 'cam_plateau', color: CAM, tags: ['fixe', 'pied', 'plateau'] },
      { kind: 'cam_lensbox', label: 'Lensbox (longue focale)', short: 'Lensbox', camKind: 'box', glyph: 'cam_lensbox', color: CAM, defaultFocale: 135, tags: ['longue focale', 'télé', 'box'] },
      { kind: 'cam_epaule', label: 'Épaule', short: 'Épaule', camKind: 'box', glyph: 'cam_epaule', color: CAM, mobile: true, tags: ['mobile', 'porté'] },
      { kind: 'cam_steadicam', label: 'Steadicam', short: 'Steadicam', camKind: 'box', glyph: 'cam_steadicam', color: CAM, mobile: true, tags: ['steady', 'stab'] },
      { kind: 'cam_ronin', label: 'Ronin', short: 'Ronin', camKind: 'box', glyph: 'cam_ronin', color: CAM, mobile: true, tags: ['gimbal', 'stab'] },
      { kind: 'cam_grue', label: 'Grue', short: 'Grue', camKind: 'box', glyph: 'cam_grue', color: '#ff5ac4', variante: 'grue', tags: ['jib', 'bras'] },
      { kind: 'cam_drone', label: 'Drone', short: 'Drone', camKind: 'box', glyph: 'cam_drone', color: '#9c5ffd', mobile: true, tags: ['aérien', 'fpv'] },
      { kind: 'cam_ptz', label: 'PTZ', short: 'PTZ', camKind: 'box', glyph: 'cam_ptz', color: CAM, tags: ['tourelle', 'remote', 'robot'] },
      { kind: 'cam_pov', label: 'POV / Minicam', short: 'POV', camKind: 'box', glyph: 'cam_pov', color: CAM, mobile: true, tags: ['gopro', 'embarquée', 'minicam'] },
      { kind: 'cam_cable', label: 'Cable-cam', short: 'Cable-cam', camKind: 'rail', railKind: 'cable', glyph: 'cam_cable', color: '#ff9f0a', tags: ['câble', 'ligne'] },
      { kind: 'cam_spider', label: 'Spider cam', short: 'Spider', camKind: 'spider', glyph: 'cam_spider', color: '#ff9f0a', tags: ['araignée', '4 points'] },
      { kind: 'cam_travelling', label: 'Travelling / Slider', short: 'Travelling', camKind: 'rail', railKind: 'travelling', glyph: 'cam_travelling', color: CAM, tags: ['slider', 'rail', 'dolly'] },
    ],
  },
  {
    key: 'zones_mesures',
    label: 'Zones & mesures',
    layer: 'zones',
    items: [
      { kind: 'zone', label: 'Zone nommée', short: 'Zone', special: 'zone', glyph: 'zone', color: '#9c5ffd', tags: ['surface', 'rect', 'scène', 'public'] },
      { kind: 'cotation', label: 'Cotation', short: 'Cote', special: 'cote', glyph: 'cote', color: '#a8a8a8', tags: ['mesure', 'distance', 'mètre'] },
    ],
  },
  {
    key: 'lumiere',
    label: 'Éclairage',
    layer: 'lumiere',
    items: [
      { kind: 'fresnel', label: 'Fresnel', glyph: 'fresnel', color: LUM, w: 60, h: 60, tags: ['proj', 'projecteur'] },
      { kind: 'skypanel_s30', label: 'SkyPanel S30', glyph: 'skypanel', color: LUM, w: 70, h: 60, tags: ['proj', 'panneau', 'arri'] },
      { kind: 'skypanel_s60', label: 'SkyPanel S60', glyph: 'skypanel', color: LUM, w: 90, h: 74, tags: ['proj', 'panneau', 'arri'] },
      { kind: 'led_bar', label: 'LED bar', glyph: 'ledbar', color: LUM, w: 110, h: 40, tags: ['barre', 'proj'] },
      { kind: 'par64', label: 'PAR 64', glyph: 'par', color: LUM, w: 54, h: 54, tags: ['proj'] },
      { kind: 'moving_head', label: 'Moving head', glyph: 'moving', color: LUM, w: 60, h: 60, tags: ['lyre', 'proj'] },
      { kind: 'poursuite', label: 'Poursuite', glyph: 'poursuite', color: LUM, w: 70, h: 70, tags: ['spot', 'follow'] },
    ],
  },
  {
    key: 'son',
    label: 'Son',
    layer: 'son',
    items: [
      { kind: 'perche', label: 'Perche', glyph: 'perche', color: SON, w: 70, h: 70 },
      { kind: 'micro_hf', label: 'Micro HF', glyph: 'micro_hf', color: SON, w: 50, h: 56, tags: ['sans fil'] },
      { kind: 'wedge', label: 'HP scène', glyph: 'wedge', color: SON, w: 64, h: 54, tags: ['hp', 'retour', 'enceinte'] },
      { kind: 'line_array', label: 'Line array', glyph: 'line_array', color: SON, w: 50, h: 90, tags: ['hp', 'enceinte', 'cluster'] },
      { kind: 'console_son', label: 'Console son', glyph: 'console', color: SON, w: 90, h: 60, tags: ['mixage', 'façade', 'foh'] },
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
      { kind: 'ecran_led', label: 'Écran LED', glyph: 'ecran_led', color: STR, w: 130, h: 60, tags: ['mur', 'screen'] },
      { kind: 'barriere', label: 'Barrière', glyph: 'barriere', color: STR, w: 90, h: 40 },
    ],
  },
  {
    key: 'regie',
    label: 'Régie / Tech',
    layer: 'structures',
    items: [
      { kind: 'regie', label: 'Régie', glyph: 'regie', color: REG, w: 110, h: 80, tags: ['video', 'foh'] },
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
