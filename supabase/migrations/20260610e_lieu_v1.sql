-- ============================================================================
-- Migration : LIEU V1 — Carte interactive (géoréférencement + POIs)
-- Date      : 2026-06-10
-- ============================================================================
--
-- Contexte :
--   Couche "Lieu" posée PAR-DESSUS l'outil `plans` existant. Permet à un admin
--   (web) de :
--     1. Caler un plan technique (raster de la table `plans`) sur une carte
--        réelle (satellite) → géoréférencement par 4 coins (quad).
--     2. Poser des POIs / zones / lignes sur la carte, liés au déroulé
--        (jour → lane → créneau), pour que le "Y aller" mobile pointe le vrai
--        lieu de rendez-vous.
--
--   Réutilise l'outil `plans` (PAS de nouvel outil_catalogue, PAS de nouvelle
--   permission) : RLS = can_read_outil / can_edit_outil(project_id, 'plans').
--   Cohérent avec la décision produit (la Carte est un sous-onglet de Plans).
--
-- Modèle :
--   - projet_lieu_maps     : 1+ carte par projet (centre/zoom/fond/opacité).
--   - projet_lieu_overlays : un plan raster calé sur une carte (4 coins lng/lat).
--   - projet_lieu_pois     : point / zone / ligne (GeoJSON) + liens déroulé.
--
-- Géométrie : stockée en JSONB GeoJSON (pas PostGIS — pas nécessaire pour de
--   l'affichage/centrage, et évite d'activer l'extension). `corners` d'un
--   overlay = 4 coins [{lng,lat}] dans l'ordre TL, TR, BR, BL (image source
--   MapLibre). `geom` d'un POI = une Geometry GeoJSON (Point/Polygon/LineString).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--   CREATE OR REPLACE, ON CONFLICT.
-- ============================================================================

BEGIN;


-- ── 1. Table projet_lieu_maps — une carte (vue) par projet ──────────────────
-- En pratique 1 carte/projet, mais on autorise plusieurs (ex: site + parking).
CREATE TABLE IF NOT EXISTS projet_lieu_maps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Carte du site',
  base_layer       text NOT NULL DEFAULT 'satellite'
                     CHECK (base_layer IN ('satellite', 'streets', 'plan')),
  center_lng       double precision,
  center_lat       double precision,
  zoom             double precision DEFAULT 15,
  default_opacity  double precision NOT NULL DEFAULT 0.7
                     CHECK (default_opacity >= 0 AND default_opacity <= 1),
  sort_order       integer NOT NULL DEFAULT 0,
  is_archived      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS projet_lieu_maps_project_idx
  ON projet_lieu_maps(project_id) WHERE NOT is_archived;

DROP TRIGGER IF EXISTS projet_lieu_maps_updated_at ON projet_lieu_maps;
CREATE TRIGGER projet_lieu_maps_updated_at
  BEFORE UPDATE ON projet_lieu_maps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projet_lieu_maps IS
  'LIEU V1 : une carte interactive d''un projet. center/zoom = vue par défaut au chargement. base_layer = fond affiché (satellite Esri par défaut). default_opacity = opacité initiale des overlays plan.';


-- ── 2. Table projet_lieu_overlays — plan raster géoréférencé ────────────────
-- Un overlay = un plan (table `plans`) calé sur une carte via 4 coins lng/lat.
-- plan_id nullable : permet aussi de caler une image ad-hoc plus tard (V2) ;
-- en V1 on cale toujours un plan existant.
CREATE TABLE IF NOT EXISTS projet_lieu_overlays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id        uuid NOT NULL REFERENCES projet_lieu_maps(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id       uuid REFERENCES plans(id) ON DELETE CASCADE,
  -- 4 coins de l'image dans l'ordre TL, TR, BR, BL : [{lng,lat},…]
  corners       jsonb NOT NULL,
  rotation_deg  double precision NOT NULL DEFAULT 0,
  opacity       double precision NOT NULL DEFAULT 0.7
                  CHECK (opacity >= 0 AND opacity <= 1),
  z             integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS projet_lieu_overlays_map_idx
  ON projet_lieu_overlays(map_id);
CREATE INDEX IF NOT EXISTS projet_lieu_overlays_plan_idx
  ON projet_lieu_overlays(plan_id) WHERE plan_id IS NOT NULL;

DROP TRIGGER IF EXISTS projet_lieu_overlays_updated_at ON projet_lieu_overlays;
CREATE TRIGGER projet_lieu_overlays_updated_at
  BEFORE UPDATE ON projet_lieu_overlays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projet_lieu_overlays IS
  'Un plan raster (table plans) calé sur une carte. corners = 4 coins lng/lat (ordre TL,TR,BR,BL) consommés directement par une image source MapLibre. opacity = réglage par overlay (le slider mobile/web part de là).';
COMMENT ON COLUMN projet_lieu_overlays.corners IS
  'JSONB array de 4 objets {lng,lat} dans l''ordre haut-gauche, haut-droit, bas-droit, bas-gauche. Correspond aux coordinates d''une image source MapLibre GL.';


-- ── 3. Table projet_lieu_pois — points / zones / lignes ─────────────────────
-- geom = GeoJSON Geometry. kind redondant avec geom.type mais pratique pour
-- filtrer/indexer côté UI sans parser le JSON.
CREATE TABLE IF NOT EXISTS projet_lieu_pois (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id        uuid NOT NULL REFERENCES projet_lieu_maps(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'point'
                  CHECK (kind IN ('point', 'zone', 'line')),
  label         text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#4d9fff',
  icon          text,                       -- nom d'icône (Lucide / set mobile)
  geom          jsonb NOT NULL,             -- GeoJSON Geometry
  notes         text,

  -- Liens optionnels vers le déroulé (le "Y aller" mobile s'en sert)
  deroule_id    uuid REFERENCES projet_deroules(id) ON DELETE SET NULL,
  lane_id       uuid REFERENCES projet_deroule_lanes(id) ON DELETE SET NULL,
  creneau_id    uuid REFERENCES projet_deroule_creneaux(id) ON DELETE SET NULL,

  sort_order    integer NOT NULL DEFAULT 0,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS projet_lieu_pois_map_idx
  ON projet_lieu_pois(map_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS projet_lieu_pois_creneau_idx
  ON projet_lieu_pois(creneau_id) WHERE creneau_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS projet_lieu_pois_lane_idx
  ON projet_lieu_pois(lane_id) WHERE lane_id IS NOT NULL;

DROP TRIGGER IF EXISTS projet_lieu_pois_updated_at ON projet_lieu_pois;
CREATE TRIGGER projet_lieu_pois_updated_at
  BEFORE UPDATE ON projet_lieu_pois
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projet_lieu_pois IS
  'POIs de la carte : point (rdv, régie, entrée…), zone (polygone) ou ligne (barriérage, accès). geom = GeoJSON Geometry. deroule_id/lane_id/creneau_id = liens optionnels vers le déroulé pour le "Y aller" mobile.';


-- ── 4. RLS — réutilise l'outil 'plans' (project-scoped) ─────────────────────
-- Pattern identique à plans_v1 : lecture si can_read_outil('plans'),
-- écriture si can_edit_outil('plans').

ALTER TABLE projet_lieu_maps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projet_lieu_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE projet_lieu_pois     ENABLE ROW LEVEL SECURITY;

-- maps
DROP POLICY IF EXISTS "lieu_maps_scoped_read"  ON projet_lieu_maps;
DROP POLICY IF EXISTS "lieu_maps_scoped_write" ON projet_lieu_maps;
CREATE POLICY "lieu_maps_scoped_read" ON projet_lieu_maps
  FOR SELECT USING (can_read_outil(project_id, 'plans'));
CREATE POLICY "lieu_maps_scoped_write" ON projet_lieu_maps
  FOR ALL
  USING      (can_edit_outil(project_id, 'plans'))
  WITH CHECK (can_edit_outil(project_id, 'plans'));

-- overlays
DROP POLICY IF EXISTS "lieu_overlays_scoped_read"  ON projet_lieu_overlays;
DROP POLICY IF EXISTS "lieu_overlays_scoped_write" ON projet_lieu_overlays;
CREATE POLICY "lieu_overlays_scoped_read" ON projet_lieu_overlays
  FOR SELECT USING (can_read_outil(project_id, 'plans'));
CREATE POLICY "lieu_overlays_scoped_write" ON projet_lieu_overlays
  FOR ALL
  USING      (can_edit_outil(project_id, 'plans'))
  WITH CHECK (can_edit_outil(project_id, 'plans'));

-- pois
DROP POLICY IF EXISTS "lieu_pois_scoped_read"  ON projet_lieu_pois;
DROP POLICY IF EXISTS "lieu_pois_scoped_write" ON projet_lieu_pois;
CREATE POLICY "lieu_pois_scoped_read" ON projet_lieu_pois
  FOR SELECT USING (can_read_outil(project_id, 'plans'));
CREATE POLICY "lieu_pois_scoped_write" ON projet_lieu_pois
  FOR ALL
  USING      (can_edit_outil(project_id, 'plans'))
  WITH CHECK (can_edit_outil(project_id, 'plans'));


COMMIT;
