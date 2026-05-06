-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Compactage des sort_orders (anti-collision palette)
-- Date      : 2026-05-07
-- Contexte  : Après les nettoyages successifs (drop legacy table, cleanup
--             des fantômes, suppression de sessions à la main), les
--             sort_orders restant dans projet_sessions ont des trous —
--             ex. [3, 5, 7, 11] pour un projet avec 4 sessions actives.
--
--             Conséquence visible : `paletteAt(sort_order)` cycle modulo 8
--             (= taille de la SESSION_PALETTE), donc sort_order=3 et
--             sort_order=11 donnent la MÊME couleur ambre. Légende et
--             chips deviennent indistinguables (cf. retour Hugo
--             2026-05-07 : Essais ≅ Transport en couleur).
--
-- Solution  : Re-numéroter les sort_orders à (1, 2, 3, ...) en préservant
--             l'ordre relatif actuel. La 1ʳᵉ session par sort_order
--             devient 1, la 2ᵉ devient 2, etc. Les couleurs deviennent
--             toutes distinctes tant qu'on a ≤ 8 sessions par projet.
--
-- Idempotente : la migration peut être rejouée. Si les sort_orders sont
--               déjà compacts (1, 2, 3, ...), elle n'apporte aucun
--               changement (chaque UPDATE est une no-op).
-- ============================================================================

BEGIN;

-- Fonction PL/pgSQL anonyme qui boucle sur chaque project_id distinct,
-- récupère les sessions ordonnées par sort_order ascendant, et leur
-- assigne (1, 2, 3, ...). Utilise un sort_order temporaire négatif
-- pendant l'update pour ne pas violer l'UNIQUE (project_id, sort_order)
-- dans l'intermédiaire.
DO $$
DECLARE
  proj RECORD;
  sess RECORD;
  new_order INTEGER;
  total_compacted INTEGER := 0;
BEGIN
  FOR proj IN
    SELECT DISTINCT project_id FROM projet_sessions
  LOOP
    -- Étape 1 : passe tous les sort_orders en négatif pour libérer les
    -- valeurs positives (sinon UPDATE 11 → 4 collide avec 4 existant).
    UPDATE projet_sessions
    SET sort_order = -sort_order
    WHERE project_id = proj.project_id;

    -- Étape 2 : ré-assigne 1, 2, 3, ... dans l'ordre des sort_orders
    -- originaux (= maintenant les plus négatifs en 1er).
    new_order := 0;
    FOR sess IN
      SELECT id FROM projet_sessions
      WHERE project_id = proj.project_id
      ORDER BY sort_order DESC  -- DESC sur négatifs = ASC sur originaux
    LOOP
      new_order := new_order + 1;
      UPDATE projet_sessions
      SET sort_order = new_order
      WHERE id = sess.id;
      total_compacted := total_compacted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Compactage terminé : % sessions re-numérotées sur l''ensemble des projets.', total_compacted;
END
$$;


-- Notification PostgREST (les sort_orders ont changé, le cache front peut
-- être obsolète — un reload suffira après la migration).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Tous les projets ont des sort_orders compacts (= max = COUNT) :
--
--    SELECT project_id, COUNT(*) AS nb, MAX(sort_order) AS max_order
--    FROM projet_sessions
--    GROUP BY project_id
--    HAVING COUNT(*) <> MAX(sort_order);
--    -- Doit retourner 0 row.
--
-- 2. Aucun sort_order négatif n'est resté (cas d'erreur) :
--
--    SELECT COUNT(*) FROM projet_sessions WHERE sort_order < 1;
--    -- Doit retourner 0.
--
-- 3. Plus de collision de palette (tant qu'il y a ≤ 8 sessions/projet) :
--    Les couleurs des chips dans la modale Présence + la légende du
--    Vue Seule doivent toutes être distinctes pour ton projet test.
-- ============================================================================
