-- ============================================================================
-- Migration : MUSIQUES MVP1 — Realtime publication pour collab multi-users
-- Date      : 2026-06-08 (E — fix urgent : Hugo signale qu'il faut reload
--                         la page pour voir les nouvelles propositions)
-- Contexte  : Le subscribeToProject côté front (lib/musiques.js) écoute les
--             postgres_changes des 3 tables musique. Si les tables ne sont
--             pas dans la publication supabase_realtime, aucun event ne
--             remonte au client.
--
--             Ajout de :
--               - projet_artistes
--               - projet_musique_propositions
--               - projet_musique_notes
--               - projet_musique_tags
--
-- Pattern   : copie conforme de 20260503_equipe_realtime_publication.sql
-- Idempotent: DO bloc avec test pg_publication_tables (re-exécution OK)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projet_artistes',
    'projet_musique_propositions',
    'projet_musique_notes',
    'projet_musique_tags'
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

-- REPLICA IDENTITY FULL : utile pour le reconcile précis côté client (on
-- récupère l'ancienne row sur UPDATE/DELETE). Coût négligeable.
ALTER TABLE projet_artistes              REPLICA IDENTITY FULL;
ALTER TABLE projet_musique_propositions  REPLICA IDENTITY FULL;
ALTER TABLE projet_musique_notes         REPLICA IDENTITY FULL;
ALTER TABLE projet_musique_tags          REPLICA IDENTITY FULL;

COMMIT;
