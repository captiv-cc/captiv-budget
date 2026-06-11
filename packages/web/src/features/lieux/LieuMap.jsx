// ════════════════════════════════════════════════════════════════════════════
// LieuMap — carte MapLibre GL (satellite Esri) + overlay plan + calage + POIs
// ════════════════════════════════════════════════════════════════════════════
//
// Deux modes d'édition (pilotés par le parent, mutuellement exclusifs) :
//   • Calage (editable) : déplacer / redimensionner / pivoter / déformer l'overlay.
//   • POI (poiMode)     : dessiner (point/zone/ligne), sélectionner, déplacer un
//                         point. Le dessin est piloté par `drawTool`.
//
// Navigation toujours dispo : clic molette OU Espace+glisser pour déplacer la
// carte (utile zoomé à fond par-dessus le plan).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { cornersToCoordinates } from '../../lib/lieux'
import { loadPoiIconImages } from './poiIcons'
import {
  lngLatToXY,
  cornersToXY,
  centroidXY,
  distXY,
  translateXY,
  scaleCorners,
  rotateCorners,
  xyToCorners,
  rotateHandlePoint,
  angleFromCenter,
} from './transform'

const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const BASE_STYLE = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    esri: {
      type: 'raster',
      tiles: [ESRI_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
}

const OVERLAY_SRC = 'plan-overlay'
const HITBOX_SRC = 'plan-hitbox'
const CORNERS_SRC = 'plan-corners'
const ROT_SRC = 'plan-rotate'
const ROTLINE_SRC = 'plan-rotate-line'
const POIS_SRC = 'lieu-pois'
const DRAFT_SRC = 'lieu-draft'
const DRAFTPT_SRC = 'lieu-draft-pts'

export default function LieuMap({
  center = { lng: 2.35, lat: 48.85 },
  zoom = 14,
  overlayUrl = null,
  corners = null,
  opacity = 0.7,
  editable = false,
  editMode = 'transform',
  pois = [],
  poiMode = false,
  drawTool = null, // null | 'point' | 'zone' | 'line'
  selectedPoiId = null,
  onCornersChange,
  onMoveEnd,
  onReady,
  onDrawComplete,
  onSelectPoi,
  onPoiMove,
  className,
  style,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const overlayUrlRef = useRef(null)

  // Refs "live"
  const cornersRef = useRef(corners)
  const editableRef = useRef(editable)
  const editModeRef = useRef(editMode)
  const poiModeRef = useRef(poiMode)
  const drawToolRef = useRef(drawTool)
  const poisRef = useRef(pois)
  const onCornersChangeRef = useRef(onCornersChange)
  const onDrawCompleteRef = useRef(onDrawComplete)
  const onSelectPoiRef = useRef(onSelectPoi)
  const onPoiMoveRef = useRef(onPoiMove)
  useEffect(() => { cornersRef.current = corners }, [corners])
  useEffect(() => { editableRef.current = editable }, [editable])
  useEffect(() => { editModeRef.current = editMode }, [editMode])
  useEffect(() => { poiModeRef.current = poiMode }, [poiMode])
  useEffect(() => { drawToolRef.current = drawTool }, [drawTool])
  useEffect(() => { poisRef.current = pois }, [pois])
  useEffect(() => { onCornersChangeRef.current = onCornersChange }, [onCornersChange])
  useEffect(() => { onDrawCompleteRef.current = onDrawComplete }, [onDrawComplete])
  useEffect(() => { onSelectPoiRef.current = onSelectPoi }, [onSelectPoi])
  useEffect(() => { onPoiMoveRef.current = onPoiMove }, [onPoiMove])

  // États impératifs
  const drag = useRef({ kind: null, cornerIdx: null, base: null, downXY: null, startAngle: 0, startDist: 0 })
  const pan = useRef({ active: false, last: null })
  const spaceRef = useRef(false)
  const draft = useRef({ coords: [] })
  const poiDrag = useRef({ id: null, active: false })
  const poiOverride = useRef(null) // { id, geom } pendant un drag de point

  // ── Init de la map (une seule fois) ───────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      readyRef.current = true
      addPoiLayers(map)
      syncOverlay()
      syncEditHandles()
      applyPois()
      updateSelected(selectedPoiId)
      if (onReady) onReady(map)
    })

    map.on('moveend', () => {
      if (!onMoveEnd) return
      const c = map.getCenter()
      onMoveEnd({ lng: c.lng, lat: c.lat }, map.getZoom())
    })

    const queryAt = (layer, pt) =>
      map.getLayer(layer) ? map.queryRenderedFeatures(pt, { layers: [layer] }) : []
    const queryAny = (layers, pt) => {
      for (const l of layers) {
        const f = queryAt(l, pt)
        if (f.length) return f[0]
      }
      return null
    }

    // ── mousedown ─────────────────────────────────────────────────────────
    const onDown = (e) => {
      // Pan custom au clic molette (toujours dispo)
      if (e.originalEvent && e.originalEvent.button === 1) {
        if (e.originalEvent.preventDefault) e.originalEvent.preventDefault()
        if (e.preventDefault) e.preventDefault()
        pan.current = { active: true, last: e.point }
        map.dragPan.disable()
        map.getCanvas().style.cursor = 'grabbing'
        return
      }
      if (spaceRef.current) return // Espace → laisser la carte se déplacer

      // Calage
      if (editableRef.current && cornersRef.current) {
        const rot = queryAt(ROT_SRC, e.point)
        const cor = queryAt(CORNERS_SRC, e.point)
        const body = queryAt(HITBOX_SRC, e.point)
        if (!rot.length && !cor.length && !body.length) return
        e.preventDefault()
        const base = cornersRef.current.map((c) => ({ ...c }))
        const cur = { lng: e.lngLat.lng, lat: e.lngLat.lat }
        drag.current.base = base
        drag.current.downXY = lngLatToXY(cur)
        if (rot.length) {
          drag.current.kind = 'rotate'
          drag.current.startAngle = angleFromCenter(base, cur)
        } else if (cor.length) {
          drag.current.kind = editModeRef.current === 'deform' ? 'deform' : 'scale'
          drag.current.cornerIdx = cor[0].properties.idx
          const c = centroidXY(cornersToXY(base))
          drag.current.startDist = distXY(c, lngLatToXY(cur)) || 1e-9
        } else {
          drag.current.kind = 'move'
        }
        map.dragPan.disable()
        map.getCanvas().style.cursor = 'grabbing'
        return
      }

      // POI : drag d'un point existant (hors mode dessin)
      if (poiModeRef.current && !drawToolRef.current) {
        const pt = queryAt('pois-point', e.point)
        if (pt.length) {
          e.preventDefault()
          poiDrag.current = { id: pt[0].properties.id, active: true }
          map.dragPan.disable()
          map.getCanvas().style.cursor = 'grabbing'
        }
      }
    }

    // ── mousemove ─────────────────────────────────────────────────────────
    const onMove = (e) => {
      if (pan.current.active) {
        const dx = e.point.x - pan.current.last.x
        const dy = e.point.y - pan.current.last.y
        map.panBy([-dx, -dy], { animate: false })
        pan.current.last = e.point
        return
      }

      // POI point drag
      if (poiDrag.current.active) {
        poiOverride.current = {
          id: poiDrag.current.id,
          geom: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] },
        }
        applyPois()
        return
      }

      // Calage transform
      const d = drag.current
      if (d.kind) {
        const cur = { lng: e.lngLat.lng, lat: e.lngLat.lat }
        let next = d.base
        if (d.kind === 'move') {
          const curXY = lngLatToXY(cur)
          next = xyToCorners(translateXY(cornersToXY(d.base), curXY.x - d.downXY.x, curXY.y - d.downXY.y))
        } else if (d.kind === 'scale') {
          const c = centroidXY(cornersToXY(d.base))
          const f = Math.max(0.05, Math.min(distXY(c, lngLatToXY(cur)) / d.startDist, 20))
          next = scaleCorners(d.base, f)
        } else if (d.kind === 'rotate') {
          const deltaDeg = ((angleFromCenter(d.base, cur) - d.startAngle) * 180) / Math.PI
          next = rotateCorners(d.base, deltaDeg)
        } else if (d.kind === 'deform') {
          next = d.base.map((p, i) => (i === d.cornerIdx ? cur : p))
        }
        cornersRef.current = next
        applyOverlayCoords(next)
        applyEditHandles(next)
        return
      }

      // Dessin en cours : rubber-band ligne/zone
      const tool = drawToolRef.current
      if (poiModeRef.current && (tool === 'line' || tool === 'zone') && draft.current.coords.length) {
        updateDraft([...draft.current.coords, [e.lngLat.lng, e.lngLat.lat]], tool)
        return
      }

      // Curseurs au survol
      if (editableRef.current) {
        const overHandle = queryAt(ROT_SRC, e.point).length || queryAt(CORNERS_SRC, e.point).length
        const overBody = queryAt(HITBOX_SRC, e.point).length
        map.getCanvas().style.cursor = overHandle ? 'grab' : overBody ? 'move' : ''
      } else if (poiModeRef.current) {
        if (tool) {
          map.getCanvas().style.cursor = 'crosshair'
        } else {
          const over = queryAny(['pois-point', 'pois-line', 'pois-fill'], e.point)
          map.getCanvas().style.cursor = over ? 'pointer' : ''
        }
      }
    }

    // ── mouseup ───────────────────────────────────────────────────────────
    const onUp = () => {
      if (pan.current.active) {
        pan.current.active = false
        map.dragPan.enable()
        map.getCanvas().style.cursor = ''
        return
      }
      if (poiDrag.current.active) {
        poiDrag.current.active = false
        map.dragPan.enable()
        map.getCanvas().style.cursor = ''
        const ov = poiOverride.current
        poiOverride.current = null
        if (ov && onPoiMoveRef.current) onPoiMoveRef.current(ov.id, ov.geom)
        return
      }
      if (!drag.current.kind) return
      drag.current.kind = null
      drag.current.cornerIdx = null
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
      if (onCornersChangeRef.current && cornersRef.current) onCornersChangeRef.current(cornersRef.current)
    }

    // ── click (sélection / dessin point / ajout sommet) ─────────────────────
    const onClick = (e) => {
      if (!poiModeRef.current) return
      const tool = drawToolRef.current
      if (tool === 'point') {
        onDrawCompleteRef.current?.({ type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] })
        return
      }
      if (tool === 'line' || tool === 'zone') {
        draft.current.coords.push([e.lngLat.lng, e.lngLat.lat])
        updateDraft(draft.current.coords, tool)
        return
      }
      // Sélection
      const hit = queryAny(['pois-point', 'pois-line', 'pois-fill'], e.point)
      if (onSelectPoiRef.current) onSelectPoiRef.current(hit ? hit.properties.id : null)
    }

    const onDblClick = (e) => {
      const tool = drawToolRef.current
      if (poiModeRef.current && (tool === 'line' || tool === 'zone')) {
        if (e.preventDefault) e.preventDefault()
        finishDraft()
      }
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    map.on('click', onClick)
    map.on('dblclick', onDblClick)

    // Pan clavier (Espace) + raccourcis dessin (Entrée / Échap)
    const isTyping = (t) =>
      t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    const onKeyDown = (ev) => {
      if (isTyping(ev.target)) return
      if (ev.code === 'Space') {
        spaceRef.current = true
        if ((editableRef.current || poiModeRef.current) && !drag.current.kind) {
          map.getCanvas().style.cursor = 'grab'
          ev.preventDefault()
        }
        return
      }
      if (!poiModeRef.current || !drawToolRef.current) return
      if (ev.code === 'Enter') { ev.preventDefault(); finishDraft() }
      else if (ev.code === 'Escape') { ev.preventDefault(); cancelDraft() }
    }
    const onKeyUp = (ev) => {
      if (ev.code !== 'Space') return
      spaceRef.current = false
      if (!drag.current.kind && !pan.current.active) map.getCanvas().style.cursor = ''
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      readyRef.current = false
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Overlay ───────────────────────────────────────────────────────────────
  function applyOverlayCoords(crs) {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource(OVERLAY_SRC)
    if (src && crs && crs.length === 4) src.setCoordinates(cornersToCoordinates(crs))
  }

  function syncOverlay() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const hasOverlay = overlayUrl && corners && corners.length === 4
    const existing = map.getSource(OVERLAY_SRC)
    if (!hasOverlay) {
      if (map.getLayer(OVERLAY_SRC)) map.removeLayer(OVERLAY_SRC)
      if (existing) map.removeSource(OVERLAY_SRC)
      overlayUrlRef.current = null
      return
    }
    if (existing && overlayUrlRef.current !== overlayUrl) {
      if (map.getLayer(OVERLAY_SRC)) map.removeLayer(OVERLAY_SRC)
      map.removeSource(OVERLAY_SRC)
    }
    if (!map.getSource(OVERLAY_SRC)) {
      map.addSource(OVERLAY_SRC, { type: 'image', url: overlayUrl, coordinates: cornersToCoordinates(corners) })
      overlayUrlRef.current = overlayUrl
      const before = map.getLayer('pois-fill') ? 'pois-fill' : undefined
      map.addLayer(
        { id: OVERLAY_SRC, type: 'raster', source: OVERLAY_SRC, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } },
        before,
      )
    } else {
      map.getSource(OVERLAY_SRC).setCoordinates(cornersToCoordinates(corners))
      if (map.getLayer(OVERLAY_SRC)) map.setPaintProperty(OVERLAY_SRC, 'raster-opacity', opacity)
    }
  }

  // ── Poignées de calage ─────────────────────────────────────────────────────
  function applyEditHandles(crs) {
    const map = mapRef.current
    if (!map) return
    if (map.getSource(HITBOX_SRC)) map.getSource(HITBOX_SRC).setData(hitboxFC(crs))
    if (map.getSource(CORNERS_SRC)) map.getSource(CORNERS_SRC).setData(cornersFC(crs))
    if (map.getSource(ROT_SRC)) map.getSource(ROT_SRC).setData(rotHandleFC(crs))
    if (map.getSource(ROTLINE_SRC)) map.getSource(ROTLINE_SRC).setData(rotLineFC(crs))
  }

  function syncEditHandles() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const show = editable && corners && corners.length === 4
    const showRotate = show && editMode === 'transform'
    toggleGeojsonLayer(map, HITBOX_SRC, show, hitboxFC(corners), {
      id: HITBOX_SRC, type: 'fill', source: HITBOX_SRC, paint: { 'fill-color': '#4d9fff', 'fill-opacity': 0.001 },
    }, map.getLayer('pois-fill') ? 'pois-fill' : undefined)
    toggleGeojsonLayer(map, ROTLINE_SRC, showRotate, rotLineFC(corners), {
      id: ROTLINE_SRC, type: 'line', source: ROTLINE_SRC, paint: { 'line-color': '#4d9fff', 'line-width': 1.5, 'line-dasharray': [2, 1] },
    })
    toggleGeojsonLayer(map, CORNERS_SRC, show, cornersFC(corners), {
      id: CORNERS_SRC, type: 'circle', source: CORNERS_SRC,
      paint: { 'circle-radius': 8, 'circle-color': '#4d9fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' },
    })
    toggleGeojsonLayer(map, ROT_SRC, showRotate, rotHandleFC(corners), {
      id: ROT_SRC, type: 'circle', source: ROT_SRC,
      paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#4d9fff' },
    })
  }

  // ── POIs ────────────────────────────────────────────────────────────────────
  function applyPois() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource(POIS_SRC)
    if (src) src.setData(poisToFC(poisRef.current, poiOverride.current))
  }

  function updateSelected(selId) {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const f = ['==', ['get', 'id'], selId || '__none__']
    if (map.getLayer('pois-sel-ring')) map.setFilter('pois-sel-ring', f)
    if (map.getLayer('pois-sel-outline')) map.setFilter('pois-sel-outline', f)
  }

  // ── Dessin (draft) ──────────────────────────────────────────────────────────
  function updateDraft(coords, tool) {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const lineCoords = coords
    const geojsonLine =
      tool === 'zone' && coords.length >= 3
        ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } }
        : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords } }
    ensureDraftLayers(map)
    map.getSource(DRAFT_SRC).setData({ type: 'FeatureCollection', features: lineCoords.length ? [geojsonLine] : [] })
    map.getSource(DRAFTPT_SRC).setData({
      type: 'FeatureCollection',
      features: draft.current.coords.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
    })
  }

  function clearDraft() {
    const map = mapRef.current
    if (!map) return
    if (map.getSource(DRAFT_SRC)) map.getSource(DRAFT_SRC).setData(emptyFC())
    if (map.getSource(DRAFTPT_SRC)) map.getSource(DRAFTPT_SRC).setData(emptyFC())
  }

  function finishDraft() {
    const map = mapRef.current
    const tool = drawToolRef.current
    const coords = dedupe(draft.current.coords)
    if (tool === 'line' && coords.length >= 2) {
      onDrawCompleteRef.current?.({ type: 'LineString', coordinates: coords })
    } else if (tool === 'zone' && coords.length >= 3) {
      onDrawCompleteRef.current?.({ type: 'Polygon', coordinates: [[...coords, coords[0]]] })
    }
    draft.current.coords = []
    if (map) clearDraft()
  }

  function cancelDraft() {
    draft.current.coords = []
    clearDraft()
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => { syncOverlay() }, [overlayUrl, corners, opacity])
  useEffect(() => { syncEditHandles() }, [editable, editMode, corners])
  useEffect(() => { applyPois() }, [pois])
  useEffect(() => { updateSelected(selectedPoiId) }, [selectedPoiId])
  // Reset du draft quand on change/désactive l'outil de dessin
  useEffect(() => { if (!drawTool) cancelDraft() }, [drawTool])
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
  )
}

/* ─── Sources/layers ──────────────────────────────────────────────────────── */

function addPoiLayers(map) {
  loadPoiIconImages(map)
  map.addSource(POIS_SRC, { type: 'geojson', data: emptyFC() })
  // Rayon du marqueur : plus grand si une icône l'habille.
  const hasIcon = ['to-boolean', ['get', 'icon']]
  // Surlignage sélection (outline sous les features)
  map.addLayer({
    id: 'pois-sel-outline', type: 'line', source: POIS_SRC,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: { 'line-color': '#fff', 'line-width': 4, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'pois-fill', type: 'fill', source: POIS_SRC,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 },
  })
  map.addLayer({
    id: 'pois-line', type: 'line', source: POIS_SRC,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 },
  })
  map.addLayer({
    id: 'pois-sel-ring', type: 'circle', source: POIS_SRC,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'circle-radius': ['case', hasIcon, 17, 12],
      'circle-color': 'rgba(255,255,255,0.001)',
      'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
    },
  })
  map.addLayer({
    id: 'pois-point', type: 'circle', source: POIS_SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['case', hasIcon, 13, 7],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
    },
  })
  // Icône (emoji) par-dessus la pastille colorée.
  map.addLayer({
    id: 'pois-icon', type: 'symbol', source: POIS_SRC,
    filter: ['all', ['==', ['geometry-type'], 'Point'], hasIcon],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': 0.62,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
  map.addLayer({
    id: 'pois-label', type: 'symbol', source: POIS_SRC,
    minzoom: 14,
    layout: {
      'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.4],
      'text-anchor': 'top', 'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
    },
    paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.4 },
  })
}

function ensureDraftLayers(map) {
  if (!map.getSource(DRAFT_SRC)) {
    map.addSource(DRAFT_SRC, { type: 'geojson', data: emptyFC() })
    map.addLayer({ id: 'draft-fill', type: 'fill', source: DRAFT_SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#4d9fff', 'fill-opacity': 0.2 } })
    map.addLayer({ id: 'draft-line', type: 'line', source: DRAFT_SRC, paint: { 'line-color': '#4d9fff', 'line-width': 2.5, 'line-dasharray': [2, 1] } })
  }
  if (!map.getSource(DRAFTPT_SRC)) {
    map.addSource(DRAFTPT_SRC, { type: 'geojson', data: emptyFC() })
    map.addLayer({ id: 'draft-pts', type: 'circle', source: DRAFTPT_SRC, paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': '#4d9fff' } })
  }
}

function toggleGeojsonLayer(map, id, show, data, layerDef, beforeId) {
  const hasSrc = map.getSource(id)
  if (!show) {
    if (map.getLayer(id)) map.removeLayer(id)
    if (hasSrc) map.removeSource(id)
    return
  }
  if (!hasSrc) {
    map.addSource(id, { type: 'geojson', data })
    map.addLayer(layerDef, beforeId)
  } else {
    map.getSource(id).setData(data)
  }
}

/* ─── GeoJSON helpers ─────────────────────────────────────────────────────── */

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}

function cornersFC(corners) {
  return {
    type: 'FeatureCollection',
    features: (corners || []).map((c, idx) => ({ type: 'Feature', properties: { idx }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })),
  }
}

function hitboxFC(corners) {
  if (!corners || corners.length !== 4) return emptyFC()
  const ring = [...corners, corners[0]].map((c) => [c.lng, c.lat])
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] }
}

function rotHandleFC(corners) {
  if (!corners || corners.length !== 4) return emptyFC()
  const p = rotateHandlePoint(corners)
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }] }
}

function rotLineFC(corners) {
  if (!corners || corners.length !== 4) return emptyFC()
  const topMid = { lng: (corners[0].lng + corners[1].lng) / 2, lat: (corners[0].lat + corners[1].lat) / 2 }
  const p = rotateHandlePoint(corners)
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[topMid.lng, topMid.lat], [p.lng, p.lat]] } }] }
}

function poisToFC(pois, override) {
  return {
    type: 'FeatureCollection',
    features: (pois || [])
      .filter((p) => p.geom && p.geom.type)
      .map((p) => {
        const geom = override && override.id === p.id ? override.geom : p.geom
        return {
          type: 'Feature',
          id: p.id,
          properties: { id: p.id, label: p.label || '', color: p.color || '#4d9fff', kind: p.kind, icon: p.icon || '' },
          geometry: geom,
        }
      }),
  }
}

function dedupe(coords) {
  const out = []
  for (const c of coords) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last[0] - c[0]) > 1e-9 || Math.abs(last[1] - c[1]) > 1e-9) out.push(c)
  }
  return out
}
