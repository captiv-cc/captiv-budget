-- ════════════════════════════════════════════════════════════════════════════
-- PROJ-PERIODES — colonne `metadata` jsonb sur events + CHECK source élargi
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ajoute une colonne `metadata` jsonb sur events pour stocker des informations
-- auxiliaires (notamment la provenance d'une projection depuis une période
-- projet : tournage / prépa / etc.). Utilisé par projectPeriodSync.js.
--
-- Élargit aussi le CHECK constraint sur `source` pour accepter la nouvelle
-- valeur `'project_periode_tournage'` (et permet de futurs miroirs prepa,
-- envoi_v1, etc. sans migration supplémentaire grâce à un préfixe).
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Ajout de la colonne metadata (jsonb) — null par défaut, valeur libre.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Index GIN pour les requêtes filter('metadata->>source', 'eq', '...')
CREATE INDEX IF NOT EXISTS events_metadata_idx
  ON events USING GIN (metadata);

-- 2) Élargissement du CHECK source pour accepter les marqueurs périodes
-- projet. Le CHECK historique s'appelle `events_source_valid` (cf. LIV-1).
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_source_valid;
-- Sécurité : l'ancien nom `events_source_check` (variation possible) est
-- aussi nettoyé pour être idempotent.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_source_check;

ALTER TABLE events
  ADD CONSTRAINT events_source_valid
  CHECK (
    source IS NULL
    OR source IN ('manual', 'livrable_etape', 'projet_phase')
    OR source LIKE 'project_periode_%'
  );

-- 2b) Cohérence source ↔ FK : les events sourcés `project_periode_*` n'ont
-- ni `livrable_etape_id` ni `projet_phase_id` (ils ne sont pas reliés à
-- une étape ou phase, ils projettent une période saisie dans le projet).
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_source_fk_consistency;

ALTER TABLE events
  ADD CONSTRAINT events_source_fk_consistency
  CHECK (
    (source = 'livrable_etape'
       AND livrable_etape_id IS NOT NULL AND projet_phase_id   IS NULL)
    OR (source = 'projet_phase'
       AND projet_phase_id   IS NOT NULL AND livrable_etape_id IS NULL)
    OR (source LIKE 'project_periode_%'
       AND livrable_etape_id IS NULL AND projet_phase_id IS NULL)
    OR ((source IS NULL OR source = 'manual')
       AND livrable_etape_id IS NULL AND projet_phase_id IS NULL)
  );

-- 3) Commentaires de schéma pour la lisibilité.
COMMENT ON COLUMN events.metadata IS
  'Données auxiliaires (jsonb). Pour les projections sourcées projet : '
  '{ source, range_index, range_start, range_end, readonly_reason }. '
  'Pour les events miroir LIV/phases : champs additionnels au besoin.';

-- Reload PostgREST schema cache (Supabase tip).
NOTIFY pgrst, 'reload schema';
