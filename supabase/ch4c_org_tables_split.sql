-- ==========================================================================
-- Chantier 4C — Split RLS on org-wide reference tables
-- --------------------------------------------------------------------------
-- Les tables clients, contacts, produits_bdd, fournisseurs étaient protégées
-- par des policies FOR ALL USING (org_id = get_user_org_id()). Ça autorisait
-- un prestataire de l'org à supprimer/modifier n'importe quelle ligne via
-- appel API direct (même si l'UI était déjà gatée par RequireRole).
--
-- On split en :
--   - SELECT : tous les membres internes de l'org
--   - INSERT / UPDATE / DELETE : admin + charge_prod + coordinateur
--
-- Les prestataires conservent la lecture (utile pour afficher un nom de
-- client, un contact crew, etc. sur un projet auquel ils sont attachés)
-- mais ne peuvent plus écrire.
-- ==========================================================================

-- Helper : membre interne de l'org courante (fallback si is_internal() absent)
-- Si tu as déjà une fonction is_internal() SECURITY DEFINER, tu peux l'utiliser
-- à la place. Sinon on se rabat sur current_user_role().

-- === clients ==============================================================
DROP POLICY IF EXISTS "clients_org"           ON clients;
DROP POLICY IF EXISTS "clients_scoped_read"   ON clients;
DROP POLICY IF EXISTS "clients_scoped_write"  ON clients;

CREATE POLICY "clients_scoped_read" ON clients
  FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "clients_scoped_write" ON clients
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  );

-- === contacts =============================================================
DROP POLICY IF EXISTS "contacts_org"           ON contacts;
DROP POLICY IF EXISTS "contacts_scoped_read"   ON contacts;
DROP POLICY IF EXISTS "contacts_scoped_write"  ON contacts;

CREATE POLICY "contacts_scoped_read" ON contacts
  FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "contacts_scoped_write" ON contacts
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  );

-- === produits_bdd =========================================================
DROP POLICY IF EXISTS "produits_org"           ON produits_bdd;
DROP POLICY IF EXISTS "produits_scoped_read"   ON produits_bdd;
DROP POLICY IF EXISTS "produits_scoped_write"  ON produits_bdd;

CREATE POLICY "produits_scoped_read" ON produits_bdd
  FOR SELECT
  USING (org_id = get_user_org_id());

CREATE POLICY "produits_scoped_write" ON produits_bdd
  FOR ALL
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod', 'coordinateur')
  );

-- === fournisseurs =========================================================
-- Note : fournisseurs est actuellement une table globale (pas d'org_id).
-- On protège par rôle uniquement — lecture pour tout utilisateur connecté,
-- écriture pour les rôles internes. Si tu multi-tenantes un jour la table,
-- ajoute org_id et refais une policy scoped.
ALTER TABLE fournisseurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fournisseurs_all"           ON fournisseurs;
DROP POLICY IF EXISTS "fournisseurs_org"           ON fournisseurs;
DROP POLICY IF EXISTS "fournisseurs_scoped_read"   ON fournisseurs;
DROP POLICY IF EXISTS "fournisseurs_scoped_write"  ON fournisseurs;

CREATE POLICY "fournisseurs_scoped_read" ON fournisseurs
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "fournisseurs_scoped_write" ON fournisseurs
  FOR ALL
  USING (current_user_role() IN ('admin', 'charge_prod', 'coordinateur'))
  WITH CHECK (current_user_role() IN ('admin', 'charge_prod', 'coordinateur'));
