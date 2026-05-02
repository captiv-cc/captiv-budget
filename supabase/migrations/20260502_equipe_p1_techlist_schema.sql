-- ============================================================================
-- Migration : ÉQUIPE Phase 1 — Schema techlist sur projet_membres
-- Date      : 2026-05-02
-- Contexte  : Refonte de la tab Équipe d'un projet pour transformer la
--             gestion crew en une vraie "tech list" :
--               - catégories libres par projet (PROD / TECHNIQUE / POST-PROD…)
--               - infos opérationnelles tournage (présence, secteur,
--                 chauffeur, hébergement, ordre custom)
--
-- Cible : la table `projet_membres` (qui est la table active utilisée par
-- la tab Équipe — pas `crew_members` qui est un fichier orphelin
-- `equipe_schema.sql` jamais déployé).
--
-- Bonne nouvelle : `projet_membres` a déjà `contact_id` en place (FK
-- vers `contacts` = annuaire org). Donc pas besoin de backfill auto-match
-- comme on l'avait initialement prévu : la liaison annuaire ↔ projet
-- est déjà faite. La migration se résume à ajouter les nouvelles colonnes
-- qui manquaient pour la techlist.
--
-- Périmètre :
--   1. Ajout de 8 colonnes sur `projet_membres` (idempotent IF NOT EXISTS)
--   2. Initialisation de `sort_order` chronologique par (project_id, category)
--   3. Index pour les requêtes fréquentes
--
-- Sécurité : pas de modification des policies RLS existantes. La policy
-- `projet_membres_org` couvre les nouvelles colonnes automatiquement
-- (filtre par project_id → projects.org_id).
--
-- Idempotent : ALTER TABLE IF NOT EXISTS sur tout, UPDATE conditionnel
-- sur les sort_order encore à 0.
-- ============================================================================

BEGIN;

-- ── 1. Nouvelles colonnes sur projet_membres ─────────────────────────────────
ALTER TABLE projet_membres
  -- Catégorie de classement dans la tech list (PRODUCTION,
  -- EQUIPE TECHNIQUE, POST PRODUCTION, ou custom). Texte libre pour
  -- rester flexible — pas de table catégories dédiée. Le front propose
  -- les 3 catégories par défaut + saisie libre.
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'PRODUCTION',

  -- Ordre custom dans la catégorie (drag & drop côté UI).
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,

  -- Secteur (= ville d'origine pour le tournage). Fallback texte libre
  -- quand contact_id est NULL ou que la personne n'a pas de ville
  -- renseignée dans contacts. Sinon le front lit `contacts.ville`.
  ADD COLUMN IF NOT EXISTS secteur TEXT,

  -- Rôle de chauffeur sur ce projet (conduit un véhicule de l'équipe).
  ADD COLUMN IF NOT EXISTS chauffeur BOOLEAN NOT NULL DEFAULT false,

  -- Hébergement (texte libre : "Hôtel Mercure", "Domicile", "Chez Marie"…).
  ADD COLUMN IF NOT EXISTS hebergement TEXT,

  -- Jours de présence sur le tournage (array de dates ISO 'YYYY-MM-DD').
  -- Édité via une modale calendrier qui propose les jours du projet
  -- (bornés par project.metadata.periodes). Vide par défaut.
  ADD COLUMN IF NOT EXISTS presence_days TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Couleur d'identification optionnelle (pour repérage rapide dans le
  -- planning/callsheet). Hex sans #, ex: 'F5A623'. NULL = pas de couleur.
  ADD COLUMN IF NOT EXISTS couleur TEXT,

  -- Budget convenu (= prix négocié avec la personne après validation
  -- devis, par défaut = coût estimé). Modifiable dans la tab Équipe,
  -- alimente le coût réel dans Budget Réel. Selon la base, peut déjà
  -- avoir été ajoutée manuellement via SQL Editor : IF NOT EXISTS = no-op.
  ADD COLUMN IF NOT EXISTS budget_convenu NUMERIC(10, 2);

-- Index pour les requêtes fréquentes (tri par catégorie + sort_order)
CREATE INDEX IF NOT EXISTS idx_projet_membres_project_category_sort
  ON projet_membres(project_id, category, sort_order);


-- ── 2. Initialisation de sort_order ─────────────────────────────────────────
-- Pour chaque (project_id, category), on assigne un sort_order incrémental
-- basé sur created_at. Permet d'avoir un ordre déterministe par défaut,
-- que l'UI pourra ensuite réordonner via drag & drop.
-- N'écrase pas les rows déjà ordonnées (ne touche que celles à 0).
UPDATE projet_membres pm
SET sort_order = ranked.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id, category
           ORDER BY created_at, id
         ) - 1 AS rn
  FROM projet_membres
) ranked
WHERE pm.id = ranked.id
  AND pm.sort_order = 0;


-- ── 3. Reload PostgREST pour exposer les nouvelles colonnes ────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. Vérification : exécuter pour valider que tout s'est bien passé.
--
--    -- Les nouvelles colonnes sont présentes ?
--    SELECT column_name, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'projet_membres'
--      AND column_name IN ('category', 'sort_order', 'secteur', 'chauffeur',
--                          'hebergement', 'presence_days', 'couleur',
--                          'budget_convenu')
--    ORDER BY column_name;
--
--    -- sort_order initialisé correctement ?
--    SELECT project_id, category, COUNT(*), MIN(sort_order), MAX(sort_order)
--    FROM projet_membres
--    GROUP BY project_id, category
--    ORDER BY project_id, category;
--
-- 2. La tab Équipe actuelle continue de fonctionner sans modification :
--    les nouvelles colonnes ont des defaults et les anciennes sont
--    intactes. La refonte UI viendra dans les étapes suivantes.
-- ============================================================================
