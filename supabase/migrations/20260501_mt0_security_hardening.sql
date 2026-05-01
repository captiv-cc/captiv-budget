-- =====================================================================
-- MT-0.3 — Security hardening multi-tenant (Phase 0 du chantier MT)
-- =====================================================================
--
-- Contexte : MATRICE GOLDEN était mono-org de fait (Captiv unique).
-- Avant d'ouvrir l'outil à d'autres sociétés de production, on durcit
-- les fonctions de sécurité (RLS helpers) et on nettoie les policies
-- trop laxistes pour garantir un cloisonnement strict cross-org.
--
-- Décisions validées (cf. CHANTIER_MULTI_TENANT.md) :
--   • Option A : cloisonnement total. Un admin d'une org ne voit JAMAIS
--     les données d'une autre org. Pas de bypass dans les helpers RLS.
--   • Le super_admin (Phase 1) sera RGPD-safe : pas d'accès aux données
--     business, uniquement à des métriques agrégées + actions métier.
--
-- Cette migration est idempotente (safe à rejouer).
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. DURCISSEMENT DES HELPERS DE SÉCURITÉ
-- =====================================================================
-- Les fonctions can_read_outil / can_edit_outil / can_see_project /
-- can_see_project_finance / is_project_member sont la pierre angulaire
-- de la sécurité : 99% des policies RLS passent par elles. On y ajoute
-- un garde-fou multi-tenant : "le projet doit appartenir à l'org du user".
--
-- Effet de cascade : toutes les policies qui appellent ces helpers
-- héritent automatiquement du filtre org, sans qu'on ait à les modifier
-- une par une.

-- ---------------------------------------------------------------------
-- 1.1 — is_project_member : garde-fou MT ajouté
-- ---------------------------------------------------------------------
-- Avant : retournait TRUE dès qu'il y avait une row dans project_access
-- pour ce user et ce projet, sans vérifier que les deux sont dans la
-- même org.
-- Après : on vérifie en plus que le projet appartient à l'org du user.
-- Cela protège même si une row pirate finissait dans project_access.
CREATE OR REPLACE FUNCTION is_project_member(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_access pa
    JOIN projects p ON p.id = pa.project_id
    WHERE pa.user_id = auth.uid()
      AND pa.project_id = pid
      AND p.org_id = get_user_org_id()  -- ⚠️ Garde-fou multi-tenant
  )
$$;

COMMENT ON FUNCTION is_project_member(UUID) IS
  'MT-0.3 : TRUE si le user courant a une attache project_access sur ce projet ET que le projet appartient à son org. Garde-fou multi-tenant.';

-- ---------------------------------------------------------------------
-- 1.2 — can_see_project : visibilité projet
-- ---------------------------------------------------------------------
-- Le projet doit appartenir à l'org du user. Sans ça, un admin
-- d'une autre org pourrait voir tous les projets via is_admin()=TRUE.
CREATE OR REPLACE FUNCTION can_see_project(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pid AND p.org_id = get_user_org_id()  -- ⚠️ Garde-fou MT
    )
    AND (is_admin() OR is_project_member(pid))
$$;

COMMENT ON FUNCTION can_see_project(UUID) IS
  'MT-0.3 : TRUE si le projet appartient à l''org du user ET (user admin OU attaché au projet). Garde-fou multi-tenant.';

-- ---------------------------------------------------------------------
-- 1.3 — can_see_project_finance : visibilité finances
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_see_project_finance(pid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pid AND p.org_id = get_user_org_id()  -- ⚠️ Garde-fou MT
    )
    AND (
      is_admin()
      OR (current_user_role() = 'charge_prod' AND is_project_member(pid))
    )
$$;

COMMENT ON FUNCTION can_see_project_finance(UUID) IS
  'MT-0.3 : TRUE si le projet appartient à l''org du user ET (admin OU charge_prod attaché). Garde-fou multi-tenant.';

-- ---------------------------------------------------------------------
-- 1.4 — can_read_outil : lecture par outil
-- ---------------------------------------------------------------------
-- On ajoute le garde-fou MT en tête. La logique métier (admin / interne /
-- prestataire avec template + override) reste identique.
CREATE OR REPLACE FUNCTION can_read_outil(pid UUID, outil TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- ⚠️ Garde-fou multi-tenant : le projet doit appartenir à l'org du user
    EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.org_id = get_user_org_id())
    AND
    CASE
      WHEN is_admin() THEN TRUE
      -- Les internes attachés bypassent les permissions outil
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

COMMENT ON FUNCTION can_read_outil(UUID, TEXT) IS
  'MT-0.3 : résolution template + override pour lecture d''un outil sur un projet, avec garde-fou multi-tenant.';

-- ---------------------------------------------------------------------
-- 1.5 — can_edit_outil : écriture par outil
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_edit_outil(pid UUID, outil TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- ⚠️ Garde-fou multi-tenant : le projet doit appartenir à l'org du user
    EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.org_id = get_user_org_id())
    AND
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

COMMENT ON FUNCTION can_edit_outil(UUID, TEXT) IS
  'MT-0.3 : résolution template + override pour écriture d''un outil sur un projet, avec garde-fou multi-tenant.';

-- =====================================================================
-- 2. NETTOYAGE DES POLICIES OUVERTES SUR fournisseurs
-- =====================================================================
-- La table fournisseurs a 3 policies qui s'écrasent par OR implicite,
-- dont 2 totalement laxistes. On nettoie tout et on remet 2 policies
-- propres (SELECT scoped, WRITE admin).

DROP POLICY IF EXISTS "fournisseurs_all"           ON fournisseurs;
DROP POLICY IF EXISTS "fournisseurs_scoped_read"   ON fournisseurs;
DROP POLICY IF EXISTS "fournisseurs_scoped_write"  ON fournisseurs;

-- Lecture : tout user de l'org peut lire les fournisseurs de son org
CREATE POLICY "fournisseurs_scoped_read" ON fournisseurs
  FOR SELECT
  USING (org_id = get_user_org_id());

-- Écriture : admin et chargé de prod uniquement, et toujours dans son org
CREATE POLICY "fournisseurs_scoped_write" ON fournisseurs
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  );

-- =====================================================================
-- 3. NETTOYAGE devis_public_token
-- =====================================================================
-- L'audit a montré 3 versions successives de cette policy dont 2 en
-- "using (true)" (reliques de migrations). On force la version sûre :
-- accès SELECT public uniquement aux devis avec un token actif.

DROP POLICY IF EXISTS "devis_public_token" ON devis;

CREATE POLICY "devis_public_token" ON devis
  FOR SELECT
  USING (public_token IS NOT NULL);

-- =====================================================================
-- 4. DURCISSEMENT project_access / project_access_permissions
-- =====================================================================
-- Ces policies utilisaient is_admin() sans filtre org → un admin pouvait
-- écrire les permissions d'un projet d'une autre org. On ajoute le filtre.

DROP POLICY IF EXISTS "project_access_admin_write" ON project_access;
CREATE POLICY "project_access_admin_write" ON project_access
  FOR ALL
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_access.project_id
        AND p.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_access.project_id
        AND p.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "pap_admin_write" ON project_access_permissions;
CREATE POLICY "pap_admin_write" ON project_access_permissions
  FOR ALL
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_access_permissions.project_id
        AND p.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_access_permissions.project_id
        AND p.org_id = get_user_org_id()
    )
  );

-- Idem pour les policies SELECT : un admin ne devrait voir que les
-- attaches de projets de son org. On garde le path "user_id = auth.uid()"
-- intact (un user voit toujours ses propres attaches), et on durcit le
-- bypass admin.
DROP POLICY IF EXISTS "project_access_read_self_or_admin" ON project_access;
CREATE POLICY "project_access_read_self_or_admin" ON project_access
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      is_admin()
      AND EXISTS (SELECT 1 FROM projects p
                  WHERE p.id = project_access.project_id
                    AND p.org_id = get_user_org_id())
    )
    OR (
      current_user_role() IN ('charge_prod','coordinateur')
      AND is_project_member(project_id)
    )
  );

DROP POLICY IF EXISTS "pap_read_self_or_admin" ON project_access_permissions;
CREATE POLICY "pap_read_self_or_admin" ON project_access_permissions
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      is_admin()
      AND EXISTS (SELECT 1 FROM projects p
                  WHERE p.id = project_access_permissions.project_id
                    AND p.org_id = get_user_org_id())
    )
    OR (
      current_user_role() IN ('charge_prod','coordinateur')
      AND is_project_member(project_id)
    )
  );

COMMIT;

-- =====================================================================
-- VÉRIFICATIONS POST-MIGRATION (à lancer à la main dans le SQL editor)
-- =====================================================================
-- 1. Les 5 helpers sont bien à jour (ils contiennent get_user_org_id) :
--    SELECT proname FROM pg_proc
--    WHERE proname IN ('is_project_member','can_see_project',
--                      'can_see_project_finance','can_read_outil','can_edit_outil')
--      AND prosrc LIKE '%get_user_org_id%';
--    -- Doit renvoyer 5 lignes
--
-- 2. Les 3 policies fournisseurs ouvertes ont été supprimées :
--    SELECT polname FROM pg_policy
--    WHERE polrelid = 'fournisseurs'::regclass
--      AND polname IN ('fournisseurs_all',
--                      'fournisseurs_scoped_read',
--                      'fournisseurs_scoped_write');
--    -- Doit renvoyer uniquement les nouvelles versions
--
-- 3. Smoke test côté admin Captiv : tu dois toujours voir tes projets,
--    tes fournisseurs, tes devis, créer/modifier des items, etc. Aucun
--    changement fonctionnel attendu côté Captiv (1 seule org).
--
-- 4. Test cross-org (fait en MT-0.4 avec 2 orgs de test).
--
-- =====================================================================
