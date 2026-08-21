-- ════════════════════════════════════════════════════════════════════════════
-- CONTENUS V1 — validation des photos / vidéos par l'équipe presse
-- Date      : 2026-08-21
-- ════════════════════════════════════════════════════════════════════════════
--
-- Besoin (festival client) : les photographes et créateurs de contenu doivent
-- suivre l'état de validation de leurs médias, et l'équipe du festival doit
-- pouvoir ajouter / statuer / commenter sans compte Captiv.
--
-- Décisions cadrage (validées Hugo 21/08) :
--   - module Captiv à part entière (clé outil 'contenus'), pas un one-shot ;
--   - photographes et scènes = valeurs libres du module, l'UI suggère ce qui
--     a déjà été saisi (+ les scènes du déroulé) → aucune table de config ;
--   - UN seul niveau derrière le lien protégé : tout le monde peut créer,
--     modifier et statuer, la traçabilité passe par le prénom + l'horodatage.
--
-- Périmètre de cette migration : tables + RLS + catalogue + realtime.
-- Les tokens de partage et leurs RPC arrivent dans 20260821b.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Catalogue ────────────────────────────────────────────────────────────
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'contenus',
  'Contenus',
  'Suivi de validation des photos et vidéos par l''équipe presse : statut, '
  'commentaires et liens de partage pour les photographes.',
  'Images',
  93
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. projet_contenus ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_contenus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- project_id direct : RLS simples + realtime filtrable (pattern matos /
  -- logistique / autorisations musiques).
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  type        text NOT NULL DEFAULT 'photo' CHECK (type IN ('photo', 'video')),

  -- Sujet : soit un artiste de l'annuaire projet, soit un libellé libre
  -- (« Ambiance camping », « Interview Marc »…). artiste_text fait foi à
  -- l'affichage quand il est renseigné — même règle que les musiques, où
  -- lier un artiste ne doit jamais renommer le crédit d'origine.
  artiste_id   uuid REFERENCES projet_artistes(id) ON DELETE SET NULL,
  artiste_text text,

  scene        text,
  -- Optionnelle : beaucoup de contenus n'ont pas de date précise
  -- (« Étape non précisée » dans la maquette du festival).
  date_contenu date,
  photographe  text,
  drive_url    text,
  suivi_par    text,

  statut      text NOT NULL DEFAULT 'en_attente'
              CHECK (statut IN ('en_attente', 'valide', 'a_revoir', 'refuse')),
  -- Posé par la lib à chaque sortie de 'en_attente'.
  decide_at   timestamptz,

  -- Suppression douce : un contenu effacé par erreur depuis un lien public
  -- doit rester récupérable côté desk.
  deleted_at  timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by_name text,
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Prénom saisi sur le portail (auteur externe sans compte).
  updated_by_name text
);

CREATE INDEX IF NOT EXISTS idx_contenus_project
  ON projet_contenus(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contenus_artiste
  ON projet_contenus(artiste_id);

COMMENT ON TABLE projet_contenus IS
  'Photos / vidéos soumises à validation presse. Alimenté en interne et via un lien de partage protégé par mot de passe (CONTENUS V1).';
COMMENT ON COLUMN projet_contenus.artiste_text IS
  'Libellé libre du sujet (moment sans artiste). Prioritaire sur artiste_id à l''affichage.';

-- ── 3. Fil d'événements (commentaires + journal des statuts) ────────────────
CREATE TABLE IF NOT EXISTS projet_contenu_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contenu_id  uuid NOT NULL REFERENCES projet_contenus(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'statut')),
  body        text NOT NULL,
  author_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contenu_events_contenu
  ON projet_contenu_events(contenu_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contenu_events_project
  ON projet_contenu_events(project_id);

-- ── 4. RLS — clé outil 'contenus' ───────────────────────────────────────────
ALTER TABLE projet_contenus      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projet_contenu_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projet_contenus', 'projet_contenu_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_read"   ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %s', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_read" ON %s FOR SELECT USING (can_read_outil(project_id, ''contenus''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %s FOR INSERT WITH CHECK (can_edit_outil(project_id, ''contenus''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %s FOR UPDATE USING (can_edit_outil(project_id, ''contenus'')) WITH CHECK (can_edit_outil(project_id, ''contenus''))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %s FOR DELETE USING (can_edit_outil(project_id, ''contenus''))',
      t, t
    );
  END LOOP;
END $$;

-- ── 5. updated_at automatique ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_projet_contenus()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  -- Sortie de « en attente » = décision : on horodate une seule fois.
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.decide_at := CASE WHEN NEW.statut = 'en_attente' THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_projet_contenus_trg ON projet_contenus;
CREATE TRIGGER touch_projet_contenus_trg
  BEFORE UPDATE ON projet_contenus
  FOR EACH ROW EXECUTE FUNCTION touch_projet_contenus();

-- ── 6. Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_contenus;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_contenu_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. L'onglet « Contenus » apparaît pour admin / charge_prod ; un prestataire
--    n'y a accès que si son métier ou un override lui donne l'outil.
-- 2. Passer un contenu en « validé » renseigne decide_at ; le repasser en
--    « en attente » le remet à NULL.
-- 3. Supprimer depuis l'UI pose deleted_at (la ligne reste en base).
-- ============================================================================
