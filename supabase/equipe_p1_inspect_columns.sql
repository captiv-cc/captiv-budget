-- ============================================================================
-- INSPECTION : colonnes réelles de la table projet_membres en BDD
-- ============================================================================
-- À exécuter dans Supabase SQL Editor pour découvrir le schéma réel de
-- la table projet_membres (les fichiers .sql en repo ne reflètent pas
-- forcément l'état déployé).
--
-- Le résultat va nous permettre de calibrer la migration au plus juste.
-- ============================================================================

SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projet_membres'
ORDER BY ordinal_position;
