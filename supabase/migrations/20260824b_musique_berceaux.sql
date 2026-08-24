-- ════════════════════════════════════════════════════════════════════════════
-- MUSIQUES — berceaux musicaux (montage d'enchaînements)
-- Date      : 2026-08-24
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un berceau = une suite ordonnée de morceaux coupés, pour maquetter la bande
-- son d'un aftermovie avant montage.
--
-- Décisions de cadrage (Hugo, 24/08) :
--   - le berceau appartient au PROJET, pas à un livrable : on en crée
--     librement, on les compare. Le lien vers un livrable reste facultatif
--     et ne sert qu'à hériter d'une durée cible ;
--   - une seule piste : les morceaux s'enchaînent, c'est ce qu'est un
--     berceau. Pas de superposition ;
--   - un bloc peut exister SANS fichier déposé : on joue alors l'extrait
--     30 s de la proposition, pour se faire une idée de l'enchaînement.
--     in_ms / out_ms sont alors bornés à la durée de l'extrait.
--
-- La sortie visée est une feuille de montage minutée, pas un rendu audio :
-- le monteur refait le montage dans son logiciel.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Berceaux ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_musique_berceaux (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nom         text NOT NULL DEFAULT 'Nouveau berceau',
  -- Facultatif : sert à hériter d'une durée cible et à proposer d'abord les
  -- musiques attribuées à ce livrable. Un berceau n'y est jamais enfermé.
  livrable_id uuid REFERENCES livrables(id) ON DELETE SET NULL,
  -- Durée visée en millisecondes. Renseignée depuis le livrable ou à la main.
  duree_cible_ms integer,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_musique_berceaux_project
  ON projet_musique_berceaux(project_id);

COMMENT ON TABLE projet_musique_berceaux IS
  'Maquettes de bande son : suites ordonnées de morceaux coupés. Objet du projet, pas du livrable.';

-- ── 2. Blocs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_musique_berceau_blocs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- project_id dénormalisé : RLS directe sans jointure (pattern maison).
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  berceau_id     uuid NOT NULL
                 REFERENCES projet_musique_berceaux(id) ON DELETE CASCADE,
  proposition_id uuid NOT NULL
                 REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,

  sort_order  integer NOT NULL DEFAULT 0,
  -- Points de coupe DANS le morceau. Sans fichier déposé, ils portent sur
  -- l'extrait 30 s.
  in_ms       integer NOT NULL DEFAULT 0 CHECK (in_ms >= 0),
  out_ms      integer NOT NULL CHECK (out_ms > 0),
  CONSTRAINT bloc_coupe_coherente CHECK (out_ms > in_ms),

  -- Fondus internes au bloc (millisecondes).
  fade_in_ms  integer NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
  fade_out_ms integer NOT NULL DEFAULT 0 CHECK (fade_out_ms >= 0),
  -- Gain relatif, 1 = tel quel.
  gain        real NOT NULL DEFAULT 1 CHECK (gain >= 0 AND gain <= 4),

  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_musique_berceau_blocs_berceau
  ON projet_musique_berceau_blocs(berceau_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_musique_berceau_blocs_project
  ON projet_musique_berceau_blocs(project_id);

-- ── 3. RLS — clé outil 'musiques' ───────────────────────────────────────────
ALTER TABLE projet_musique_berceaux      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projet_musique_berceau_blocs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projet_musique_berceaux', 'projet_musique_berceau_blocs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_read"   ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %s', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_read" ON %s FOR SELECT USING (can_read_outil(project_id, ''musiques''))', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %s FOR INSERT WITH CHECK (can_edit_outil(project_id, ''musiques''))', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %s FOR UPDATE USING (can_edit_outil(project_id, ''musiques'')) WITH CHECK (can_edit_outil(project_id, ''musiques''))', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %s FOR DELETE USING (can_edit_outil(project_id, ''musiques''))', t, t);
  END LOOP;
END $$;

-- ── 4. updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_musique_berceau()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_musique_berceau_trg ON projet_musique_berceaux;
CREATE TRIGGER touch_musique_berceau_trg
  BEFORE UPDATE ON projet_musique_berceaux
  FOR EACH ROW EXECUTE FUNCTION touch_musique_berceau();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_musique_berceau_blocs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. Créer un berceau, y glisser deux morceaux : les blocs se suivent dans
--    l'ordre sort_order.
-- 2. Un bloc dont out_ms <= in_ms est refusé par la contrainte.
-- 3. Supprimer une proposition retire ses blocs (cascade).
-- ============================================================================
