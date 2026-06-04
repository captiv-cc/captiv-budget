-- ============================================================================
-- Migration : DÉROULÉ FESTIVAL — Sprint 1 (Foundation)
-- Date      : 2026-06-04
-- Contexte  : Démarrage du chantier festival (CHANTIER_DEROULE_FESTIVAL.md).
--             L'outil Déroulé actuel marche pour les lives simples (max 5
--             lanes "équipes"). On l'étend pour supporter les festivals :
--             - Distinction sémantique entre les types de lanes (lieu / personne / global / equipe)
--             - Lien direct lane <-> membre du crew (pour la vue Cadreur)
--             - Code couleur par lane (notamment par cadreur)
--             - Plus de 5 lanes possibles (typique : 7 scènes + 5 cadreurs)
--
-- Décisions Hugo (2026-05-13) :
--   - 1 déroulé = 1 jour (modèle inchangé)
--   - Ajout cadreurs comme lanes 'personne' = bouton manuel
--   - Mode livraison compressé (sprints 1-4 prioritaires)
--
-- Effet :
--   1. ADD COLUMN type TEXT NOT NULL DEFAULT 'equipe' CHECK (...)
--   2. ADD COLUMN membre_id UUID (FK projet_membres) — pour lanes 'personne'
--   3. ADD COLUMN couleur TEXT — code couleur de la lane (hex sans #)
--   4. UPDATE lanes existantes : sort_order=0 → type='global', sinon 'equipe'
--   5. DROP CHECK sort_order 0-4 (libère le cap de 5 lanes)
--   6. ADD CHECK consistance (membre_id NOT NULL ssi type='personne')
--   7. UNIQUE (deroule_id, membre_id) WHERE type='personne' — empêche
--      d'avoir 2 lanes pour le même cadreur sur le même déroulé
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS.
-- Backward compat : aucun déroulé live existant cassé. Toutes les lanes
-- pré-migration deviennent type='global' (sort_order=0) ou type='equipe'
-- (sort_order >=1) — mapping naturel.
-- ============================================================================

BEGIN;


-- ── 1. Ajout des nouvelles colonnes ────────────────────────────────────────
ALTER TABLE projet_deroule_lanes
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'equipe'
    CHECK (type IN ('global', 'equipe', 'lieu', 'personne')),
  ADD COLUMN IF NOT EXISTS membre_id UUID REFERENCES projet_membres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS couleur TEXT;

COMMENT ON COLUMN projet_deroule_lanes.type IS
  'Type de lane : global (transverse), equipe (parallèle générique), lieu (scène / salle / plateau), personne (cadreur nominatif). Festival : utilise lieu + personne. Live : utilise equipe + global.';

COMMENT ON COLUMN projet_deroule_lanes.membre_id IS
  'Lien direct vers projet_membres si type=personne. Permet la vue Cadreur native et le calcul de charge / conflits. ON DELETE SET NULL : si le membre est retiré du projet, la lane reste mais perd sa référence — l''admin pourra la réassigner ou supprimer.';

COMMENT ON COLUMN projet_deroule_lanes.couleur IS
  'Code couleur hex sans # (ex: "378ADD"). Hérité par les créneaux qui n''ont pas de couleur propre. Pour type=personne : couleur perso du cadreur. NULL = couleur dérivée du type par défaut côté front.';


-- ── 2. Migration des lanes existantes ──────────────────────────────────────
-- Convention historique : sort_order=0 est la lane "Global", sort_order>=1
-- sont les lanes "Équipe A/B/C/D". On adopte cette logique pour le typage.
UPDATE projet_deroule_lanes
   SET type = CASE
     WHEN sort_order = 0 THEN 'global'
     ELSE 'equipe'
   END
 WHERE type IS NULL OR type = 'equipe'; -- safe : on ne touche pas les futurs lieu/personne


-- ── 3. Libération du cap 5 lanes ───────────────────────────────────────────
-- Le CHECK historique limitait sort_order à 0-4 (max 5 lanes). On le drop
-- pour permettre N lanes (festival = facilement 10-15 colonnes). Le scroll
-- horizontal côté UI gère la densité.
ALTER TABLE projet_deroule_lanes
  DROP CONSTRAINT IF EXISTS projet_deroule_lanes_sort_order_check;

-- On garde le CHECK >= 0 (sort_order négatif n'a pas de sens)
ALTER TABLE projet_deroule_lanes
  ADD CONSTRAINT projet_deroule_lanes_sort_order_check
    CHECK (sort_order >= 0);


-- ── 4. CHECK consistance type ↔ membre_id ──────────────────────────────────
-- Si type='personne', membre_id doit être renseigné. Sinon il doit être NULL.
-- Garde-fou côté DB pour éviter les états incohérents (lane 'lieu' avec un
-- membre_id par erreur, ou lane 'personne' sans membre).
ALTER TABLE projet_deroule_lanes
  ADD CONSTRAINT projet_deroule_lanes_membre_consistency_check
    CHECK (
      (type = 'personne' AND membre_id IS NOT NULL)
      OR (type <> 'personne' AND membre_id IS NULL)
    );


-- ── 5. UNIQUE (deroule_id, membre_id) pour lanes 'personne' ────────────────
-- Empêche d'avoir 2 lanes 'personne' pour le même cadreur sur le même
-- déroulé (Hugo en double = bug de saisie). Index partiel : ne s'applique
-- qu'aux lanes type='personne'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projet_deroule_lanes_unique_membre
  ON projet_deroule_lanes(deroule_id, membre_id)
  WHERE type = 'personne';


-- ── 6. Index lookup par type (utile pour les vues filtrées) ────────────────
CREATE INDEX IF NOT EXISTS idx_projet_deroule_lanes_deroule_type
  ON projet_deroule_lanes(deroule_id, type, sort_order);


-- ── 7. Reload PostgREST pour exposer les nouvelles colonnes ────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================================
-- Vérifications post-deploy :
--
-- 1. Nouvelles colonnes présentes :
--      \d projet_deroule_lanes
--    → doit montrer type, membre_id, couleur
--
-- 2. Backward compat des lanes existantes :
--      SELECT type, sort_order, COUNT(*)
--        FROM projet_deroule_lanes
--       GROUP BY type, sort_order
--       ORDER BY sort_order;
--    → sort_order=0 doivent être type='global', sort_order>=1 type='equipe'.
--
-- 3. Pas de violation contrainte :
--      SELECT COUNT(*) FROM projet_deroule_lanes
--       WHERE (type = 'personne' AND membre_id IS NULL)
--          OR (type <> 'personne' AND membre_id IS NOT NULL);
--    → 0 attendu.
--
-- 4. Cap 5 lanes libéré :
--      Test : INSERT 6 lanes pour un même deroule_id avec sort_order 0..5
--      → doit passer (avant : refusé par le CHECK).
--
-- 5. UNIQUE membre par déroulé :
--      Test : INSERT 2 lanes type='personne' avec même (deroule_id, membre_id)
--      → 2e doit échouer (violation idx_projet_deroule_lanes_unique_membre).
-- ============================================================================
