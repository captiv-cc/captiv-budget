-- ============================================================================
-- Migration : EQUIPE-RT — Realtime publication pour collab multi-users
-- Date      : 2026-05-03
-- Contexte  : Ajouter projet_membres à la publication supabase_realtime pour
--             que le hook useCrew puisse s'abonner aux changements distants
--             (INSERT/UPDATE/DELETE) et garder les vues Crew list /
--             Attribution / Finances synchronisées entre admins.
--
--             Les RLS existantes sur projet_membres sont appliquées
--             automatiquement par Supabase Realtime : un user ne reçoit que
--             les events des projets de son organisation (cf. policies de
--             projet_membres). Pas de fuite cross-org.
--
--             Le hook useCrew filtre déjà côté client par project_id (`filter:
--             project_id=eq.${projectId}`), ce qui évite de pousser le bruit
--             des autres projets de l'org sur le wire.
--
-- Pattern   : copie conforme de 20260421_matos_realtime_publication.sql
-- Idempotent: DO bloc avec test pg_publication_tables (re-exécution OK)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projet_membres'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END;
$$;

-- REPLICA IDENTITY FULL : permet aux payloads UPDATE / DELETE de contenir
-- l'ancienne ligne (utile pour faire du reconcile précis côté client si on
-- voulait éviter le full refetch — pas utilisé pour l'instant, mais coût
-- négligeable et ça nous laisse la porte ouverte).
ALTER TABLE projet_membres REPLICA IDENTITY FULL;

COMMIT;
