-- ============================================================================
-- Migration : PERM — RLS granulaire Planning (events + enfants)
-- Date      : 2026-04-19
-- Contexte  : La migration PL-1 (20260416) a créé `events`, `event_members` et
--             `event_devis_lines` avec des policies `FOR ALL` qui ne filtraient
--             que par organisation. Résultat : un prestataire attaché à un
--             projet voyait les events de ce projet même sans permission
--             "Planning Lire", et pouvait modifier/créer/supprimer sans
--             permission "Planning Éditer".
--
--             On suit désormais le pattern établi par CHANTIER 3B
--             (ch3b_project_access.sql) pour les outils `livrables`, `callsheet`
--             et les anciennes tables planning : SELECT via can_read_outil,
--             INSERT/UPDATE/DELETE via can_edit_outil, clé outil = 'planning'.
--
-- Idempotent : safe à rejouer. On DROP d'abord les anciennes policies puis on
--              CREATE les nouvelles. Si la migration est déjà passée, le DROP
--              cible l'ancien nom `events_org` OU les nouveaux noms, le CREATE
--              est protégé par le DROP IF EXISTS préalable.
-- ============================================================================

BEGIN;

-- ── events ─────────────────────────────────────────────────────────────────
-- Remplace la policy "events_org" (org-scoped, FOR ALL) par deux policies
-- séparées : read via can_read_outil, write via can_edit_outil.
DROP POLICY IF EXISTS "events_org"                ON events;
DROP POLICY IF EXISTS "events_scoped_read"        ON events;
DROP POLICY IF EXISTS "events_scoped_write"       ON events;

CREATE POLICY "events_scoped_read" ON events
  FOR SELECT
  USING (can_read_outil(project_id, 'planning'));

CREATE POLICY "events_scoped_write" ON events
  FOR ALL
  USING (can_edit_outil(project_id, 'planning'))
  WITH CHECK (can_edit_outil(project_id, 'planning'));


-- ── event_members ──────────────────────────────────────────────────────────
-- On scope via le project_id de l'event parent. Même logique : lecture si
-- can_read, mutation si can_edit.
DROP POLICY IF EXISTS "event_members_org"            ON event_members;
DROP POLICY IF EXISTS "event_members_scoped_read"    ON event_members;
DROP POLICY IF EXISTS "event_members_scoped_write"   ON event_members;

CREATE POLICY "event_members_scoped_read" ON event_members
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_members.event_id
      AND can_read_outil(e.project_id, 'planning')
  ));

CREATE POLICY "event_members_scoped_write" ON event_members
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_members.event_id
      AND can_edit_outil(e.project_id, 'planning')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_members.event_id
      AND can_edit_outil(e.project_id, 'planning')
  ));


-- ── event_devis_lines ──────────────────────────────────────────────────────
-- Lecture : read sur planning suffit (c'est un rattachement événement↔ligne
-- de devis, l'info n'est pas sensible côté finance tant qu'on ne lit pas la
-- ligne de devis elle-même — qui reste protégée par `devis_scoped` /
-- `devis_lines_scoped`, cf. ch3b_project_access.sql).
-- Écriture : on exige edit sur planning (c'est le pilote planning qui rattache
-- un event à une ligne).
DROP POLICY IF EXISTS "event_devis_lines_org"            ON event_devis_lines;
DROP POLICY IF EXISTS "event_devis_lines_scoped_read"    ON event_devis_lines;
DROP POLICY IF EXISTS "event_devis_lines_scoped_write"   ON event_devis_lines;

CREATE POLICY "event_devis_lines_scoped_read" ON event_devis_lines
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_devis_lines.event_id
      AND can_read_outil(e.project_id, 'planning')
  ));

CREATE POLICY "event_devis_lines_scoped_write" ON event_devis_lines
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_devis_lines.event_id
      AND can_edit_outil(e.project_id, 'planning')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_devis_lines.event_id
      AND can_edit_outil(e.project_id, 'planning')
  ));


-- ── Notes pour la relecture ────────────────────────────────────────────────
-- 1. event_types et locations restent en `org_id = get_user_org_id()` :
--    ce sont des catalogues org-wide (types d'événements personnalisables,
--    repérages mutualisés). Leur accès n'est pas lié à un projet particulier.
--
-- 2. Les helpers `can_read_outil` et `can_edit_outil` bypassent
--    automatiquement les rôles internes (admin / charge_prod / coordinateur
--    attachés). Un prestataire doit passer par son template métier + ses
--    overrides project_access_permissions pour la clé outil = 'planning'.
--
-- 3. Les edge functions (ical-feed) utilisent le service_role et ne sont pas
--    affectées par ces policies — l'autorisation s'y fait par token dédié
--    (ical_tokens, migration 20260419_ical_tokens_pl8.sql).

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS POST-MIGRATION (à lancer à la main dans Supabase SQL editor)
-- ============================================================================
-- 1. Les anciennes policies ont bien disparu :
--    SELECT policyname FROM pg_policies
--    WHERE tablename IN ('events','event_members','event_devis_lines');
--    -- Doit lister uniquement *_scoped_read / *_scoped_write
--
-- 2. L'admin voit bien tous les events :
--    SET ROLE authenticated; -- ou re-login UI en admin
--    SELECT count(*) FROM events;
--
-- 3. Un prestataire sans permission "Planning Lire" ne voit plus les events :
--    -- se connecter en prestataire non-planning, puis :
--    SELECT count(*) FROM events WHERE project_id = '<projet-affilié>'; -- 0
--
-- 4. Un prestataire avec "Planning Lire" OUI mais "Éditer" NON ne peut plus
--    insérer ni modifier :
--    INSERT INTO events (project_id, title, starts_at, ends_at)
--    VALUES ('<projet>', 'Test', now(), now() + interval '1 hour');
--    -- Doit échouer avec "new row violates row-level security policy"
-- ============================================================================
