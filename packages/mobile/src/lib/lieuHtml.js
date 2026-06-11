// ════════════════════════════════════════════════════════════════════════════
// lib/lieuHtml.js — HTML auto-porté pour la WebView carte (MapLibre)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche : satellite Esri + overlay plan calé (PDF rasterisé via pdf.js) +
// POIs (pastille couleur + ombre + emoji + label) + focus pulsé.
//
// Contrôles : slider d'opacité + toggle Plan (in-HTML). Recentrage via
// window.__recenter() (appelé en injectJavaScript). Tap POI → postMessage
// {type:'poi_tap', ...} → carte d'info native côté RN.
// ════════════════════════════════════════════════════════════════════════════

const POI_EMOJI = {
  pin: '📍', flag: '🚩', star: '⭐', camera: '📷', video: '🎥', truck: '🚚',
  tent: '⛺', parking: '🅿️', info: 'ℹ️', 'first-aid': '⛑️', toilet: '🚻',
  food: '🍔', stage: '🎤', music: '🎵', door: '🚪',
}

export function buildMapHtml({ center, zoom = 15, overlay = null, pois = [], focus = null } = {}) {
  const data = {
    center: center || { lng: 2.35, lat: 48.85 },
    zoom,
    overlay: overlay && overlay.url && Array.isArray(overlay.corners)
      ? { url: overlay.url, corners: overlay.corners, opacity: overlay.opacity ?? 0.7, fileType: overlay.fileType || 'png' }
      : null,
    pois: (pois || []).filter((p) => p?.geom?.type),
    focus: focus || null,
    emoji: POI_EMOJI,
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0A0A0B; }
  .maplibregl-ctrl-attrib { font-size:9px; }

  /* Contrôle opacité + toggle plan */
  #ctrl { position:fixed; left:12px; bottom:18px; display:flex; align-items:center; gap:10px;
    background:rgba(18,20,26,0.86); border:1px solid rgba(255,255,255,0.14); backdrop-filter:blur(8px);
    border-radius:14px; padding:9px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.4); }
  #toggle { display:flex; align-items:center; gap:5px; background:none; border:none; color:#fff;
    font:600 12px -apple-system,system-ui,sans-serif; padding:0; }
  #toggle .dot { width:9px; height:9px; border-radius:5px; background:#4d9fff; }
  #toggle.off { color:rgba(255,255,255,0.45); }
  #toggle.off .dot { background:rgba(255,255,255,0.3); }
  #op { -webkit-appearance:none; width:120px; height:4px; border-radius:2px;
    background:rgba(255,255,255,0.25); outline:none; }
  #op::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:9px;
    background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.4); }

  /* Marqueur focus pulsé */
  .focus-pin { width:18px; height:18px; }
  .focus-pin .core { position:absolute; left:0; top:0; width:18px; height:18px; border-radius:9px;
    background:#4d9fff; border:3px solid #fff; box-sizing:border-box; box-shadow:0 1px 6px rgba(0,0,0,0.5); }
  .focus-pin .ring { position:absolute; left:-3px; top:-3px; width:24px; height:24px; border-radius:14px;
    border:2px solid #4d9fff; animation:pulse 1.8s ease-out infinite; }
  @keyframes pulse { 0%{ transform:scale(0.7); opacity:0.9; } 100%{ transform:scale(2.6); opacity:0; } }
</style>
</head>
<body>
<div id="map"></div>
<div id="ctrl" style="display:none">
  <button id="toggle"><span class="dot"></span>Plan</button>
  <input id="op" type="range" min="0" max="1" step="0.05" value="0.7" />
</div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
const D = ${json};
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const map = new maplibregl.Map({
  container:'map',
  style:{ version:8, glyphs:'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources:{ esri:{ type:'raster', tiles:[ESRI], tileSize:256, maxzoom:19, attribution:'© Esri' } },
    layers:[{ id:'esri', type:'raster', source:'esri' }] },
  center:[D.center.lng, D.center.lat],
  zoom: D.focus ? 17 : D.zoom,
  attributionControl:{ compact:true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');

function post(m){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }

function loadIcons(){
  const r=2,px=44;
  for(const k in D.emoji){ try{
    const c=document.createElement('canvas'); c.width=px; c.height=px;
    const x=c.getContext('2d'); x.font=Math.round(px*0.78)+'px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
    x.textAlign='center'; x.textBaseline='middle'; x.fillText(D.emoji[k], px/2, px/2+px*0.04);
    if(!map.hasImage(k)) map.addImage(k, x.getImageData(0,0,px,px), { pixelRatio:r });
  }catch(e){} }
}

function poisFC(){
  return { type:'FeatureCollection', features: D.pois.map(function(p){
    return { type:'Feature', id:p.id, properties:{ id:p.id, label:p.label||'', color:p.color||'#4d9fff', icon:p.icon||'', notes:p.notes||'' }, geometry:p.geom };
  }) };
}

function collect(geom, b){
  if(!geom) return;
  if(geom.type==='Point'){ b.extend(geom.coordinates); }
  else if(geom.type==='LineString'){ geom.coordinates.forEach(function(c){ b.extend(c); }); }
  else if(geom.type==='Polygon'){ geom.coordinates[0].forEach(function(c){ b.extend(c); }); }
}

window.__recenter = function(){
  if(D.focus){ map.flyTo({ center:[D.focus.lng,D.focus.lat], zoom:17.5, duration:600 }); return; }
  var b = new maplibregl.LngLatBounds(); var any=false;
  D.pois.forEach(function(p){ collect(p.geom, b); any=true; });
  if(D.overlay) D.overlay.corners.forEach(function(c){ b.extend([c.lng,c.lat]); any=true; });
  if(any){ try{ map.fitBounds(b, { padding:60, duration:600, maxZoom:18 }); }catch(e){} }
};

async function addOverlay(){
  if(!D.overlay) return;
  let url = D.overlay.url;
  try{
    if(D.overlay.fileType==='pdf'){
      const pdfjs = await import('https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc='https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ url }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale:1 });
      const scale = Math.min(Math.max(2400/base.width,1),4);
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
      const cx = cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height);
      await page.render({ canvasContext:cx, viewport:vp }).promise;
      url = cv.toDataURL('image/png');
    }
  }catch(e){ post({ type:'overlay_error', msg:String(e) }); return; }
  const coords = D.overlay.corners.map(function(c){ return [c.lng, c.lat]; });
  map.addSource('overlay', { type:'image', url:url, coordinates:coords });
  const before = map.getLayer('pois-shadow') ? 'pois-shadow' : undefined;
  map.addLayer({ id:'overlay', type:'raster', source:'overlay', paint:{ 'raster-opacity':D.overlay.opacity, 'raster-fade-duration':0 } }, before);
  // Active le contrôle d'opacité
  const ctrl=document.getElementById('ctrl'); ctrl.style.display='flex';
  const op=document.getElementById('op'); op.value=String(D.overlay.opacity);
  op.addEventListener('input', function(){ if(map.getLayer('overlay')) map.setPaintProperty('overlay','raster-opacity', parseFloat(op.value)); });
  let vis=true; const tg=document.getElementById('toggle');
  tg.addEventListener('click', function(){ vis=!vis; if(map.getLayer('overlay')) map.setLayoutProperty('overlay','visibility', vis?'visible':'none'); tg.classList.toggle('off', !vis); });
}

map.on('load', function(){
  loadIcons();
  map.addSource('pois', { type:'geojson', data:poisFC() });
  const hasIcon = ['to-boolean',['get','icon']];
  map.addLayer({ id:'pois-fill', type:'fill', source:'pois', filter:['==',['geometry-type'],'Polygon'], paint:{ 'fill-color':['get','color'], 'fill-opacity':0.28 } });
  map.addLayer({ id:'pois-line', type:'line', source:'pois', filter:['in',['geometry-type'],['literal',['Polygon','LineString']]], paint:{ 'line-color':['get','color'], 'line-width':2.5 } });
  map.addLayer({ id:'pois-shadow', type:'circle', source:'pois', filter:['==',['geometry-type'],'Point'], paint:{ 'circle-radius':['case',hasIcon,15,9], 'circle-color':'rgba(0,0,0,0.35)', 'circle-blur':0.7, 'circle-translate':[0,1.5] } });
  map.addLayer({ id:'pois-point', type:'circle', source:'pois', filter:['==',['geometry-type'],'Point'], paint:{ 'circle-radius':['case',hasIcon,12,6.5], 'circle-color':['get','color'], 'circle-stroke-width':1.5, 'circle-stroke-color':'#fff' } });
  map.addLayer({ id:'pois-icon', type:'symbol', source:'pois', filter:['all',['==',['geometry-type'],'Point'],hasIcon], layout:{ 'icon-image':['get','icon'], 'icon-size':0.58, 'icon-allow-overlap':true, 'icon-ignore-placement':true } });
  map.addLayer({ id:'pois-label', type:'symbol', source:'pois', minzoom:14, layout:{ 'text-field':['get','label'], 'text-size':12, 'text-offset':[0,1.5], 'text-anchor':'top', 'text-font':['Open Sans Regular','Noto Sans Regular'], 'text-optional':true }, paint:{ 'text-color':'#fff', 'text-halo-color':'rgba(0,0,0,0.85)', 'text-halo-width':1.4 } });

  addOverlay();

  if(D.focus){
    const el=document.createElement('div'); el.className='focus-pin';
    el.innerHTML='<div class="ring"></div><div class="core"></div>';
    new maplibregl.Marker({ element:el, anchor:'center' }).setLngLat([D.focus.lng,D.focus.lat]).addTo(map);
    map.flyTo({ center:[D.focus.lng,D.focus.lat], zoom:17.5, duration:600 });
  }

  ['pois-point','pois-fill','pois-line'].forEach(function(layer){
    map.on('click', layer, function(e){
      const f=e.features&&e.features[0]; if(!f) return;
      const p=f.properties||{};
      post({ type:'poi_tap', id:p.id, label:p.label||'', notes:p.notes||'', lng:e.lngLat.lng, lat:e.lngLat.lat });
    });
    map.on('mouseenter', layer, function(){ map.getCanvas().style.cursor='pointer'; });
    map.on('mouseleave', layer, function(){ map.getCanvas().style.cursor=''; });
  });

  post({ type:'ready' });
});
</script>
</body>
</html>`
}
