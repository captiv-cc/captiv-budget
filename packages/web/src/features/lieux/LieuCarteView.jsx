// ════════════════════════════════════════════════════════════════════════════
// LieuCarteView — sous-onglet "Carte" de l'outil Plans
// ════════════════════════════════════════════════════════════════════════════
//
// P1 : géoréférencement. L'admin recherche le lieu, choisit un plan (image OU
// PDF rasterisé), le cale sur le satellite (déplacer / agrandir / pivoter /
// déformer), règle l'opacité, enregistre. Lecture seule sinon.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Crosshair,
  Check,
  Hexagon,
  Info,
  Loader2,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Move,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Spline,
  X,
} from 'lucide-react'

import LieuMap from './LieuMap'
import LieuPoiPanel from './LieuPoiPanel'
import { cornersForAspect, scaleCorners, rotateCorners } from './transform'
import { loadPlanRaster } from './planRaster'
import {
  getOrCreateMap,
  listOverlays,
  createOverlay,
  updateOverlay,
  deleteOverlay,
  updateMap,
  listPois,
  createPoi,
  updatePoi,
  deletePoi,
} from '../../lib/lieux'
import { getSignedUrl } from '../../lib/plans'
import { geocodeSearch } from '../../lib/geocode'
import { fetchDerouleComplet, fetchProjectLanes, formatMinHHMM, defaultLaneLibelle } from '../../lib/deroule'
import { notify } from '../../lib/notify'

function formatJourShort(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

const DEFAULT_CENTER = { lng: 2.35, lat: 48.85 }

export default function LieuCarteView({ projectId, project, plans = [], canEdit = false, onBack }) {
  const [map, setMap] = useState(null)
  const [overlay, setOverlay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedPlanId, setSelectedPlanId] = useState(null)
  const [overlayUrl, setOverlayUrl] = useState(null)
  const [rasterLoading, setRasterLoading] = useState(false)
  const [corners, setCorners] = useState(null)
  const [opacity, setOpacity] = useState(0.7)
  const [calage, setCalage] = useState(false)
  const [editMode, setEditMode] = useState('transform') // 'transform' | 'deform'

  // P2 — POIs
  const [mode, setMode] = useState('calage') // 'calage' | 'poi'
  const [pois, setPois] = useState([])
  const [selectedPoiId, setSelectedPoiId] = useState(null)
  const [drawTool, setDrawTool] = useState(null) // null | 'point' | 'zone' | 'line'
  const [poiSaving, setPoiSaving] = useState(false)

  const mapInstanceRef = useRef(null)
  const viewRef = useRef({ center: DEFAULT_CENTER, zoom: 14 })
  const rasterRef = useRef({ objectUrl: null, revoke: false, aspect: 1.4 })
  const pendingInitRef = useRef(false)

  // Tous les plans non archivés (PDF inclus — rasterisés au calage).
  const calablePlans = useMemo(
    () => plans.filter((p) => !p.is_archived && ['png', 'jpg', 'pdf'].includes(p.file_type)),
    [plans],
  )

  // ── Centre par défaut : coordonnées du projet si dispo ────────────────────
  const projectCenter = useMemo(() => {
    const lat = project?.lat ?? project?.latitude
    const lon = project?.lon ?? project?.longitude
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lng: lon, lat }
    return null
  }, [project])

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const m = await getOrCreateMap(projectId)
        if (!alive) return
        setMap(m)
        setOpacity(m.default_opacity ?? 0.7)
        if (m.center_lng != null && m.center_lat != null) {
          viewRef.current = { center: { lng: m.center_lng, lat: m.center_lat }, zoom: m.zoom ?? 15 }
        } else if (projectCenter) {
          viewRef.current = { center: projectCenter, zoom: 15 }
        }
        const ovs = await listOverlays(m.id)
        if (!alive) return
        const ov = ovs[0] || null
        if (ov) {
          setOverlay(ov)
          setSelectedPlanId(ov.plan_id)
          setCorners(ov.corners)
          setOpacity(ov.opacity ?? m.default_opacity ?? 0.7)
        }
      } catch (err) {
        console.error('[LieuCarteView] load', err)
        notify.error(err.message || 'Erreur de chargement de la carte')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [projectId, projectCenter])

  // ── Chargement du raster du plan sélectionné (image directe ou PDF rasterisé)
  useEffect(() => {
    let alive = true
    if (!selectedPlanId) {
      revokeRaster()
      setOverlayUrl(null)
      return
    }
    const plan = plans.find((p) => p.id === selectedPlanId)
    if (!plan?.storage_path) return
    setRasterLoading(true)
    ;(async () => {
      try {
        const signed = await getSignedUrl(plan.storage_path)
        const raster = await loadPlanRaster({ url: signed, fileType: plan.file_type })
        if (!alive) {
          if (raster.revoke) URL.revokeObjectURL(raster.objectUrl)
          return
        }
        revokeRaster()
        rasterRef.current = {
          objectUrl: raster.objectUrl,
          revoke: raster.revoke,
          aspect: raster.height ? raster.width / raster.height : 1.4,
        }
        setOverlayUrl(raster.objectUrl)
        // Init des coins si nouveau calage.
        if (pendingInitRef.current) {
          const c = viewRef.current.center || DEFAULT_CENTER
          setCorners(cornersForAspect(c, rasterRef.current.aspect, 500))
          pendingInitRef.current = false
        }
      } catch (err) {
        console.error('[LieuCarteView] raster', err)
        if (alive) {
          notify.error(err.message || 'Impossible de charger ce plan')
          setOverlayUrl(null)
        }
      } finally {
        if (alive) setRasterLoading(false)
      }
    })()
    return () => { alive = false }
     
  }, [selectedPlanId, plans])

  function revokeRaster() {
    const r = rasterRef.current
    if (r?.revoke && r.objectUrl) {
      try { URL.revokeObjectURL(r.objectUrl) } catch { /* noop */ }
    }
  }
  useEffect(() => () => revokeRaster(), [])

  // ── Sélection d'un plan ───────────────────────────────────────────────────
  const handleSelectPlan = useCallback((planId) => {
    setSelectedPlanId(planId || null)
    if (planId && planId !== overlay?.plan_id) {
      pendingInitRef.current = true // (re)initialise les coins après chargement
    }
    if (planId) setCalage(true)
  }, [overlay])

  const handleMoveEnd = useCallback((center, zoom) => {
    viewRef.current = { center, zoom }
  }, [])

  const handleMapReady = useCallback((m) => {
    mapInstanceRef.current = m
  }, [])

  // ── POIs : chargement + CRUD ──────────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    let alive = true
    listPois(map.id)
      .then((d) => { if (alive) setPois(d) })
      .catch((err) => console.warn('[LieuCarteView] listPois', err))
    return () => { alive = false }
  }, [map])

  const kindFromGeom = (g) =>
    g.type === 'Point' ? 'point' : g.type === 'Polygon' ? 'zone' : 'line'

  const handleDrawComplete = useCallback(async (geom) => {
    if (!map) return
    try {
      const created = await createPoi({
        mapId: map.id, projectId, kind: kindFromGeom(geom), geom, color: '#4d9fff',
      })
      setPois((prev) => [...prev, created])
      setSelectedPoiId(created.id)
      setDrawTool(null)
    } catch (err) {
      notify.error(err.message || 'Échec de la création du repère')
    }
  }, [map, projectId])

  const handleSelectPoi = useCallback((id) => {
    setSelectedPoiId(id)
    if (id) setDrawTool(null)
  }, [])

  const handlePoiMove = useCallback(async (id, geom) => {
    setPois((prev) => prev.map((p) => (p.id === id ? { ...p, geom } : p)))
    try { await updatePoi(id, { geom }) } catch { notify.error('Échec du repositionnement') }
  }, [])

  const handleSavePoi = useCallback(async (id, fields) => {
    setPoiSaving(true)
    try {
      const up = await updatePoi(id, fields)
      setPois((prev) => prev.map((p) => (p.id === id ? up : p)))
      notify.success('Repère enregistré')
    } catch (err) {
      notify.error(err.message || 'Échec de l’enregistrement')
    } finally {
      setPoiSaving(false)
    }
  }, [])

  const handleDeletePoi = useCallback(async (id) => {
    try {
      await deletePoi(id)
      setPois((prev) => prev.filter((p) => p.id !== id))
      setSelectedPoiId(null)
    } catch (err) {
      notify.error(err.message || 'Échec de la suppression')
    }
  }, [])

  const toggleTool = (t) => {
    setDrawTool((prev) => (prev === t ? null : t))
    setSelectedPoiId(null)
  }

  const selectedPoi = pois.find((p) => p.id === selectedPoiId) || null

  // ── Index déroulé (pour résumer le lien d'un POI dans la liste) ───────────
  const [derouleIndex, setDerouleIndex] = useState({ deroules: {}, creneaux: {} })
  const [laneById, setLaneById] = useState({})
  useEffect(() => {
    const ids = [...new Set(pois.map((p) => p.deroule_id).filter(Boolean))]
    if (!ids.length) { setDerouleIndex({ deroules: {}, creneaux: {} }); return }
    let alive = true
    Promise.all(ids.map((id) => fetchDerouleComplet(id).catch(() => null))).then((list) => {
      if (!alive) return
      const deroules = {}, creneaux = {}
      for (const d of list) {
        if (!d?.deroule) continue
        deroules[d.deroule.id] = d.deroule
        for (const c of d.creneaux || []) creneaux[c.id] = c
      }
      setDerouleIndex({ deroules, creneaux })
    })
    return () => { alive = false }
  }, [pois])

  // Lanes du projet (pour résoudre lane_id → libellé, lien scène transversal).
  useEffect(() => {
    if (!projectId) return
    let alive = true
    fetchProjectLanes(projectId)
      .then((ls) => { if (alive) setLaneById(Object.fromEntries(ls.map((l) => [l.id, l]))) })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId])

  const linkLabelFor = useCallback((poi) => {
    const { deroules, creneaux } = derouleIndex
    const jour = poi.deroule_id && deroules[poi.deroule_id] ? formatJourShort(deroules[poi.deroule_id].date_jour) : null
    if (poi.creneau_id && creneaux[poi.creneau_id]) {
      const c = creneaux[poi.creneau_id]
      return `${jour ? `${jour} · ` : ''}${formatMinHHMM(c.heure_debut_min)} ${c.titre || c.type || ''}`.trim()
    }
    if (poi.lane_id && laneById[poi.lane_id]) {
      const l = laneById[poi.lane_id]
      return l.libelle || defaultLaneLibelle(l.sort_order)
    }
    return jour
  }, [derouleIndex, laneById])

  // ── Boutons de transformation ─────────────────────────────────────────────
  const rotateBy = (deg) => setCorners((c) => (c ? rotateCorners(c, deg) : c))
  const scaleBy = (f) => setCorners((c) => (c ? scaleCorners(c, f) : c))
  const recenterPlan = () =>
    setCorners(cornersForAspect(viewRef.current.center || DEFAULT_CENTER, rasterRef.current.aspect, 500))

  // ── Recherche de lieu ─────────────────────────────────────────────────────
  const handleGeocodePick = useCallback((res) => {
    const m = mapInstanceRef.current
    if (!m) return
    if (res.bbox) {
      const [w, s, e, n] = res.bbox
      m.fitBounds([[w, s], [e, n]], { padding: 40, duration: 800 })
    } else {
      m.flyTo({ center: [res.lon, res.lat], zoom: 16, duration: 800 })
    }
  }, [])

  // ── Enregistrement ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!map || !selectedPlanId || !corners) return
    setSaving(true)
    try {
      await updateMap(map.id, {
        center_lng: viewRef.current.center?.lng,
        center_lat: viewRef.current.center?.lat,
        zoom: viewRef.current.zoom,
        default_opacity: opacity,
      })
      let saved
      if (overlay) {
        saved = await updateOverlay(overlay.id, { corners, opacity, plan_id: selectedPlanId })
      } else {
        saved = await createOverlay({ mapId: map.id, projectId, planId: selectedPlanId, corners, opacity })
      }
      setOverlay(saved)
      setCalage(false)
      notify.success('Calage enregistré')
    } catch (err) {
      console.error('[LieuCarteView] save', err)
      notify.error(err.message || 'Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }, [map, overlay, selectedPlanId, corners, opacity, projectId])

  const handleRemoveOverlay = useCallback(async () => {
    if (!overlay) return
    setSaving(true)
    try {
      await deleteOverlay(overlay.id)
      setOverlay(null)
      setSelectedPlanId(null)
      setCorners(null)
      revokeRaster()
      setOverlayUrl(null)
      setCalage(false)
      notify.success('Plan retiré de la carte')
    } catch (err) {
      notify.error(err.message || 'Échec de la suppression')
    } finally {
      setSaving(false)
    }
     
  }, [overlay])

  const selectedPlan = plans.find((p) => p.id === selectedPlanId)

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* Header */}
      <header className="flex items-start gap-3 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
          title="Retour aux plans"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue-bg)' }}>
          <MapIcon className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--txt)' }}>
            Carte du site
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {project?.title ? `${project.title} · ` : ''}
            {overlay ? 'Plan calé sur le satellite' : 'Aucun plan calé pour l’instant'}
          </p>
        </div>
      </header>

      {/* Toggle de mode : Calage / Points & zones */}
      {canEdit && (
        <div className="inline-flex items-center gap-1 mb-3 p-1 rounded-lg" style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}>
          <ModeBtn active={mode === 'calage'} onClick={() => { setMode('calage'); setDrawTool(null); setSelectedPoiId(null) }}>
            Calage du plan
          </ModeBtn>
          <ModeBtn active={mode === 'poi'} onClick={() => { setMode('poi'); setCalage(false) }}>
            Points & zones
          </ModeBtn>
        </div>
      )}

      {/* Barre d'outils de calage */}
      {canEdit && mode === 'calage' && (
        <div
          className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-lg"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
        >
          <label className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>Plan&nbsp;:</label>
          <select
            value={selectedPlanId || ''}
            onChange={(e) => handleSelectPlan(e.target.value || null)}
            className="text-sm px-2 py-1.5 rounded-md outline-none"
            style={{ background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--brd)', maxWidth: 220 }}
          >
            <option value="">— Choisir un plan —</option>
            {calablePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.file_type === 'pdf' ? ' (PDF)' : ''}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>Opacité</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              style={{ width: 100 }}
            />
            <span className="text-xs tabular-nums w-8" style={{ color: 'var(--txt-3)' }}>
              {Math.round(opacity * 100)}%
            </span>
          </div>

          <div className="flex-1" />

          {selectedPlanId && (
            <button
              type="button"
              onClick={() => setCalage((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: calage ? 'var(--blue-bg)' : 'var(--bg)',
                color: calage ? 'var(--blue)' : 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
            >
              <Crosshair className="w-3.5 h-3.5" />
              {calage ? 'Calage actif' : 'Caler le plan'}
            </button>
          )}

          {overlay && (
            <button
              type="button"
              onClick={handleRemoveOverlay}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{ background: 'var(--bg)', color: 'var(--txt-3)', border: '1px solid var(--brd)' }}
            >
              Retirer
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !selectedPlanId || !corners}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
            style={{ background: 'var(--blue)', color: 'white', opacity: saving || !selectedPlanId || !corners ? 0.5 : 1 }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
        </div>
      )}

      {/* Sous-barre transformations (calage actif) */}
      {canEdit && calage && selectedPlanId && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Rotation : pas fin + grossier */}
          <div className="flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5 mr-0.5" style={{ color: 'var(--txt-3)' }} />
            <StepBtn onClick={() => rotateBy(-15)}>−15°</StepBtn>
            <StepBtn onClick={() => rotateBy(-1)}>−1°</StepBtn>
            <StepBtn onClick={() => rotateBy(1)}>+1°</StepBtn>
            <StepBtn onClick={() => rotateBy(15)}>+15°</StepBtn>
          </div>

          <div className="w-px h-5" style={{ background: 'var(--brd)' }} />

          {/* Taille : pas fin + grossier */}
          <div className="flex items-center gap-1">
            <Maximize2 className="w-3.5 h-3.5 mr-0.5" style={{ color: 'var(--txt-3)' }} />
            <StepBtn onClick={() => scaleBy(0.9)}>−10%</StepBtn>
            <StepBtn onClick={() => scaleBy(0.98)}>−2%</StepBtn>
            <StepBtn onClick={() => scaleBy(1.02)}>+2%</StepBtn>
            <StepBtn onClick={() => scaleBy(1.1)}>+10%</StepBtn>
          </div>

          <div className="w-px h-5" style={{ background: 'var(--brd)' }} />

          <TransformBtn icon={Move} label="Recentrer" onClick={recenterPlan} />
          <button
            type="button"
            onClick={() => setEditMode((m) => (m === 'deform' ? 'transform' : 'deform'))}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors"
            style={{
              background: editMode === 'deform' ? 'var(--blue-bg)' : 'var(--bg-elev)',
              color: editMode === 'deform' ? 'var(--blue)' : 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
            title="Mode déformation : déplacer chaque coin indépendamment (corrige la perspective)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Déformer {editMode === 'deform' ? '(actif)' : ''}
          </button>
        </div>
      )}

      {/* Aide */}
      {canEdit && calage && (
        <div
          className="flex items-start gap-2 mb-3 px-3 py-2 rounded-md text-xs"
          style={{ background: 'var(--blue-bg)', color: 'var(--txt-2)' }}
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--blue)' }} />
          <span>
            {editMode === 'deform'
              ? 'Mode déformation : glisse chaque coin bleu indépendamment pour corriger la perspective.'
              : 'Glisse le plan pour le déplacer, un coin pour l’agrandir, la poignée du haut pour pivoter ; les boutons ci-dessus affinent au degré / au %.'}{' '}
            Pour <strong>naviguer la carte</strong> par-dessus le plan : <strong>maintiens Espace</strong> et glisse (ou <strong>clic molette</strong>). Baisse l’opacité pour vérifier, puis <strong>Enregistrer</strong>.
          </span>
        </div>
      )}

      {/* Barre d'outils POIs */}
      {canEdit && mode === 'poi' && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <ToolBtn active={drawTool === 'point'} icon={MapPin} label="Point" onClick={() => toggleTool('point')} />
          <ToolBtn active={drawTool === 'zone'} icon={Hexagon} label="Zone" onClick={() => toggleTool('zone')} />
          <ToolBtn active={drawTool === 'line'} icon={Spline} label="Ligne" onClick={() => toggleTool('line')} />
          {drawTool === 'point' && (
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>Clique sur la carte pour poser le point.</span>
          )}
          {(drawTool === 'zone' || drawTool === 'line') && (
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Clique pour ajouter des sommets, <strong>double-clic</strong> (ou Entrée) pour terminer, Échap pour annuler.
            </span>
          )}
          {!drawTool && (
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Choisis un outil, ou clique un repère pour l’éditer. Espace/clic molette pour naviguer.
            </span>
          )}
        </div>
      )}

      {/* Carte (+ panneau POIs en mode points) */}
      <div className="flex gap-3">
        <div
          className="flex-1 rounded-xl overflow-hidden relative"
          style={{ border: '1px solid var(--brd)', height: 'min(72vh, 760px)' }}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--bg-elev)' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
            </div>
          ) : (
            <>
              <LieuMap
                center={viewRef.current.center}
                zoom={viewRef.current.zoom}
                overlayUrl={overlayUrl}
                corners={corners}
                opacity={opacity}
                editable={canEdit && mode === 'calage' && calage}
                editMode={editMode}
                pois={pois}
                poiMode={canEdit && mode === 'poi'}
                drawTool={drawTool}
                selectedPoiId={selectedPoiId}
                onCornersChange={setCorners}
                onMoveEnd={handleMoveEnd}
                onReady={handleMapReady}
                onDrawComplete={handleDrawComplete}
                onSelectPoi={handleSelectPoi}
                onPoiMove={handlePoiMove}
              />

              {/* Recherche de lieu (overlay haut-gauche) */}
              <GeocodeSearch onPick={handleGeocodePick} />

              {/* Spinner rasterisation PDF */}
              {rasterLoading && (
                <div
                  className="absolute top-3 right-14 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', backdropFilter: 'blur(4px)' }}
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Préparation du plan…
                </div>
              )}
            </>
          )}
        </div>

        {/* Panneau POIs */}
        {canEdit && mode === 'poi' && (
          <LieuPoiPanel
            pois={pois}
            selectedPoi={selectedPoi}
            projectId={projectId}
            saving={poiSaving}
            linkLabelFor={linkLabelFor}
            onSelect={handleSelectPoi}
            onSave={handleSavePoi}
            onDelete={handleDeletePoi}
          />
        )}
      </div>

      {!canEdit && (
        <p className="mt-2 text-xs flex items-center gap-1.5" style={{ color: 'var(--txt-3)' }}>
          <Check className="w-3.5 h-3.5" /> Lecture seule — calage géré par la production.
        </p>
      )}
      {selectedPlan && (
        <p className="mt-2 text-xs" style={{ color: 'var(--txt-3)' }}>
          Plan affiché&nbsp;: <strong style={{ color: 'var(--txt-2)' }}>{selectedPlan.name}</strong>
        </p>
      )}
    </div>
  )
}

/* ─── Sous-composants ─────────────────────────────────────────────────────── */

function ModeBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
      style={{ background: active ? 'var(--blue)' : 'transparent', color: active ? '#fff' : 'var(--txt-2)' }}
    >
      {children}
    </button>
  )
}

function ToolBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
        color: active ? 'var(--blue)' : 'var(--txt-2)',
        border: '1px solid var(--brd)',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function StepBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold px-2 py-1.5 rounded-md tabular-nums transition-colors"
      style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)', minWidth: 42 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)'; e.currentTarget.style.color = 'var(--txt)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elev)'; e.currentTarget.style.color = 'var(--txt-2)' }}
    >
      {children}
    </button>
  )
}

function TransformBtn({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors"
      style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elev)' }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function GeocodeSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setSearching(true)
      try {
        const res = await geocodeSearch(q, { limit: 5, signal: ctrl.signal })
        setResults(res)
        setOpen(true)
      } catch { /* noop */ } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="absolute top-3 left-3" style={{ width: 300, maxWidth: '70%', zIndex: 5 }}>
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
        style={{ background: 'rgba(20,22,28,0.92)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }}
      >
        {searching ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }} />
        ) : (
          <Search className="w-4 h-4 shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }} />
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Rechercher un lieu (festival, adresse…)"
          className="flex-1 text-sm bg-transparent outline-none"
          style={{ color: '#fff' }}
        />
        {q && (
          <button type="button" onClick={() => { setQ(''); setResults([]); setOpen(false) }} style={{ color: 'rgba(255,255,255,0.6)' }}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div
          className="mt-1 rounded-lg overflow-hidden"
          style={{ background: 'rgba(20,22,28,0.96)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }}
        >
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(r); setOpen(false) }}
              className="block w-full text-left px-3 py-2 text-xs transition-colors"
              style={{ color: 'rgba(255,255,255,0.85)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
