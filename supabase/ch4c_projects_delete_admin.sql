-- ==========================================================================
-- Chantier 4C — Restrict project DELETE to admin only
-- --------------------------------------------------------------------------
-- Le policy "projects_scoped_write" était en FOR ALL, ce qui autorisait
-- charge_prod à supprimer un projet dès lors qu'il en est membre.
-- On split la policy :
--   - INSERT / UPDATE : admin + charge_prod (sur ses projets)
--   - DELETE          : admin uniquement
-- ==========================================================================

DROP POLICY IF EXISTS "projects_scoped_write"  ON projects;
DROP POLICY IF EXISTS "projects_scoped_insert" ON projects;
DROP POLICY IF EXISTS "projects_scoped_update" ON projects;
DROP POLICY IF EXISTS "projects_scoped_delete" ON projects;

-- INSERT : admin + charge_prod (tous les deux peuvent créer un projet ;
-- un trigger attache automatiquement le créateur dans project_access).
CREATE POLICY "projects_scoped_insert" ON projects
  FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id()
    AND (is_admin() OR current_user_role() = 'charge_prod')
  );

-- UPDATE : admin partout, charge_prod uniquement sur ses projets attachés.
CREATE POLICY "projects_scoped_update" ON projects
  FOR UPDATE
  USING (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (current_user_role() = 'charge_prod' AND is_project_member(id))
    )
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (is_admin() OR current_user_role() = 'charge_prod')
  );

-- DELETE : admin uniquement. Point final.
CREATE POLICY "projects_scoped_delete" ON projects
  FOR DELETE
  USING (
    org_id = get_user_org_id()
    AND is_admin()
  );
