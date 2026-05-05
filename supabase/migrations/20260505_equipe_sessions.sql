-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Phase 0a (LOGISTIQUE V1)
-- Date      : 2026-05-05
-- Contexte  : Préparer le futur module Logistique en introduisant la notion
--             de "session" (= séjour cohérent d'un membre sur un projet).
--             Permet de gérer les cas multi-séjours : ex. essais à Paris
--             puis tournage à Mtp, ou tournage découpé en plusieurs phases.
--
-- Approche  : MIGRATION ADDITIVE NON-BREAKING.
--             - Nouvelle table `projet_membres_sessions` créée.
--             - Seed auto : 1 session par membre existant, héritée de ses
--               arrival_date / departure_date / presence_days actuels.
--             - `projet_membres` reste source de vérité POUR L'INSTANT.
--             - La bascule (sessions = source de vérité) viendra en Phase 0b
--               quand on adaptera l'UI Équipe.
--
-- Cohérence : la table `projet_membres_sessions` hérite ses droits via
--             projet_membres → can_read_outil('equipe', project_id) /
--             can_edit_outil. Pas de duplication de logique RLS.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, INSERT WHERE NOT EXISTS pour
-- le seed, DROP POLICY IF EXISTS avant CREATE.
-- ============================================================================

BEGIN;

-- ── 1. Nouvelle table projet_membres_sessions ───────────────────────────────
-- Une session = un séjour cohérent (plage + lieu) d'un membre sur un projet.
-- Cas standard : 1 session par membre. Cas avancé : 2-3+ sessions quand le
-- projet a des phases distinctes (essais/installation/tournage…).
CREATE TABLE IF NOT EXISTS projet_membres_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien vers le membre du projet. CASCADE car une session sans membre
  -- n'a pas de sens — si on supprime un membre, ses sessions partent.
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,

  -- Ordre d'affichage. 1 = première session (chronologiquement la plus
  -- ancienne par défaut, mais l'admin peut réordonner manuellement si
  -- les dates ne suffisent pas à exprimer son intention).
  sort_order INTEGER NOT NULL DEFAULT 1,

  -- Label libre. Exemples métier : "Essais", "Installation", "Tournage",
  -- "Préparation Paris", "Post-tournage Lyon". Si vide, le front affiche
  -- "Session N" en fallback (auto via sort_order).
  label TEXT,

  -- Plage de dates de cette session.
  -- arrival_date : jour où le membre arrive sur le séjour (peut être le
  -- même que le 1er jour de présence ou la veille s'il y a transit).
  -- departure_date : jour où il repart (idem, peut être après le dernier
  -- jour de présence si retour J+1).
  arrival_date DATE,
  departure_date DATE,

  -- Jours de présence effective sur cette session (array ISO YYYY-MM-DD).
  -- Subset de la plage [arrival_date, departure_date] mais peut avoir
  -- des trous (ex. jour off au milieu).
  presence_days TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Lieu principal de la session. DOUBLE MODE :
  --   • Texte libre rapide : "Paris", "Mtp", "Studio Bastille"
  --   • Lien optionnel vers un logistique_lieux (FK ajouté plus tard,
  --     pas encore créé en Phase 0a). On crée la colonne dès maintenant
  --     pour éviter une 2e ALTER TABLE.
  lieu_principal_text TEXT,
  lieu_principal_id UUID,  -- FK vers logistique_lieux ajoutée en Phase 0c

  -- Couleur d'identification (pour color-code la grille présence et les
  -- chips dans la crew list). Auto-attribuée depuis une palette si vide.
  -- Hex sans #, ex: 'A78BFA'.
  couleur TEXT,

  -- Statut administratif. Permet à l'admin de tracker une session
  -- planifiée mais pas encore confirmée (ex. en attente de réponse
  -- du prestataire).
  statut TEXT NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie', 'confirme', 'annule')),

  -- Notes libres (transport spécial, contraintes, contacts urgence).
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Contrainte : pas 2 sessions au même sort_order chez le même membre.
  -- Permet le drag & drop sans collisions.
  UNIQUE (membre_id, sort_order)
);


-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- Lookup par membre (cas le plus fréquent : "donne-moi les sessions d'Hugo")
CREATE INDEX IF NOT EXISTS idx_projet_membres_sessions_membre
  ON projet_membres_sessions(membre_id, sort_order);

-- Lookup par plage (cas régie : "qui est en session active aujourd'hui ?")
-- via une jointure sur membre_id → project_id. Index sur les dates pour
-- accélérer les ranges.
CREATE INDEX IF NOT EXISTS idx_projet_membres_sessions_dates
  ON projet_membres_sessions(arrival_date, departure_date);


-- ── 3. RLS — héritée du membre (donc du projet, donc de l'outil 'equipe') ──
ALTER TABLE projet_membres_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_membres_sessions_read"   ON projet_membres_sessions;
DROP POLICY IF EXISTS "projet_membres_sessions_insert" ON projet_membres_sessions;
DROP POLICY IF EXISTS "projet_membres_sessions_update" ON projet_membres_sessions;
DROP POLICY IF EXISTS "projet_membres_sessions_delete" ON projet_membres_sessions;

-- 3.1 — SELECT : peut lire les sessions des membres dont on peut lire le
-- projet_membres (= can_read_outil('equipe') sur le project_id du membre).
CREATE POLICY "projet_membres_sessions_read" ON projet_membres_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projet_membres pm
      WHERE pm.id = projet_membres_sessions.membre_id
        AND can_read_outil(pm.project_id, 'equipe')
    )
  );

-- 3.2 — INSERT : edit sur 'equipe' du projet du membre.
CREATE POLICY "projet_membres_sessions_insert" ON projet_membres_sessions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_membres pm
      WHERE pm.id = projet_membres_sessions.membre_id
        AND can_edit_outil(pm.project_id, 'equipe')
    )
  );

-- 3.3 — UPDATE : edit sur 'equipe' avant ET après l'update (le membre
-- ne peut pas être déplacé vers un autre projet où on n'a pas les droits).
CREATE POLICY "projet_membres_sessions_update" ON projet_membres_sessions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_membres pm
      WHERE pm.id = projet_membres_sessions.membre_id
        AND can_edit_outil(pm.project_id, 'equipe')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_membres pm
      WHERE pm.id = projet_membres_sessions.membre_id
        AND can_edit_outil(pm.project_id, 'equipe')
    )
  );

-- 3.4 — DELETE : edit sur 'equipe'. Pas de garde admin spéciale (cohérent
-- avec projet_membres — si tu peux éditer la techlist tu peux supprimer).
CREATE POLICY "projet_membres_sessions_delete" ON projet_membres_sessions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projet_membres pm
      WHERE pm.id = projet_membres_sessions.membre_id
        AND can_edit_outil(pm.project_id, 'equipe')
    )
  );


-- ── 4. Trigger de cohérence updated_at ──────────────────────────────────────
-- Standard pratique : updated_at se met à jour auto à chaque UPDATE.
CREATE OR REPLACE FUNCTION projet_membres_sessions_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_membres_sessions_updated_at ON projet_membres_sessions;
CREATE TRIGGER trg_projet_membres_sessions_updated_at
  BEFORE UPDATE ON projet_membres_sessions
  FOR EACH ROW
  EXECUTE FUNCTION projet_membres_sessions_touch_updated_at();


-- ── 5. Seed automatique : 1 session par membre existant ────────────────────
-- Pour chaque projet_membres existant qui n'a pas encore de session, on
-- crée la session par défaut héritée de ses dates actuelles. Idempotent
-- via WHERE NOT EXISTS — on peut rejouer la migration sans dupliquer.
INSERT INTO projet_membres_sessions (
  membre_id,
  sort_order,
  label,
  arrival_date,
  departure_date,
  presence_days,
  statut
)
SELECT
  pm.id              AS membre_id,
  1                  AS sort_order,
  NULL               AS label,         -- "Session 1" implicite côté front
  pm.arrival_date    AS arrival_date,
  pm.departure_date  AS departure_date,
  COALESCE(pm.presence_days, '{}'::text[]) AS presence_days,
  'confirme'         AS statut         -- les membres existants sont confirmés
FROM projet_membres pm
WHERE NOT EXISTS (
  SELECT 1 FROM projet_membres_sessions s WHERE s.membre_id = pm.id
);


-- ── 6. Reload PostgREST pour exposer la nouvelle table ─────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
--
-- 1. Vérification : exécuter pour valider que tout s'est bien passé.
--
--    -- La table existe avec ses colonnes ?
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'projet_membres_sessions'
--    ORDER BY ordinal_position;
--
--    -- Le seed a bien créé 1 session par membre ?
--    SELECT
--      COUNT(*) FILTER (WHERE 1=1)                              AS total_membres,
--      COUNT(*) FILTER (WHERE s.id IS NOT NULL)                 AS membres_avec_session,
--      COUNT(*) FILTER (WHERE s.id IS NULL)                     AS membres_sans_session
--    FROM projet_membres pm
--    LEFT JOIN projet_membres_sessions s ON s.membre_id = pm.id;
--    -- Doit donner total_membres == membres_avec_session, 0 sans session.
--
--    -- Les sessions héritent bien des dates ?
--    SELECT
--      pm.id, pm.arrival_date, pm.departure_date, pm.presence_days,
--      s.arrival_date AS s_arr, s.departure_date AS s_dep, s.presence_days AS s_days
--    FROM projet_membres pm
--    JOIN projet_membres_sessions s ON s.membre_id = pm.id
--    LIMIT 5;
--    -- Toutes les colonnes "s_*" doivent matcher leurs équivalents "pm.*".
--
-- 2. ⚠️ Phase 0a uniquement — la source de vérité reste `projet_membres`
--    pour `arrival_date / departure_date / presence_days`. La nouvelle
--    table sessions est créée et seedée mais l'UI Équipe ne l'utilise
--    pas encore. La bascule viendra en Phase 0b (UI multi-sessions).
--
-- 3. Si on doit rollback : DROP TABLE projet_membres_sessions CASCADE.
--    Aucune dépendance encore en Phase 0a. Les colonnes
--    `lieu_principal_id` est en attente de FK vers `logistique_lieux`
--    qui sera ajoutée en Phase 0c.
-- ============================================================================
