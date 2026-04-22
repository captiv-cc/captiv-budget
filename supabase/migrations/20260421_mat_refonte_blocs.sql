-- ============================================================================
-- Migration : MAT — Refonte "blocs simples" (remplace MAT-1)
-- Date      : 2026-04-21
-- Contexte  : Le premier schéma MAT-1 (matos_listes → matos_versions → categories
--             → items) s'est révélé trop complexe à l'usage. Hugo demande une
--             architecture beaucoup plus simple :
--               - Versions GLOBALES au projet (V1, V2... pour TOUT le matos),
--                 pas de container "liste" par département.
--               - Des BLOCS qui s'enchaînent verticalement (plus de catégories
--                 imbriquées). Chaque bloc est soit une "liste" classique, soit
--                 une "config caméra" (lignes label : désignation).
--               - Un seul type d'item polymorphe : label optionnel, le reste
--                 commun (qté, loueurs, flag, triple checklist).
--               - Clé d'agrégation pour le récap loueurs : materiel_bdd_id
--                 (fallback sur texte de la désignation si ligne saisie libre).
--
-- Ce qui est SUPPRIMÉ :
--   - matos_listes, matos_categories (concept inutile avec les blocs)
--   - Dates prépa_matos / shoot_début / shoot_fin / retour (pas de besoin)
--
-- Ce qui est CONSERVÉ :
--   - materiel_bdd (catalogue)
--   - fournisseurs.couleur + fournisseurs.is_loueur_matos
--   - Le principe flag 3 états + triple checklist
--   - Le pivot multi-loueurs par item (avec numero_reference)
--
-- Structure résultante :
--   matos_versions (project_id, numero, label, is_active, archived_at...)
--     └ matos_blocks (version_id, titre, couleur, affichage, sort_order)
--         └ matos_items (block_id, label?, designation, qte, materiel_bdd_id,
--                        flag, triple checklist, notes, sort_order)
--             └ matos_item_loueurs (pivot)
--
-- Idempotent : DROP IF EXISTS, CREATE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Dépend de  : ch3b_project_access.sql, schema.sql, 20260420_mat1_materiel_schema.sql
-- ============================================================================

BEGIN;

-- ── 1. DROP des tables projet de MAT-1 ───────────────────────────────────
-- CASCADE supprime en un coup : policies, triggers, FK, pivots, index.
-- materiel_bdd est conservé.
DROP TABLE IF EXISTS matos_item_loueurs CASCADE;
DROP TABLE IF EXISTS matos_items        CASCADE;
DROP TABLE IF EXISTS matos_categories   CASCADE;
DROP TABLE IF EXISTS matos_versions     CASCADE;
DROP TABLE IF EXISTS matos_listes       CASCADE;


-- ── 2. matos_versions : versions globales au projet ──────────────────────
-- Une version = un snapshot de TOUT le matos du projet à un instant donné.
-- Une seule active à la fois. Les autres sont archivées (archived_at != NULL)
-- et restaurables via UI. La duplication d'une version crée une V(n+1) avec
-- tous les blocs/items clonés (pattern miroir duplicateDevis).
CREATE TABLE matos_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero        integer NOT NULL DEFAULT 1,
  label         text,
  is_active     boolean NOT NULL DEFAULT true,
  archived_at   timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (project_id, numero)
);

CREATE INDEX matos_versions_project_idx ON matos_versions(project_id);
CREATE INDEX matos_versions_active_idx  ON matos_versions(project_id)
  WHERE is_active = true AND archived_at IS NULL;

DROP TRIGGER IF EXISTS matos_versions_updated_at ON matos_versions;
CREATE TRIGGER matos_versions_updated_at
  BEFORE UPDATE ON matos_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_versions IS
  'Version globale du matériel projet (V1, V2...). Une seule active à la fois. Les autres archivées (archived_at != NULL), restaurables.';
COMMENT ON COLUMN matos_versions.label IS
  'Libellé humain (ex: "V1 Matériel — plan initial"). Si NULL, le front affiche "V<numero> Matériel".';


-- ── 3. matos_blocks : blocs qui s'enchaînent dans une version ────────────
-- Chaque bloc a un "affichage" qui conditionne le rendu UI :
--   'liste'  : tableau classique (désignation, qté, loueurs, flag, checklist)
--   'config' : rendu épuré "label : désignation" (pour config caméra type CAM 1)
-- La structure en DB est la même — c'est juste un indicateur de rendu.
CREATE TABLE matos_blocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  titre         text NOT NULL,
  couleur       text,
  affichage     text NOT NULL DEFAULT 'liste'
                CHECK (affichage IN ('liste','config')),
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX matos_blocks_version_idx ON matos_blocks(version_id);

DROP TRIGGER IF EXISTS matos_blocks_updated_at ON matos_blocks;
CREATE TRIGGER matos_blocks_updated_at
  BEFORE UPDATE ON matos_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_blocks IS
  'Bloc vertical dans une version (ex: "CAMÉRA", "CAM 1 — Plan large", "LUMIÈRE"). Le champ "affichage" bascule entre rendu tableau classique ou config caméra.';
COMMENT ON COLUMN matos_blocks.affichage IS
  '"liste" (défaut) : tableau classique. "config" : rendu label:valeur épuré pour les configs caméra sur les lives.';
COMMENT ON COLUMN matos_blocks.couleur IS
  'Couleur hex optionnelle pour pastille de titre (non utilisée pour l''instant mais prévue pour cohérence visuelle).';


-- ── 4. matos_items : items polymorphes ──────────────────────────────────
-- Le champ "label" est optionnel :
--   - Vide/NULL → ligne classique ("Sony FX6" avec qté / loueurs / flag...)
--   - Rempli    → ligne config ("Boîtier : Sony FX6")
-- materiel_bdd_id est optionnel mais recommandé : c'est LA clé d'agrégation
-- pour le récap loueurs. Fallback sur le texte "designation" si null.
CREATE TABLE matos_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id        uuid NOT NULL REFERENCES matos_blocks(id)  ON DELETE CASCADE,
  materiel_bdd_id uuid REFERENCES materiel_bdd(id)           ON DELETE SET NULL,
  label           text,
  designation     text NOT NULL,
  quantite        integer NOT NULL DEFAULT 1,
  remarques       text,
  flag            text NOT NULL DEFAULT 'ok'
                  CHECK (flag IN ('ok','attention','probleme')),
  pre_check_at    timestamptz,
  pre_check_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  post_check_at   timestamptz,
  post_check_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  prod_check_at   timestamptz,
  prod_check_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX matos_items_block_idx    ON matos_items(block_id);
CREATE INDEX matos_items_bdd_idx      ON matos_items(materiel_bdd_id) WHERE materiel_bdd_id IS NOT NULL;
CREATE INDEX matos_items_flag_idx     ON matos_items(block_id) WHERE flag <> 'ok';

DROP TRIGGER IF EXISTS matos_items_updated_at ON matos_items;
CREATE TRIGGER matos_items_updated_at
  BEFORE UPDATE ON matos_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_items IS
  'Item polymorphe. Si label rempli → rendu "label : designation" (config). Si label vide → rendu classique. materiel_bdd_id est la clé d''agrégation du récap loueurs.';
COMMENT ON COLUMN matos_items.label IS
  'Optionnel. Rempli pour les blocs config caméra ("Boîtier", "Optique"...). Vide pour les listes matos classiques.';
COMMENT ON COLUMN matos_items.materiel_bdd_id IS
  'Référence optionnelle vers le catalogue. Permet l''agrégation propre dans le récap loueurs (somme des quantités d''un même item sur toute la version). Fallback sur le texte "designation" si NULL.';
COMMENT ON COLUMN matos_items.flag IS
  '3 états : ok (vert, défaut), attention (orange, à vérifier), probleme (rouge, bloquant).';


-- ── 5. matos_item_loueurs : pivot multi-loueurs ──────────────────────────
CREATE TABLE matos_item_loueurs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           uuid NOT NULL REFERENCES matos_items(id)  ON DELETE CASCADE,
  loueur_id         uuid NOT NULL REFERENCES fournisseurs(id) ON DELETE CASCADE,
  numero_reference  text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, loueur_id, numero_reference)
);

CREATE INDEX matos_item_loueurs_item_idx   ON matos_item_loueurs(item_id);
CREATE INDEX matos_item_loueurs_loueur_idx ON matos_item_loueurs(loueur_id);

COMMENT ON COLUMN matos_item_loueurs.numero_reference IS
  'Identifie une instance physique (ex: "2/3/6"). Optionnel.';


-- ── 6. RLS — matos_versions (scope outil 'materiel') ─────────────────────
ALTER TABLE matos_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_versions_scoped_read"  ON matos_versions;
DROP POLICY IF EXISTS "matos_versions_scoped_write" ON matos_versions;

CREATE POLICY "matos_versions_scoped_read" ON matos_versions
  FOR SELECT
  USING (can_read_outil(project_id, 'materiel'));

CREATE POLICY "matos_versions_scoped_write" ON matos_versions
  FOR ALL
  USING      (can_edit_outil(project_id, 'materiel'))
  WITH CHECK (can_edit_outil(project_id, 'materiel'));


-- ── 7. RLS — matos_blocks (via matos_versions) ───────────────────────────
ALTER TABLE matos_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_blocks_scoped_read"  ON matos_blocks;
DROP POLICY IF EXISTS "matos_blocks_scoped_write" ON matos_blocks;

CREATE POLICY "matos_blocks_scoped_read" ON matos_blocks
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_blocks.version_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_blocks_scoped_write" ON matos_blocks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_blocks.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_blocks.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 8. RLS — matos_items (via matos_blocks → matos_versions) ─────────────
ALTER TABLE matos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_items_scoped_read"  ON matos_items;
DROP POLICY IF EXISTS "matos_items_scoped_write" ON matos_items;

CREATE POLICY "matos_items_scoped_read" ON matos_items
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_blocks mb
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mb.id = matos_items.block_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_items_scoped_write" ON matos_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_blocks mb
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mb.id = matos_items.block_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_blocks mb
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mb.id = matos_items.block_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 9. RLS — matos_item_loueurs (via matos_items → blocks → versions) ───
ALTER TABLE matos_item_loueurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_item_loueurs_scoped_read"  ON matos_item_loueurs;
DROP POLICY IF EXISTS "matos_item_loueurs_scoped_write" ON matos_item_loueurs;

CREATE POLICY "matos_item_loueurs_scoped_read" ON matos_item_loueurs
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_item_loueurs_scoped_write" ON matos_item_loueurs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


COMMIT;
