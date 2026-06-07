-- ============================================================================
-- Migration : MUSIQUES MVP1 — Tables propositions + notes + tags
-- Date      : 2026-06-08 (D — suite de 20260608c_projet_artistes.sql)
-- Contexte  : Cœur du module Musiques. Trois tables :
--               1. propositions : un titre proposé dans le vrac collaboratif
--               2. notes : note ★ individuelle par user (moyenne agrégée
--                          côté front)
--               3. tags : tags collaboratifs libres (autocomplete sur les
--                         tags déjà utilisés dans le projet)
--
-- Périmètre :
--   1. INSERT 'musiques' dans outils_catalogue
--   2. ALTER POLICY projet_artistes : étend le write à can_edit_outil('musiques')
--   3. CREATE TABLE projet_musique_propositions
--   4. CREATE TABLE projet_musique_notes
--   5. CREATE TABLE projet_musique_tags
--   6. Indexes + Triggers + RLS
--
-- Cycle de vie (statut) :
--   vrac → selectionne → valide_festival → en_nego → accorde
--                                        ↘ refuse
--   Le cycle complet est utilisé à partir de MVP2 (Kanban). En MVP1 toutes
--   les propositions restent en 'vrac' (la transition se fera à la main).
--
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. Ajout 'musiques' au catalogue d'outils ─────────────────────────────
-- L'outil Musiques apparaît dans la liste des outils du projet. Permet
-- aux admins de définir qui peut lire/écrire via project_outils_access
-- (mécanique standard Captiv).
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'musiques',
  'Musiques',
  'Sélection collaborative des musiques pour les livrables vidéo '
  '(aftermovie, reels, RSO). Vrac + notation, recherche Spotify intégrée, '
  'import depuis affiche festival, suivi presse labels.',
  'Music',
  35
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. Étend l'écriture projet_artistes à 'musiques' ──────────────────────
-- En MUS-1.1, seul 'deroule' avait droit d'écrire l'annuaire. Maintenant
-- que 'musiques' existe, on étend (l'import affiche IA passe par
-- 'musiques' et doit pouvoir upserter dans projet_artistes).
DROP POLICY IF EXISTS "projet_artistes_insert" ON projet_artistes;
DROP POLICY IF EXISTS "projet_artistes_update" ON projet_artistes;
DROP POLICY IF EXISTS "projet_artistes_delete" ON projet_artistes;

CREATE POLICY "projet_artistes_insert" ON projet_artistes
  FOR INSERT WITH CHECK (
    can_edit_outil(project_id, 'deroule')
    OR can_edit_outil(project_id, 'musiques')
  );

CREATE POLICY "projet_artistes_update" ON projet_artistes
  FOR UPDATE
  USING (
    can_edit_outil(project_id, 'deroule')
    OR can_edit_outil(project_id, 'musiques')
  )
  WITH CHECK (
    can_edit_outil(project_id, 'deroule')
    OR can_edit_outil(project_id, 'musiques')
  );

CREATE POLICY "projet_artistes_delete" ON projet_artistes
  FOR DELETE USING (
    can_edit_outil(project_id, 'deroule')
    OR can_edit_outil(project_id, 'musiques')
  );


-- ── 3. CREATE TABLE projet_musique_propositions ──────────────────────────
-- Une proposition = un titre suggéré par un membre dans le vrac. Liée
-- optionnellement à un artiste de l'annuaire (artiste_id) ou bien à un
-- nom libre (artiste_text) si l'artiste n'est pas encore dans l'annuaire.
CREATE TABLE IF NOT EXISTS projet_musique_propositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Lien artiste : matérialisé si trouvé dans l'annuaire (recommandé),
  -- texte libre sinon (jingle, son d'ambiance, artiste pas encore confirmé).
  artiste_id   UUID REFERENCES projet_artistes(id) ON DELETE SET NULL,
  artiste_text TEXT,

  -- Au moins un des deux doit être renseigné (sinon proposition orpheline).
  CONSTRAINT proposition_has_artiste
    CHECK (artiste_id IS NOT NULL OR (artiste_text IS NOT NULL AND artiste_text <> '')),

  titre TEXT NOT NULL,

  -- ─── Sources externes ─────────────────────────────────────────────────
  -- Spotify (si match trouvé via recherche ou paste YouTube → lookup)
  spotify_id     TEXT,
  spotify_url    TEXT,
  preview_url    TEXT,      -- mp3 30s public, sans pub
  cover_url      TEXT,
  duration_ms    INTEGER,

  -- audio_features : objet Spotify Audio Features (BPM, energy, danceability,
  -- valence, key, tempo, loudness, etc.). Format JSONB pour rester flexible
  -- face aux évolutions Spotify API.
  audio_features JSONB,

  -- YouTube (pour la version full + passages timecodés précis)
  lien_youtube TEXT,

  -- Timecode optionnel pour usage précis dans un montage. Exprimés en
  -- secondes depuis le début du morceau. Si NULL, le titre est utilisable
  -- en entier (ou Spotify preview 30s par défaut).
  timecode_start_sec INTEGER CHECK (timecode_start_sec IS NULL OR timecode_start_sec >= 0),
  timecode_end_sec   INTEGER CHECK (timecode_end_sec   IS NULL OR timecode_end_sec   >= 0),
  CONSTRAINT timecode_coherent
    CHECK (
      timecode_start_sec IS NULL
      OR timecode_end_sec IS NULL
      OR timecode_end_sec > timecode_start_sec
    ),

  -- ─── Cycle de vie ─────────────────────────────────────────────────────
  -- vrac           : pool initial (MVP1 par défaut)
  -- selectionne    : sélectionné par l'équipe créa (MVP2)
  -- valide_festival: validé par le festival (MVP3)
  -- en_nego        : en négociation avec le label (MVP4)
  -- accorde        : autorisation label finalisée (MVP4)
  -- refuse         : refusé soit par le festival soit par le label (toute phase)
  statut TEXT NOT NULL DEFAULT 'vrac'
    CHECK (statut IN ('vrac', 'selectionne', 'valide_festival', 'en_nego', 'accorde', 'refuse')),

  -- Personne qui a proposé le titre (audit). SET NULL si profil supprimé.
  proposer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Remarques libres (timecode narratif "intro 2:20 → 2:35", contexte,
  -- "bon pour le drop du SEQ 4", etc.). Texte simple, pas RichEditor en MVP1.
  remarques TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_musique_propositions IS
  'MUSIQUES MVP1 — Une proposition de titre dans le vrac collaboratif du '
  'projet. Lien optionnel artiste_id (annuaire) ou artiste_text (libre). '
  'Métadonnées Spotify (audio_features inclus) + lien YouTube full. '
  'Cycle de vie : vrac → selectionne → valide_festival → en_nego → accorde.';

COMMENT ON COLUMN projet_musique_propositions.audio_features IS
  'Spotify Audio Features : { tempo, energy, danceability, valence, key, '
  'loudness, acousticness, instrumentalness, liveness, speechiness, '
  'time_signature }. Récupéré lors du match Spotify. Permet la '
  'coloration par énergie, le tri par BPM, la recherche IA niveau 3.';


-- ── 4. CREATE TABLE projet_musique_notes ─────────────────────────────────
-- Note individuelle par user, échelle 1-5. La moyenne est agrégée côté
-- front en MVP1 (passe en vue SQL si la charge le justifie).
CREATE TABLE IF NOT EXISTS projet_musique_notes (
  proposition_id UUID NOT NULL
    REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note           SMALLINT NOT NULL CHECK (note BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Une seule note par user par proposition (un re-vote remplace).
  PRIMARY KEY (proposition_id, user_id)
);

COMMENT ON TABLE projet_musique_notes IS
  'MUSIQUES MVP1 — Notes individuelles ★ (1-5) par user sur une '
  'proposition. Moyenne agrégée côté front en MVP1. Un user ne peut '
  'avoir qu''une seule note par proposition (UPSERT).';


-- ── 5. CREATE TABLE projet_musique_tags ──────────────────────────────────
-- Tags collaboratifs sur une proposition. Autocomplete sur les tags
-- existants du projet (query DISTINCT join propositions). Plusieurs users
-- peuvent ajouter des tags différents à la même proposition, mais pas
-- deux fois le même tag.
CREATE TABLE IF NOT EXISTS projet_musique_tags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  proposition_id UUID NOT NULL
    REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,

  -- Tag normalisé côté JS (lowercase, trim, NFD si pertinent). Stockage
  -- simple TEXT. Pas de table tags séparée (over-engineering MVP1).
  -- Ex : "drop banger", "intro chill", "voix fem", "instrumental".
  tag TEXT NOT NULL CHECK (LENGTH(tag) >= 1 AND LENGTH(tag) <= 40),

  -- User qui a ajouté le tag (audit + analyse "qui tagge quoi").
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas deux fois le même tag sur la même proposition.
  UNIQUE (proposition_id, tag)
);

COMMENT ON TABLE projet_musique_tags IS
  'MUSIQUES MVP1 — Tags collaboratifs sur une proposition. Free-form '
  'string normalisé côté JS. Autocomplete sur DISTINCT(tag) du projet. '
  'UNIQUE(proposition_id, tag) pour éviter les doublons.';


-- ── 6. Indexes ────────────────────────────────────────────────────────────
-- propositions
CREATE INDEX IF NOT EXISTS idx_musique_propositions_project_id
  ON projet_musique_propositions (project_id);

CREATE INDEX IF NOT EXISTS idx_musique_propositions_project_statut
  ON projet_musique_propositions (project_id, statut);

CREATE INDEX IF NOT EXISTS idx_musique_propositions_artiste_id
  ON projet_musique_propositions (artiste_id)
  WHERE artiste_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_musique_propositions_spotify_id
  ON projet_musique_propositions (spotify_id)
  WHERE spotify_id IS NOT NULL;

-- notes (PRIMARY KEY couvre déjà proposition_id)
CREATE INDEX IF NOT EXISTS idx_musique_notes_user_id
  ON projet_musique_notes (user_id);

-- tags
CREATE INDEX IF NOT EXISTS idx_musique_tags_proposition_id
  ON projet_musique_tags (proposition_id);

CREATE INDEX IF NOT EXISTS idx_musique_tags_tag
  ON projet_musique_tags (tag);


-- ── 7. Triggers updated_at ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_musique_propositions_updated_at
  ON projet_musique_propositions;
CREATE TRIGGER trg_musique_propositions_updated_at
  BEFORE UPDATE ON projet_musique_propositions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_musique_notes_updated_at
  ON projet_musique_notes;
CREATE TRIGGER trg_musique_notes_updated_at
  BEFORE UPDATE ON projet_musique_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 8. RLS — projet_musique_propositions ─────────────────────────────────
ALTER TABLE projet_musique_propositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "musique_propositions_read"   ON projet_musique_propositions;
DROP POLICY IF EXISTS "musique_propositions_insert" ON projet_musique_propositions;
DROP POLICY IF EXISTS "musique_propositions_update" ON projet_musique_propositions;
DROP POLICY IF EXISTS "musique_propositions_delete" ON projet_musique_propositions;

CREATE POLICY "musique_propositions_read" ON projet_musique_propositions
  FOR SELECT USING (can_read_outil(project_id, 'musiques'));

CREATE POLICY "musique_propositions_insert" ON projet_musique_propositions
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'musiques'));

CREATE POLICY "musique_propositions_update" ON projet_musique_propositions
  FOR UPDATE
  USING (can_edit_outil(project_id, 'musiques'))
  WITH CHECK (can_edit_outil(project_id, 'musiques'));

CREATE POLICY "musique_propositions_delete" ON projet_musique_propositions
  FOR DELETE USING (can_edit_outil(project_id, 'musiques'));


-- ── 9. RLS — projet_musique_notes (hérité via proposition → project) ─────
-- Une note s'écrit toujours pour soi (note de l'utilisateur courant).
-- La lecture est ouverte à tous les membres pouvant lire le module.
ALTER TABLE projet_musique_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "musique_notes_read"   ON projet_musique_notes;
DROP POLICY IF EXISTS "musique_notes_insert" ON projet_musique_notes;
DROP POLICY IF EXISTS "musique_notes_update" ON projet_musique_notes;
DROP POLICY IF EXISTS "musique_notes_delete" ON projet_musique_notes;

CREATE POLICY "musique_notes_read" ON projet_musique_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_notes.proposition_id
        AND can_read_outil(p.project_id, 'musiques')
    )
  );

-- Insert/Update/Delete : seulement sa propre note + permission édition module.
CREATE POLICY "musique_notes_insert" ON projet_musique_notes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_notes.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_notes_update" ON projet_musique_notes
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_notes.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_notes.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_notes_delete" ON projet_musique_notes
  FOR DELETE USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_notes.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );


-- ── 10. RLS — projet_musique_tags (hérité via proposition → project) ────
-- Un user peut ajouter un tag à n'importe quelle proposition du projet
-- (collaboratif). Il peut supprimer un tag qu'il a ajouté lui-même.
-- L'édition (rename) n'a pas de sens : on supprime + recrée.
ALTER TABLE projet_musique_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "musique_tags_read"   ON projet_musique_tags;
DROP POLICY IF EXISTS "musique_tags_insert" ON projet_musique_tags;
DROP POLICY IF EXISTS "musique_tags_delete" ON projet_musique_tags;

CREATE POLICY "musique_tags_read" ON projet_musique_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_tags.proposition_id
        AND can_read_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_tags_insert" ON projet_musique_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_tags.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_tags_delete" ON projet_musique_tags
  FOR DELETE USING (
    -- Soit le tag est de l'utilisateur courant, soit l'utilisateur est
    -- admin/charge_prod (édition élargie du module = peut nettoyer).
    (user_id = auth.uid() OR can_edit_outil(
      (SELECT p.project_id FROM projet_musique_propositions p
       WHERE p.id = projet_musique_tags.proposition_id),
      'musiques'
    ))
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_tags.proposition_id
        AND can_read_outil(p.project_id, 'musiques')
    )
  );


COMMIT;
