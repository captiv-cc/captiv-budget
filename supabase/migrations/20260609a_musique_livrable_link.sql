-- ============================================================================
-- Migration : MUSIQUES MUS-6.1 — Link N:M propositions ↔ livrables
-- Date      : 2026-06-09 (a — MUS-6.1)
-- Contexte  : Le workflow Musiques se découpe en :
--               1. Vrac collaboratif (propositions globales projet — déjà fait)
--               2. Attribution par livrable (cette migration)
--                  - Une track peut être liée à N livrables
--                  - Un livrable peut contenir N tracks
--                  - Statut de validation client SPÉCIFIQUE au couple
--                  - Remarque + ordre éditoriaux SPÉCIFIQUES au couple
--               3. Validation presse/labels (vague MUS-7 future, hors scope)
--
--             Le statut global de la track (projet_musique_propositions.statut :
--             vrac/sélectionné/validé festival/accordé/refusé/en_nego) reste
--             distinct du statut local par couple. Une track peut être
--             "accordée" globalement et "refus_client" pour le Master.
--
-- Périmètre :
--   1. CREATE TABLE projet_musique_livrable_link
--   2. Indexes (livrable_id, ordre) + (proposition_id)
--   3. Trigger updated_at
--   4. RLS (héritage via livrable.project_id + outil 'musiques')
--   5. Realtime publication
-- ============================================================================

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_musique_livrable_link (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cibles du lien
  proposition_id  UUID NOT NULL
                  REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,
  livrable_id     UUID NOT NULL
                  REFERENCES livrables(id) ON DELETE CASCADE,

  -- Ordre dans la setlist du livrable. REAL pour fractional ordering :
  -- on peut insérer entre 2 rows sans renuméroter. Interprétation libre
  -- (séquence temporelle ou priorité préférence) — l'utilisateur décide
  -- selon le contexte du livrable et précise dans la remarque si besoin.
  ordre           REAL,

  -- Remarque éditoriale SPÉCIFIQUE à ce couple (différente de la remarque
  -- globale de la proposition). Ex: "à utiliser en intro", "version
  -- raccourcie 30s", "drop à 02:15".
  remarque        TEXT,

  -- Statut local de validation client (distinct du statut global de la track)
  --   propose       : par défaut au moment du link (proposition pour le client)
  --   valide_client : le client a approuvé pour CE livrable
  --   refuse_client : le client a rejeté pour CE livrable
  -- Volontairement minimal — le tunnel droits/labels (en_nego, accordé droits,
  -- refusé droits) sera une vague séparée MUS-7 avec ses propres besoins.
  statut_local    TEXT NOT NULL DEFAULT 'propose'
                  CHECK (statut_local IN ('propose', 'valide_client', 'refuse_client')),

  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas de doublons exacts du couple (sinon ça veut dire la même track
  -- ajoutée 2 fois au même livrable — on prendra l'existante et on
  -- updatera ordre/remarque/statut côté UI).
  UNIQUE (proposition_id, livrable_id)
);

COMMENT ON TABLE projet_musique_livrable_link IS
  'MUSIQUES MUS-6.1 — Lien N:M proposition ↔ livrable. Une track peut '
  'être proposée pour plusieurs livrables avec un ordre, une remarque '
  'et un statut de validation client spécifiques au couple.';

COMMENT ON COLUMN projet_musique_livrable_link.ordre IS
  'Ordre dans la setlist du livrable. REAL pour fractional ordering. '
  'Interprétation libre (séquence ou priorité) selon le contexte.';

COMMENT ON COLUMN projet_musique_livrable_link.statut_local IS
  'Statut de validation client SPÉCIFIQUE au couple track+livrable. '
  'Distinct du statut global de la proposition.';


-- ── 2. Indexes ───────────────────────────────────────────────────────────
-- Setlist par livrable triée par ordre : query principale dans le drawer livrable
CREATE INDEX IF NOT EXISTS idx_musique_livrable_link_livrable_ordre
  ON projet_musique_livrable_link (livrable_id, ordre NULLS LAST, created_at);

-- Reverse lookup "dans quels livrables est cette track" : section Utilisée dans
CREATE INDEX IF NOT EXISTS idx_musique_livrable_link_proposition
  ON projet_musique_livrable_link (proposition_id);


-- ── 3. Trigger updated_at ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_musique_livrable_link_updated_at
  ON projet_musique_livrable_link;
CREATE TRIGGER trg_musique_livrable_link_updated_at
  BEFORE UPDATE ON projet_musique_livrable_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────
-- Lecture  : tout membre qui peut lire l'outil 'musiques' du projet
-- Création : qui peut éditer l'outil 'musiques' du projet
-- Update   : pareil (n'importe quel admin/charge_prod, pas seulement created_by
--            — un lien est partagé, l'ordre/remarque/statut sont collaboratifs)
-- Delete   : qui peut éditer l'outil
ALTER TABLE projet_musique_livrable_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "musique_livrable_link_read"   ON projet_musique_livrable_link;
DROP POLICY IF EXISTS "musique_livrable_link_insert" ON projet_musique_livrable_link;
DROP POLICY IF EXISTS "musique_livrable_link_update" ON projet_musique_livrable_link;
DROP POLICY IF EXISTS "musique_livrable_link_delete" ON projet_musique_livrable_link;

CREATE POLICY "musique_livrable_link_read" ON projet_musique_livrable_link
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM livrables l
      WHERE l.id = projet_musique_livrable_link.livrable_id
        AND can_read_outil(l.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_livrable_link_insert" ON projet_musique_livrable_link
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM livrables l
      WHERE l.id = projet_musique_livrable_link.livrable_id
        AND can_edit_outil(l.project_id, 'musiques')
    )
    -- Et la proposition doit appartenir au même projet (cohérence)
    AND EXISTS (
      SELECT 1
      FROM projet_musique_propositions p
      JOIN livrables l ON l.id = projet_musique_livrable_link.livrable_id
      WHERE p.id = projet_musique_livrable_link.proposition_id
        AND p.project_id = l.project_id
    )
  );

CREATE POLICY "musique_livrable_link_update" ON projet_musique_livrable_link
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM livrables l
      WHERE l.id = projet_musique_livrable_link.livrable_id
        AND can_edit_outil(l.project_id, 'musiques')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM livrables l
      WHERE l.id = projet_musique_livrable_link.livrable_id
        AND can_edit_outil(l.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_livrable_link_delete" ON projet_musique_livrable_link
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM livrables l
      WHERE l.id = projet_musique_livrable_link.livrable_id
        AND can_edit_outil(l.project_id, 'musiques')
    )
  );


-- ── 5. Realtime publication ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'projet_musique_livrable_link'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projet_musique_livrable_link;
  END IF;
END;
$$;

ALTER TABLE projet_musique_livrable_link REPLICA IDENTITY FULL;


COMMIT;
