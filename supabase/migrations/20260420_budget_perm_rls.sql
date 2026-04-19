-- ============================================================================
-- Migration : BUDGET-PERM — RLS granulaire Devis / Factures / Budget réel
-- Date      : 2026-04-20
-- Contexte  : CH3B (ch3b_project_access.sql) avait posé des policies `*_scoped`
--             FOR ALL utilisant `can_see_project_finance(pid)` pour devis,
--             devis_categories, devis_lines, devis_ligne_membres, budget_reel
--             et factures. Cette fonction retourne vrai pour admin OR
--             (charge_prod attaché) — coordinateurs et prestataires n'ont
--             donc jamais accès à ces tables.
--
--             On bascule maintenant sur le pattern `can_read_outil` /
--             `can_edit_outil` déjà utilisé pour planning / livrables /
--             callsheet (cf. ch3b + 20260419_perm_planning_rls.sql) avec
--             deux clés outil :
--               * 'devis'  → table devis + enfants (devis_categories,
--                            devis_lines, devis_ligne_membres) + devis_lots
--               * 'budget' → factures + budget_reel
--
--             Impact sur les rôles :
--               * admin                 : inchangé (bypass dans les helpers).
--               * charge_prod attaché   : inchangé (bypass via can_*_outil).
--               * coordinateur attaché  : NOUVEAU — voit et édite devis et
--                                         budget sur les projets auxquels il
--                                         est attaché (can_*_outil bypasse
--                                         coordinateur attaché). C'est le
--                                         comportement demandé par Hugo.
--               * prestataire attaché   : NOUVEAU — nécessite désormais une
--                                         permission template ou override
--                                         sur outil 'devis' ou 'budget'.
--                                         Aucun prestataire ne l'a par défaut
--                                         (BP-2 n'a rien semé).
--
--             devis_lots : lecture ouverte aux porteurs de 'devis' OU
--             'budget' (les factures / budget réel affichent le titre du
--             lot de rattachement) ; écriture réservée à 'devis' (création /
--             renommage d'un lot se fait depuis l'onglet Devis).
--
--             v_compta_factures : reçoit `security_invoker = on` pour que
--             la RLS de factures s'applique quand un utilisateur requête la
--             vue. Sans ça la vue bypasserait la RLS (propriétaire postgres).
--
--             devis_public_token : préservée telle quelle (accès public en
--             lecture par token pour les clients externes — rien à voir
--             avec les permissions outil).
--
-- Idempotent : on DROP d'abord les anciennes policies (y compris les noms
-- avant CH3B) puis on CREATE les nouvelles. Safe à rejouer.
--
-- Dépend de : 20260420_budget_perm_catalogue.sql (les clés 'devis' et
-- 'budget' doivent exister dans outils_catalogue avant que l'UI les consulte,
-- mais les RLS utilisent une string littérale, donc pas de dépendance FK
-- entre les 2 migrations).
-- ============================================================================

BEGIN;

-- ── devis ──────────────────────────────────────────────────────────────────
-- Avant : devis_scoped FOR ALL via can_see_project_finance
-- Après : lecture via can_read_outil('devis'), écriture via can_edit_outil('devis').
DROP POLICY IF EXISTS "devis_org"                ON devis;
DROP POLICY IF EXISTS "devis_scoped"             ON devis;
DROP POLICY IF EXISTS "devis_scoped_read"        ON devis;
DROP POLICY IF EXISTS "devis_scoped_write"       ON devis;
-- devis_public_token reste en place (on la recrée si jamais absente, idempotent).
DROP POLICY IF EXISTS "devis_public_token"       ON devis;

CREATE POLICY "devis_scoped_read" ON devis
  FOR SELECT
  USING (can_read_outil(project_id, 'devis'));

CREATE POLICY "devis_scoped_write" ON devis
  FOR ALL
  USING (can_edit_outil(project_id, 'devis'))
  WITH CHECK (can_edit_outil(project_id, 'devis'));

-- Accès public en lecture via token (client externe qui consulte un devis
-- partagé). Aucune modif possible par ce biais.
CREATE POLICY "devis_public_token" ON devis
  FOR SELECT
  USING (public_token IS NOT NULL);


-- ── devis_categories ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devis_cat_org"            ON devis_categories;
DROP POLICY IF EXISTS "devis_cat_scoped"         ON devis_categories;
DROP POLICY IF EXISTS "devis_cat_scoped_read"    ON devis_categories;
DROP POLICY IF EXISTS "devis_cat_scoped_write"   ON devis_categories;

CREATE POLICY "devis_cat_scoped_read" ON devis_categories
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_categories.devis_id
                   AND can_read_outil(d.project_id, 'devis')));

CREATE POLICY "devis_cat_scoped_write" ON devis_categories
  FOR ALL
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_categories.devis_id
                   AND can_edit_outil(d.project_id, 'devis')))
  WITH CHECK (EXISTS (SELECT 1 FROM devis d
                      WHERE d.id = devis_categories.devis_id
                        AND can_edit_outil(d.project_id, 'devis')));


-- ── devis_lines ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devis_lines_org"          ON devis_lines;
DROP POLICY IF EXISTS "devis_lines_scoped"       ON devis_lines;
DROP POLICY IF EXISTS "devis_lines_scoped_read"  ON devis_lines;
DROP POLICY IF EXISTS "devis_lines_scoped_write" ON devis_lines;

CREATE POLICY "devis_lines_scoped_read" ON devis_lines
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_lines.devis_id
                   AND can_read_outil(d.project_id, 'devis')));

CREATE POLICY "devis_lines_scoped_write" ON devis_lines
  FOR ALL
  USING (EXISTS (SELECT 1 FROM devis d
                 WHERE d.id = devis_lines.devis_id
                   AND can_edit_outil(d.project_id, 'devis')))
  WITH CHECK (EXISTS (SELECT 1 FROM devis d
                      WHERE d.id = devis_lines.devis_id
                        AND can_edit_outil(d.project_id, 'devis')));


-- ── devis_ligne_membres ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "dlm_org"                  ON devis_ligne_membres;
DROP POLICY IF EXISTS "dlm_scoped"               ON devis_ligne_membres;
DROP POLICY IF EXISTS "dlm_scoped_read"          ON devis_ligne_membres;
DROP POLICY IF EXISTS "dlm_scoped_write"         ON devis_ligne_membres;

CREATE POLICY "dlm_scoped_read" ON devis_ligne_membres
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM devis_lines dl
    JOIN devis d ON d.id = dl.devis_id
    WHERE dl.id = devis_ligne_membres.devis_line_id
      AND can_read_outil(d.project_id, 'devis')
  ));

CREATE POLICY "dlm_scoped_write" ON devis_ligne_membres
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM devis_lines dl
    JOIN devis d ON d.id = dl.devis_id
    WHERE dl.id = devis_ligne_membres.devis_line_id
      AND can_edit_outil(d.project_id, 'devis')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM devis_lines dl
    JOIN devis d ON d.id = dl.devis_id
    WHERE dl.id = devis_ligne_membres.devis_line_id
      AND can_edit_outil(d.project_id, 'devis')
  ));


-- ── devis_lots ─────────────────────────────────────────────────────────────
-- Lecture : les porteurs de 'devis' OU 'budget' voient les lots (les onglets
-- Factures et Budget réel affichent le titre du lot de rattachement).
-- Écriture : réservée aux porteurs de 'devis' (création/renommage/archivage
-- depuis l'onglet Devis).
DROP POLICY IF EXISTS "devis_lots_org"           ON devis_lots;
DROP POLICY IF EXISTS "devis_lots_scoped"        ON devis_lots;
DROP POLICY IF EXISTS "devis_lots_scoped_read"   ON devis_lots;
DROP POLICY IF EXISTS "devis_lots_scoped_write"  ON devis_lots;

CREATE POLICY "devis_lots_scoped_read" ON devis_lots
  FOR SELECT
  USING (can_read_outil(project_id, 'devis')
      OR can_read_outil(project_id, 'budget'));

CREATE POLICY "devis_lots_scoped_write" ON devis_lots
  FOR ALL
  USING (can_edit_outil(project_id, 'devis'))
  WITH CHECK (can_edit_outil(project_id, 'devis'));


-- ── factures ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "factures_org"             ON factures;
DROP POLICY IF EXISTS "factures_scoped"          ON factures;
DROP POLICY IF EXISTS "factures_scoped_read"     ON factures;
DROP POLICY IF EXISTS "factures_scoped_write"    ON factures;

CREATE POLICY "factures_scoped_read" ON factures
  FOR SELECT
  USING (can_read_outil(project_id, 'budget'));

CREATE POLICY "factures_scoped_write" ON factures
  FOR ALL
  USING (can_edit_outil(project_id, 'budget'))
  WITH CHECK (can_edit_outil(project_id, 'budget'));


-- ── budget_reel ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "budget_reel_org"          ON budget_reel;
DROP POLICY IF EXISTS "budget_reel_scoped"       ON budget_reel;
DROP POLICY IF EXISTS "budget_reel_scoped_read"  ON budget_reel;
DROP POLICY IF EXISTS "budget_reel_scoped_write" ON budget_reel;

CREATE POLICY "budget_reel_scoped_read" ON budget_reel
  FOR SELECT
  USING (can_read_outil(project_id, 'budget'));

CREATE POLICY "budget_reel_scoped_write" ON budget_reel
  FOR ALL
  USING (can_edit_outil(project_id, 'budget'))
  WITH CHECK (can_edit_outil(project_id, 'budget'));


-- ── v_compta_factures : hériter la RLS via security_invoker ───────────────
-- Par défaut, une vue postgres est exécutée avec les droits de son
-- propriétaire (superuser-ish) → bypass complet de la RLS des tables
-- sous-jacentes. `security_invoker = on` force l'exécution avec les droits
-- de l'utilisateur connecté → la RLS de factures s'applique.
--
-- Note : cette option existe depuis Postgres 15. Supabase est sur PG 15+ par
-- défaut. Si la commande échoue (PG < 15), il faudra `CREATE OR REPLACE VIEW
-- … WITH (security_invoker = on)` directement.
ALTER VIEW v_compta_factures SET (security_invoker = on);


COMMIT;
