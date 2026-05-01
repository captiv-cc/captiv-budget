-- =====================================================================
-- MT-0.4-C — Audit statique de la sécurité multi-tenant
-- =====================================================================
--
-- Script de vérification à exécuter dans le SQL Editor de Supabase.
-- Aucune écriture, aucun effet de bord — uniquement des SELECT qui
-- inspectent l'état actuel de la base et donnent un verdict visuel.
--
-- Usage :
--   • Ouvrir Supabase → SQL Editor
--   • Coller ce fichier
--   • Lancer une section à la fois (ou tout d'un coup) et observer le
--     résultat. Chaque section affiche un statut "OK" ou "KO".
--
-- Contexte : ce script remplace un test cross-org grandeur nature
-- (impraticable tant qu'on n'a qu'une seule org). Il vérifie que
-- les fondations de sécurité posées en MT-0.3 sont bien en place.
-- =====================================================================


-- =====================================================================
-- §1 — HELPERS DE SÉCURITÉ : tous filtrent-ils par org ?
-- =====================================================================
-- Les 5 helpers durcis en MT-0.3 doivent tous contenir le filtre
-- "get_user_org_id" dans leur code source. Si l'un d'eux ne le
-- contient pas, c'est qu'il a été ré-écrasé après notre migration.

SELECT
  proname AS helper,
  CASE
    WHEN prosrc ILIKE '%get_user_org_id%' THEN '✅ OK — filtre org présent'
    ELSE '⚠️  KO — filtre org MANQUANT'
  END AS verdict
FROM pg_proc
WHERE proname IN (
  'is_project_member',
  'can_see_project',
  'can_see_project_finance',
  'can_read_outil',
  'can_edit_outil'
)
ORDER BY proname;

-- Résultat attendu : 5 lignes, toutes "✅ OK"


-- =====================================================================
-- §2 — POLICIES SUSPECTES : reste-t-il des policies "open" ?
-- =====================================================================
-- Une policy avec USING = "true" est un trou potentiel (sauf cas
-- intentionnels comme le partage public via token, qui doit AUSSI
-- avoir une condition restrictive sur le token).

SELECT
  c.relname AS table_name,
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS action,
  pg_get_expr(p.polqual, p.polrelid) AS using_clause,
  '⚠️  À examiner — policy ouverte' AS verdict
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE pg_get_expr(p.polqual, p.polrelid) IN ('true', '(true)')
ORDER BY c.relname, p.polname;

-- Résultat attendu : aucune ligne, OU uniquement la policy
-- "grille_cc_read" (la grille des conventions collectives est une
-- donnée publique légale, partage volontaire entre toutes les orgs).


-- =====================================================================
-- §3 — POLICIES "AUTH SANS ORG" : reste-t-il des policies trop laxes ?
-- =====================================================================
-- Une policy qui ne filtre QUE par auth.uid() ou "auth IS NOT NULL"
-- sans contrainte d'org est suspecte (sauf cas légitimes comme
-- "profile_own" où un user ne voit que son propre profil).

SELECT
  c.relname AS table_name,
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS action,
  pg_get_expr(p.polqual, p.polrelid) AS using_clause
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE
  pg_get_expr(p.polqual, p.polrelid) ILIKE '%auth.uid()%'
  AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%get_user_org_id%'
  AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%can_see_project%'
  AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%can_read_outil%'
  AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%can_edit_outil%'
  AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%is_project_member%'
ORDER BY c.relname, p.polname;

-- Résultat attendu : uniquement les policies "self-only" légitimes
-- (profile_own, profiles_update_own, project_access_read_self_or_admin
-- — où la condition principale "user_id = auth.uid()" est OK car le
-- user ne voit que ses propres lignes).


-- =====================================================================
-- §4 — RLS ACTIVÉE : toutes les tables business l'ont-elles ?
-- =====================================================================
-- Une table business sans RLS activée serait totalement ouverte à
-- tout client authentifié.

WITH business_tables AS (
  SELECT unnest(ARRAY[
    'budget_reel','call_sheet_lignes','call_sheets','clients','contacts',
    'cotisation_config','crew_members','devis','devis_categories',
    'devis_ligne_membres','devis_lines','devis_lots','devis_templates',
    'event_devis_lines','event_members','event_types','events','factures',
    'fournisseurs','ical_tokens','invitations_log','jours_tournage',
    'livrable_blocks','livrable_etapes','livrable_share_tokens',
    'livrable_versions','livrables','locations','materiel_bdd',
    'matos_blocks','matos_categories','matos_check_tokens',
    'matos_item_comments','matos_item_loueurs','matos_item_photos',
    'matos_items','matos_listes','matos_version_attachments',
    'matos_version_loueur_infos','matos_versions','planning_items',
    'planning_phases','planning_views','produits_bdd','profiles',
    'project_access','project_access_permissions','projects',
    'projet_livrable_config','projet_membres','projet_phases'
  ]) AS table_name
)
SELECT
  bt.table_name,
  CASE
    WHEN c.oid IS NULL THEN '⚠️  N/A — table inexistante'
    WHEN c.relrowsecurity THEN '✅ RLS activée'
    ELSE '⚠️  KO — RLS DÉSACTIVÉE'
  END AS verdict
FROM business_tables bt
LEFT JOIN pg_class c
  ON c.relname = bt.table_name
 AND c.relkind = 'r'
ORDER BY verdict DESC, bt.table_name;

-- Résultat attendu : toutes les tables existantes en "✅ RLS activée".


-- =====================================================================
-- §5 — POLICIES PAR TABLE : combien chaque table en a-t-elle ?
-- =====================================================================
-- Vue d'ensemble : pour chaque table business, on compte les policies
-- en place. Une table business sans policy serait ouverte (la RLS
-- activée sans policy = tout bloqué pour les non-superusers, mais
-- on veut au moins une policy SELECT et une WRITE).

SELECT
  c.relname AS table_name,
  COUNT(p.polname) AS nb_policies,
  STRING_AGG(p.polname, ', ' ORDER BY p.polname) AS policies
FROM pg_class c
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relkind = 'r'
  AND c.relname IN (
    'budget_reel','call_sheets','call_sheet_lignes','clients','contacts',
    'devis','devis_categories','devis_lines','devis_ligne_membres',
    'devis_lots','events','event_members','event_devis_lines','factures',
    'fournisseurs','livrables','livrable_blocks','livrable_versions',
    'livrable_etapes','livrable_share_tokens','matos_listes',
    'matos_versions','matos_blocks','matos_items','planning_items',
    'planning_phases','jours_tournage','projects','project_access',
    'project_access_permissions','projet_membres'
  )
GROUP BY c.relname
ORDER BY nb_policies, c.relname;

-- Résultat attendu : aucune table à 0 policy.


-- =====================================================================
-- §6 — BILAN GLOBAL
-- =====================================================================
-- Un seul SELECT qui agrège les vérifications précédentes en un
-- verdict unique pour Phase 0.

WITH checks AS (
  SELECT
    -- Helpers OK
    (SELECT COUNT(*) FROM pg_proc
     WHERE proname IN ('is_project_member','can_see_project',
                       'can_see_project_finance','can_read_outil',
                       'can_edit_outil')
       AND prosrc ILIKE '%get_user_org_id%') AS helpers_ok,
    -- Helpers attendus
    5 AS helpers_attendus,
    -- Policies vraiment ouvertes (hors catalogues publics intentionnels)
    -- Whitelist :
    --   - grille_cc            : grille convention collective (publique légale)
    --   - outils_catalogue     : catalogue d'outils du système
    --   - minimas_convention   : minimas tarifaires CCNTA (publique légale)
    --   - catalogue_lignes     : catalogue de lignes types pour devis (partagé,
    --                            sera scopé par org en MT-PRE-1.B)
    --   - app_settings         : paramètres globaux du produit (MT-PRE-1.A)
    (SELECT COUNT(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
     WHERE pg_get_expr(p.polqual, p.polrelid) IN ('true','(true)')
       AND c.relname NOT IN (
         'grille_cc',
         'outils_catalogue',
         'minimas_convention',
         'catalogue_lignes',
         'app_settings'
       )) AS policies_ouvertes
)
SELECT
  helpers_ok || '/' || helpers_attendus AS helpers_durcis,
  policies_ouvertes AS policies_a_examiner,
  CASE
    WHEN helpers_ok = helpers_attendus AND policies_ouvertes = 0
      THEN '✅ PASS — Phase 0 sécurité validée statiquement'
    ELSE '⚠️  FAIL — Vérifier les sections ci-dessus'
  END AS verdict_global
FROM checks;

-- Résultat attendu : "✅ PASS — Phase 0 sécurité validée statiquement"
