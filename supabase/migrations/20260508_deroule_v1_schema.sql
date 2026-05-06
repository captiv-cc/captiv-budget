-- ============================================================================
-- Migration : DÉROULÉ V1 — Schéma initial (planning tournage par journée)
-- Date      : 2026-05-08
-- Contexte  : Nouveau chantier "Déroulé jour" (rundown / call sheet) — tab
--             dédiée pour gérer le déroulé temporel d'une journée de tournage
--             (qui fait quoi à quelle heure, sur quelle équipe, à quel
--             endroit). Cf. CHANTIER_DEROULE.md pour la roadmap complète.
--
-- Décisions tranchées avec Hugo (2026-05-08) :
--   - Multi-lane jusqu'à 5 équipes parallèles (lane 0 "Global" toujours
--     présente, lanes 1-4 nommables "Équipe A/B/C/D" par défaut)
--   - Granularité 5min stockée / 15min affichée (Alt pendant drag pour 5min)
--   - Blocs multi-lane possibles (span sur plusieurs lanes simultanément)
--   - canEdit projet = tous (prestataires inclus)
--   - Partage public via lien (V2) + intégration sous-page portail (V2)
--
-- Effet :
--   1. INSERT 'deroule' dans outils_catalogue (sort_order = 35, entre
--      planning et livrables — un déroulé est entre planning haut niveau
--      et exécution livrables)
--   2. CREATE 4 tables : projet_deroules, projet_deroule_lanes,
--      projet_deroule_creneaux, projet_deroule_creneau_membres
--   3. Indexes pour les lookups les plus fréquents
--   4. RLS scoped via can_read_outil/can_edit_outil('deroule')
--   5. Triggers : updated_at + auto sort_order créneaux + cross-déroulé
--      check (lane_id appartient à la même conduite que le créneau)
--
-- Idempotent : Oui (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE,
--             ON CONFLICT DO NOTHING).
-- Réversible : DROP TABLE projet_deroule_creneau_membres,
--             projet_deroule_creneaux, projet_deroule_lanes,
--             projet_deroules CASCADE ; DELETE FROM outils_catalogue
--             WHERE key = 'deroule'.
-- ============================================================================

BEGIN;


-- ── 1. Ajout 'deroule' au catalogue d'outils ────────────────────────────────
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'deroule',
  'Déroulé',
  'Planning détaillé par journée de tournage en créneaux horaires (rundown), multi-équipes parallèles, partage public et call sheets',
  'Clock',
  35
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. projet_deroules — 1 row par jour de tournage ─────────────────────────
-- L'entité racine : une conduite/déroulé pour une date donnée d'un projet.
-- L'admin crée un déroulé jour par jour, configure ses bornes et sa
-- granularité, puis y empile des lanes et des créneaux.
CREATE TABLE IF NOT EXISTS projet_deroules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Date de la journée concernée. UNIQUE (project_id, date_jour) garantit
  -- qu'on a au plus un déroulé par jour par projet.
  date_jour DATE NOT NULL,

  -- Titre libre. Default suggéré côté front : "J{N} — {titre projet}" ou
  -- "Tournage live ZLAN" ou date formatée si rien d'autre.
  titre TEXT,

  -- Granularité réelle stockée (5min) ; le snap visuel est sur
  -- display_step_min (15min). Permet à l'utilisateur d'avoir 09:07 sans
  -- pour autant polluer la grille avec une graduation toutes les 5min.
  granularite_min INTEGER NOT NULL DEFAULT 5
    CHECK (granularite_min IN (1, 5, 10, 15, 30)),
  display_step_min INTEGER NOT NULL DEFAULT 15
    CHECK (display_step_min IN (5, 10, 15, 30, 60)),

  -- Bornes affichage timeline. Configurables par jour (live nuit
  -- 20h-04h doit pouvoir descendre à minuit, tournage matin court
  -- peut s'arrêter à 18h).
  heure_debut TIME NOT NULL DEFAULT '06:00',
  heure_fin   TIME NOT NULL DEFAULT '23:00',

  -- Statut administratif global du déroulé. 'planifie' = en cours d'écriture,
  -- 'valide' = validé par le DP/coord (incrémente revision), 'verrouille'
  -- = pas d'édition possible (V3+ pour mode régie live).
  statut TEXT NOT NULL DEFAULT 'planifie'
    CHECK (statut IN ('planifie', 'valide', 'verrouille')),

  -- Briefing global du jour, affiché en tête du déroulé partagé.
  notes TEXT,

  -- Compteur de versions. Incrémenté à chaque transition statut -> 'valide'
  -- (V4 : utilisé pour traçabilité call sheet "version envoyée à 18h32").
  revision INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT projet_deroules_heures_check CHECK (heure_fin > heure_debut),
  UNIQUE (project_id, date_jour)
);


-- ── 3. projet_deroule_lanes — lanes verticales d'un déroulé ────────────────
-- Modélise les colonnes parallèles de la timeline. Lane 0 = "Global",
-- toujours présente, sert pour les créneaux toute l'équipe (camion,
-- repas, briefing). Lanes 1-4 = équipes parallèles, nommables par admin
-- (default "Équipe A/B/C/D"). Max 5 lanes total (0 + 1..4).
CREATE TABLE IF NOT EXISTS projet_deroule_lanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  deroule_id UUID NOT NULL REFERENCES projet_deroules(id) ON DELETE CASCADE,

  -- 0 = Global (non supprimable côté UI), 1..4 = équipes parallèles.
  -- UNIQUE (deroule_id, sort_order) assure l'absence de doublons.
  sort_order INTEGER NOT NULL DEFAULT 0
    CHECK (sort_order >= 0 AND sort_order <= 4),

  -- Libellé éditable. Default front : "Global" pour 0, "Équipe A/B/C/D"
  -- pour 1-4. L'admin peut personnaliser ("Équipe Cadre", "Régie son").
  libelle TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (deroule_id, sort_order)
);


-- ── 4. projet_deroule_creneaux — 1 row par bloc temporel ────────────────────
-- Un créneau a une heure début/fin, un type (install/repas/prise/etc),
-- une couleur (auto-dérivée du type ou override admin), et appartient
-- soit à une lane unique (mode mono-lane, défaut), soit span sur toutes
-- les lanes (mode multi_lane=true, ex: "Pause repas toute l'équipe").
CREATE TABLE IF NOT EXISTS projet_deroule_creneaux (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  deroule_id UUID NOT NULL REFERENCES projet_deroules(id) ON DELETE CASCADE,

  -- Horaires. Stockés en TIME (HH:MM:SS) plutôt qu'en interval ou minutes
  -- pour rester lisibles en SQL et compatibles avec les outils admin.
  -- Le check empêche les créneaux à durée nulle ou inversés.
  heure_debut TIME NOT NULL,
  heure_fin   TIME NOT NULL,

  -- Lane assignée en mode mono-lane. NULL si multi_lane=true (le créneau
  -- s'affiche alors sur toute la largeur, en surimpression des autres
  -- lanes pendant sa durée).
  lane_id UUID REFERENCES projet_deroule_lanes(id) ON DELETE SET NULL,

  -- Toggle multi-lane. Si true, ignore lane_id et le créneau couvre
  -- toutes les lanes du déroulé (pause repas, briefing collectif, live).
  multi_lane BOOLEAN NOT NULL DEFAULT FALSE,

  titre TEXT NOT NULL,
  description TEXT,

  -- Type sémantique du créneau. Détermine l'icône et la couleur par
  -- défaut côté UI. Enum fermé V1, extensible plus tard si besoin réel.
  type TEXT NOT NULL DEFAULT 'autre'
    CHECK (type IN ('install', 'repas', 'prise', 'pause', 'transport',
                    'brief', 'live', 'autre')),

  -- Override couleur (hex sans #). NULL = couleur dérivée du type côté UI.
  couleur TEXT,

  -- Lieu : double mode comme pour les sessions (cf. projet_sessions).
  -- lieu_text = texte libre rapide ("Studio principal", "Régie 2").
  -- lieu_id = FK future vers logistique_lieux (V2 logistique).
  lieu_text TEXT,
  lieu_id UUID,

  -- Statut opérationnel pour mode régie live (V3). 'planifie' = défaut,
  -- 'en_cours' = animé/highlight, 'fait' = check + barré.
  statut TEXT NOT NULL DEFAULT 'planifie'
    CHECK (statut IN ('planifie', 'en_cours', 'fait', 'annule')),

  notes TEXT,

  -- Pour ordre stable quand 2 créneaux ont la même heure_debut sur la
  -- même lane (rare mais possible pendant un drag-drop). Auto-set par
  -- trigger BEFORE INSERT à MAX+1 si NULL.
  sort_order INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT projet_deroule_creneaux_horaires_check
    CHECK (heure_fin > heure_debut),

  -- Contrainte logique : si multi_lane=false, lane_id doit être set.
  -- Si multi_lane=true, lane_id doit être NULL (cohérence sémantique).
  CONSTRAINT projet_deroule_creneaux_lane_consistency_check
    CHECK (
      (multi_lane = FALSE AND lane_id IS NOT NULL)
      OR
      (multi_lane = TRUE AND lane_id IS NULL)
    )
);


-- ── 5. projet_deroule_creneau_membres — assignations N-N ────────────────────
-- Un membre peut être assigné à 0..N créneaux du déroulé, et un créneau
-- peut avoir 0..N membres assignés. Le rôle (optionnel) précise si le
-- membre a un rôle spécifique sur ce créneau ("Cadreur 1", "Régie son").
CREATE TABLE IF NOT EXISTS projet_deroule_creneau_membres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  creneau_id UUID NOT NULL
    REFERENCES projet_deroule_creneaux(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL
    REFERENCES projet_membres(id) ON DELETE CASCADE,

  -- Rôle libre, optionnel. Si vide, le membre est juste "présent sur ce
  -- créneau" sans précision particulière.
  role TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (creneau_id, membre_id)
);


-- ── 6. Indexes ──────────────────────────────────────────────────────────────
-- Lookup le plus fréquent : "tous les déroulés d'un projet". Couvre aussi
-- la query "déroulé d'un projet à une date donnée" via UNIQUE composite.
CREATE INDEX IF NOT EXISTS idx_projet_deroules_project
  ON projet_deroules(project_id);

-- "Toutes les lanes d'un déroulé" — query systématique au load.
CREATE INDEX IF NOT EXISTS idx_projet_deroule_lanes_deroule
  ON projet_deroule_lanes(deroule_id, sort_order);

-- "Tous les créneaux d'un déroulé" — query systématique au load.
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneaux_deroule
  ON projet_deroule_creneaux(deroule_id, heure_debut);

-- "Tous les créneaux d'une lane" — utile pour le rendu colonne par colonne
-- et le drag-drop.
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneaux_lane
  ON projet_deroule_creneaux(lane_id) WHERE lane_id IS NOT NULL;

-- "Tous les créneaux d'un membre" — utile pour la vue par membre future
-- et le détection d'overlap cross-créneaux.
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneau_membres_membre
  ON projet_deroule_creneau_membres(membre_id);

-- "Tous les membres d'un créneau" — query systématique au render.
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneau_membres_creneau
  ON projet_deroule_creneau_membres(creneau_id);


-- ── 7. RLS — projet_deroules ────────────────────────────────────────────────
-- Pattern aligné sur projet_sessions (Phase A) : read via can_read_outil,
-- write via can_edit_outil, clé outil = 'deroule'.
ALTER TABLE projet_deroules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_deroules_read"   ON projet_deroules;
DROP POLICY IF EXISTS "projet_deroules_insert" ON projet_deroules;
DROP POLICY IF EXISTS "projet_deroules_update" ON projet_deroules;
DROP POLICY IF EXISTS "projet_deroules_delete" ON projet_deroules;

CREATE POLICY "projet_deroules_read" ON projet_deroules
  FOR SELECT USING (can_read_outil(project_id, 'deroule'));

CREATE POLICY "projet_deroules_insert" ON projet_deroules
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'deroule'));

CREATE POLICY "projet_deroules_update" ON projet_deroules
  FOR UPDATE
  USING (can_edit_outil(project_id, 'deroule'))
  WITH CHECK (can_edit_outil(project_id, 'deroule'));

CREATE POLICY "projet_deroules_delete" ON projet_deroules
  FOR DELETE USING (can_edit_outil(project_id, 'deroule'));


-- ── 8. RLS — projet_deroule_lanes (héritée via deroule→projet) ─────────────
ALTER TABLE projet_deroule_lanes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_deroule_lanes_read"   ON projet_deroule_lanes;
DROP POLICY IF EXISTS "projet_deroule_lanes_insert" ON projet_deroule_lanes;
DROP POLICY IF EXISTS "projet_deroule_lanes_update" ON projet_deroule_lanes;
DROP POLICY IF EXISTS "projet_deroule_lanes_delete" ON projet_deroule_lanes;

CREATE POLICY "projet_deroule_lanes_read" ON projet_deroule_lanes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_lanes.deroule_id
        AND can_read_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_lanes_insert" ON projet_deroule_lanes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_lanes.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_lanes_update" ON projet_deroule_lanes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_lanes.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_lanes.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_lanes_delete" ON projet_deroule_lanes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_lanes.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );


-- ── 9. RLS — projet_deroule_creneaux ────────────────────────────────────────
ALTER TABLE projet_deroule_creneaux ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_deroule_creneaux_read"   ON projet_deroule_creneaux;
DROP POLICY IF EXISTS "projet_deroule_creneaux_insert" ON projet_deroule_creneaux;
DROP POLICY IF EXISTS "projet_deroule_creneaux_update" ON projet_deroule_creneaux;
DROP POLICY IF EXISTS "projet_deroule_creneaux_delete" ON projet_deroule_creneaux;

CREATE POLICY "projet_deroule_creneaux_read" ON projet_deroule_creneaux
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_creneaux.deroule_id
        AND can_read_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneaux_insert" ON projet_deroule_creneaux
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_creneaux.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneaux_update" ON projet_deroule_creneaux
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_creneaux.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_creneaux.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneaux_delete" ON projet_deroule_creneaux
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_deroules d
      WHERE d.id = projet_deroule_creneaux.deroule_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );


-- ── 10. RLS — projet_deroule_creneau_membres ────────────────────────────────
ALTER TABLE projet_deroule_creneau_membres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_deroule_creneau_membres_read"
  ON projet_deroule_creneau_membres;
DROP POLICY IF EXISTS "projet_deroule_creneau_membres_insert"
  ON projet_deroule_creneau_membres;
DROP POLICY IF EXISTS "projet_deroule_creneau_membres_update"
  ON projet_deroule_creneau_membres;
DROP POLICY IF EXISTS "projet_deroule_creneau_membres_delete"
  ON projet_deroule_creneau_membres;

CREATE POLICY "projet_deroule_creneau_membres_read"
  ON projet_deroule_creneau_membres
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE c.id = projet_deroule_creneau_membres.creneau_id
        AND can_read_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneau_membres_insert"
  ON projet_deroule_creneau_membres
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE c.id = projet_deroule_creneau_membres.creneau_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneau_membres_update"
  ON projet_deroule_creneau_membres
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE c.id = projet_deroule_creneau_membres.creneau_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE c.id = projet_deroule_creneau_membres.creneau_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );

CREATE POLICY "projet_deroule_creneau_membres_delete"
  ON projet_deroule_creneau_membres
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE c.id = projet_deroule_creneau_membres.creneau_id
        AND can_edit_outil(d.project_id, 'deroule')
    )
  );


-- ── 11. Triggers updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION projet_deroules_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_deroules_touch_updated_at ON projet_deroules;
CREATE TRIGGER trg_projet_deroules_touch_updated_at
  BEFORE UPDATE ON projet_deroules
  FOR EACH ROW EXECUTE FUNCTION projet_deroules_touch_updated_at();

DROP TRIGGER IF EXISTS trg_projet_deroule_lanes_touch_updated_at
  ON projet_deroule_lanes;
CREATE TRIGGER trg_projet_deroule_lanes_touch_updated_at
  BEFORE UPDATE ON projet_deroule_lanes
  FOR EACH ROW EXECUTE FUNCTION projet_deroules_touch_updated_at();

DROP TRIGGER IF EXISTS trg_projet_deroule_creneaux_touch_updated_at
  ON projet_deroule_creneaux;
CREATE TRIGGER trg_projet_deroule_creneaux_touch_updated_at
  BEFORE UPDATE ON projet_deroule_creneaux
  FOR EACH ROW EXECUTE FUNCTION projet_deroules_touch_updated_at();


-- ── 12. Trigger auto sort_order créneaux ────────────────────────────────────
-- Pattern Phase A : si NEW.sort_order IS NULL ou 0, on l'auto-set à
-- MAX(sort_order)+1 dans le scope (deroule_id) — atomique en BEFORE INSERT.
-- Permet au front d'envoyer juste les champs métier sans gérer l'ordre.
CREATE OR REPLACE FUNCTION projet_deroule_creneaux_auto_sort_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sort_order IS NULL OR NEW.sort_order = 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1
      INTO NEW.sort_order
      FROM projet_deroule_creneaux
     WHERE deroule_id = NEW.deroule_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_deroule_creneaux_auto_sort_order
  ON projet_deroule_creneaux;
CREATE TRIGGER trg_projet_deroule_creneaux_auto_sort_order
  BEFORE INSERT ON projet_deroule_creneaux
  FOR EACH ROW EXECUTE FUNCTION projet_deroule_creneaux_auto_sort_order();


-- ── 13. Trigger cross-déroulé check ─────────────────────────────────────────
-- Empêche un créneau de pointer vers une lane qui appartient à un AUTRE
-- déroulé. Sécurité de cohérence : sans ça, une requête API directe (ou
-- un bug front) pourrait créer un état incohérent.
CREATE OR REPLACE FUNCTION projet_deroule_creneaux_check_lane_deroule()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_lane_deroule_id UUID;
BEGIN
  -- Skip check si pas de lane (mode multi_lane)
  IF NEW.lane_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT deroule_id INTO v_lane_deroule_id
    FROM projet_deroule_lanes
   WHERE id = NEW.lane_id;

  IF v_lane_deroule_id IS NULL THEN
    RAISE EXCEPTION 'Lane % introuvable', NEW.lane_id
      USING ERRCODE = '23503';
  END IF;

  IF v_lane_deroule_id != NEW.deroule_id THEN
    RAISE EXCEPTION 'La lane % appartient au déroulé %, pas à %',
      NEW.lane_id, v_lane_deroule_id, NEW.deroule_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_deroule_creneaux_check_lane_ins
  ON projet_deroule_creneaux;
CREATE TRIGGER trg_projet_deroule_creneaux_check_lane_ins
  BEFORE INSERT ON projet_deroule_creneaux
  FOR EACH ROW EXECUTE FUNCTION projet_deroule_creneaux_check_lane_deroule();

DROP TRIGGER IF EXISTS trg_projet_deroule_creneaux_check_lane_upd
  ON projet_deroule_creneaux;
CREATE TRIGGER trg_projet_deroule_creneaux_check_lane_upd
  BEFORE UPDATE OF lane_id, deroule_id ON projet_deroule_creneaux
  FOR EACH ROW EXECUTE FUNCTION projet_deroule_creneaux_check_lane_deroule();


-- ── 14. Realtime ────────────────────────────────────────────────────────────
-- Activer Realtime sur les 4 tables pour collaboration multi-utilisateurs
-- (cohérent avec equipe/materiel/livrables). Le filtre côté client se fait
-- sur project_id (déroulés) ou via JOIN (lanes/creneaux/membres).
ALTER PUBLICATION supabase_realtime ADD TABLE projet_deroules;
ALTER PUBLICATION supabase_realtime ADD TABLE projet_deroule_lanes;
ALTER PUBLICATION supabase_realtime ADD TABLE projet_deroule_creneaux;
ALTER PUBLICATION supabase_realtime ADD TABLE projet_deroule_creneau_membres;


NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifs post-deploy :
--
-- 1. Trigger auto sort_order :
--    INSERT INTO projet_deroule_creneaux (deroule_id, heure_debut, heure_fin,
--      lane_id, multi_lane, titre)
--    VALUES ('<deroule>', '09:00', '10:00', '<lane>', false, 'Test')
--    RETURNING sort_order;
--    -- doit retourner sort_order = MAX+1 (ou 1 si premier)
--
-- 2. Cross-déroulé check :
--    INSERT INTO projet_deroule_creneaux (deroule_id, heure_debut, heure_fin,
--      lane_id, multi_lane, titre)
--    VALUES ('<deroule_A>', '09:00', '10:00', '<lane_de_deroule_B>', false, 'X');
--    -- doit raise '23514' "La lane X appartient au déroulé B, pas à A"
--
-- 3. Lane consistency check :
--    INSERT INTO projet_deroule_creneaux (deroule_id, heure_debut, heure_fin,
--      lane_id, multi_lane, titre)
--    VALUES ('<deroule>', '09:00', '10:00', '<lane>', true, 'X');
--    -- doit raise CHECK constraint (multi_lane=true mais lane_id set)
--
-- 4. RLS : un user sans can_read_outil('deroule') sur ce projet ne doit
--    rien voir via SELECT * FROM projet_deroules.
-- ============================================================================
