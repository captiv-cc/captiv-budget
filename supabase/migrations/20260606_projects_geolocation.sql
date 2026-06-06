-- ════════════════════════════════════════════════════════════════════════════
-- FEST-5.1a — Géolocalisation des projets (pour Golden Hour + futures features)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Sprint 5 Festival : ajout d'un champ "lieu" (texte libre) + cache lat/lon
-- géocodé via Nominatim. Permet de calculer les heures de lever/coucher du
-- soleil et l'overlay golden hour sur la timeline du déroulé festival.
--
-- - lieu_text  : saisie utilisateur libre (ex: "Vand'B Fest, Vendeuvre-sur-Barse",
--                "Marseille 13002", ou même coordonnées brutes "44.84, -0.58")
-- - lat / lon  : cache du géocodage Nominatim. NUMERIC(9,6) = précision ~10cm.
-- - geocoded_at: timestamp du dernier géocodage, pour invalider le cache si
--                lieu_text change.
--
-- Tous les champs sont nullable : la géoloc reste optionnelle (un projet
-- studio en intérieur n'a pas besoin de golden hour).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projects ADD COLUMN IF NOT EXISTS lieu_text TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lat NUMERIC(9, 6);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lon NUMERIC(9, 6);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

-- Contraintes de plage (latitude ±90, longitude ±180)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lat_range;
ALTER TABLE projects ADD CONSTRAINT projects_lat_range
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lon_range;
ALTER TABLE projects ADD CONSTRAINT projects_lon_range
  CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180));

COMMENT ON COLUMN projects.lieu_text IS
  'Lieu/adresse du projet (saisie libre). Utilisé pour le géocodage Nominatim et le calcul du golden hour dans le déroulé festival.';
COMMENT ON COLUMN projects.lat IS
  'Latitude WGS84 (cache du géocodage de lieu_text via Nominatim). NULL = pas géocodé.';
COMMENT ON COLUMN projects.lon IS
  'Longitude WGS84 (cache du géocodage de lieu_text via Nominatim). NULL = pas géocodé.';
COMMENT ON COLUMN projects.geocoded_at IS
  'Timestamp du dernier géocodage réussi. Permet d''invalider le cache si lieu_text est modifié.';
