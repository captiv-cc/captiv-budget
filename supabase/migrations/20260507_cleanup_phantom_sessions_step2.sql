-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Cleanup fantômes étape 2 (label NULL)
-- Date      : 2026-05-07
-- Contexte  : La 1ʳᵉ migration cleanup (20260507_cleanup_empty_phantom_sessions
--             .sql) avait un critère "100% vide" trop strict. Elle ne ciblait
--             que les sessions sans presence_days / dates / notes / etc.
--
--             Après cette 1ʳᵉ passe, il reste 45 sessions "Sans nom" (1 par
--             membre, typique d'un seed automatique) qui ont des
--             presence_days ou des dates héritées du seed legacy mais
--             AUCUN label, AUCUN lieu, AUCUNE couleur custom, AUCUNE
--             note. Diagnostic confirmé via la query d'audit (cf. message
--             Hugo 2026-05-07).
--
-- Critère relâché :
--   • label IS NULL
--   • lieu_principal_text IS NULL
--   • lieu_principal_id IS NULL
--   (on accepte les presence_days / dates héritées — c'est le résidu seed)
--
-- On garde la condition sur le LIEU pour ne PAS détruire une session
-- qu'un user aurait créée volontairement sans label mais avec un lieu
-- (ex. "Studio Bastille" sans nommer la session — pratique chez certains).
-- Le diagnostic montre 0 dans cette catégorie aujourd'hui (avec_lieu=0),
-- mais la condition reste un garde-fou pour le futur.
-- ============================================================================

BEGIN;

-- Compte avant pour traçabilité dans le NOTICE.
DO $$
DECLARE
  to_delete INTEGER;
  members_affected INTEGER;
BEGIN
  SELECT COUNT(*) INTO to_delete
  FROM projet_sessions
  WHERE label IS NULL
    AND lieu_principal_text IS NULL
    AND lieu_principal_id IS NULL;

  SELECT COUNT(DISTINCT psm.membre_id) INTO members_affected
  FROM projet_sessions s
  JOIN projet_session_membres psm ON psm.session_id = s.id
  WHERE s.label IS NULL
    AND s.lieu_principal_text IS NULL
    AND s.lieu_principal_id IS NULL;

  RAISE NOTICE 'Cleanup étape 2 : % sessions Sans nom à supprimer (% membres concernés).', to_delete, members_affected;
END
$$;


-- ── Suppression cascade ───────────────────────────────────────────────────
-- DELETE projet_sessions cascade les participations via la FK ON DELETE
-- CASCADE de projet_session_membres (cf. migration Phase A).
-- Conséquence : les membres qui n'avaient QUE cette session "Sans nom"
-- se retrouveront sans aucune session — c'est OK fonctionnellement,
-- l'UI le gère (cf. comportement de Kelly avant Phase A).
DELETE FROM projet_sessions
WHERE label IS NULL
  AND lieu_principal_text IS NULL
  AND lieu_principal_id IS NULL;


-- ── Notification PostgREST ─────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Plus aucune session "Sans nom" :
--
--      SELECT COUNT(*) FROM projet_sessions WHERE label IS NULL;
--      -- Doit retourner 0 (sauf si un user crée une nouvelle session
--      --  sans label après cette migration — désormais empêché par le
--      --  garde-fou du mini-form "+ Nouvelle" côté UI).
--
-- 2. Plus aucune participation orpheline :
--
--      SELECT COUNT(*) FROM projet_session_membres psm
--      WHERE NOT EXISTS (SELECT 1 FROM projet_sessions s WHERE s.id = psm.session_id);
--      -- Doit retourner 0 (cascade FK garantit l'intégrité).
--
-- 3. Membres sans session — c'est attendu pour ceux qui n'ont pas de
--    présence enregistrée. Ils peuvent en créer via la modale Présence :
--
--      SELECT pm.id, pm.prenom, pm.nom, pm.project_id
--      FROM projet_membres pm
--      WHERE NOT EXISTS (
--        SELECT 1 FROM projet_session_membres psm
--        WHERE psm.membre_id = pm.id
--      );
-- ============================================================================
