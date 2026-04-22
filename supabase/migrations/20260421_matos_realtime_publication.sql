-- ============================================================================
-- Migration : MAT — Realtime publication pour collab multi-users
-- Date      : 2026-04-21
-- Contexte  : Ajouter les 4 tables matos_* à la publication supabase_realtime
--             pour que le hook useMateriel puisse s'abonner aux changements
--             distants (INSERT/UPDATE/DELETE) et sync l'UI à 2 comptes.
--
--             Les RLS existantes (can_read_outil / can_edit_outil) sont
--             appliquées automatiquement : un user ne reçoit que les events
--             des lignes auxquelles il a accès en lecture.
--
-- Dépend de  : 20260421_mat_refonte_blocs.sql
-- Idempotent : utilise un DO bloc avec EXECUTE conditionnel pour éviter les
--              erreurs "relation already member of publication".
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'matos_versions',
    'matos_blocks',
    'matos_items',
    'matos_item_loueurs'
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

-- Pour que les payloads UPDATE / DELETE contiennent aussi les anciennes valeurs
-- (utile pour du reconcile local fin), on met la replica identity à FULL.
-- Coût minime sur des tables de taille modeste.
ALTER TABLE matos_versions     REPLICA IDENTITY FULL;
ALTER TABLE matos_blocks       REPLICA IDENTITY FULL;
ALTER TABLE matos_items        REPLICA IDENTITY FULL;
ALTER TABLE matos_item_loueurs REPLICA IDENTITY FULL;

COMMIT;
