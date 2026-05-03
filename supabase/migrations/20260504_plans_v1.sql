-- ============================================================================
-- Migration : PLANS V1 — Plans techniques (caméra, lumière, son, …)
-- Date      : 2026-05-04
-- ============================================================================
--
-- Contexte :
--   Nouvelle tab "Plans" dans le ProjetLayout. Sert à stocker les plans
--   techniques d'un projet (plan caméra, plan de feu, plan de masse, …) et
--   les rendre consultables facilement, en particulier sur mobile en terrain
--   (cas d'usage central : un cadreur consulte le plan caméra sur place).
--
--   Format de fichier accepté : png, jpg, pdf.
--
-- Décisions Hugo (session 2026-05-04) :
--   1. Catégories obligatoires + tags libres optionnels (multi).
--   2. Liste de catégories hardcodée par défaut (10 cats), personnalisable
--      par organisation (rename / archive / réorder / création).
--   3. Seules les permissions admin org peuvent gérer les catégories.
--   4. Versioning avec archive : remplacer un fichier crée une entrée dans
--      plan_versions (ancien fichier conservé), le plan principal pointe
--      vers la dernière version.
--   5. Soft archive des catégories : les plans existants conservent leur
--      catégorie (affichée "(Archivée)"), mais elle disparaît du dropdown
--      de création.
--   6. Mobile-first : viewer plein écran (modale + URL state ?plan=<id>),
--      pinch-zoom, multi-pages PDF. Pas de share offline en V1 (V2 PWA).
--
-- Architecture :
--   - outils_catalogue : ajout 'plans' (active la gating canRead/canEdit).
--   - plan_categories  : catégories per-org (10 défaut + personnalisable).
--   - plans            : table principale, scopée projet.
--   - plan_versions    : archive automatique au remplacement de fichier.
--   - bucket plans     : storage privé, signed URLs (bucket non public).
--
-- RLS :
--   - plan_categories : SELECT pour membres de l'org, WRITE admin org only.
--   - plans / plan_versions : USING can_read_outil(project_id, 'plans'),
--     CHECK can_edit_outil(project_id, 'plans'). Pattern aligné sur matos.
--   - storage : path = <project_id>/<plan_id>/<filename>. RLS valide via
--     can_read_outil / can_edit_outil sur le project_id du 1er segment.
--
-- Idempotent : INSERT … ON CONFLICT, CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS.
-- ============================================================================

BEGIN;


-- ── 1. Ajout 'plans' au catalogue d'outils ──────────────────────────────────
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'plans',
  'Plans',
  'Plans techniques du projet (plan caméra, plan de feu, masse, …) consultables en terrain',
  'Map',
  60
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. Table plan_categories — catégories de plans per-org ──────────────────
-- Seed des 10 catégories par défaut sur chaque org (et trigger pour les
-- nouvelles orgs). L'admin org peut renommer / archiver / créer / réordonner.
-- Soft archive (is_archived) : les plans existants conservent leur catégorie
-- mais elle disparaît du dropdown de création.
CREATE TABLE IF NOT EXISTS plan_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  key          text NOT NULL,
  label        text NOT NULL,
  color        text NOT NULL DEFAULT '#5c5c5c',
  sort_order   integer NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false,
  is_archived  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS plan_categories_org_idx
  ON plan_categories(org_id) WHERE NOT is_archived;

DROP TRIGGER IF EXISTS plan_categories_updated_at ON plan_categories;
CREATE TRIGGER plan_categories_updated_at
  BEFORE UPDATE ON plan_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_categories IS
  'Catégories de plans per-org. 10 catégories par défaut seedées à la création de l''org (is_default=true). L''admin org peut renommer, ajouter, archiver, réordonner. Le `key` reste stable pour permettre les renames de label sans casser les références (filters URL, intégrations futures).';
COMMENT ON COLUMN plan_categories.key IS
  'Identifiant stable (ex: ''camera''). Auto-slugifié au create côté front. Unique par org.';
COMMENT ON COLUMN plan_categories.is_default IS
  'true = catégorie seedée par Captiv. L''admin peut la modifier mais c''est un indicateur (utile pour réinitialiser un jour).';


-- ── 3. Helper : seed des 10 catégories par défaut ───────────────────────────
-- Exposé en fonction réutilisable (pour le trigger sur orgs + le backfill
-- des orgs existantes).
CREATE OR REPLACE FUNCTION _plans_seed_default_categories(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO plan_categories (org_id, key, label, color, sort_order, is_default)
  VALUES
    (p_org_id, 'camera',     'Caméra',                '#4d9fff', 10, true),
    (p_org_id, 'lumiere',    'Lumière',               '#ffce00', 20, true),
    (p_org_id, 'son',         'Son',                  '#9c5ffd', 30, true),
    (p_org_id, 'video',      'Vidéo / Régie',         '#ff5ac4', 40, true),
    (p_org_id, 'reseau',     'Réseau / Comms',        '#00c875', 50, true),
    (p_org_id, 'plateau',    'Plateau / Scène',       '#ff9f0a', 60, true),
    (p_org_id, 'logistique', 'Logistique',            '#ffa657', 70, true),
    (p_org_id, 'securite',   'Sécurité',              '#ff4757', 80, true),
    (p_org_id, 'storyboard', 'Storyboard / Découpage','#a8a8a8', 90, true),
    (p_org_id, 'autre',      'Autre',                 '#5c5c5c',100, true)
  ON CONFLICT (org_id, key) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION _plans_seed_default_categories IS
  'Insère les 10 catégories par défaut pour une org donnée. Idempotent (ON CONFLICT DO NOTHING). Appelé par trigger au create d''une org + backfill des orgs existantes.';


-- ── 4. Trigger : seed auto à la création d'une nouvelle org ─────────────────
CREATE OR REPLACE FUNCTION _plans_on_organisation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM _plans_seed_default_categories(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plans_seed_categories_on_org ON organisations;
CREATE TRIGGER plans_seed_categories_on_org
  AFTER INSERT ON organisations
  FOR EACH ROW EXECUTE FUNCTION _plans_on_organisation_insert();


-- ── 5. Backfill : seed des catégories pour les orgs existantes ──────────────
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organisations LOOP
    PERFORM _plans_seed_default_categories(org_record.id);
  END LOOP;
END$$;


-- ── 6. Table plans — un plan = un fichier (PDF / image) ─────────────────────
-- file_url stocke le chemin Storage relatif (pas l'URL signée). Le front
-- demande une signed URL à la volée via supabase.storage.createSignedUrl()
-- (validité ~10 min, renouvelée à chaque ouverture).
CREATE TABLE IF NOT EXISTS plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id       uuid REFERENCES plan_categories(id) ON DELETE SET NULL,
  name              text NOT NULL,
  description       text,
  tags              text[] NOT NULL DEFAULT '{}',
  storage_path      text NOT NULL,         -- ex: <project_id>/<plan_id>/<filename>
  file_type         text NOT NULL CHECK (file_type IN ('pdf','png','jpg')),
  file_size         bigint,
  page_count        integer,                -- PDF only ; null pour images
  applicable_date   date,                   -- jour applicable (multi-jour de tournage)
  current_version   integer NOT NULL DEFAULT 1,
  sort_order        integer NOT NULL DEFAULT 0,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS plans_project_idx
  ON plans(project_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS plans_category_idx
  ON plans(category_id) WHERE category_id IS NOT NULL;

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plans IS
  'PLANS V1 : un plan technique d''un projet (PDF ou image). category_id obligatoire au front mais nullable en DB pour permettre le SET NULL si la catégorie est hard-deleted (en pratique on archive seulement). current_version indique la version actuelle ; les anciennes sont dans plan_versions.';
COMMENT ON COLUMN plans.storage_path IS
  'Chemin relatif dans le bucket Storage `plans`. Format : <project_id>/<plan_id>/<filename>. Le front demande une signed URL à la volée (createSignedUrl, validity ~10min) pour la consultation.';
COMMENT ON COLUMN plans.applicable_date IS
  'Optionnel. Jour de tournage auquel le plan s''applique (utile sur multi-jour). Affiché en chip à côté du titre.';
COMMENT ON COLUMN plans.current_version IS
  'Numéro de la version courante (1 au create, +1 à chaque remplacement). Les versions précédentes sont dans plan_versions.';


-- ── 7. Table plan_versions — archive des anciennes versions ─────────────────
-- Lors d'un remplacement de fichier (EditPlanModal) : on copie l'ancien
-- fichier dans un nouveau path versionné, on insère une row plan_versions,
-- puis on update plans avec le nouveau fichier + current_version+1.
CREATE TABLE IF NOT EXISTS plan_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  version_num   integer NOT NULL,
  storage_path  text NOT NULL,
  file_type     text NOT NULL CHECK (file_type IN ('pdf','png','jpg')),
  file_size     bigint,
  page_count    integer,
  comment       text,                -- "Ajout caméra HF en fond" — note de mise à jour
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (plan_id, version_num)
);

CREATE INDEX IF NOT EXISTS plan_versions_plan_idx ON plan_versions(plan_id);

COMMENT ON TABLE plan_versions IS
  'Archive des versions précédentes d''un plan. Une row est créée à chaque remplacement de fichier sur un plan (EditPlanModal). La version courante reste dans plans (current_version), uniquement les anciennes sont ici.';
COMMENT ON COLUMN plan_versions.comment IS
  'Note libre saisie par l''utilisateur lors de la mise à jour ("Ajout caméra HF", "Validé par DOP", …). Affichée dans le drawer "Versions précédentes" du PlanViewer.';


-- ── 8. RLS — plan_categories ────────────────────────────────────────────────
-- SELECT : tous les membres de l'org peuvent lire (besoin pour afficher les
-- chips de filtre + le label dans les listes). WRITE : admin org seulement
-- (cf. décision Hugo "choix A : admin org uniquement").
ALTER TABLE plan_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_categories_org_read" ON plan_categories;
CREATE POLICY "plan_categories_org_read" ON plan_categories
  FOR SELECT
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "plan_categories_admin_write" ON plan_categories;
CREATE POLICY "plan_categories_admin_write" ON plan_categories
  FOR ALL
  USING      (org_id = get_user_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = get_user_org_id() AND current_user_role() = 'admin');


-- ── 9. RLS — plans (via outil 'plans' scopé projet) ─────────────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_scoped_read"  ON plans;
DROP POLICY IF EXISTS "plans_scoped_write" ON plans;

CREATE POLICY "plans_scoped_read" ON plans
  FOR SELECT
  USING (can_read_outil(project_id, 'plans'));

CREATE POLICY "plans_scoped_write" ON plans
  FOR ALL
  USING      (can_edit_outil(project_id, 'plans'))
  WITH CHECK (can_edit_outil(project_id, 'plans'));


-- ── 10. RLS — plan_versions (via plan_id → plans → outil) ───────────────────
ALTER TABLE plan_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_versions_scoped_read"  ON plan_versions;
DROP POLICY IF EXISTS "plan_versions_scoped_write" ON plan_versions;

CREATE POLICY "plan_versions_scoped_read" ON plan_versions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM plans p
    WHERE p.id = plan_versions.plan_id
      AND can_read_outil(p.project_id, 'plans')
  ));

CREATE POLICY "plan_versions_scoped_write" ON plan_versions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM plans p
    WHERE p.id = plan_versions.plan_id
      AND can_edit_outil(p.project_id, 'plans')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans p
    WHERE p.id = plan_versions.plan_id
      AND can_edit_outil(p.project_id, 'plans')
  ));


-- ── 11. Bucket Storage `plans` ──────────────────────────────────────────────
-- Bucket privé (pas de public read). Le front utilise createSignedUrl() à la
-- consultation pour générer une URL signée temporaire. Limite 50 MB par
-- fichier (les plans techniques en haute def peuvent être lourds).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'plans',
  'plans',
  false,
  50 * 1024 * 1024,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── 12. RLS — storage.objects (bucket 'plans') ──────────────────────────────
-- Path convention : <project_id>/<plan_id>/<filename>. Le 1er segment du
-- path = project_id → on dérive can_read_outil / can_edit_outil dessus.
DROP POLICY IF EXISTS "plans_storage_read"   ON storage.objects;
DROP POLICY IF EXISTS "plans_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "plans_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "plans_storage_delete" ON storage.objects;

CREATE POLICY "plans_storage_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'plans'
    AND can_read_outil(
      ((storage.foldername(name))[1])::uuid,
      'plans'
    )
  );

CREATE POLICY "plans_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'plans'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'plans'
    )
  );

CREATE POLICY "plans_storage_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'plans'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'plans'
    )
  );

CREATE POLICY "plans_storage_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'plans'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'plans'
    )
  );


COMMIT;
