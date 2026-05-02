-- ============================================================================
-- Migration : ÉQUIPE Phase 1.5 — Rattachement de postes + "À trier"
-- Date      : 2026-05-02
-- Contexte  : retours UX Hugo après test Tech list initiale.
--
-- Deux changements structurels :
--
--   1) `category` devient NULLABLE :
--      Une attribution sans catégorie = "À trier" dans la techlist.
--      C'est traité comme une boîte de réception séparée dans l'UI, pas
--      comme une catégorie standard (cf. design Hugo : "À trier ne devrait
--      pas être une catégorie simple, sinon ça peut se confondre avec
--      PRODUCTION ou autre").
--      Toutes les rows existantes sont remises à NULL → l'admin trie
--      explicitement par drag & drop.
--
--   2) `parent_membre_id` (UUID nullable, FK self-référence) :
--      Permet de rattacher plusieurs attributions du même contact à une
--      "ligne principale". Sur la techlist on n'affiche que les principales
--      (parent_membre_id IS NULL), les rattachées restent visibles dans
--      Attribution + dans le détail de la persona.
--
--      Cas typique : Alexandre a 1 ligne "Cadreur" (3 jours) + 1 ligne
--      "Essais caméra" (1 jour). Sur la techlist il apparaît une seule fois
--      en "Cadreur" avec un badge "+ 1 rôle rattaché".
--
-- Idempotent : ALTER ... IF EXISTS, ADD COLUMN IF NOT EXISTS, etc.
-- ============================================================================

BEGIN;

-- ── 1. category : drop default + drop NOT NULL ───────────────────────────────
ALTER TABLE projet_membres
  ALTER COLUMN category DROP DEFAULT;

ALTER TABLE projet_membres
  ALTER COLUMN category DROP NOT NULL;

-- Migration data : on remet TOUT à NULL pour repartir propre. L'admin
-- triera explicitement les attributions existantes via drag & drop.
-- (Validé par Hugo — option B)
UPDATE projet_membres SET category = NULL;


-- ── 2. parent_membre_id : FK self-référence pour rattachement de postes ──────
ALTER TABLE projet_membres
  ADD COLUMN IF NOT EXISTS parent_membre_id UUID REFERENCES projet_membres(id)
    ON DELETE SET NULL;

-- Index pour les requêtes de filtrage techlist (parent_membre_id IS NULL =
-- ligne principale) et pour récupérer les enfants d'une principale.
CREATE INDEX IF NOT EXISTS idx_projet_membres_parent
  ON projet_membres(parent_membre_id);


-- ── 3. Garde-fou : empêcher un cycle parent ↔ enfant ─────────────────────────
-- Une ligne ne peut pas être rattachée à elle-même. En théorie l'app évite
-- ça, mais on ajoute un CHECK en sécurité.
ALTER TABLE projet_membres
  DROP CONSTRAINT IF EXISTS projet_membres_no_self_parent;
ALTER TABLE projet_membres
  ADD CONSTRAINT projet_membres_no_self_parent
    CHECK (parent_membre_id IS NULL OR parent_membre_id <> id);


-- ── 4. Reload PostgREST pour exposer la nouvelle colonne ────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. Vérification :
--
--    -- La colonne parent_membre_id existe ?
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'projet_membres'
--      AND column_name IN ('category', 'parent_membre_id');
--
--    -- Toutes les attributions sont à category = NULL (= À trier) ?
--    SELECT COUNT(*) FILTER (WHERE category IS NULL) AS a_trier,
--           COUNT(*) FILTER (WHERE category IS NOT NULL) AS triees,
--           COUNT(*) AS total
--    FROM projet_membres;
--
-- 2. Côté front, les attributions existantes apparaîtront toutes dans la
--    boîte "📥 À trier" en haut de la techlist. L'admin pourra ensuite
--    les drag & drop dans les bonnes catégories.
--
-- 3. La règle de RLS `projet_membres_org` couvre automatiquement la nouvelle
--    colonne parent_membre_id (filtre via project_id → projects.org_id).
-- ============================================================================
