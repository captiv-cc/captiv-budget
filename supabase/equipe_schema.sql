-- ─────────────────────────────────────────────────────────────────────────────
-- ÉQUIPE — CAPTIV BUDGET
-- À exécuter dans Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne is_crew sur devis_lines ────────────────────────────────────────
-- Permet d'identifier les lignes "humaines" indépendamment du régime
ALTER TABLE devis_lines ADD COLUMN IF NOT EXISTS is_crew boolean DEFAULT false;

-- Rétroactivement : marquer is_crew = true pour les régimes salariés existants
-- (à ajuster selon les valeurs de régime dans ta base)
UPDATE devis_lines
SET is_crew = true
WHERE regime IN ('Intermittent Technicien', 'Intermittent Artiste', 'Salarié CDD')
  AND is_crew = false;

-- ── 2. Table crew_members ────────────────────────────────────────────────────
-- Un enregistrement par (projet, rôle). La personne assignée à ce poste.
CREATE TABLE IF NOT EXISTS crew_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  crew_role   text NOT NULL,      -- = produit de la ligne devis (ex: "Chef Opérateur")
  interne     boolean DEFAULT false, -- poste interne (non facturé)

  -- Personne assignée (optionnel — peut rester vide le temps de la recherche)
  person_name text,
  email       text,
  phone       text,

  -- Suivi
  statut      text DEFAULT 'recherche' CHECK (statut IN (
                'recherche', 'contacte', 'confirme', 'signe', 'regle'
              )),
  notes       text,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Index pour accès rapide par projet
CREATE INDEX IF NOT EXISTS idx_crew_members_project ON crew_members(project_id);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;

-- Membres de l'org peuvent tout faire sur les crew de leurs projets
CREATE POLICY "org_crew_members" ON crew_members
  USING (
    project_id IN (
      SELECT id FROM projects WHERE org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE org_id = get_user_org_id()
    )
  );

-- ── 4. Trigger updated_at ─────────────────────────────────────────────────────
-- (si la fonction set_updated_at() existe déjà dans ta base)
-- CREATE TRIGGER crew_members_updated_at
--   BEFORE UPDATE ON crew_members
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
