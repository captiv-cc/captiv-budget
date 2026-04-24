-- ============================================================================
-- Migration : LIV-1 — Schéma Outil Livrables
-- Date      : 2026-04-24
-- Contexte  : Nouveau chantier "Livrables (LIV)". Centralise le suivi de la
--             post-production audiovisuelle par projet : multi-livrables
--             groupés en blocs (AFTERMOVIE / SNACK CONTENT / COCKTAIL...),
--             versions historisées (V0 → V1 → VDEF), pipeline d'étapes,
--             phases projet répétables (PROD / TOURNAGE / MONTAGE…).
--
--             Sync planning bidirectionnelle :
--               * livrable_etapes (montage, étalonnage, envoi V0…) → event
--               * projet_phases   (TOURNAGE 21-24 août…)            → event
--             L'étape (ou la phase) est PROPRIÉTAIRE, l'event est une
--             projection. Lien stocké des deux côtés (defense en profondeur)
--             pour permettre le query inverse depuis le planning.
--
--             Structure :
--               projet_livrable_config (1-1 projet, en-tête)
--               livrable_blocks        (regroupement, soft delete)
--                 └ livrables          (entité principale, soft delete)
--                     ├ livrable_versions  (historique V0/V1/VDEF + feedback)
--                     └ livrable_etapes    (pipeline + event miroir)
--               projet_phases          (phases globales + event multi-jours)
--               events (+ colonnes source / livrable_etape_id / projet_phase_id)
--
-- Choix produit (validés par Hugo, voir CHANTIER_LIV_ROADMAP.md §2) :
--   * Versions = vraie entité avec historique (table livrable_versions).
--   * version_label (texte libre) ET statut (enum CHECK) sont distincts.
--   * Monteur = lien profiles.id + champ texte libre pour freelances externes.
--   * Numérotation auto = préfixe bloc + index, avec override possible.
--   * Soft delete via deleted_at sur livrable_blocks et livrables.
--   * Phases répétables (rien n'empêche 2 phases TOURNAGE sur 2 dates).
--   * Lien devis Niveau 1 : pointeur livrables.devis_lot_id nullable.
--   * Liens externes : lien_frame (validation) + lien_drive (master), texte URL.
--   * Pas de stockage Supabase Storage — Frame.io et Drive owners.
--
-- Convention Supabase locale : pas de CREATE TYPE / ENUM (alignement avec le
-- reste du schéma — ex events.status, matos_items.flag, etc.). Statuts
-- modélisés en text + CHECK constraint pour rester souple à l'évolution.
--
-- L'outil 'livrables' n'est PAS encore inséré dans outils_catalogue : c'est
-- l'objet de la migration LIV-2 (avec les permissions associées).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS. Safe à rejouer.
-- Dépend de  : ch3b_project_access.sql (can_read_outil / can_edit_outil),
--              schema.sql (projects, profiles, organisations, set_updated_at()),
--              20260413_devis_lots.sql (devis_lots),
--              20260416_planning_pl1.sql (events).
-- ============================================================================

BEGIN;

-- ── 0. Cleanup ancien schéma livrables (héritage migration_v2.sql) ─────────
-- migration_v2.sql avait posé une version minimale de `livrables` et
-- `livrable_versions` (deadline / responsable_id / nb_revisions / lien_final…)
-- jamais branchée à une UI. Le nouveau schéma du chantier LIV est trop
-- différent pour une migration en place (pas de blocks, statuts différents,
-- soft delete absent, FK projet_membres → profiles…). On drop CASCADE pour
-- repartir propre — sans perte applicative puisque rien n'écrivait dessus.
--
-- IMPORTANT : si tu as commencé à utiliser ces tables (peu probable mais
-- vérifier dans Supabase Studio avant de jouer la migration), exporter avant.
DROP TABLE IF EXISTS livrable_versions CASCADE;
DROP TABLE IF EXISTS livrables          CASCADE;


-- ── 1. projet_livrable_config : en-tête livrables (1-1 avec projet) ─────────
-- Reproduit le bloc "haut de page" des templates Excel : nom client, logo,
-- producteur post-prod, période de tournage en label texte (ex "21-24 août
-- 2025" ou "/" si SVP), version du planning post-prod lui-même (V1 du
-- planning, V2 après refonte client, etc.).
CREATE TABLE IF NOT EXISTS projet_livrable_config (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  client_nom           text,
  client_logo_url      text,
  producteur_postprod  text,
  tournage_label       text,
  version_numero       integer NOT NULL DEFAULT 1,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS projet_livrable_config_project_idx
  ON projet_livrable_config(project_id);

DROP TRIGGER IF EXISTS projet_livrable_config_updated_at ON projet_livrable_config;
CREATE TRIGGER projet_livrable_config_updated_at
  BEFORE UPDATE ON projet_livrable_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projet_livrable_config IS
  'En-tête de l''outil Livrables, 1-1 avec project. Reproduit le haut de page des templates Excel (client, logo, producteur post-prod, période de tournage, version du planning).';
COMMENT ON COLUMN projet_livrable_config.tournage_label IS
  'Période de tournage en texte libre, ex "21-24 août 2025", "Du 5/9 au 12/9 + 18/9", "/" si non concerné. Pas de date structurée car format hétérogène.';
COMMENT ON COLUMN projet_livrable_config.version_numero IS
  'Numéro de la version du planning post-prod lui-même (V1, V2 après refonte client). Différent du version_label des livrables.';


-- ── 2. livrable_blocks : regroupement de livrables ──────────────────────────
-- Ex "AFTERMOVIE / RÉCAP", "SNACK CONTENT", "COCKTAIL".
-- Préfixe court (1-4 caractères) utilisé pour la numérotation auto des
-- livrables (ex "A1", "S12", "C4").
CREATE TABLE IF NOT EXISTS livrable_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nom         text NOT NULL,
  prefixe     text CHECK (prefixe IS NULL OR length(prefixe) BETWEEN 1 AND 4),
  couleur     text,
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS livrable_blocks_project_idx
  ON livrable_blocks(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS livrable_blocks_project_sort_idx
  ON livrable_blocks(project_id, sort_order) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS livrable_blocks_updated_at ON livrable_blocks;
CREATE TRIGGER livrable_blocks_updated_at
  BEFORE UPDATE ON livrable_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE livrable_blocks IS
  'Regroupement de livrables d''un projet (ex "AFTERMOVIE / RÉCAP", "SNACK CONTENT"). Soft delete via deleted_at. Le préfixe (1-4 chars) sert à la numérotation auto.';
COMMENT ON COLUMN livrable_blocks.prefixe IS
  'Préfixe court (ex "A", "S", "C", "REC") utilisé pour générer le numéro par défaut des livrables ("A1", "S12"…). Override possible sur chaque livrable.';
COMMENT ON COLUMN livrable_blocks.couleur IS
  'Couleur hex (#22c55e…) pour les en-têtes / badges du bloc dans l''UI et le PDF.';


-- ── 3. livrables : entité principale ────────────────────────────────────────
-- Un livrable = une obligation contractuelle (ou pas), à une date, dans un
-- format/durée donné, avec un assignee. project_id est dénormalisé depuis
-- block_id pour accélérer les RLS (un seul join au lieu de deux).
CREATE TABLE IF NOT EXISTS livrables (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id            uuid NOT NULL REFERENCES livrable_blocks(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id)        ON DELETE CASCADE,

  numero              text NOT NULL,
  nom                 text NOT NULL,
  format              text,
  duree               text,

  version_label       text,
  statut              text NOT NULL DEFAULT 'brief'
                      CHECK (statut IN ('brief','en_cours','a_valider','valide','livre','archive')),

  projet_dav          text,
  assignee_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assignee_external   text,

  date_livraison      date,
  lien_frame          text,
  lien_drive          text,
  devis_lot_id        uuid REFERENCES devis_lots(id) ON DELETE SET NULL,
  notes               text,

  sort_order          integer NOT NULL DEFAULT 0,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES profiles(id) ON DELETE SET NULL
);

-- Numero unique par bloc (ignore les supprimés pour permettre réutilisation
-- d'un numéro après corbeille).
CREATE UNIQUE INDEX IF NOT EXISTS livrables_block_numero_unique
  ON livrables(block_id, numero) WHERE deleted_at IS NULL;

-- Index pour les widgets compteurs / "prochain livrable" (LIV-16/17/18).
CREATE INDEX IF NOT EXISTS livrables_project_date_idx
  ON livrables(project_id, date_livraison)
  WHERE deleted_at IS NULL;

-- Index pour le filtre "Mes livrables" (LIV-15).
CREATE INDEX IF NOT EXISTS livrables_assignee_idx
  ON livrables(assignee_profile_id)
  WHERE deleted_at IS NULL AND assignee_profile_id IS NOT NULL;

-- Index pour query inverse depuis devis (LIV-19 badge "Lié à N livrable(s)").
CREATE INDEX IF NOT EXISTS livrables_devis_lot_idx
  ON livrables(devis_lot_id)
  WHERE deleted_at IS NULL AND devis_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS livrables_block_sort_idx
  ON livrables(block_id, sort_order) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS livrables_updated_at ON livrables;
CREATE TRIGGER livrables_updated_at
  BEFORE UPDATE ON livrables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE livrables IS
  'Entité principale du chantier Livrables : une obligation de livraison (vidéo, snack, récap…) à une date, dans un format/durée, avec un assignee. project_id dénormalisé pour RLS rapide.';
COMMENT ON COLUMN livrables.numero IS
  'Identifiant court ("A1", "S12", "C4*"). Auto-généré (préfixe bloc + index libre) à la création, override possible. Unique par bloc parmi les non-supprimés.';
COMMENT ON COLUMN livrables.statut IS
  '6 états : brief (créé, pas démarré) | en_cours (montage) | a_valider (envoyé client) | valide (retours OK) | livre (master remis) | archive (clôt, hors stats).';
COMMENT ON COLUMN livrables.version_label IS
  'Label texte libre de la version courante affichée dans la liste : "V1", "V3", "V3*", "??". Distinct de l''entité livrable_versions qui historise les envois.';
COMMENT ON COLUMN livrables.projet_dav IS
  'Référence projet DaVinci ("A", "B"…) — utile pour les équipes qui partagent une suite Resolve par projet.';
COMMENT ON COLUMN livrables.assignee_external IS
  'Nom libre pour assignee hors équipe (freelance non profile). Mutuellement exclusif avec assignee_profile_id côté UI mais pas en DB pour rester souple.';
COMMENT ON COLUMN livrables.devis_lot_id IS
  'Lien Niveau 1 vers un lot de devis. Permet badge "Lié à N livrable(s)" sur DevisTab et compteurs contractuels (Niveau 3 plus tard).';


-- ── 4. livrable_versions : historique des versions envoyées au client ──────
-- Pas de soft delete : on supprime physiquement, l'historique reste implicite
-- via les autres versions. statut_validation distinct du statut du livrable
-- (qui est l'état global, pas l'état d'une version donnée).
CREATE TABLE IF NOT EXISTS livrable_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  livrable_id       uuid NOT NULL REFERENCES livrables(id) ON DELETE CASCADE,
  numero_label      text NOT NULL,
  date_envoi        date,
  lien_frame        text,
  statut_validation text NOT NULL DEFAULT 'en_attente'
                    CHECK (statut_validation IN ('en_attente','retours_a_integrer','valide','rejete')),
  feedback_client   text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS livrable_versions_livrable_idx
  ON livrable_versions(livrable_id);
CREATE INDEX IF NOT EXISTS livrable_versions_livrable_sort_idx
  ON livrable_versions(livrable_id, sort_order);

DROP TRIGGER IF EXISTS livrable_versions_updated_at ON livrable_versions;
CREATE TRIGGER livrable_versions_updated_at
  BEFORE UPDATE ON livrable_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE livrable_versions IS
  'Historique des versions envoyées au client pour un livrable (V0, V1, VDEF…). Trace les retours et la validation. Suppression physique (pas de soft delete).';
COMMENT ON COLUMN livrable_versions.numero_label IS
  'Label texte libre ("V0", "V1", "VDEF", "V2 motion"). Pas d''auto-incrément pour permettre toutes les conventions terrain.';


-- ── 5. livrable_etapes : pipeline post-prod par livrable ────────────────────
-- Une étape = une portion de timeline (1 jour ou plage). Un event planning
-- miroir est créé si is_event=true (cf. lib LIV-4 livrablesPlanningSync.js).
-- L'étape est PROPRIÉTAIRE, event est une projection. UNIQUE event_id pour
-- assurer 1-1.
CREATE TABLE IF NOT EXISTS livrable_etapes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  livrable_id         uuid NOT NULL REFERENCES livrables(id) ON DELETE CASCADE,
  nom                 text NOT NULL,
  kind                text NOT NULL DEFAULT 'autre'
                      CHECK (kind IN ('production','da','montage','sound','delivery','feedback','autre')),
  date_debut          date NOT NULL,
  date_fin            date NOT NULL,
  assignee_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  couleur             text,
  notes               text,
  sort_order          integer NOT NULL DEFAULT 0,

  -- Lien vers event planning miroir. ON DELETE SET NULL : si l'event est
  -- supprimé manuellement, l'étape devient orpheline (UI propose recréation).
  event_id            uuid UNIQUE REFERENCES events(id) ON DELETE SET NULL,
  is_event            boolean NOT NULL DEFAULT true,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT livrable_etapes_dates_ordered CHECK (date_fin >= date_debut)
);

CREATE INDEX IF NOT EXISTS livrable_etapes_livrable_idx
  ON livrable_etapes(livrable_id);
CREATE INDEX IF NOT EXISTS livrable_etapes_livrable_sort_idx
  ON livrable_etapes(livrable_id, sort_order);
CREATE INDEX IF NOT EXISTS livrable_etapes_assignee_idx
  ON livrable_etapes(assignee_profile_id) WHERE assignee_profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS livrable_etapes_updated_at ON livrable_etapes;
CREATE TRIGGER livrable_etapes_updated_at
  BEFORE UPDATE ON livrable_etapes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE livrable_etapes IS
  'Étape du pipeline post-prod d''un livrable (ex "Edit/Motion 14-15", "DA 16", "Envoi V0 17"). Event planning miroir via event_id (1-1, étape = owner).';
COMMENT ON COLUMN livrable_etapes.kind IS
  '7 catégories pour swimlanes Vague 2 et code couleur : production | da | montage | sound | delivery | feedback | autre.';
COMMENT ON COLUMN livrable_etapes.is_event IS
  'Si true, un event planning miroir est créé/maintenu via event_id. Si false, l''étape est purement interne au pipeline livrable.';


-- ── 6. projet_phases : phases projet globales (PROD / TOURNAGE / OFF…) ─────
-- Multi-jours uniques (un seul event multi-jours par phase, pas de daily
-- repeat). Répétables dans le temps : 2 phases TOURNAGE possibles à 2 dates
-- différentes (cas réel chez V and B Fest).
CREATE TABLE IF NOT EXISTS projet_phases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nom         text NOT NULL,
  kind        text NOT NULL DEFAULT 'autre'
              CHECK (kind IN ('prod','tournage','montage','delivery','off','autre')),
  date_debut  date NOT NULL,
  date_fin    date NOT NULL,
  couleur     text,
  notes       text,

  event_id    uuid UNIQUE REFERENCES events(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projet_phases_dates_ordered CHECK (date_fin >= date_debut)
);

CREATE INDEX IF NOT EXISTS projet_phases_project_idx
  ON projet_phases(project_id);
CREATE INDEX IF NOT EXISTS projet_phases_project_dates_idx
  ON projet_phases(project_id, date_debut, date_fin);

DROP TRIGGER IF EXISTS projet_phases_updated_at ON projet_phases;
CREATE TRIGGER projet_phases_updated_at
  BEFORE UPDATE ON projet_phases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projet_phases IS
  'Phases projet globales (PROD / TOURNAGE / MONTAGE / DELIVERY / OFF). Répétables dans le temps. Event planning miroir multi-jours unique via event_id.';
COMMENT ON COLUMN projet_phases.kind IS
  '6 catégories pour code couleur et filtres : prod | tournage | montage | delivery | off | autre.';


-- ── 7. events : ajout colonnes pour sync inverse depuis planning ───────────
-- Permet au front planning de détecter qu'un event est miroir d'une étape ou
-- d'une phase, et de router les drag/edit/delete vers la bonne mutation
-- (updateEtape / updatePhase au lieu de updateEvent).
--
-- ON DELETE SET NULL côté events : si l'étape/phase est supprimée, l'event
-- devient un event normal (pas de cascade applicative — c'est la lib LIV-4
-- qui gère la suppression simultanée si demandée).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source            text,
  ADD COLUMN IF NOT EXISTS livrable_etape_id uuid UNIQUE
    REFERENCES livrable_etapes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS projet_phase_id   uuid UNIQUE
    REFERENCES projet_phases(id)   ON DELETE SET NULL;

-- CHECK source : null ou 'manual' = event normal, 'livrable_etape' / 'projet_phase' = miroir.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_source_valid;
ALTER TABLE events
  ADD CONSTRAINT events_source_valid
  CHECK (source IS NULL OR source IN ('manual','livrable_etape','projet_phase'));

-- Garantir cohérence source ↔ FK : un event ne peut être miroir QUE d'une étape
-- OU d'une phase, jamais des deux ; les FK doivent être null si source = manual.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_source_fk_consistency;
ALTER TABLE events
  ADD CONSTRAINT events_source_fk_consistency
  CHECK (
    (source = 'livrable_etape'
       AND livrable_etape_id IS NOT NULL AND projet_phase_id   IS NULL)
    OR (source = 'projet_phase'
       AND projet_phase_id   IS NOT NULL AND livrable_etape_id IS NULL)
    OR ((source IS NULL OR source = 'manual')
       AND livrable_etape_id IS NULL AND projet_phase_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS events_livrable_etape_idx
  ON events(livrable_etape_id) WHERE livrable_etape_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_projet_phase_idx
  ON events(projet_phase_id)   WHERE projet_phase_id   IS NOT NULL;

COMMENT ON COLUMN events.source IS
  'Origine de l''event : null/''manual'' = créé via planning, ''livrable_etape'' = miroir d''une étape post-prod, ''projet_phase'' = miroir d''une phase projet. Cf. LIV-4.';


-- ── 8. RLS — projet_livrable_config (scope outil 'livrables') ───────────────
ALTER TABLE projet_livrable_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_livrable_config_scoped_read"  ON projet_livrable_config;
DROP POLICY IF EXISTS "projet_livrable_config_scoped_write" ON projet_livrable_config;

CREATE POLICY "projet_livrable_config_scoped_read" ON projet_livrable_config
  FOR SELECT
  USING (can_read_outil(project_id, 'livrables'));

CREATE POLICY "projet_livrable_config_scoped_write" ON projet_livrable_config
  FOR ALL
  USING      (can_edit_outil(project_id, 'livrables'))
  WITH CHECK (can_edit_outil(project_id, 'livrables'));


-- ── 9. RLS — livrable_blocks (scope outil 'livrables') ──────────────────────
ALTER TABLE livrable_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livrable_blocks_scoped_read"  ON livrable_blocks;
DROP POLICY IF EXISTS "livrable_blocks_scoped_write" ON livrable_blocks;

CREATE POLICY "livrable_blocks_scoped_read" ON livrable_blocks
  FOR SELECT
  USING (can_read_outil(project_id, 'livrables'));

CREATE POLICY "livrable_blocks_scoped_write" ON livrable_blocks
  FOR ALL
  USING      (can_edit_outil(project_id, 'livrables'))
  WITH CHECK (can_edit_outil(project_id, 'livrables'));


-- ── 10. RLS — livrables (scope direct via project_id dénormalisé) ──────────
ALTER TABLE livrables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livrables_scoped_read"  ON livrables;
DROP POLICY IF EXISTS "livrables_scoped_write" ON livrables;

CREATE POLICY "livrables_scoped_read" ON livrables
  FOR SELECT
  USING (can_read_outil(project_id, 'livrables'));

CREATE POLICY "livrables_scoped_write" ON livrables
  FOR ALL
  USING      (can_edit_outil(project_id, 'livrables'))
  WITH CHECK (can_edit_outil(project_id, 'livrables'));


-- ── 11. RLS — livrable_versions (via livrables → project_id) ───────────────
ALTER TABLE livrable_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livrable_versions_scoped_read"  ON livrable_versions;
DROP POLICY IF EXISTS "livrable_versions_scoped_write" ON livrable_versions;

CREATE POLICY "livrable_versions_scoped_read" ON livrable_versions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_versions.livrable_id
      AND can_read_outil(l.project_id, 'livrables')
  ));

CREATE POLICY "livrable_versions_scoped_write" ON livrable_versions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_versions.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_versions.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ));


-- ── 12. RLS — livrable_etapes (via livrables → project_id) ─────────────────
ALTER TABLE livrable_etapes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livrable_etapes_scoped_read"  ON livrable_etapes;
DROP POLICY IF EXISTS "livrable_etapes_scoped_write" ON livrable_etapes;

CREATE POLICY "livrable_etapes_scoped_read" ON livrable_etapes
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_etapes.livrable_id
      AND can_read_outil(l.project_id, 'livrables')
  ));

CREATE POLICY "livrable_etapes_scoped_write" ON livrable_etapes
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_etapes.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_etapes.livrable_id
      AND can_edit_outil(l.project_id, 'livrables')
  ));


-- ── 13. RLS — projet_phases (scope direct via project_id) ──────────────────
ALTER TABLE projet_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_phases_scoped_read"  ON projet_phases;
DROP POLICY IF EXISTS "projet_phases_scoped_write" ON projet_phases;

CREATE POLICY "projet_phases_scoped_read" ON projet_phases
  FOR SELECT
  USING (can_read_outil(project_id, 'livrables'));

CREATE POLICY "projet_phases_scoped_write" ON projet_phases
  FOR ALL
  USING      (can_edit_outil(project_id, 'livrables'))
  WITH CHECK (can_edit_outil(project_id, 'livrables'));


COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. Activer Realtime sur les 6 tables (via Dashboard Supabase ou via une
--    migration dédiée type matos_realtime_publication.sql) avant LIV-3 :
--      ALTER PUBLICATION supabase_realtime ADD TABLE projet_livrable_config;
--      ALTER PUBLICATION supabase_realtime ADD TABLE livrable_blocks;
--      ALTER PUBLICATION supabase_realtime ADD TABLE livrables;
--      ALTER PUBLICATION supabase_realtime ADD TABLE livrable_versions;
--      ALTER PUBLICATION supabase_realtime ADD TABLE livrable_etapes;
--      ALTER PUBLICATION supabase_realtime ADD TABLE projet_phases;
--    (events est déjà dans la publication via PL-1.)
--
-- 2. LIV-2 ajoutera :
--      INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
--      VALUES ('livrables', 'Livrables', '...', 'Film', 92)
--      ON CONFLICT DO NOTHING;
--    Sans cet insert, can_read_outil/can_edit_outil renverront false pour
--    'livrables' → toutes les RLS bloqueront. C'est volontaire : le schéma
--    est inerte tant que LIV-2 n'est pas posée.
-- ============================================================================
