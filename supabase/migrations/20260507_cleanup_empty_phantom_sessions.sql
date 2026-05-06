-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Cleanup des sessions fantômes 100% vides
-- Date      : 2026-05-07
-- Contexte  : Le seed de `20260505_equipe_sessions.sql` créait 1 session par
--             membre existant à l'origine, même sans données. La migration
--             Phase A a transféré ces sessions fantômes 1:1 dans les
--             nouvelles tables (projet_sessions + projet_session_membres).
--
--             Symptôme côté UI :
--               • Modale Présence : cache la chip tant que c'est mono-
--                 session anonyme, mais dès qu'on ajoute une vraie session,
--                 la chip "Sans nom" réapparaît (filtre désactivé en
--                 multi-session)
--               • Crew list : génère une chip violette "?" qui pollue
--               • Drawer membre : affiche un placeholder "Nom (ex. Essais,
--                 Tournage…)" qui n'a aucun sens
--
-- Critère "100% vide" :
--   Session globale : label NULL, lieu NULL (text + id), couleur NULL,
--                     presence_days = '{}', start_date NULL, end_date NULL,
--                     notes NULL, statut = 'planifie' (default)
--   ET pour CHAQUE participation pointant dessus :
--     presence_days = '{}', arrival_date NULL, arrival_time NULL,
--     departure_date NULL, departure_time NULL, notes NULL,
--     statut = 'planifie'
--
-- On garde scrupuleusement les sessions où n'importe quel champ a été
-- renseigné par un user (couleur custom, statut confirmé, notes, etc.).
-- ============================================================================

BEGIN;

-- ── 1. Identifie les sessions fantômes ─────────────────────────────────────
-- CTE = liste des session_id à supprimer. Critère stricts pour éviter de
-- détruire une session sur laquelle un user a écrit même un seul champ.
WITH phantom_sessions AS (
  SELECT s.id
  FROM projet_sessions s
  WHERE s.label IS NULL
    AND s.lieu_principal_text IS NULL
    AND s.lieu_principal_id IS NULL
    AND s.couleur IS NULL
    AND s.notes IS NULL
    AND s.start_date IS NULL
    AND s.end_date IS NULL
    AND COALESCE(array_length(s.presence_days, 1), 0) = 0
    AND s.statut = 'planifie'
    -- Toutes les participations doivent être également vides
    AND NOT EXISTS (
      SELECT 1 FROM projet_session_membres psm
      WHERE psm.session_id = s.id
        AND (
          COALESCE(array_length(psm.presence_days, 1), 0) > 0
          OR psm.arrival_date IS NOT NULL
          OR psm.arrival_time IS NOT NULL
          OR psm.departure_date IS NOT NULL
          OR psm.departure_time IS NOT NULL
          OR psm.notes IS NOT NULL
          OR psm.statut <> 'planifie'
        )
    )
)

-- ── 2. Suppression cascade ────────────────────────────────────────────────
-- DELETE sur projet_sessions cascade les participations via la FK ON DELETE
-- CASCADE de la table projet_session_membres (cf. migration Phase A).
DELETE FROM projet_sessions
WHERE id IN (SELECT id FROM phantom_sessions);


-- ── 3. Notification PostgREST ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Combien ont été supprimées :
--    Le COMMIT renvoie le nombre de rows affectées par le DELETE final.
--    On peut aussi vérifier qu'il n'en reste plus en re-lançant la CTE :
--
--      SELECT COUNT(*) FROM projet_sessions s
--      WHERE s.label IS NULL AND s.lieu_principal_text IS NULL
--        AND s.lieu_principal_id IS NULL AND s.couleur IS NULL
--        AND s.notes IS NULL AND s.start_date IS NULL
--        AND s.end_date IS NULL
--        AND COALESCE(array_length(s.presence_days, 1), 0) = 0
--        AND s.statut = 'planifie'
--        AND NOT EXISTS (
--          SELECT 1 FROM projet_session_membres psm
--          WHERE psm.session_id = s.id AND (
--            COALESCE(array_length(psm.presence_days, 1), 0) > 0
--            OR psm.arrival_date IS NOT NULL OR psm.departure_date IS NOT NULL
--            OR psm.notes IS NOT NULL OR psm.statut <> 'planifie'
--          )
--        );
--      -- Doit retourner 0.
--
-- 2. Les sessions "vraiment renseignées" sont préservées : aucune session
--    avec label, lieu, dates, presence ou notes ne doit être affectée.
-- ============================================================================
