-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Phase A (sessions partagées multi-membres)
-- Date      : 2026-05-05
-- Contexte  : Le modèle Phase 0a/0b traitait chaque session comme appartenant
--             à 1 seul membre (`projet_membres_sessions.membre_id`). Bien
--             pour démarrer, mais inadapté quand plusieurs personnes
--             participent à la MÊME session ("Installation 13-14/05 à
--             Mtp" pour Hugo + Samuel + Victorien + Jérôme — chacun avec
--             ses dates persos d'arrivée/retour).
--
-- Modèle Phase A :
--             • `projet_sessions` (= la session "produit") : label, lieu,
--               dates globales, couleur. Une row par session distincte.
--             • `projet_session_membres` (= la participation) : jointure
--               session × membre, avec presence_days / arrival / departure
--               PROPRES À CE PARTICIPANT. Une row par couple.
--
-- Approche  : MIGRATION ADDITIVE.
--             - Nouvelles tables créées
--             - Migration 1:1 des données existantes : chaque row
--               `projet_membres_sessions` devient (1 projet_sessions +
--               1 projet_session_membres). Pas de fusion automatique : si
--               Hugo + Samuel ont chacun "Tournage Mtp 14-17/05", ça reste
--               2 sessions distinctes après migration. La fusion sera
--               manuelle côté UI (futur "+ Template" qui rejoindra
--               vraiment au lieu de dupliquer).
--             - L'ancienne table `projet_membres_sessions` reste en place
--               (lecture seule effective côté front Phase A/2). Sera
--               supprimée à la phase suivante quand on sera sûr de tout.
--             - `projet_session_membres.legacy_session_id` trace la row
--               source pour idempotence (rejouer la migration ne duplique
--               pas).
--
-- Cohérence : héritage RLS via projet_sessions.project_id →
--             can_read_outil('equipe', project_id) /
--             can_edit_outil. Pas de duplication de logique RLS.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, INSERT WHERE NOT EXISTS pour
-- la migration de données, DROP POLICY IF EXISTS avant CREATE.
-- ============================================================================

BEGIN;

-- ── 1. Nouvelle table projet_sessions ───────────────────────────────────────
-- La session "produit" : entité partagée entre 1+ membres.
CREATE TABLE IF NOT EXISTS projet_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien direct vers le projet. CASCADE car une session sans projet
  -- n'a pas de sens.
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Ordre d'affichage (drag-reorder manuel éventuel). 1 = première par
  -- défaut. Sert AUSSI à indexer la palette de couleurs déterministe :
  -- session 1 = bleu, 2 = teal, 3 = ambre, etc. (cf. SESSION_PALETTE).
  sort_order INTEGER NOT NULL DEFAULT 1,

  -- Label libre. Ex. "Essais", "Installation", "Tournage". Si NULL,
  -- le front affiche "Session N" en fallback.
  label TEXT,

  -- Dates "enveloppe" de la session : start_date = 1er jour couvert,
  -- end_date = dernier jour couvert. Calculées à partir des
  -- presence_days des participations. À la création UI, l'admin pose
  -- une plage globale ; les participants individuels ont chacun leurs
  -- propres dates dans la jointure.
  start_date DATE,
  end_date DATE,

  -- Jours globaux de la session. Sert de "pool" : les participations
  -- individuelles cochent un sous-ensemble de ces jours. Si un membre
  -- est marqué présent un jour HORS de cette enveloppe, on l'accepte
  -- côté DB (pas de CHECK strict) — l'UI peut alerter si elle veut.
  presence_days TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Lieu principal de la session (DOUBLE MODE comme avant) :
  --   • Texte libre rapide : "Paris", "Mtp", "Studio Bastille"
  --   • Lien optionnel vers logistique_lieux (table future, FK pas
  --     encore créée — la colonne est là pour éviter une 2ᵉ ALTER)
  lieu_principal_text TEXT,
  lieu_principal_id UUID,

  -- Couleur d'identification. Hex sans #. Auto-attribuée depuis la
  -- palette si NULL (front fait paletteAt(sort_order)).
  couleur TEXT,

  -- Statut administratif (pour la session globale, indépendant des
  -- statuts individuels des participants).
  statut TEXT NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie', 'confirme', 'annule')),

  -- Notes globales sur la session (briefing collectif, contraintes, etc.)
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas 2 sessions au même sort_order sur le même projet (cohérence
  -- avec la palette de couleurs déterministe).
  UNIQUE (project_id, sort_order)
);


-- ── 2. Nouvelle table projet_session_membres ────────────────────────────────
-- La participation : un membre × une session. Porte les overrides
-- individuels (presence_days du membre, arrival/departure perso, statut
-- individuel, notes perso).
CREATE TABLE IF NOT EXISTS projet_session_membres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Liens. Tous CASCADE : si on supprime la session ou le membre, les
  -- participations partent.
  session_id UUID NOT NULL REFERENCES projet_sessions(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,

  -- Présence individuelle dans la session. Sous-ensemble (en pratique)
  -- des presence_days globaux de la session. C'est ICI que se gère
  -- "Jérôme rejoint l'Installation seulement le 14/05" (presence_days
  -- = ['2026-05-14'] côté Jérôme alors que la session globale couvre
  -- ['2026-05-13', '2026-05-14']).
  presence_days TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Logistique perso : quand CE membre arrive et repart. Indépendant
  -- des autres participants (Hugo arrive 12/05 en transit, Samuel
  -- arrive 13/05 le matin, Jérôme arrive 14/05 directement).
  arrival_date DATE,
  arrival_time TEXT, -- ex. "14:30" — TEXT pour souplesse formats
  departure_date DATE,
  departure_time TEXT,

  -- Statut individuel (un membre peut être "annule" sur une session
  -- partagée alors que les autres restent "confirme").
  statut TEXT NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie', 'confirme', 'annule')),

  -- Notes perso (ex. "départ avancé pour rdv médical", "passe
  -- récupérer matériel chez prestataire en route").
  notes TEXT,

  -- Idempotence migration : trace la row source `projet_membres_sessions`
  -- d'où vient la participation. NULL pour les participations créées
  -- post-migration. Permet de rejouer la migration sans dupliquer.
  legacy_session_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un membre ne peut pas avoir 2 participations dans la même session.
  UNIQUE (session_id, membre_id)
);


-- ── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projet_sessions_project
  ON projet_sessions(project_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_projet_sessions_dates
  ON projet_sessions(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_projet_session_membres_session
  ON projet_session_membres(session_id);

CREATE INDEX IF NOT EXISTS idx_projet_session_membres_membre
  ON projet_session_membres(membre_id);

-- Lookup pour idempotence migration
CREATE INDEX IF NOT EXISTS idx_projet_session_membres_legacy
  ON projet_session_membres(legacy_session_id)
  WHERE legacy_session_id IS NOT NULL;


-- ── 4. RLS — projet_sessions ────────────────────────────────────────────────
ALTER TABLE projet_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_sessions_read"   ON projet_sessions;
DROP POLICY IF EXISTS "projet_sessions_insert" ON projet_sessions;
DROP POLICY IF EXISTS "projet_sessions_update" ON projet_sessions;
DROP POLICY IF EXISTS "projet_sessions_delete" ON projet_sessions;

CREATE POLICY "projet_sessions_read" ON projet_sessions
  FOR SELECT USING (can_read_outil(project_id, 'equipe'));

CREATE POLICY "projet_sessions_insert" ON projet_sessions
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'equipe'));

CREATE POLICY "projet_sessions_update" ON projet_sessions
  FOR UPDATE
  USING (can_edit_outil(project_id, 'equipe'))
  WITH CHECK (can_edit_outil(project_id, 'equipe'));

CREATE POLICY "projet_sessions_delete" ON projet_sessions
  FOR DELETE USING (can_edit_outil(project_id, 'equipe'));


-- ── 5. RLS — projet_session_membres (héritée via session→projet) ───────────
ALTER TABLE projet_session_membres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_session_membres_read"   ON projet_session_membres;
DROP POLICY IF EXISTS "projet_session_membres_insert" ON projet_session_membres;
DROP POLICY IF EXISTS "projet_session_membres_update" ON projet_session_membres;
DROP POLICY IF EXISTS "projet_session_membres_delete" ON projet_session_membres;

CREATE POLICY "projet_session_membres_read" ON projet_session_membres
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_sessions s
      WHERE s.id = projet_session_membres.session_id
        AND can_read_outil(s.project_id, 'equipe')
    )
  );

CREATE POLICY "projet_session_membres_insert" ON projet_session_membres
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_sessions s
      WHERE s.id = projet_session_membres.session_id
        AND can_edit_outil(s.project_id, 'equipe')
    )
  );

CREATE POLICY "projet_session_membres_update" ON projet_session_membres
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_sessions s
      WHERE s.id = projet_session_membres.session_id
        AND can_edit_outil(s.project_id, 'equipe')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_sessions s
      WHERE s.id = projet_session_membres.session_id
        AND can_edit_outil(s.project_id, 'equipe')
    )
  );

CREATE POLICY "projet_session_membres_delete" ON projet_session_membres
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_sessions s
      WHERE s.id = projet_session_membres.session_id
        AND can_edit_outil(s.project_id, 'equipe')
    )
  );


-- ── 6. Triggers updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION projet_sessions_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_sessions_updated_at ON projet_sessions;
CREATE TRIGGER trg_projet_sessions_updated_at
  BEFORE UPDATE ON projet_sessions
  FOR EACH ROW EXECUTE FUNCTION projet_sessions_touch_updated_at();

CREATE OR REPLACE FUNCTION projet_session_membres_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_session_membres_updated_at ON projet_session_membres;
CREATE TRIGGER trg_projet_session_membres_updated_at
  BEFORE UPDATE ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_touch_updated_at();


-- ── 7. Migration des données existantes (1:1, idempotent) ──────────────────
-- Pour chaque row de projet_membres_sessions qui n'a PAS encore été
-- migrée (= aucune participation legacy_session_id ne pointe dessus) :
--   1. Crée 1 row dans projet_sessions (avec le project_id du membre)
--   2. Crée 1 row dans projet_session_membres pointant vers (nouvelle
--      session, membre_id source)
--   3. Marque legacy_session_id = source.id sur la participation pour
--      tracer et garantir l'idempotence
--
-- Le `sort_order` global de la session est calculé : MAX(sort_order)
-- existant pour le projet + 1 — chaque session source devient une
-- session distincte avec son propre sort_order. Dans le pire cas
-- (rejoue sur un projet déjà partiellement migré), on ajoute à la
-- queue plutôt que d'écraser.
--
-- Note : on PRÉSERVE intentionnellement la duplication apparente.
-- Si Hugo + Samuel ont chacun "Tournage Mtp 14-17/05" en source, ça
-- donnera 2 sessions distinctes après migration. La fusion (= "rejoindre
-- au lieu de dupliquer") sera proposée par l'UI Phase A/2 quand
-- l'admin cliquera sur le bouton "+ Tournage (Mtp)" template.
DO $$
DECLARE
  src RECORD;
  new_session_id UUID;
  new_sort_order INTEGER;
BEGIN
  FOR src IN
    SELECT
      s.id          AS source_id,
      pm.project_id AS project_id,
      s.label,
      s.lieu_principal_text,
      s.lieu_principal_id,
      s.couleur,
      s.arrival_date,
      s.departure_date,
      COALESCE(s.presence_days, '{}'::text[]) AS presence_days,
      s.statut,
      s.notes,
      s.membre_id,
      s.created_at,
      s.updated_at
    FROM projet_membres_sessions s
    JOIN projet_membres pm ON pm.id = s.membre_id
    WHERE NOT EXISTS (
      SELECT 1 FROM projet_session_membres psm
      WHERE psm.legacy_session_id = s.id
    )
    ORDER BY pm.project_id, s.sort_order, s.created_at
  LOOP
    -- Calcul sort_order incrémental par projet
    SELECT COALESCE(MAX(sort_order), 0) + 1
      INTO new_sort_order
      FROM projet_sessions
      WHERE project_id = src.project_id;

    -- 1. Création de la session globale (start/end = enveloppe perso
    --    du membre source, sera étendue par l'UI si d'autres
    --    participants rejoignent avec d'autres dates).
    INSERT INTO projet_sessions (
      project_id, sort_order, label,
      start_date, end_date, presence_days,
      lieu_principal_text, lieu_principal_id, couleur,
      statut, notes, created_at, updated_at
    ) VALUES (
      src.project_id,
      new_sort_order,
      src.label,
      src.arrival_date,
      src.departure_date,
      src.presence_days,
      src.lieu_principal_text,
      src.lieu_principal_id,
      src.couleur,
      src.statut,
      src.notes,
      src.created_at,
      src.updated_at
    )
    RETURNING id INTO new_session_id;

    -- 2. Création de la participation (= jointure avec overrides
    --    perso = mêmes valeurs que la session source).
    INSERT INTO projet_session_membres (
      session_id, membre_id,
      presence_days, arrival_date, departure_date,
      statut, notes, legacy_session_id,
      created_at, updated_at
    ) VALUES (
      new_session_id,
      src.membre_id,
      src.presence_days,
      src.arrival_date,
      src.departure_date,
      src.statut,
      src.notes,
      src.source_id,
      src.created_at,
      src.updated_at
    );
  END LOOP;
END
$$;


-- ── 8. Reload PostgREST pour exposer les nouvelles tables ──────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
--
-- 1. Vérification rapide :
--
--    -- Combien de sessions globales par projet ?
--    SELECT project_id, COUNT(*) AS sessions_count
--    FROM projet_sessions
--    GROUP BY project_id
--    ORDER BY sessions_count DESC;
--
--    -- Combien de participations par membre ?
--    SELECT membre_id, COUNT(*) AS participations_count
--    FROM projet_session_membres
--    GROUP BY membre_id
--    ORDER BY participations_count DESC;
--
--    -- Toutes les rows source ont-elles été migrées ?
--    SELECT COUNT(*) AS unmigrated
--    FROM projet_membres_sessions s
--    WHERE NOT EXISTS (
--      SELECT 1 FROM projet_session_membres psm
--      WHERE psm.legacy_session_id = s.id
--    );
--    -- Doit donner 0.
--
--    -- Échantillon de correspondance source → migré
--    SELECT
--      s.id          AS source_id,
--      s.label,
--      s.arrival_date, s.departure_date,
--      ps.id         AS migrated_session_id,
--      psm.id        AS participation_id,
--      psm.arrival_date AS p_arr,
--      psm.departure_date AS p_dep
--    FROM projet_membres_sessions s
--    JOIN projet_session_membres psm ON psm.legacy_session_id = s.id
--    JOIN projet_sessions ps ON ps.id = psm.session_id
--    LIMIT 10;
--
-- 2. ⚠️ Phase A/1 — l'ancienne table `projet_membres_sessions` reste
--    en place et continue d'être lue par le front (rien ne change
--    visuellement). Phase A/2 fera basculer useCrew sur les nouvelles
--    tables. Phase A/3 implémentera la vraie fusion (boutons "+
--    Template" qui rejoignent au lieu de dupliquer). À la fin on
--    pourra DROP TABLE projet_membres_sessions.
--
-- 3. Rollback : DROP TABLE projet_session_membres ; DROP TABLE
--    projet_sessions ; — l'ancienne table reste intacte et le front
--    continue à fonctionner comme avant.
-- ============================================================================
