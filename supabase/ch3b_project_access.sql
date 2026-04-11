-- =====================================================================
-- CHANTIER 3B.1 — Project Access + RLS granulaire
-- =====================================================================
-- Objectif :
--   1. Cr\u00e9er project_access (attachement user <-> projet, template par projet)
--   2. Cr\u00e9er project_access_permissions (override par outil, par projet)
--   3. D\u00e9finir les helpers SQL (is_admin, can_see_project, can_read_outil, ...)
--   4. Remplacer les RLS trop larges par des RLS scop\u00e9es \u00e0 project_access
--   5. Nettoyer les reliquats de 3A (profiles.metier_template_id, prestataire_outils)
--
-- Idempotent : safe \u00e0 rejouer plusieurs fois.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. NETTOYAGE DES RELIQUATS 3A
-- ---------------------------------------------------------------------
-- Le mod\u00e8le \u00e9volue : le template m\u00e9tier n'est plus global sur le profil,
-- il est port\u00e9 par project_access (un humain peut \u00eatre monteur sur un
-- projet et chef op sur un autre).

-- Suppression de la table d'overrides globaux (devient inutile, les
-- overrides vivent d\u00e9sormais par projet)
DROP POLICY IF EXISTS "prestataire_outils_self_read"   ON prestataire_outils;
DROP POLICY IF EXISTS "prestataire_outils_admin_write" ON prestataire_outils;
DROP TABLE IF EXISTS prestataire_outils;

-- Suppression des colonnes globales sur profiles
ALTER TABLE profiles DROP COLUMN IF EXISTS metier_template_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS metier_label;

-- ---------------------------------------------------------------------
-- 2. TABLE : project_access (attachement user <-> projet)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_access (
  user_id             UUID REFERENCES profiles(id)       ON DELETE CASCADE NOT NULL,
  project_id          UUID REFERENCES projects(id)       ON DELETE CASCADE NOT NULL,

  -- Template m\u00e9tier appliqu\u00e9 \u00e0 ce (user, project).
  -- NULL = l'utilisateur n'est pas prestataire OU l'attachement est pass\u00e9
  --       par un rôle interne (charge_prod/coordinateur) qui bypass les
  --       permissions outil.
  metier_template_id  UUID REFERENCES metiers_template(id) ON DELETE SET NULL,

  -- Libellé libre affich\u00e9 dans l'UI ("Chef op lumi\u00e8re", "Renfort week-end")
  role_label          TEXT,

  -- Tra\u00e7abilit\u00e9
  note                TEXT,
  added_at            TIMESTAMPTZ DEFAULT now(),
  added_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,

  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_access_project ON project_access(project_id);
CREATE INDEX IF NOT EXISTS idx_project_access_user    ON project_access(user_id);

-- ---------------------------------------------------------------------
-- 3. TABLE : project_access_permissions (overrides par outil)
-- ---------------------------------------------------------------------
-- NULL sur can_read/can_comment/can_edit = "h\u00e9riter du template".
-- Valeur explicite = "remplace le template sur cet outil, sur ce projet".
CREATE TABLE IF NOT EXISTS project_access_permissions (
  user_id      UUID NOT NULL,
  project_id   UUID NOT NULL,
  outil_key    TEXT REFERENCES outils_catalogue(key) ON DELETE CASCADE NOT NULL,
  can_read     BOOLEAN,
  can_comment  BOOLEAN,
  can_edit     BOOLEAN,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, project_id, outil_key),
  FOREIGN KEY (user_id, project_id)
    REFERENCES project_access(user_id, project_id)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 4. HELPERS SQL (SECURITY DEFINER, STABLE)
-- ---------------------------------------------------------------------
-- Tous les helpers utilisent auth.uid() et sont immutables dans une m\u00eame
-- transaction (STABLE). Ils sont SECURITY DEFINER pour pouvoir lire
-- profiles et project_access sans boucler sur leurs propres RLS.

-- Rôle courant (cached par Postgres dans une m\u00eame query)
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN ('admin','charge_prod','coordinateur')
$$;

CREATE OR REPLACE FUNCTION has_finance_role()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN ('admin','charge_prod')
$$;

-- Attachement au projet
CREATE OR REPLACE FUNCTION is_project_member(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_access
    WHERE user_id = auth.uid() AND project_id = pid
  )
$$;

-- Visibilit\u00e9 du projet : admin tout, autres = attach\u00e9s uniquement
CREATE OR REPLACE FUNCTION can_see_project(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin() OR is_project_member(pid)
$$;

-- Visibilit\u00e9 des finances du projet : admin ou charge_prod attach\u00e9
CREATE OR REPLACE FUNCTION can_see_project_finance(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_admin()
    OR (current_user_role() = 'charge_prod' AND is_project_member(pid))
$$;

-- R\u00e9solution template + override pour un outil sur un projet
CREATE OR REPLACE FUNCTION can_read_outil(pid UUID, outil TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN is_admin() THEN TRUE
      -- Les internes attach\u00e9s bypassent les permissions outil
      WHEN current_user_role() IN ('charge_prod','coordinateur')
           AND is_project_member(pid) THEN TRUE
      -- Prestataires : override projet d'abord, template ensuite
      WHEN current_user_role() = 'prestataire'
           AND is_project_member(pid) THEN
        COALESCE(
          (SELECT can_read FROM project_access_permissions
             WHERE user_id = auth.uid() AND project_id = pid AND outil_key = outil),
          (SELECT mtp.can_read
             FROM metier_template_permissions mtp
             JOIN project_access pa
               ON pa.metier_template_id = mtp.template_id
             WHERE pa.user_id = auth.uid()
               AND pa.project_id = pid
               AND mtp.outil_key = outil),
          FALSE
        )
      ELSE FALSE
    END
$$;

CREATE OR REPLACE FUNCTION can_edit_outil(pid UUID, outil TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN is_admin() THEN TRUE
      WHEN current_user_role() IN ('charge_prod','coordinateur')
           AND is_project_member(pid) THEN TRUE
      WHEN current_user_role() = 'prestataire'
           AND is_project_member(pid) THEN
        COALESCE(
          (SELECT can_edit FROM project_access_permissions
             WHERE user_id = auth.uid() AND project_id = pid AND outil_key = outil),
          (SELECT mtp.can_edit
             FROM metier_template_permissions mtp
             JOIN project_access pa
               ON pa.metier_template_id = mtp.template_id
             WHERE pa.user_id = auth.uid()
               AND pa.project_id = pid
               AND mtp.outil_key = outil),
          FALSE
        )
      ELSE FALSE
    END
$$;

-- ---------------------------------------------------------------------
-- 5. RLS SUR project_access / project_access_permissions
-- ---------------------------------------------------------------------
ALTER TABLE project_access             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_access_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_access_read_self_or_admin"   ON project_access;
DROP POLICY IF EXISTS "project_access_admin_write"          ON project_access;
DROP POLICY IF EXISTS "pap_read_self_or_admin"              ON project_access_permissions;
DROP POLICY IF EXISTS "pap_admin_write"                     ON project_access_permissions;

-- L'utilisateur voit ses propres lignes. Les admins voient tout.
-- Les charge_prod / coordinateur attach\u00e9s au projet voient qui d'autre est attach\u00e9.
CREATE POLICY "project_access_read_self_or_admin" ON project_access
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_admin()
    OR (current_user_role() IN ('charge_prod','coordinateur')
        AND is_project_member(project_id))
  );

-- Seuls les admins peuvent \u00e9crire dans project_access pour 3B.1.
-- (3B.2 ouvrira ça aux charge_prod avec des garde-fous)
CREATE POLICY "project_access_admin_write" ON project_access
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "pap_read_self_or_admin" ON project_access_permissions
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_admin()
    OR (current_user_role() IN ('charge_prod','coordinateur')
        AND is_project_member(project_id))
  );

CREATE POLICY "pap_admin_write" ON project_access_permissions
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---------------------------------------------------------------------
-- 6. RLS TIGHTENING SUR LES TABLES EXISTANTES
-- ---------------------------------------------------------------------
-- Strat\u00e9gie : on DROP les anciennes policies "org-wide" et on les remplace
-- par des policies qui exigent can_see_project / can_see_project_finance /
-- can_read_outil.

-- === projects : visibilit\u00e9 globale ===================================
DROP POLICY IF EXISTS "projects_org"          ON projects;
DROP POLICY IF EXISTS "projects_scoped_read"  ON projects;
DROP POLICY IF EXISTS "projects_scoped_write" ON projects;

CREATE POLICY "projects_scoped_read" ON projects
  FOR SELECT
  USING (org_id = get_user_org_id() AND can_see_project(id));

-- Cr\u00e9ation / modif / suppression : admin partout, charge_prod uniquement
-- sur les projets où il est attach\u00e9. La cr\u00e9ation d'un projet est g\u00e9r\u00e9e
-- par un INSERT admin + ajout automatique du cr\u00e9ateur dans project_access
-- (voir trigger plus bas).
CREATE POLICY "projects_scoped_write" ON projects
  FOR ALL
  USING (org_id = get_user_org_id()
         AND (is_admin()
              OR (current_user_role() = 'charge_prod' AND is_project_member(id))))
  WITH CHECK (org_id = get_user_org_id()
              AND (is_admin() OR current_user_role() = 'charge_prod'));

-- === devis + enfants : finance scop\u00e9 =================================
DROP POLICY IF EXISTS "devis_org"          ON devis;
DROP POLICY IF EXISTS "devis_public_token" ON devis;
DROP POLICY IF EXISTS "devis_scoped"       ON devis;

CREATE POLICY "devis_scoped" ON devis
  FOR ALL
  USING (can_see_project_finance(project_id))
  WITH CHECK (can_see_project_finance(project_id));

-- Le token public reste pour les clients externes (accès public en lecture)
CREATE POLICY "devis_public_token" ON devis
  FOR SELECT
  USING (public_token IS NOT NULL);

DROP POLICY IF EXISTS "devis_cat_org"     ON devis_categories;
DROP POLICY IF EXISTS "devis_cat_scoped"  ON devis_categories;
CREATE POLICY "devis_cat_scoped" ON devis_categories
  FOR ALL
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_categories.devis_id
                   AND can_see_project_finance(d.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM devis d
                      WHERE d.id = devis_categories.devis_id
                        AND can_see_project_finance(d.project_id)));

DROP POLICY IF EXISTS "devis_lines_org"    ON devis_lines;
DROP POLICY IF EXISTS "devis_lines_scoped" ON devis_lines;
CREATE POLICY "devis_lines_scoped" ON devis_lines
  FOR ALL
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_lines.devis_id
                   AND can_see_project_finance(d.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM devis d
                      WHERE d.id = devis_lines.devis_id
                        AND can_see_project_finance(d.project_id)));

DROP POLICY IF EXISTS "dlm_org"    ON devis_ligne_membres;
DROP POLICY IF EXISTS "dlm_scoped" ON devis_ligne_membres;
CREATE POLICY "dlm_scoped" ON devis_ligne_membres
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM devis_lines dl
    JOIN devis d ON d.id = dl.devis_id
    WHERE dl.id = devis_ligne_membres.devis_line_id
      AND can_see_project_finance(d.project_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM devis_lines dl
    JOIN devis d ON d.id = dl.devis_id
    WHERE dl.id = devis_ligne_membres.devis_line_id
      AND can_see_project_finance(d.project_id)
  ));

-- === budget_reel : finance scop\u00e9 ======================================
DROP POLICY IF EXISTS "budget_reel_org"    ON budget_reel;
DROP POLICY IF EXISTS "budget_reel_scoped" ON budget_reel;
CREATE POLICY "budget_reel_scoped" ON budget_reel
  FOR ALL
  USING (can_see_project_finance(project_id))
  WITH CHECK (can_see_project_finance(project_id));

-- === factures : finance scop\u00e9 =========================================
DROP POLICY IF EXISTS "factures_org"    ON factures;
DROP POLICY IF EXISTS "factures_scoped" ON factures;
CREATE POLICY "factures_scoped" ON factures
  FOR ALL
  USING (can_see_project_finance(project_id))
  WITH CHECK (can_see_project_finance(project_id));

-- === livrables : outil 'livrables' ====================================
DROP POLICY IF EXISTS "livrables_org"           ON livrables;
DROP POLICY IF EXISTS "livrables_scoped_read"   ON livrables;
DROP POLICY IF EXISTS "livrables_scoped_write"  ON livrables;
CREATE POLICY "livrables_scoped_read" ON livrables
  FOR SELECT USING (can_read_outil(project_id, 'livrables'));
CREATE POLICY "livrables_scoped_write" ON livrables
  FOR ALL USING (can_edit_outil(project_id, 'livrables'))
          WITH CHECK (can_edit_outil(project_id, 'livrables'));

DROP POLICY IF EXISTS "livrable_versions_org"           ON livrable_versions;
DROP POLICY IF EXISTS "livrable_versions_scoped_read"   ON livrable_versions;
DROP POLICY IF EXISTS "livrable_versions_scoped_write"  ON livrable_versions;
CREATE POLICY "livrable_versions_scoped_read" ON livrable_versions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM livrables l
    WHERE l.id = livrable_versions.livrable_id
      AND can_read_outil(l.project_id, 'livrables')
  ));
CREATE POLICY "livrable_versions_scoped_write" ON livrable_versions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM livrables l
                 WHERE l.id = livrable_versions.livrable_id
                   AND can_edit_outil(l.project_id, 'livrables')))
  WITH CHECK (EXISTS (SELECT 1 FROM livrables l
                      WHERE l.id = livrable_versions.livrable_id
                        AND can_edit_outil(l.project_id, 'livrables')));

-- === call_sheets + call_sheet_lignes : outil 'callsheet' ==============
DROP POLICY IF EXISTS "call_sheets_org"           ON call_sheets;
DROP POLICY IF EXISTS "call_sheets_scoped_read"   ON call_sheets;
DROP POLICY IF EXISTS "call_sheets_scoped_write"  ON call_sheets;
CREATE POLICY "call_sheets_scoped_read" ON call_sheets
  FOR SELECT USING (can_read_outil(project_id, 'callsheet'));
CREATE POLICY "call_sheets_scoped_write" ON call_sheets
  FOR ALL USING (can_edit_outil(project_id, 'callsheet'))
          WITH CHECK (can_edit_outil(project_id, 'callsheet'));

DROP POLICY IF EXISTS "call_sheet_lignes_org"           ON call_sheet_lignes;
DROP POLICY IF EXISTS "call_sheet_lignes_scoped_read"   ON call_sheet_lignes;
DROP POLICY IF EXISTS "call_sheet_lignes_scoped_write"  ON call_sheet_lignes;
CREATE POLICY "call_sheet_lignes_scoped_read" ON call_sheet_lignes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM call_sheets cs
    WHERE cs.id = call_sheet_lignes.call_sheet_id
      AND can_read_outil(cs.project_id, 'callsheet')
  ));
CREATE POLICY "call_sheet_lignes_scoped_write" ON call_sheet_lignes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM call_sheets cs
                 WHERE cs.id = call_sheet_lignes.call_sheet_id
                   AND can_edit_outil(cs.project_id, 'callsheet')))
  WITH CHECK (EXISTS (SELECT 1 FROM call_sheets cs
                      WHERE cs.id = call_sheet_lignes.call_sheet_id
                        AND can_edit_outil(cs.project_id, 'callsheet')));

-- === planning_phases / planning_items / jours_tournage : outil 'planning' ===
DROP POLICY IF EXISTS "planning_phases_org"           ON planning_phases;
DROP POLICY IF EXISTS "planning_phases_scoped_read"   ON planning_phases;
DROP POLICY IF EXISTS "planning_phases_scoped_write"  ON planning_phases;
CREATE POLICY "planning_phases_scoped_read" ON planning_phases
  FOR SELECT USING (can_read_outil(project_id, 'planning'));
CREATE POLICY "planning_phases_scoped_write" ON planning_phases
  FOR ALL USING (can_edit_outil(project_id, 'planning'))
          WITH CHECK (can_edit_outil(project_id, 'planning'));

DROP POLICY IF EXISTS "planning_items_org"           ON planning_items;
DROP POLICY IF EXISTS "planning_items_scoped_read"   ON planning_items;
DROP POLICY IF EXISTS "planning_items_scoped_write"  ON planning_items;
CREATE POLICY "planning_items_scoped_read" ON planning_items
  FOR SELECT USING (can_read_outil(project_id, 'planning'));
CREATE POLICY "planning_items_scoped_write" ON planning_items
  FOR ALL USING (can_edit_outil(project_id, 'planning'))
          WITH CHECK (can_edit_outil(project_id, 'planning'));

DROP POLICY IF EXISTS "jours_tournage_org"           ON jours_tournage;
DROP POLICY IF EXISTS "jours_tournage_scoped_read"   ON jours_tournage;
DROP POLICY IF EXISTS "jours_tournage_scoped_write"  ON jours_tournage;
CREATE POLICY "jours_tournage_scoped_read" ON jours_tournage
  FOR SELECT USING (can_read_outil(project_id, 'planning'));
CREATE POLICY "jours_tournage_scoped_write" ON jours_tournage
  FOR ALL USING (can_edit_outil(project_id, 'planning'))
          WITH CHECK (can_edit_outil(project_id, 'planning'));

-- === projet_membres : outil 'equipe' (read seulement, scop\u00e9 par projet) ===
-- NB : les joins depuis call_sheet_lignes / devis_ligne_membres ont besoin
-- de LIRE cette table m\u00eame pour un prestataire qui n'a pas acc\u00e8s \u00e0 l'outil
-- equipe. On autorise donc READ d\u00e8s que le projet est visible, et on
-- g\u00e8re le masquage de la PAGE "\u00c9quipe" au niveau UI (ProjetLayout).
-- L'\u00e9criture, elle, reste conditionn\u00e9e \u00e0 edit sur l'outil equipe.
DROP POLICY IF EXISTS "projet_membres_org"           ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_read"   ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_write"  ON projet_membres;
CREATE POLICY "projet_membres_scoped_read" ON projet_membres
  FOR SELECT USING (can_see_project(project_id));
CREATE POLICY "projet_membres_scoped_write" ON projet_membres
  FOR ALL USING (can_edit_outil(project_id, 'equipe'))
          WITH CHECK (can_edit_outil(project_id, 'equipe'));

-- ---------------------------------------------------------------------
-- 7. TRIGGER : auto-attachement du cr\u00e9ateur d'un projet
-- ---------------------------------------------------------------------
-- Quand un charge_prod cr\u00e9e un projet, on l'inscrit automatiquement dans
-- project_access, sinon il ne verrait pas le projet qu'il vient de cr\u00e9er.
CREATE OR REPLACE FUNCTION auto_attach_creator_to_project()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO project_access (user_id, project_id, added_by)
    VALUES (NEW.created_by, NEW.id, NEW.created_by)
    ON CONFLICT (user_id, project_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_attach_creator ON projects;
CREATE TRIGGER trg_auto_attach_creator
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION auto_attach_creator_to_project();

-- ---------------------------------------------------------------------
-- 8. COMMENTAIRES POUR LA DOC POSTGRES
-- ---------------------------------------------------------------------
COMMENT ON TABLE  project_access IS
  'Chantier 3B : attache un user (profiles) \u00e0 un projet. Porte le template m\u00e9tier utilis\u00e9 sur CE projet pour les prestataires.';
COMMENT ON TABLE  project_access_permissions IS
  'Chantier 3B : overrides par outil sur un (user, projet). NULL = h\u00e9riter du template.';
COMMENT ON FUNCTION can_see_project(UUID) IS
  'Chantier 3B : TRUE si admin OU user attach\u00e9 au projet via project_access.';
COMMENT ON FUNCTION can_read_outil(UUID, TEXT) IS
  'Chantier 3B : r\u00e9solution template + override pour la lecture d''un outil sur un projet. Bypass admin + internes attach\u00e9s.';
COMMENT ON FUNCTION can_edit_outil(UUID, TEXT) IS
  'Chantier 3B : idem can_read_outil mais pour l''\u00e9criture.';

COMMIT;

-- =====================================================================
-- V\u00c9RIFICATIONS POST-MIGRATION (\u00e0 lancer \u00e0 la main)
-- =====================================================================
-- 1. Les nouvelles tables existent et sont vides
--    SELECT count(*) FROM project_access;                     -- 0
--    SELECT count(*) FROM project_access_permissions;         -- 0
--
-- 2. Les colonnes 3A sont bien supprim\u00e9es
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='profiles' AND column_name IN ('metier_template_id','metier_label');
--    -- 0 lignes
--
-- 3. prestataire_outils n'existe plus
--    SELECT to_regclass('public.prestataire_outils');          -- NULL
--
-- 4. Les helpers renvoient ce qu'on attend pour l'admin
--    SELECT is_admin(), is_internal(), has_finance_role();     -- true, true, true
--
-- 5. Admin voit tous les projets
--    SELECT id, title FROM projects;                           -- toutes les lignes
--
-- =====================================================================
