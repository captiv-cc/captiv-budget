-- ============================================================================
-- Migration : MAT-1 — Schéma Outil Matériel
-- Date      : 2026-04-20
-- Contexte  : Nouveau chantier "Outil Matériel". Permet aux équipes de
--             constituer, par projet, des listes de matériel (CAMERA /
--             MACHINERIE / LIGHTS / REGIE ...) avec multi-loueurs par item,
--             triple checklist (pre-check / post-check / prod-check), flag
--             3 états, versioning inspiré du pattern devis_lots → devis.
--
--             Structure (miroir de devis_lots / devis / devis_categories /
--             devis_lines) :
--               matos_listes      (container stable : "CAMERA", "LIGHTS"...)
--                 └ matos_versions   (v1, v2, v3 — une seule active, les autres
--                                     archivées, restaurables)
--                     └ matos_categories  (BOITIER, OPTIQUES, SON, ALIM...)
--                         └ matos_items       (les lignes matos)
--                             └ matos_item_loueurs  (pivot multi-loueurs)
--
--             Catalogue réutilisable :
--               materiel_bdd     (autonome, org-scoped, indépendant de
--                                 produits_bdd qui est orienté devis/tarif)
--
--             Fournisseurs → dropdown loueurs unifié :
--               + couleur         : hex pour badge coloré (ex: #22c55e CAPTIV)
--               + is_loueur_matos : filtre du dropdown loueur dans l'UI matos
--
-- Choix produit (confirmés par Hugo) :
--   * Plusieurs listes par projet (OUI)
--   * Multi-loueurs par item (OUI, via table pivot)
--   * Pas de prix du tout (pas de tarif_ht / montant / unité tarifaire)
--   * Nouveau catalogue materiel_bdd (pas de réutilisation de produits_bdd)
--   * Flag 3 états : ok / attention / probleme
--   * Versioning type devis_lots : container stable, versions numérotées,
--     archivage non-destructif + restauration
--   * Loueurs fusionnés avec fournisseurs (plus de texte libre)
--
-- La clé 'materiel' est DÉJÀ présente dans outils_catalogue (seed ch3a),
-- donc rien à ajouter sur ce point.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- ON CONFLICT DO NOTHING, DROP POLICY IF EXISTS. Safe à rejouer.
-- Dépend de  : ch3b_project_access.sql (can_read_outil / can_edit_outil),
--              schema.sql (fournisseurs, projects, organisations, profiles,
--              set_updated_at()), ch3a_permissions.sql (clé 'materiel').
-- ============================================================================

BEGIN;

-- ── 1. fournisseurs : couleur + flag loueur matos ─────────────────────────
ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS couleur         text,
  ADD COLUMN IF NOT EXISTS is_loueur_matos boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_fournisseurs_loueur_matos
  ON fournisseurs(org_id) WHERE is_loueur_matos = true;

COMMENT ON COLUMN fournisseurs.couleur IS
  'Couleur hex (#22c55e, #eab308...) pour affichage badge dans l''outil Matériel. Null = couleur par défaut.';
COMMENT ON COLUMN fournisseurs.is_loueur_matos IS
  'Si true, apparaît dans le dropdown loueur des listes matériel. Permet de séparer les loueurs (CAPTIV, PUZZLE...) des autres fournisseurs (traiteur, déco, etc.).';


-- ── 2. materiel_bdd : catalogue matos réutilisable par org ────────────────
CREATE TABLE IF NOT EXISTS materiel_bdd (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  nom                     text NOT NULL,
  categorie_suggeree      text,
  sous_categorie_suggeree text,
  description             text,
  tags                    text[] DEFAULT '{}',
  actif                   boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS materiel_bdd_org_idx       ON materiel_bdd(org_id);
CREATE INDEX IF NOT EXISTS materiel_bdd_nom_lower_idx ON materiel_bdd(org_id, lower(nom));
CREATE INDEX IF NOT EXISTS materiel_bdd_tags_idx      ON materiel_bdd USING gin (tags);

DROP TRIGGER IF EXISTS materiel_bdd_updated_at ON materiel_bdd;
CREATE TRIGGER materiel_bdd_updated_at
  BEFORE UPDATE ON materiel_bdd
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE materiel_bdd IS
  'Catalogue matériel réutilisable par organisation. Indépendant de produits_bdd (qui est orienté devis/tarifs). Alimente l''autocomplete des items dans les listes matériel.';


-- ── 3. matos_listes : container stable (CAMERA, MACHINERIE, LIGHTS...) ────
CREATE TABLE IF NOT EXISTS matos_listes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matos_listes_project_idx ON matos_listes(project_id);

DROP TRIGGER IF EXISTS matos_listes_updated_at ON matos_listes;
CREATE TRIGGER matos_listes_updated_at
  BEFORE UPDATE ON matos_listes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_listes IS
  'Container stable d''une liste matériel (ex: "CAMERA", "LIGHTS"). Contient plusieurs matos_versions (v1, v2...). Pattern miroir de devis_lots.';


-- ── 4. matos_versions : versions numérotées d'une liste ───────────────────
-- Une seule version est active à la fois (is_active=true). Les autres sont
-- archivées (is_active=false + archived_at renseigné), restaurables via UI.
-- Les dates PREPA / SHOOT / RETOUR vivent ici (pas sur matos_listes) pour
-- qu'une révision puisse avoir son propre calendrier logistique.
CREATE TABLE IF NOT EXISTS matos_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matos_liste_id    uuid NOT NULL REFERENCES matos_listes(id) ON DELETE CASCADE,
  version_number    integer NOT NULL DEFAULT 1,
  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,
  prepa_matos_date  date,
  shoot_date_debut  date,
  shoot_date_fin    date,
  retour_date       date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (matos_liste_id, version_number)
);

CREATE INDEX IF NOT EXISTS matos_versions_liste_idx  ON matos_versions(matos_liste_id);
CREATE INDEX IF NOT EXISTS matos_versions_active_idx ON matos_versions(matos_liste_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS matos_versions_updated_at ON matos_versions;
CREATE TRIGGER matos_versions_updated_at
  BEFORE UPDATE ON matos_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_versions IS
  'Version d''une liste matériel. Pattern miroir de devis (v1, v2, v3). Une seule active à la fois par matos_liste_id, les autres archivées et restaurables.';


-- ── 5. matos_categories : sous-sections (BOITIER, OPTIQUES, SON...) ───────
CREATE TABLE IF NOT EXISTS matos_categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matos_version_id  uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  name              text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matos_categories_version_idx ON matos_categories(matos_version_id);


-- ── 6. matos_items : les lignes matos ─────────────────────────────────────
-- Triple checklist stockée en timestamptz + profile_id → on garde la trace
-- de qui a coché quand (affichage tooltip "Validé par X le 14/04 à 15:32").
-- Flag 3 états : 'ok' (vert, défaut) / 'attention' (orange) / 'probleme' (rouge).
CREATE TABLE IF NOT EXISTS matos_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matos_version_id  uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  category_id       uuid REFERENCES matos_categories(id) ON DELETE SET NULL,
  materiel_bdd_id   uuid REFERENCES materiel_bdd(id)    ON DELETE SET NULL,
  designation       text NOT NULL,
  quantite          integer NOT NULL DEFAULT 1,
  remarques         text,
  flag              text NOT NULL DEFAULT 'ok'
                    CHECK (flag IN ('ok','attention','probleme')),
  pre_check_at      timestamptz,
  pre_check_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  post_check_at     timestamptz,
  post_check_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  prod_check_at     timestamptz,
  prod_check_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matos_items_version_idx  ON matos_items(matos_version_id);
CREATE INDEX IF NOT EXISTS matos_items_category_idx ON matos_items(category_id);
CREATE INDEX IF NOT EXISTS matos_items_flag_idx     ON matos_items(matos_version_id) WHERE flag <> 'ok';

DROP TRIGGER IF EXISTS matos_items_updated_at ON matos_items;
CREATE TRIGGER matos_items_updated_at
  BEFORE UPDATE ON matos_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN matos_items.flag IS
  '3 états : ok (vert, défaut), attention (orange, à vérifier), probleme (rouge, bloquant). Reproduit les lignes rouges des feuilles actuelles.';
COMMENT ON COLUMN matos_items.remarques IS
  'Notes libres sur l''item (ex: "2/3/6" pour numéroter des items individuels, "Logan", "Slider", etc.).';


-- ── 7. matos_item_loueurs : pivot multi-loueurs par item ─────────────────
CREATE TABLE IF NOT EXISTS matos_item_loueurs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           uuid NOT NULL REFERENCES matos_items(id)   ON DELETE CASCADE,
  loueur_id         uuid NOT NULL REFERENCES fournisseurs(id)  ON DELETE CASCADE,
  numero_reference  text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, loueur_id, numero_reference)
);

CREATE INDEX IF NOT EXISTS matos_item_loueurs_item_idx   ON matos_item_loueurs(item_id);
CREATE INDEX IF NOT EXISTS matos_item_loueurs_loueur_idx ON matos_item_loueurs(loueur_id);

COMMENT ON COLUMN matos_item_loueurs.numero_reference IS
  'Identifie une instance physique du matériel chez le loueur (ex: "2/3/6" signifie items #2, #3 et #6 d''un pool de 6). Text libre.';


-- ── 8. RLS — materiel_bdd (org-scope classique) ──────────────────────────
ALTER TABLE materiel_bdd ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "materiel_bdd_org_read"  ON materiel_bdd;
DROP POLICY IF EXISTS "materiel_bdd_org_write" ON materiel_bdd;

-- Lecture : tout membre de l'org.
CREATE POLICY "materiel_bdd_org_read" ON materiel_bdd
  FOR SELECT
  USING (org_id = get_user_org_id());

-- Écriture : admin de l'org (on reste aligné sur produits_bdd).
CREATE POLICY "materiel_bdd_org_write" ON materiel_bdd
  FOR ALL
  USING      (org_id = get_user_org_id() AND is_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_admin());


-- ── 9. RLS — matos_listes / matos_versions (scope outil 'materiel') ──────
ALTER TABLE matos_listes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE matos_versions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_listes_scoped_read"   ON matos_listes;
DROP POLICY IF EXISTS "matos_listes_scoped_write"  ON matos_listes;

CREATE POLICY "matos_listes_scoped_read" ON matos_listes
  FOR SELECT
  USING (can_read_outil(project_id, 'materiel'));

CREATE POLICY "matos_listes_scoped_write" ON matos_listes
  FOR ALL
  USING      (can_edit_outil(project_id, 'materiel'))
  WITH CHECK (can_edit_outil(project_id, 'materiel'));


DROP POLICY IF EXISTS "matos_versions_scoped_read"  ON matos_versions;
DROP POLICY IF EXISTS "matos_versions_scoped_write" ON matos_versions;

CREATE POLICY "matos_versions_scoped_read" ON matos_versions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM matos_listes ml
                 WHERE ml.id = matos_versions.matos_liste_id
                   AND can_read_outil(ml.project_id, 'materiel')));

CREATE POLICY "matos_versions_scoped_write" ON matos_versions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM matos_listes ml
                 WHERE ml.id = matos_versions.matos_liste_id
                   AND can_edit_outil(ml.project_id, 'materiel')))
  WITH CHECK (EXISTS (SELECT 1 FROM matos_listes ml
                      WHERE ml.id = matos_versions.matos_liste_id
                        AND can_edit_outil(ml.project_id, 'materiel')));


-- ── 10. RLS — matos_categories (via matos_versions → matos_listes) ───────
ALTER TABLE matos_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_cat_scoped_read"  ON matos_categories;
DROP POLICY IF EXISTS "matos_cat_scoped_write" ON matos_categories;

CREATE POLICY "matos_cat_scoped_read" ON matos_categories
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_categories.matos_version_id
      AND can_read_outil(ml.project_id, 'materiel')
  ));

CREATE POLICY "matos_cat_scoped_write" ON matos_categories
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_categories.matos_version_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_categories.matos_version_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ));


-- ── 11. RLS — matos_items (via matos_versions → matos_listes) ────────────
ALTER TABLE matos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_items_scoped_read"  ON matos_items;
DROP POLICY IF EXISTS "matos_items_scoped_write" ON matos_items;

CREATE POLICY "matos_items_scoped_read" ON matos_items
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_items.matos_version_id
      AND can_read_outil(ml.project_id, 'materiel')
  ));

CREATE POLICY "matos_items_scoped_write" ON matos_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_items.matos_version_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    JOIN matos_listes ml ON ml.id = mv.matos_liste_id
    WHERE mv.id = matos_items.matos_version_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ));


-- ── 12. RLS — matos_item_loueurs (via matos_items → versions → listes) ──
ALTER TABLE matos_item_loueurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_item_loueurs_scoped_read"  ON matos_item_loueurs;
DROP POLICY IF EXISTS "matos_item_loueurs_scoped_write" ON matos_item_loueurs;

CREATE POLICY "matos_item_loueurs_scoped_read" ON matos_item_loueurs
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_items mi
    JOIN matos_versions mv ON mv.id = mi.matos_version_id
    JOIN matos_listes   ml ON ml.id = mv.matos_liste_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_read_outil(ml.project_id, 'materiel')
  ));

CREATE POLICY "matos_item_loueurs_scoped_write" ON matos_item_loueurs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_items mi
    JOIN matos_versions mv ON mv.id = mi.matos_version_id
    JOIN matos_listes   ml ON ml.id = mv.matos_liste_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_items mi
    JOIN matos_versions mv ON mv.id = mi.matos_version_id
    JOIN matos_listes   ml ON ml.id = mv.matos_liste_id
    WHERE mi.id = matos_item_loueurs.item_id
      AND can_edit_outil(ml.project_id, 'materiel')
  ));


COMMIT;
