-- ============================================================
-- MATRICE GOLDEN — Migration V2 : Schéma complet
-- À exécuter dans Supabase → SQL Editor → Run
-- Toutes les commandes sont idempotentes (IF NOT EXISTS / IF EXISTS)
-- ============================================================


-- ============================================================
-- 0. HELPERS
-- ============================================================

-- Fonction updated_at (si pas encore créée)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Macro pour attacher le trigger updated_at à une table
-- (on le réutilise pour chaque nouvelle table)


-- ============================================================
-- 1. MISE À JOUR — PROFILES (nouveaux rôles)
-- ============================================================

-- Supprimer l'ancienne contrainte de rôle
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Migrer les anciens rôles EN PREMIER (avant d'ajouter la nouvelle contrainte)
UPDATE profiles SET role = 'charge_prod'  WHERE role = 'editor';
UPDATE profiles SET role = 'coordinateur' WHERE role = 'viewer';
-- 'admin' reste 'admin', pas de changement nécessaire

-- Ajouter la nouvelle contrainte (les données sont déjà migrées)
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'admin',          -- Accès total
    'charge_prod',    -- Devis, équipe, planning, chiffres visibles
    'coordinateur',   -- Équipe + planning uniquement, aucun chiffre
    'prestataire'     -- Lecture seule de sa fiche + planning
  ));

-- Colonnes complémentaires sur profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS nom        TEXT,
  ADD COLUMN IF NOT EXISTS prenom     TEXT,
  ADD COLUMN IF NOT EXISTS email      TEXT,
  ADD COLUMN IF NOT EXISTS phone      TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS actif      BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();


-- ============================================================
-- 2. MISE À JOUR — PROJECTS
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type_projet   TEXT DEFAULT 'autre'
                           CHECK (type_projet IN (
                             'film_institutionnel','publicite','clip_musical',
                             'documentaire','court_metrage','long_metrage',
                             'reportage','emission_tv','captation_evenement',
                             'formation','autre'
                           )),
  ADD COLUMN IF NOT EXISTS drive_url     TEXT,
  ADD COLUMN IF NOT EXISTS chef_projet_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloture_notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- Mise à jour des valeurs de statut existantes
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
-- Migrer EN PREMIER, puis ajouter la contrainte
UPDATE projects SET status = 'archive' WHERE status = 'annule';
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check CHECK (status IN (
    'prospect', 'en_cours', 'termine', 'archive', 'annule'
  ));

-- Trigger updated_at sur projects
DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 3. MISE À JOUR — DEVIS_LINES
-- ============================================================

ALTER TABLE devis_lines
  ADD COLUMN IF NOT EXISTS cout_ht    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_crew    BOOLEAN DEFAULT false;

-- Rétroactivement marquer les lignes intermittents comme crew
UPDATE devis_lines
  SET is_crew = true
  WHERE regime IN ('Intermittent Technicien','Intermittent Artiste')
    AND is_crew = false;


-- ============================================================
-- 4. BDD CONTACTS (référentiel global des personnes)
-- ============================================================
-- Remplace et enrichit crew_members comme référentiel global.
-- Un contact peut apparaître dans plusieurs projets.

CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE NOT NULL,

  -- Identité
  nom             TEXT NOT NULL,
  prenom          TEXT NOT NULL,
  email           TEXT,
  telephone       TEXT,
  adresse         TEXT,

  -- Métier
  regime          TEXT DEFAULT 'Externe'
                  CHECK (regime IN (
                    'Intermittent Technicien','Intermittent Artiste',
                    'Interne','Externe','Technique','Frais'
                  )),
  specialite      TEXT,       -- Chef op, Monteur, Ingénieur son, Motion designer...
  tarif_jour_ref  NUMERIC(10,2),  -- Tarif de référence (pré-remplissage devis)

  -- Admin
  iban            TEXT,
  siret           TEXT,       -- Pour auto-entrepreneurs
  notes           TEXT,
  actif           BOOLEAN DEFAULT true,

  -- Lien compte utilisateur (si ce contact a accès à l'app)
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_regime ON contacts(regime);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contacts_org" ON contacts;
CREATE POLICY "contacts_org" ON contacts FOR ALL
  USING  (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 5. PROJET_MEMBRES
-- ============================================================
-- Personnes affectées à un projet spécifique.
-- Peut pointer vers un contact BDD (contact_id) ou être saisi à la volée.
-- Remplace conceptuellement crew_members (qu'on garde pour compatibilité).

CREATE TABLE IF NOT EXISTS projet_membres (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,  -- NULL si hors BDD

  -- Surcharge si hors BDD ou si différent du contact BDD
  nom                 TEXT,
  prenom              TEXT,
  email               TEXT,
  telephone           TEXT,

  -- Rôle sur ce projet spécifique
  regime              TEXT CHECK (regime IN (
                        'Intermittent Technicien','Intermittent Artiste',
                        'Interne','Externe','Technique','Frais'
                      )),
  specialite          TEXT,    -- Peut différer de la spécialité BDD
  tarif_jour          NUMERIC(10,2),

  -- Suivi MovinMotion (intermittents uniquement)
  movinmotion_statut  TEXT DEFAULT 'non_applicable'
                      CHECK (movinmotion_statut IN (
                        'non_applicable',    -- Pas un intermittent
                        'a_integrer',        -- À ajouter dans MovinMotion
                        'integre',           -- Intégré dans MovinMotion
                        'contrat_signe',     -- Contrat signé
                        'paie_en_cours',     -- Paie en cours
                        'paie_terminee'      -- Paie terminée ✓
                      )),

  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projet_membres_project ON projet_membres(project_id);
CREATE INDEX IF NOT EXISTS idx_projet_membres_contact ON projet_membres(contact_id);

ALTER TABLE projet_membres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projet_membres_org" ON projet_membres;
CREATE POLICY "projet_membres_org" ON projet_membres FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );

DROP TRIGGER IF EXISTS projet_membres_updated_at ON projet_membres;
CREATE TRIGGER projet_membres_updated_at
  BEFORE UPDATE ON projet_membres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 6. DEVIS_LIGNE_MEMBRES
-- ============================================================
-- Affectation d'un membre du projet à une ou plusieurs lignes du devis.
-- Ex : Jean Dupont (chef op) → ligne "Chef opérateur J1" + "Chef opérateur J2"

CREATE TABLE IF NOT EXISTS devis_ligne_membres (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devis_line_id     UUID REFERENCES devis_lines(id) ON DELETE CASCADE NOT NULL,
  projet_membre_id  UUID REFERENCES projet_membres(id) ON DELETE CASCADE NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(devis_line_id, projet_membre_id)
);

CREATE INDEX IF NOT EXISTS idx_dlm_line   ON devis_ligne_membres(devis_line_id);
CREATE INDEX IF NOT EXISTS idx_dlm_membre ON devis_ligne_membres(projet_membre_id);

ALTER TABLE devis_ligne_membres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dlm_org" ON devis_ligne_membres;
CREATE POLICY "dlm_org" ON devis_ligne_membres FOR ALL
  USING (
    devis_line_id IN (
      SELECT dl.id FROM devis_lines dl
      JOIN devis d ON dl.devis_id = d.id
      JOIN projects p ON d.project_id = p.id
      WHERE p.org_id = get_user_org_id()
    )
  );


-- ============================================================
-- 7. PLANNING — PHASES MACRO (RETROPLANNING)
-- ============================================================

CREATE TABLE IF NOT EXISTS planning_phases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,

  type        TEXT NOT NULL
              CHECK (type IN (
                'brief','pre_production','tournage','montage',
                'etalonnage','mixage','motion_design',
                'validation_client','livraison','autre'
              )),
  label       TEXT,        -- Label personnalisé (ex: "Montage rough cut")
  couleur     TEXT,        -- Couleur hex pour le Gantt

  date_debut  DATE,
  date_fin    DATE,
  statut      TEXT DEFAULT 'a_faire'
              CHECK (statut IN ('a_faire','en_cours','termine','bloque')),
  ordre       INTEGER DEFAULT 0,
  notes       TEXT,

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_phases_project ON planning_phases(project_id);

ALTER TABLE planning_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "planning_phases_org" ON planning_phases;
CREATE POLICY "planning_phases_org" ON planning_phases FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS planning_phases_updated_at ON planning_phases;
CREATE TRIGGER planning_phases_updated_at
  BEFORE UPDATE ON planning_phases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 8. PLANNING — TÂCHES (dans chaque phase)
-- ============================================================

CREATE TABLE IF NOT EXISTS planning_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  phase_id        UUID REFERENCES planning_phases(id) ON DELETE CASCADE NOT NULL,

  titre           TEXT NOT NULL,
  description     TEXT,
  date_echeance   DATE,
  responsable_id  UUID REFERENCES projet_membres(id) ON DELETE SET NULL,
  statut          TEXT DEFAULT 'a_faire'
                  CHECK (statut IN ('a_faire','en_cours','termine','bloque')),
  ordre           INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_items_project ON planning_items(project_id);
CREATE INDEX IF NOT EXISTS idx_planning_items_phase   ON planning_items(phase_id);

ALTER TABLE planning_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "planning_items_org" ON planning_items;
CREATE POLICY "planning_items_org" ON planning_items FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS planning_items_updated_at ON planning_items;
CREATE TRIGGER planning_items_updated_at
  BEFORE UPDATE ON planning_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 9. JOURS DE TOURNAGE
-- ============================================================

CREATE TABLE IF NOT EXISTS jours_tournage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  phase_id        UUID REFERENCES planning_phases(id) ON DELETE SET NULL,

  date_tournage   DATE NOT NULL,
  lieu            TEXT,
  sequences       TEXT,   -- Description des séquences / plan de travail du jour
  notes           TEXT,
  ordre           INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jours_tournage_project ON jours_tournage(project_id);

ALTER TABLE jours_tournage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jours_tournage_org" ON jours_tournage;
CREATE POLICY "jours_tournage_org" ON jours_tournage FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS jours_tournage_updated_at ON jours_tournage;
CREATE TRIGGER jours_tournage_updated_at
  BEFORE UPDATE ON jours_tournage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 10. CALL SHEETS (PLACEHOLDER — à développer ultérieurement)
-- ============================================================
-- Structure minimale pour réserver la place dans le schéma.
-- L'outil complet (convocations par heure, export PDF, etc.)
-- sera développé dans une prochaine phase.
-- À intégrer : heure de convocation individuelle, lieu détaillé,
-- contacts d'urgence, véhicules, plan de travail séquencé,
-- météo du jour, export PDF formaté, envoi par email/SMS.

CREATE TABLE IF NOT EXISTS call_sheets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  jour_tournage_id  UUID REFERENCES jours_tournage(id) ON DELETE CASCADE,

  date_tournage     DATE NOT NULL,
  lieu              TEXT,
  notes_generales   TEXT,
  statut            TEXT DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon','envoye','confirme')),

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_sheet_lignes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sheet_id     UUID REFERENCES call_sheets(id) ON DELETE CASCADE NOT NULL,
  projet_membre_id  UUID REFERENCES projet_membres(id) ON DELETE CASCADE,

  -- Données de convocation
  nom_affiche       TEXT,           -- Nom affiché sur le call sheet
  role_affiche      TEXT,           -- Poste affiché
  heure_convocation TIME,
  lieu_rdv          TEXT,           -- Peut différer du lieu principal
  notes             TEXT,
  ordre             INTEGER DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE call_sheets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sheet_lignes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_sheets_org" ON call_sheets;
CREATE POLICY "call_sheets_org" ON call_sheets FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP POLICY IF EXISTS "call_sheet_lignes_org" ON call_sheet_lignes;
CREATE POLICY "call_sheet_lignes_org" ON call_sheet_lignes FOR ALL
  USING (
    call_sheet_id IN (
      SELECT cs.id FROM call_sheets cs
      JOIN projects p ON cs.project_id = p.id
      WHERE p.org_id = get_user_org_id()
    )
  );


-- ============================================================
-- 11. LIVRABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS livrables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,

  nom             TEXT NOT NULL,    -- "Master 4K", "Version 30s Instagram"
  format          TEXT,             -- H.264, ProRes 422, MP3, PDF...
  duree           TEXT,             -- "30s", "3min20", "variable"
  resolution      TEXT,             -- "4K", "1080p", "9:16 1080x1920"
  deadline        DATE,
  responsable_id  UUID REFERENCES projet_membres(id) ON DELETE SET NULL,

  -- Statut de livraison (suit le cycle de révisions)
  statut          TEXT DEFAULT 'en_production'
                  CHECK (statut IN (
                    'en_production',   -- Montage en cours
                    'v1_envoyee',      -- Première version envoyée au client
                    'retours_v1',      -- Retours reçus sur V1
                    'v2_envoyee',      -- Deuxième version envoyée
                    'retours_v2',      -- Retours reçus sur V2
                    'v3_envoyee',      -- Troisième version
                    'valide',          -- Validé par le client ✓
                    'livre'            -- Fichier final livré ✓✓
                  )),

  nb_revisions_incluses   INTEGER DEFAULT 2,
  nb_revisions_realisees  INTEGER DEFAULT 0,

  lien_final      TEXT,   -- Lien de téléchargement du master final
  notes           TEXT,
  ordre           INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livrables_project ON livrables(project_id);

ALTER TABLE livrables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "livrables_org" ON livrables;
CREATE POLICY "livrables_org" ON livrables FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS livrables_updated_at ON livrables;
CREATE TRIGGER livrables_updated_at
  BEFORE UPDATE ON livrables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 12. LIVRABLE_VERSIONS (historique des révisions)
-- ============================================================

CREATE TABLE IF NOT EXISTS livrable_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  livrable_id   UUID REFERENCES livrables(id) ON DELETE CASCADE NOT NULL,

  version_label TEXT NOT NULL,     -- "V1", "V2 après retours client", "Master final"
  date_envoi    DATE,
  lien_visio    TEXT,              -- Lien de visionnage (Drive, Frame.io, Vimeo...)
  notes_envoi   TEXT,              -- Notes à l'envoi
  notes_retours TEXT,              -- Retours du client

  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livrable_versions_livrable ON livrable_versions(livrable_id);

ALTER TABLE livrable_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "livrable_versions_org" ON livrable_versions;
CREATE POLICY "livrable_versions_org" ON livrable_versions FOR ALL
  USING (
    livrable_id IN (
      SELECT l.id FROM livrables l
      JOIN projects p ON l.project_id = p.id
      WHERE p.org_id = get_user_org_id()
    )
  );


-- ============================================================
-- 13. FACTURES
-- ============================================================

CREATE TABLE IF NOT EXISTS factures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  devis_id        UUID REFERENCES devis(id) ON DELETE SET NULL,

  -- Type et numérotation
  type            TEXT NOT NULL
                  CHECK (type IN (
                    'acompte',              -- Acompte initial (ex: 30%)
                    'acompte_intermediaire',-- Acompte en cours de projet
                    'solde',                -- Solde final
                    'globale'               -- Facture unique (tout en un)
                  )),
  numero          TEXT,          -- Numéro de facture (ex: FAC-2026-042)
  objet           TEXT,          -- Objet de la facture (pré-rempli depuis le projet)

  -- Montants
  montant_ht      NUMERIC(10,2) NOT NULL DEFAULT 0,
  tva_pct         NUMERIC(5,2)  DEFAULT 20,
  montant_ttc     NUMERIC(10,2) GENERATED ALWAYS AS
                    (ROUND(montant_ht * (1 + tva_pct / 100), 2)) STORED,

  -- Suivi comptable
  statut          TEXT DEFAULT 'brouillon'
                  CHECK (statut IN (
                    'brouillon',         -- En cours de préparation
                    'envoyee',           -- Envoyée au client
                    'en_attente',        -- En attente de paiement
                    'reglee',            -- Payée ✓
                    'en_retard'          -- Délai dépassé, non réglée
                  )),

  date_emission   DATE,
  date_envoi      DATE,
  delai_paiement  INTEGER DEFAULT 30,   -- Délai contractuel en jours
  date_echeance   DATE,                 -- Calculé : date_envoi + delai_paiement
  date_reglement  DATE,                 -- Date effective du paiement

  notes           TEXT,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factures_project ON factures(project_id);
CREATE INDEX IF NOT EXISTS idx_factures_statut  ON factures(statut);

ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "factures_org" ON factures;
CREATE POLICY "factures_org" ON factures FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS factures_updated_at ON factures;
CREATE TRIGGER factures_updated_at
  BEFORE UPDATE ON factures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 14. MISE À JOUR — BUDGET_REEL (enrichissement)
-- ============================================================

ALTER TABLE budget_reel
  ADD COLUMN IF NOT EXISTS montant_ttc  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tva_pct      NUMERIC(5,2) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS justificatif_url TEXT,
  ADD COLUMN IF NOT EXISTS created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS budget_reel_updated_at ON budget_reel;
CREATE TRIGGER budget_reel_updated_at
  BEFORE UPDATE ON budget_reel
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 15. AJUSTEMENTS GLOBAUX DEVIS
-- ============================================================
-- Stocke les ajustements globaux (Mg+Fg, assurance, remise)
-- séparément du devis pour plus de clarté.
-- Note : ces valeurs sont actuellement sur la table devis directement.
-- Ce bloc est prévu pour une refacto future si nécessaire.
-- Pour l'instant, on ajoute les colonnes manquantes sur devis.

ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS marge_globale_pct      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assurance_pct          NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_globale_pct     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_globale_montant NUMERIC DEFAULT 0;


-- ============================================================
-- 16. VUE — COMPTA (factures en cours, toutes org confondues
--     mais filtrées par RLS)
-- ============================================================
-- Utilisée par l'onglet "Compta" de la sidebar pour afficher
-- toutes les factures en attente avec leur urgence.

CREATE OR REPLACE VIEW v_compta_factures AS
SELECT
  f.id,
  f.project_id,
  p.title                             AS project_title,
  c.name                              AS client_name,
  f.type,
  f.numero,
  f.objet,
  f.montant_ht,
  f.tva_pct,
  f.montant_ttc,
  f.statut,
  f.date_emission,
  f.date_envoi,
  f.delai_paiement,
  f.date_echeance,
  f.date_reglement,
  -- Jours restants avant échéance (négatif = en retard)
  CASE
    WHEN f.date_echeance IS NOT NULL AND f.statut NOT IN ('reglee')
    THEN f.date_echeance - CURRENT_DATE
    ELSE NULL
  END                                 AS jours_avant_echeance,
  -- Flag urgence
  CASE
    WHEN f.statut = 'reglee'          THEN 'regle'
    WHEN f.date_echeance < CURRENT_DATE THEN 'en_retard'
    WHEN f.date_echeance <= CURRENT_DATE + 7 THEN 'urgent'
    WHEN f.date_echeance <= CURRENT_DATE + 30 THEN 'a_venir'
    ELSE 'ok'
  END                                 AS urgence,
  p.org_id
FROM factures f
JOIN projects p ON f.project_id = p.id
LEFT JOIN clients c ON p.client_id = c.id
ORDER BY
  CASE
    WHEN f.statut = 'reglee' THEN 3
    WHEN f.date_echeance < CURRENT_DATE THEN 0
    WHEN f.date_echeance <= CURRENT_DATE + 7 THEN 1
    ELSE 2
  END,
  f.date_echeance ASC NULLS LAST;


-- ============================================================
-- 17. VUE — DASHBOARD PROJET (KPIs synthétiques)
-- ============================================================

CREATE OR REPLACE VIEW v_dashboard_projet AS
SELECT
  p.id                                AS project_id,
  p.title,
  p.status,
  p.type_projet,
  p.date_debut,
  p.date_fin,
  c.name                              AS client_name,

  -- Factures
  COUNT(DISTINCT f.id)                AS nb_factures,
  COALESCE(SUM(f.montant_ht) FILTER (WHERE f.statut != 'brouillon'), 0)
                                      AS ca_facture_ht,
  COALESCE(SUM(f.montant_ttc) FILTER (WHERE f.statut = 'reglee'), 0)
                                      AS ca_encaisse_ttc,

  -- Livrables
  COUNT(DISTINCT l.id)                AS nb_livrables,
  COUNT(DISTINCT l.id) FILTER (WHERE l.statut = 'livre')
                                      AS nb_livrables_livres,

  -- Budget réel
  COALESCE(SUM(br.montant_ht), 0)     AS total_depenses_reelles_ht,

  p.org_id
FROM projects p
LEFT JOIN clients c   ON p.client_id = c.id
LEFT JOIN factures f  ON f.project_id = p.id
LEFT JOIN livrables l ON l.project_id = p.id
LEFT JOIN budget_reel br ON br.project_id = p.id
GROUP BY p.id, p.title, p.status, p.type_projet, p.date_debut, p.date_fin,
         c.name, p.org_id;


-- ============================================================
-- 18. INDEX DE PERFORMANCE (tables existantes)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_devis_project      ON devis(project_id);
CREATE INDEX IF NOT EXISTS idx_devis_lines_devis  ON devis_lines(devis_id);
CREATE INDEX IF NOT EXISTS idx_devis_lines_cat    ON devis_lines(category_id);
CREATE INDEX IF NOT EXISTS idx_budget_reel_project ON budget_reel(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_reel_line    ON budget_reel(devis_line_id);


-- ============================================================
-- FIN DE LA MIGRATION V2
-- ============================================================
-- Tables créées / modifiées :
--   MODIFIÉES  : profiles, projects, devis, devis_lines, budget_reel
--   CRÉÉES     : contacts, projet_membres, devis_ligne_membres
--                planning_phases, planning_items
--                jours_tournage
--                call_sheets, call_sheet_lignes (placeholder)
--                livrables, livrable_versions
--                factures
-- VUES         : v_compta_factures, v_dashboard_projet
-- ============================================================
