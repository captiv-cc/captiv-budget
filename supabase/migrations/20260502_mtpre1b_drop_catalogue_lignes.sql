-- ============================================================================
-- Migration : MT-PRE-1.B — Drop table morte catalogue_lignes
-- Date      : 2026-05-02
-- Contexte  : `catalogue_lignes` était prévue à l'origine comme catalogue
--             plat de "lignes types" piochables dans les devis (postes
--             externes avec régime juridique + tarif de référence). En
--             pratique elle n'a jamais été branchée :
--               - 0 INSERT dans la migration (table créée vide)
--               - 0 référence côté front (page Catalogue utilise
--                 `produits_bdd` à la place)
--               - 0 jointure SQL ailleurs
--               - 0 FK qui pointe dessus
--
--             La feature a été supplantée par `produits_bdd` (avec
--             `org_id` direct, RLS scopée, UI Catalogue branchée à
--             ~128 éléments en prod) qui couvre exactement le même
--             besoin de manière multi-tenant safe.
--
--             Drop dans le cadre de MT-PRE-1.B (scoping catalogues
--             par-org) : plutôt que d'ajouter `org_id` à une table
--             vide qui ne sert à rien, on simplifie la base et on
--             reconstruira proprement si le besoin réapparaît un jour.
--
-- Sécurité : aucun risque. La page Catalogue (`src/pages/BDD.jsx`) lit
--            `produits_bdd`, pas `catalogue_lignes` — vérifié par grep.
--
-- Idempotent : DROP TABLE IF EXISTS.
-- ============================================================================

BEGIN;

-- Drop la table + toutes ses policies + tous ses index automatiquement
-- via CASCADE. Pas de FK entrante donc CASCADE n'a rien d'autre à supprimer.
DROP TABLE IF EXISTS public.catalogue_lignes CASCADE;

-- Reload PostgREST pour que l'API REST cesse d'exposer cette ressource
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. La whitelist dans `supabase/mt0_4_static_audit.sql` (ligne 213)
--    contient encore `'catalogue_lignes'` comme catalogue partagé
--    légitime. À retirer dans un commit séparé pour ne pas mélanger
--    schéma et tooling.
--
-- 2. Le seul fichier de référence à `catalogue_lignes` est
--    `public/migration-minimas.sql` (migration historique de seed des
--    minimas conventionnels). On ne le modifie PAS — c'est une trace
--    historique qui a déjà été appliquée. Les futures réexécutions du
--    fichier resteront idempotentes (CREATE TABLE IF NOT EXISTS), donc
--    si on le rejoue par accident la table sera recréée vide. Pour
--    éviter ce risque, retirer la section catalogue_lignes du fichier
--    `migration-minimas.sql` dans un commit ultérieur.
-- ============================================================================
