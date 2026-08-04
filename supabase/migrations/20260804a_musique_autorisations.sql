-- ════════════════════════════════════════════════════════════════════════════
-- MUS-7 A1 — Autorisations musiques : suivi par track × média
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cadrage : docs/CHANTIER_MUS-7_AUTORISATIONS.md (décisions Hugo 04/08) :
--   - granularité = track × média → 1 row par projet_musique_livrable_link
--   - opéré par les RP du festival via lien token SANS compte (phase A3)
--   - champs : durée d'utilisation, statut autor, contact label, doc signé,
--     commentaires (fil), master (lien DL), utilisé
--
-- Statuts (couvre les colonnes ENVOYÉ + AUTORISATION du tableur de réf) :
--   a_lancer → envoyee (= EN COURS) → accordee (= OUI) | refusee (= NON)
-- envoyee_at / decidee_at posés automatiquement par la lib au changement.
--
-- Périmètre A1 : table + events (fil de commentaires & journal statuts)
-- + RLS org (clé outil 'musiques') + realtime. Les tokens RP (A3) et le
-- partage lecture par média (A4) viendront dans des migrations dédiées.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. projet_musique_autorisations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_musique_autorisations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- project_id dénormalisé : RLS directes + realtime filtrable (pattern
  -- matos/logistique).
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 1-1 avec le couple track × livrable. Si le link saute (track retirée
  -- du média), le suivi d'autorisation saute avec.
  link_id      uuid NOT NULL UNIQUE
               REFERENCES projet_musique_livrable_link(id) ON DELETE CASCADE,

  statut       text NOT NULL DEFAULT 'a_lancer'
               CHECK (statut IN ('a_lancer', 'envoyee', 'accordee', 'refusee')),
  envoyee_at   timestamptz,
  decidee_at   timestamptz,

  -- Durée d'utilisation demandée / accordée ("60s", "max 25 sec"…)
  duree_utilisation text,
  contact_label     text,
  doc_signe         boolean NOT NULL DEFAULT false,
  -- Lien de téléchargement de la musique en bonne qualité
  master_url        text,
  -- Track effectivement utilisée dans le montage
  utilise           boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Qui a fait la dernière modif : user interne (uuid) OU nom saisi sur le
  -- portail RP anonyme (phase A3).
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by_name text
);

CREATE INDEX IF NOT EXISTS idx_musique_autor_project
  ON projet_musique_autorisations(project_id);

COMMENT ON TABLE projet_musique_autorisations IS
  'Suivi des autorisations musique par track × média (link livrable). Opéré en interne et par les RP festival via token (MUS-7).';

-- ── 2. Fil d''événements (commentaires + journal de statuts) ────────────────
CREATE TABLE IF NOT EXISTS projet_musique_autorisation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  autorisation_id uuid NOT NULL
                  REFERENCES projet_musique_autorisations(id) ON DELETE CASCADE,
  -- 'comment' = message libre ; 'statut' = changement d'état (body = nouveau
  -- statut) — journalise les allers-retours RP ↔ équipe.
  kind        text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'statut')),
  body        text NOT NULL,
  author_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Nom saisi sur le portail RP (auteur externe sans compte)
  author_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_musique_autor_events_autor
  ON projet_musique_autorisation_events(autorisation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_musique_autor_events_project
  ON projet_musique_autorisation_events(project_id);

-- ── 3. RLS — clé outil 'musiques' (pattern projet_musique_livrable_link) ────
ALTER TABLE projet_musique_autorisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE projet_musique_autorisation_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projet_musique_autorisations', 'projet_musique_autorisation_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_read"   ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %s', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_read" ON %s FOR SELECT USING (can_read_outil(project_id, ''musiques''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %s FOR INSERT WITH CHECK (can_edit_outil(project_id, ''musiques''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %s FOR UPDATE USING (can_edit_outil(project_id, ''musiques'')) WITH CHECK (can_edit_outil(project_id, ''musiques''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %s FOR DELETE USING (can_edit_outil(project_id, ''musiques''))',
      t, t
    );
  END LOOP;
END $$;

-- ── 4. Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_musique_autorisations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_musique_autorisation_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- Vérifications post-deploy :
--   SELECT * FROM information_schema.tables
--    WHERE table_name LIKE 'projet_musique_autorisation%';
--   SELECT polname FROM pg_policy WHERE polname LIKE '%musique_autorisation%';
