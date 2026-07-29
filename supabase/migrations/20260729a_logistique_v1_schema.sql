-- ════════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE V1 — P1 : modèle structuré (trajets, repas, nuits, hébergements)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Refonte de l'outil Logistique & VHR (plan validé Hugo 2026-07-29).
-- Principe : la logistique ne ressaisit JAMAIS les dates — les présences et
-- arrivées/départs restent dans l'Équipe (projet_session_membres) ; ces
-- tables ajoutent les couches transport / repas / nuits / hébergements.
--
--   1. projet_logistique_hebergements        — lieux d'hébergement du projet
--   2. projet_logistique_hebergement_membres — infos par personne (chambre,
--                                              pdj, check-in/out overrides)
--   3. projet_logistique_trajets             — déplacements par membre, à
--                                              N étapes ordonnées (jsonb)
--   4. projet_logistique_repas               — 1 row = 1 repas pris en charge
--                                              (client/production/defraye) ;
--                                              absence de row = « — »
--   5. projet_logistique_nuits               — 1 row = 1 nuit (membre, date),
--                                              rattachée à un hébergement
--
-- project_id DÉNORMALISÉ partout (pattern matos) : RLS directes + filtre
-- realtime sans jointure. RLS = clé outil 'logistique_v0' (les permissions
-- de l'onglet existant s'appliquent telles quelles).
--
-- La V0 (textes libres + docs) N'EST PAS supprimée : migrée en P2.
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Hébergements du projet ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_logistique_hebergements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  -- Type libre : "Hôtel", "Apart'hôtel", "Airbnb", "Camping"… pas d'enum.
  type TEXT,
  adresse TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logi_hebergements_project
  ON projet_logistique_hebergements(project_id, sort_order);


-- ── 2. Infos hébergement PAR PERSONNE ───────────────────────────────────────
-- chambre / petit-déj / overrides de check-in/out. Les check-in/out par
-- défaut sont CALCULÉS depuis les nuits cochées (table 5) — les overrides
-- ne servent qu'aux cas particuliers (arrivée tardive, late checkout…).
CREATE TABLE IF NOT EXISTS projet_logistique_hebergement_membres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hebergement_id UUID NOT NULL
    REFERENCES projet_logistique_hebergements(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,
  chambre TEXT,
  pdj BOOLEAN NOT NULL DEFAULT FALSE,
  checkin_override DATE,
  checkout_override DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hebergement_id, membre_id)
);

CREATE INDEX IF NOT EXISTS idx_logi_heb_membres_project
  ON projet_logistique_hebergement_membres(project_id);
CREATE INDEX IF NOT EXISTS idx_logi_heb_membres_membre
  ON projet_logistique_hebergement_membres(membre_id);


-- ── 3. Trajets (déplacements à étapes) ──────────────────────────────────────
-- Un trajet = un déplacement (aller / retour / autre) daté, composé de N
-- étapes ordonnées en jsonb :
--   etapes: [{ mode, heure, depart, arrivee, note }]
--     mode  : 'train'|'voiture'|'minibus'|'avion'|'autre' (libre côté front)
--     heure : "10:42" (TEXT, souplesse formats comme arrival_time Équipe)
--     note  : n° de train, conducteur, point de RDV…
-- Pas de table dédiée : les étapes n'ont ni FK ni existence propre.
-- Le coût est GLOBAL au trajet (décision Hugo) — jamais montré aux partages.
CREATE TABLE IF NOT EXISTS projet_logistique_trajets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,
  sens TEXT NOT NULL DEFAULT 'aller' CHECK (sens IN ('aller', 'retour', 'autre')),
  date_trajet DATE,
  etapes JSONB NOT NULL DEFAULT '[]'::jsonb,
  cout NUMERIC,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logi_trajets_project
  ON projet_logistique_trajets(project_id, date_trajet);
CREATE INDEX IF NOT EXISTS idx_logi_trajets_membre
  ON projet_logistique_trajets(membre_id, sort_order);


-- ── 4. Repas ────────────────────────────────────────────────────────────────
-- 1 row = 1 repas PRIS EN CHARGE pour (membre, date, service). L'absence de
-- row = « — » (pas de repas géré). 4e état implicite → pas de statut 'none'.
CREATE TABLE IF NOT EXISTS projet_logistique_repas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,
  date_repas DATE NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('midi', 'soir')),
  statut TEXT NOT NULL CHECK (statut IN ('client', 'production', 'defraye')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membre_id, date_repas, service)
);

CREATE INDEX IF NOT EXISTS idx_logi_repas_project
  ON projet_logistique_repas(project_id, date_repas);


-- ── 5. Nuits ────────────────────────────────────────────────────────────────
-- 1 row = 1 nuit cochée (membre, date de la nuit = date du soir). Une
-- personne ne dort qu'à un endroit par nuit → UNIQUE(membre_id, date_nuit).
-- hebergement_id nullable : nuit cochée avant d'avoir choisi l'hébergement.
CREATE TABLE IF NOT EXISTS projet_logistique_nuits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,
  date_nuit DATE NOT NULL,
  hebergement_id UUID
    REFERENCES projet_logistique_hebergements(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membre_id, date_nuit)
);

CREATE INDEX IF NOT EXISTS idx_logi_nuits_project
  ON projet_logistique_nuits(project_id, date_nuit);
CREATE INDEX IF NOT EXISTS idx_logi_nuits_hebergement
  ON projet_logistique_nuits(hebergement_id);


-- ── 6. updated_at triggers (réutilise set_updated_at() existant) ────────────
DROP TRIGGER IF EXISTS trg_logi_hebergements_updated ON projet_logistique_hebergements;
CREATE TRIGGER trg_logi_hebergements_updated
  BEFORE UPDATE ON projet_logistique_hebergements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_logi_heb_membres_updated ON projet_logistique_hebergement_membres;
CREATE TRIGGER trg_logi_heb_membres_updated
  BEFORE UPDATE ON projet_logistique_hebergement_membres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_logi_trajets_updated ON projet_logistique_trajets;
CREATE TRIGGER trg_logi_trajets_updated
  BEFORE UPDATE ON projet_logistique_trajets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 7. RLS — clé outil 'logistique_v0' (permissions de l'onglet inchangées) ─
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projet_logistique_hebergements',
    'projet_logistique_hebergement_membres',
    'projet_logistique_trajets',
    'projet_logistique_repas',
    'projet_logistique_nuits'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_read" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_read" ON %I FOR SELECT USING (can_read_outil(project_id, ''logistique_v0''))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (can_edit_outil(project_id, ''logistique_v0''))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %I FOR UPDATE USING (can_edit_outil(project_id, ''logistique_v0'')) WITH CHECK (can_edit_outil(project_id, ''logistique_v0''))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %I FOR DELETE USING (can_edit_outil(project_id, ''logistique_v0''))',
      t, t);
  END LOOP;
END $$;


-- ── 8. Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE projet_logistique_repas;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE projet_logistique_nuits;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE projet_logistique_trajets;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;


-- ── Vérifications post-migration ────────────────────────────────────────────
-- 1. SELECT COUNT(*) FROM projet_logistique_repas;      -- 0, pas d'erreur
-- 2. INSERT test (en tant que membre du projet) puis DELETE.
-- 3. SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename LIKE 'projet_logistique%';
