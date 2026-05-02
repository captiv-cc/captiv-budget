-- ============================================================================
-- ÉQUIPE Phase 1 — DRY-RUN d'audit (cible: projet_membres)
-- ============================================================================
-- À exécuter dans Supabase SQL Editor AVANT la migration
-- `20260502_equipe_p1_techlist_schema.sql`.
--
-- Ce script est SELECT-only. Il ne modifie RIEN.
--
-- La table cible est `projet_membres` (qui contient les attributions
-- crew par projet). Elle a déjà `contact_id` en place — pas besoin de
-- backfill comme on l'avait initialement prévu sur `crew_members` (qui
-- est en fait un fichier orphelin jamais déployé).
--
-- L'audit montre :
--   1. Volume total + pourcentage avec contact_id renseigné
--   2. Quelques exemples de rows pour validation visuelle
--   3. Dry-run du futur sort_order (pour s'assurer de l'ordre logique)
-- ============================================================================

-- ── 1. Volumes globaux ──────────────────────────────────────────────────────
SELECT
  '1. Volumes' AS section,
  COUNT(*) AS total_projet_membres,
  COUNT(contact_id) AS avec_contact_id,
  COUNT(*) - COUNT(contact_id) AS sans_contact_id_libre,
  COUNT(DISTINCT project_id) AS nb_projets_concernes,
  COUNT(DISTINCT contact_id) AS nb_contacts_distincts;


-- ── 2. Aperçu des projet_membres existants (max 20) ─────────────────────────
-- Sert juste à voir les noms/régimes/spécialités pour s'assurer que les
-- catégories par défaut auront du sens.
SELECT
  '2. Aperçu (max 20)' AS section,
  pm.id,
  COALESCE(c.prenom || ' ' || c.nom, pm.prenom || ' ' || pm.nom) AS personne,
  pm.specialite,
  pm.regime,
  pm.movinmotion_statut,
  p.title AS projet
FROM projet_membres pm
LEFT JOIN contacts c ON c.id = pm.contact_id
LEFT JOIN projects p ON p.id = pm.project_id
ORDER BY pm.created_at DESC
LIMIT 20;


-- ── 3. Sanity check : tout projet_membre est bien rattaché à un projet ─────
SELECT
  '3. Orphelins (project_id invalide)' AS section,
  COUNT(*) AS nb_orphelins
FROM projet_membres pm
LEFT JOIN projects p ON p.id = pm.project_id
WHERE p.id IS NULL;


-- ── 4. Détection des budget_convenu déjà existants ─────────────────────────
-- Pour savoir si Hugo a déjà ajouté la colonne manuellement via SQL Editor
-- (auquel cas l'IF NOT EXISTS de la migration sera no-op, comme prévu).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projet_membres'
      AND column_name = 'budget_convenu'
  ) THEN
    RAISE NOTICE '4. budget_convenu — colonne déjà présente sur projet_membres ✅';
  ELSE
    RAISE NOTICE '4. budget_convenu — colonne ABSENTE, sera créée par la migration';
  END IF;
END $$;


-- ── 5. Résumé final ─────────────────────────────────────────────────────────
SELECT
  '5. RÉCAP' AS section,
  (SELECT COUNT(*) FROM projet_membres) AS total,
  (SELECT COUNT(*) FROM projet_membres WHERE contact_id IS NOT NULL) AS avec_contact,
  (SELECT COUNT(*) FROM projet_membres WHERE contact_id IS NULL) AS sans_contact,
  CASE
    WHEN (SELECT COUNT(*) FROM projet_membres) = 0
      THEN '⚠️ Table vide — la migration s''appliquera proprement, juste les ALTER TABLE'
    ELSE '✅ Données présentes — la migration ajoutera les colonnes sans toucher aux données'
  END AS verdict;

-- ============================================================================
-- Lecture des résultats
-- ============================================================================
-- - Section 1 : on s'attend à voir un total > 0 (Captiv a des attributions)
-- - Section 2 : on doit voir des noms cohérents (Samuel, Gaëlle, etc.)
-- - Section 3 : doit retourner 0 (sinon il y a un problème de FK)
-- - Section 4 : info sur budget_convenu (présent ou absent)
-- - Section 5 : verdict final, on peut passer à la migration si tout est OK
-- ============================================================================
