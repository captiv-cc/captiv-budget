-- ============================================================================
-- Migration : EQUIPE-PERM-2 — RLS DB pour le mode prestataire (Hugo + Martin)
-- Date      : 2026-05-04
-- Contexte  : Suite au commit ec8a542 (gating UI prestataire), il faut
--             aligner les RLS Postgres pour que les capabilities calculées
--             côté front soient effectivement appliquées côté serveur.
--
--             Sans ça :
--               - un prestataire en mode "vue" pourrait écrire via direct
--                 API call (les ALL policies org-scoped sont trop laxistes)
--               - un prestataire en canEdit ne peut PAS lire devis_lines /
--                 devis_lots / devis_categories (vue Attribution vide)
--               - un prestataire en canEdit pourrait écrire/supprimer des
--                 contacts (table partagée annuaire org)
--
-- Périmètre :
--   1. projet_membres : SELECT + INSERT + UPDATE gated par 'equipe',
--      DELETE strictement réservé aux internes (admin/cp/coord)
--   2. contacts : SELECT org-scoped (annuaire commun), WRITE réservé aux
--      internes (pas de modif annuaire par un prestataire)
--   3. devis / devis_lots / devis_lines / devis_categories : étendre la
--      lecture aux users qui ont droit 'equipe' (pour la vue Attribution).
--      L'écriture reste sur 'devis' uniquement.
--
-- Pré-requis : helpers `can_read_outil`, `can_edit_outil`, `is_admin`,
-- `is_project_member`, `current_user_role`, `get_user_org_id` créés
-- dans 20260501_mt0_security_hardening.sql.
--
-- Idempotent : DROP POLICY IF EXISTS + CREATE POLICY.
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. projet_membres — gating par OUTILS.EQUIPE + DELETE réservé internes
-- =====================================================================
-- Ancienne policy ALL trop large (org-scoped uniquement) → on remplace par
-- 3 policies fines pour distinguer SELECT / INSERT-UPDATE / DELETE.

ALTER TABLE projet_membres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_membres_org"               ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped"            ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_read"       ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_insert"     ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_update"     ON projet_membres;
DROP POLICY IF EXISTS "projet_membres_scoped_delete"     ON projet_membres;

-- 1.1 — SELECT : tout user qui a au moins read sur OUTILS.EQUIPE pour ce
-- projet (admin bypass via can_read_outil, internes attachés OK,
-- prestataire selon template/override).
CREATE POLICY "projet_membres_scoped_read" ON projet_membres
  FOR SELECT
  USING (can_read_outil(project_id, 'equipe'));

-- 1.2 — INSERT : edit sur OUTILS.EQUIPE
CREATE POLICY "projet_membres_scoped_insert" ON projet_membres
  FOR INSERT
  WITH CHECK (can_edit_outil(project_id, 'equipe'));

-- 1.3 — UPDATE : edit sur OUTILS.EQUIPE
CREATE POLICY "projet_membres_scoped_update" ON projet_membres
  FOR UPDATE
  USING      (can_edit_outil(project_id, 'equipe'))
  WITH CHECK (can_edit_outil(project_id, 'equipe'));

-- 1.4 — DELETE : strictement réservé aux rôles internes attachés.
-- Décision Hugo (EQUIPE-PERM) : un prestataire en canEdit peut tout
-- éditer SAUF supprimer une attribution (= retirer un membre de
-- l'équipe). Cette opération reste l'apanage des admin / cp / coord.
CREATE POLICY "projet_membres_scoped_delete" ON projet_membres
  FOR DELETE
  USING (
    is_admin()
    OR (
      current_user_role() IN ('charge_prod','coordinateur')
      AND is_project_member(project_id)
    )
  );


-- =====================================================================
-- 2. contacts — annuaire org : read commun, write internes uniquement
-- =====================================================================
-- Avant : `contacts_org` ALL pour tout user de l'org → un prestataire
-- pouvait modifier/supprimer un contact. Mauvais.
-- Après : SELECT org-scoped (l'annuaire est partagé), WRITE réservé
-- aux rôles internes (admin / charge_prod / coordinateur).
-- Cohérent avec le drawer où le crayon d'édition annuaire est gated par
-- canEditAnnuaire = isInternal côté front.

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_org"               ON contacts;
DROP POLICY IF EXISTS "contacts_scoped"            ON contacts;
DROP POLICY IF EXISTS "contacts_scoped_read"       ON contacts;
DROP POLICY IF EXISTS "contacts_scoped_write"      ON contacts;

-- 2.1 — SELECT : tout user de l'org (l'annuaire est consultable par
-- tous les users de l'organisation, y compris les prestataires
-- attachés à au moins un projet — utile pour AddMemberModal).
CREATE POLICY "contacts_scoped_read" ON contacts
  FOR SELECT
  USING (org_id = get_user_org_id());

-- 2.2 — WRITE (INSERT/UPDATE/DELETE) : org-scoped + rôle interne.
CREATE POLICY "contacts_scoped_write" ON contacts
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR current_user_role() IN ('charge_prod','coordinateur')
    )
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR current_user_role() IN ('charge_prod','coordinateur')
    )
  );


-- =====================================================================
-- 3. devis* : étendre la LECTURE aux users 'equipe' (pour Attribution)
-- =====================================================================
-- Sans ça, un prestataire en canEdit voit la tab Attribution mais
-- "Aucun poste crew dans le devis" car les devis_lines lui sont bloquées.
-- On étend les policies de lecture déjà gatées par 'devis' (et 'budget'
-- pour devis_lots) avec un OR 'equipe'. L'écriture reste réservée à
-- 'devis' (un prestataire ne peut PAS modifier un devis).

-- 3.1 — devis (table principale)
DROP POLICY IF EXISTS "devis_scoped_read"        ON devis;
CREATE POLICY "devis_scoped_read" ON devis
  FOR SELECT
  USING (
    can_read_outil(project_id, 'devis')
    OR can_read_outil(project_id, 'budget')
    OR can_read_outil(project_id, 'equipe')
  );

-- 3.2 — devis_lots
DROP POLICY IF EXISTS "devis_lots_scoped_read"   ON devis_lots;
CREATE POLICY "devis_lots_scoped_read" ON devis_lots
  FOR SELECT
  USING (
    can_read_outil(project_id, 'devis')
    OR can_read_outil(project_id, 'budget')
    OR can_read_outil(project_id, 'equipe')
  );

-- 3.3 — devis_categories (catégories des devis = blocs)
DROP POLICY IF EXISTS "devis_cat_scoped_read"    ON devis_categories;
CREATE POLICY "devis_cat_scoped_read" ON devis_categories
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM devis d
     WHERE d.id = devis_categories.devis_id
       AND (
         can_read_outil(d.project_id, 'devis')
         OR can_read_outil(d.project_id, 'budget')
         OR can_read_outil(d.project_id, 'equipe')
       )
  ));

-- 3.4 — devis_lines (les lignes — visibles dans Attribution)
DROP POLICY IF EXISTS "devis_lines_scoped_read"  ON devis_lines;
CREATE POLICY "devis_lines_scoped_read" ON devis_lines
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM devis d
     WHERE d.id = devis_lines.devis_id
       AND (
         can_read_outil(d.project_id, 'devis')
         OR can_read_outil(d.project_id, 'budget')
         OR can_read_outil(d.project_id, 'equipe')
       )
  ));


-- ── Reload PostgREST pour exposer les changements de schema ─────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Lister les policies actuelles sur les tables touchées :
--
--    SELECT schemaname, tablename, policyname, cmd, roles, qual
--      FROM pg_policies
--     WHERE tablename IN ('projet_membres','contacts','devis','devis_lots',
--                         'devis_lines','devis_categories')
--     ORDER BY tablename, policyname;
--
-- 2. Smoke test prestataire (en local) :
--    - Connecte un user `prestataire` attaché à un projet via project_access
--      avec project_access_permissions.outil_key='equipe', can_edit=true
--    - Il doit pouvoir : SELECT projet_membres + INSERT + UPDATE,
--      SELECT devis_lines (via Attribution), SELECT contacts (annuaire).
--    - Il NE doit PAS pouvoir : DELETE projet_membres, INSERT/UPDATE
--      contacts, INSERT/UPDATE devis_lines.
--
-- 3. Smoke test admin/charge_prod/coordinateur :
--    - Comportement identique à avant (bypass via is_admin / is_project_member).
--
-- ============================================================================
