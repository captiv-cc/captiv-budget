-- ============================================================================
-- Migration : MUSIQUES MVP1 — Annuaire artistes du projet (table partagée
--             entre Déroulé et Musiques)
-- Date      : 2026-06-08 (C — première brique du chantier Musiques)
-- Contexte  : Pour éviter de saisir 3 fois les mêmes artistes festival (une
--             fois pour le pré-listing affiche, une pour la grille déroulé,
--             une pour le pickup musiques), on crée un annuaire unifié au
--             niveau projet : projet_artistes.
--
--             L'annuaire est alimenté par 3 sources :
--               - 'affiche' : import IA d'une affiche festival (MUS-1.5)
--               - 'grille'  : import IA de la timetable festival (existant)
--               - 'manuel'  : ajout direct via UI (Déroulé ou Musiques)
--
--             Le déroulé existant ne casse pas : on ajoute juste une colonne
--             artiste_id nullable sur projet_deroule_creneaux. Les anciens
--             créneaux gardent leur titre libre + artiste_id NULL.
--
-- Périmètre  :
--   1. CREATE TABLE projet_artistes
--   2. Indexes pour matching flou + lookups fréquents
--   3. Trigger updated_at
--   4. RLS : read = can_see_project, write = can_edit_outil('deroule')
--      (la table sera étendue à l'outil 'musiques' dans MUS-1.2 quand
--       l'outil sera ajouté au catalogue)
--   5. ALTER projet_deroule_creneaux : ADD COLUMN artiste_id NULL
--
-- Naming    : projet_artistes (pas projet_artists, on garde le français
--             cohérent avec projet_membres, projet_deroules, etc.)
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. CREATE TABLE projet_artistes ───────────────────────────────────────
-- Un artiste = un nom unique au sein d'un projet. Le matching de doublon
-- repose sur nom_normalise (NFD + lowercase + retire ponctuation côté
-- helper JS lib/projetArtistes.js) — on stocke aussi la version brute
-- pour l'affichage UI.
CREATE TABLE IF NOT EXISTS projet_artistes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Nom tel que saisi / extrait (affichage). Ex : "Charlotte de Witte",
  -- "Bigflo & Oli", "MØDE".
  nom TEXT NOT NULL,

  -- Nom normalisé pour matching flou et déduplication. Calculé côté
  -- application (lib/projetArtistes.js : NFD → lowercase → retire
  -- accents/ponctuation/espaces multiples). Pas de trigger BDD pour
  -- garder le contrôle côté front (cohérence d'algorithme avec le
  -- matching du picker).
  -- Ex : "Charlotte de Witte" → "charlotte de witte"
  --      "MØDE"               → "mode"
  --      "Bigflo & Oli"       → "bigflo oli"
  nom_normalise TEXT NOT NULL,

  -- Jour de programmation (libellé libre : 'J1' | 'J2' | 'Vendredi' | …).
  -- Optionnel : peut être renseigné par l'affiche, la grille, ou laissé
  -- vide si l'artiste est juste mentionné sans contexte horaire.
  jour TEXT,

  -- Scène libellée (libre : 'Mainstage' | 'Plage' | 'Mediator' | …).
  -- Optionnel pour les mêmes raisons.
  scene TEXT,

  -- Headliner = tête d'affiche (pour pondération tri / mise en avant UI).
  headliner BOOLEAN NOT NULL DEFAULT FALSE,

  -- Source de l'enregistrement : affiche IA, grille IA, ou saisie manuelle.
  -- Permet de gérer la priorité d'enrichissement (ex : la grille remplace
  -- l'affiche sur les champs jour/scène car plus précise).
  source TEXT NOT NULL CHECK (source IN ('affiche', 'grille', 'manuel')),

  -- ID artiste Spotify si lookup réussi. Permet d'éviter de re-search
  -- Spotify à chaque proposition, et de récupérer le top tracks / cover
  -- pour des features futures.
  spotify_artist_id TEXT,

  -- Metadata libre pour extensions futures (genre principal, années
  -- actives, label, lien social, etc.). Pas de schéma strict pour rester
  -- flexible le temps que les besoins se précisent.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Une seule entrée par couple (project, nom_normalise). Si l'import IA
  -- tombe sur un nom déjà présent, on UPDATE au lieu de créer un doublon.
  UNIQUE (project_id, nom_normalise)
);

COMMENT ON TABLE projet_artistes IS
  'MUSIQUES MVP1 — Annuaire artistes du projet, partagé entre Déroulé et '
  'Musiques. Alimenté par import affiche IA (source=''affiche''), '
  'import grille IA (source=''grille''), ou saisie manuelle '
  '(source=''manuel''). Matching de doublon via nom_normalise + UNIQUE.';

COMMENT ON COLUMN projet_artistes.nom_normalise IS
  'Nom normalisé pour matching flou. Calcul côté JS '
  '(lib/projetArtistes.js : NFD → lowercase → retire accents/ponctuation). '
  'Sert à dédupliquer et à matcher au picker (artistes proposés vs déjà saisis).';


-- ── 2. Indexes ────────────────────────────────────────────────────────────
-- project_id : tous les lookups sont scopés projet.
CREATE INDEX IF NOT EXISTS idx_projet_artistes_project_id
  ON projet_artistes (project_id);

-- (project_id, nom_normalise) : matching flou + UNIQUE lookup rapide.
-- Couvert par le UNIQUE constraint mais on l'expose en index nommé pour
-- la clarté des EXPLAIN.
-- (Postgres crée déjà un index pour le UNIQUE — pas besoin d'en créer
-- un autre, mais on s'attend à beaucoup de WHERE project_id = X
-- ORDER BY nom_normalise donc l'index UNIQUE composite suffit.)

-- spotify_artist_id : lookup quand on enrichit (rare, mais utile pour
-- les jobs de réconciliation futurs).
CREATE INDEX IF NOT EXISTS idx_projet_artistes_spotify_id
  ON projet_artistes (spotify_artist_id)
  WHERE spotify_artist_id IS NOT NULL;


-- ── 3. Trigger updated_at ─────────────────────────────────────────────────
-- Réutilise la fonction set_updated_at() universelle définie dans une
-- migration antérieure.
DROP TRIGGER IF EXISTS trg_projet_artistes_updated_at ON projet_artistes;
CREATE TRIGGER trg_projet_artistes_updated_at
  BEFORE UPDATE ON projet_artistes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 4. RLS ────────────────────────────────────────────────────────────────
-- Read : tout membre du projet peut voir l'annuaire (non sensible).
-- Write : permission d'éditer le Déroulé (outil 'deroule') suffit en
--         MUS-1.1, car l'annuaire est alimenté en pratique par l'import
--         déroulé et le drag-and-drop dans le déroulé. En MUS-1.2 quand
--         on ajoutera l'outil 'musiques' au catalogue, on étendra
--         l'autorisation d'écriture pour aussi accepter
--         can_edit_outil('musiques').
ALTER TABLE projet_artistes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_artistes_read"   ON projet_artistes;
DROP POLICY IF EXISTS "projet_artistes_insert" ON projet_artistes;
DROP POLICY IF EXISTS "projet_artistes_update" ON projet_artistes;
DROP POLICY IF EXISTS "projet_artistes_delete" ON projet_artistes;

CREATE POLICY "projet_artistes_read" ON projet_artistes
  FOR SELECT USING (can_see_project(project_id));

CREATE POLICY "projet_artistes_insert" ON projet_artistes
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'deroule'));

CREATE POLICY "projet_artistes_update" ON projet_artistes
  FOR UPDATE
  USING (can_edit_outil(project_id, 'deroule'))
  WITH CHECK (can_edit_outil(project_id, 'deroule'));

CREATE POLICY "projet_artistes_delete" ON projet_artistes
  FOR DELETE USING (can_edit_outil(project_id, 'deroule'));


-- ── 5. ALTER projet_deroule_creneaux : ADD COLUMN artiste_id ─────────────
-- Lien optionnel vers l'annuaire artistes. Permet de matérialiser
-- "ce créneau show correspond à l'artiste X de l'annuaire" pour
-- bénéficier ensuite des liens cross-outil (Musiques peut alors
-- afficher "Joue J2 · Mainstage" sur une proposition).
--
-- Aucun breaking change : les anciens créneaux gardent artiste_id NULL
-- et leur champ `titre` libre. Le picker artiste introduit par MUS-1.7
-- proposera de matérialiser le lien sur les anciens créneaux quand un
-- match est trouvé.
ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS artiste_id UUID
    REFERENCES projet_artistes(id) ON DELETE SET NULL;

-- Index sur artiste_id pour les lookups "tous les créneaux de cet artiste"
-- (utile pour la vue cadreur et le widget "ce show est lié à X mission(s)
-- cadreur").
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneaux_artiste_id
  ON projet_deroule_creneaux (artiste_id)
  WHERE artiste_id IS NOT NULL;

COMMENT ON COLUMN projet_deroule_creneaux.artiste_id IS
  'MUSIQUES MVP1 — Lien optionnel vers projet_artistes (annuaire unifié). '
  'NULL = créneau libre (texte dans titre). NON NULL = lien matérialisé '
  'vers l''annuaire pour cross-référencer avec les propositions Musiques.';


COMMIT;
