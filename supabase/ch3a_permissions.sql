-- ════════════════════════════════════════════════════════════════════════════
-- CHANTIER 3A — Modèle de permissions prestataire
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter dans Supabase : SQL Editor → New query → Coller → Run
--
-- Ce que fait cette migration :
--   1. Relâche et redéfinit la contrainte profiles.role (valeurs attendues par le frontend)
--   2. Ajoute profiles.metier_template_id et profiles.metier_label
--   3. Crée le catalogue d'outils (outils_catalogue)
--   4. Crée les templates métier (metiers_template)
--   5. Crée la matrice de permissions par template
--   6. Crée la table d'overrides par utilisateur
--   7. Active RLS sur toutes les nouvelles tables
--   8. Seed le catalogue + 4 templates système (Monteur, Cadreur/DP, Ass. réa, Réalisateur)
--
-- La migration est IDEMPOTENTE : tu peux la rejouer sans casser la base.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Normalisation des rôles profiles
-- ─────────────────────────────────────────────────────────────────────────────
-- On relâche d'abord la contrainte si elle existe, puis on la remet avec
-- les valeurs exactes utilisées par le frontend (AuthContext.jsx).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'charge_prod', 'coordinateur', 'prestataire'));

-- Rétrocompat : si des profils ont encore l'ancien 'editor'/'viewer', on les migre
UPDATE profiles SET role = 'charge_prod'  WHERE role = 'editor';
UPDATE profiles SET role = 'coordinateur' WHERE role = 'viewer';

-- Valeur par défaut alignée sur la plus restrictive
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'coordinateur';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Table : outils_catalogue
-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue référentiel des outils de l'app. Ajouter un outil = insérer une
-- ligne ici, aucun code à modifier. Les outils sont identifiés par une clé
-- texte stable (ex: 'livrables').
CREATE TABLE IF NOT EXISTS outils_catalogue (
  key          text PRIMARY KEY,
  label        text NOT NULL,
  description  text,
  icon         text,            -- nom d'icône Lucide (ex: 'FileVideo')
  sort_order   integer DEFAULT 0,
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table : metiers_template
-- ─────────────────────────────────────────────────────────────────────────────
-- Profils métier réutilisables (Monteur, Cadreur, Ingé son...). Chaque org
-- peut créer ses propres templates, mais les templates système (is_system=true)
-- sont livrés avec l'app et partagés par toutes les orgs (org_id NULL).
CREATE TABLE IF NOT EXISTS metiers_template (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES organisations(id) ON DELETE CASCADE, -- NULL = template système
  key          text NOT NULL,      -- ex: 'monteur'
  label        text NOT NULL,      -- ex: 'Monteur'
  description  text,
  icon         text,               -- nom d'icône Lucide
  color        text,               -- ex: '#F5A623'
  is_system    boolean DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_metiers_template_org ON metiers_template(org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Table : metier_template_permissions
-- ─────────────────────────────────────────────────────────────────────────────
-- Matrice : pour un template donné, quelle action est autorisée sur quel outil.
-- On stocke seulement les outils explicitement autorisés. Un outil absent de
-- la table = aucune permission.
CREATE TABLE IF NOT EXISTS metier_template_permissions (
  template_id  uuid REFERENCES metiers_template(id) ON DELETE CASCADE NOT NULL,
  outil_key    text REFERENCES outils_catalogue(key) ON DELETE CASCADE NOT NULL,
  can_read     boolean DEFAULT false,
  can_comment  boolean DEFAULT false,
  can_edit     boolean DEFAULT false,
  PRIMARY KEY (template_id, outil_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Table : prestataire_outils (overrides par utilisateur)
-- ─────────────────────────────────────────────────────────────────────────────
-- Permet de donner à un prestataire spécifique une permission qu'il n'a pas
-- dans son template, ou de lui en retirer une. Cas particulier, rarement
-- utilisé. La fusion template + overrides se fait côté application.
CREATE TABLE IF NOT EXISTS prestataire_outils (
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  outil_key    text REFERENCES outils_catalogue(key) ON DELETE CASCADE NOT NULL,
  can_read     boolean,   -- NULL = hérité du template
  can_comment  boolean,
  can_edit     boolean,
  note         text,       -- explication pour traçabilité
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, outil_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Extension de profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS metier_template_id uuid
    REFERENCES metiers_template(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS metier_label text;   -- libellé libre affiché dans l'UI

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE outils_catalogue            ENABLE ROW LEVEL SECURITY;
ALTER TABLE metiers_template            ENABLE ROW LEVEL SECURITY;
ALTER TABLE metier_template_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestataire_outils          ENABLE ROW LEVEL SECURITY;

-- Catalogue : lecture publique pour tous les utilisateurs authentifiés
DROP POLICY IF EXISTS "outils_catalogue_read" ON outils_catalogue;
CREATE POLICY "outils_catalogue_read" ON outils_catalogue
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Templates : lecture des templates système (org_id IS NULL) + ceux de son org
DROP POLICY IF EXISTS "metiers_template_read" ON metiers_template;
CREATE POLICY "metiers_template_read" ON metiers_template
  FOR SELECT USING (
    org_id IS NULL
    OR org_id = get_user_org_id()
  );

-- Templates : écriture réservée aux admins de l'org (templates non système)
DROP POLICY IF EXISTS "metiers_template_write" ON metiers_template;
CREATE POLICY "metiers_template_write" ON metiers_template
  FOR ALL USING (
    is_system = false
    AND org_id = get_user_org_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Permissions template : lecture si template accessible en lecture
DROP POLICY IF EXISTS "metier_template_permissions_read" ON metier_template_permissions;
CREATE POLICY "metier_template_permissions_read" ON metier_template_permissions
  FOR SELECT USING (
    template_id IN (
      SELECT id FROM metiers_template
      WHERE org_id IS NULL OR org_id = get_user_org_id()
    )
  );

-- Permissions template : écriture réservée aux admins pour les templates non système
DROP POLICY IF EXISTS "metier_template_permissions_write" ON metier_template_permissions;
CREATE POLICY "metier_template_permissions_write" ON metier_template_permissions
  FOR ALL USING (
    template_id IN (
      SELECT id FROM metiers_template
      WHERE is_system = false
        AND org_id = get_user_org_id()
    )
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Overrides utilisateur : chaque user lit ses propres overrides, admin lit tout dans son org
DROP POLICY IF EXISTS "prestataire_outils_read" ON prestataire_outils;
CREATE POLICY "prestataire_outils_read" ON prestataire_outils
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT id FROM profiles
      WHERE org_id = get_user_org_id()
        AND EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "prestataire_outils_write" ON prestataire_outils;
CREATE POLICY "prestataire_outils_write" ON prestataire_outils
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND user_id IN (SELECT id FROM profiles WHERE org_id = get_user_org_id())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SEED — Catalogue d'outils
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO outils_catalogue (key, label, description, icon, sort_order) VALUES
  ('projet_info', 'Fiche projet',   'Informations générales du projet',              'FileText',    10),
  ('equipe',      'Équipe',         'Annuaire de l''équipe du projet',               'Users',       20),
  ('planning',    'Planning',       'Calendrier de production',                      'Calendar',    30),
  ('callsheet',   'Call sheet',     'Feuilles de service / convocations',            'ClipboardList', 40),
  ('production',  'Production',     'Notes de production, décisions, logistique',    'Clapperboard', 50),
  ('livrables',   'Livrables',      'Rushes, versions, validations client',          'FileVideo',   60),
  ('materiel',    'Matériel',       'Liste matériel caméra / lumière / son',         'Camera',      70),
  ('decors',      'Décors',         'Plans, références, liste déco',                 'Home',        80)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SEED — Templates métier système
-- ─────────────────────────────────────────────────────────────────────────────
-- Ces templates sont livrés avec l'app (is_system=true, org_id=NULL) et sont
-- accessibles à toutes les organisations. Ils servent de base sur laquelle
-- chaque org peut ensuite créer ses propres variations.

INSERT INTO metiers_template (id, org_id, key, label, description, icon, color, is_system) VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, NULL, 'monteur',       'Monteur',            'Accès aux livrables du projet en édition, lecture de l''équipe et des notes de prod', 'Scissors',      '#F5A623', true),
  ('22222222-2222-2222-2222-222222222222'::uuid, NULL, 'cadreur',       'Cadreur / Chef op',  'Accès aux call sheets, planning, équipe et matériel en lecture',                      'Camera',        '#3B82F6', true),
  ('33333333-3333-3333-3333-333333333333'::uuid, NULL, 'assistant_rea', 'Assistant réa',      'Profil large production : édition callsheet, planning, production, équipe',          'ClipboardList', '#10B981', true),
  ('44444444-4444-4444-4444-444444444444'::uuid, NULL, 'realisateur',   'Réalisateur',        'Lecture et commentaires sur tout le projet, édition des livrables',                   'Film',          '#8B5CF6', true)
ON CONFLICT (org_id, key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SEED — Permissions par template
-- ─────────────────────────────────────────────────────────────────────────────
-- Matrice appliquée pour chaque template système.

-- ── Monteur : Livrables (edit), Équipe (read), Production (read)
INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit) VALUES
  ('11111111-1111-1111-1111-111111111111', 'livrables',   true, true, true),
  ('11111111-1111-1111-1111-111111111111', 'equipe',      true, false, false),
  ('11111111-1111-1111-1111-111111111111', 'production',  true, false, false),
  ('11111111-1111-1111-1111-111111111111', 'projet_info', true, false, false)
ON CONFLICT DO NOTHING;

-- ── Cadreur / Chef op : Callsheet + Planning + Équipe + Matériel (read)
INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit) VALUES
  ('22222222-2222-2222-2222-222222222222', 'callsheet',   true, false, false),
  ('22222222-2222-2222-2222-222222222222', 'planning',    true, false, false),
  ('22222222-2222-2222-2222-222222222222', 'equipe',      true, false, false),
  ('22222222-2222-2222-2222-222222222222', 'materiel',    true, true, false),
  ('22222222-2222-2222-2222-222222222222', 'projet_info', true, false, false)
ON CONFLICT DO NOTHING;

-- ── Assistant réa : Callsheet + Planning + Production + Équipe (edit complet)
INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit) VALUES
  ('33333333-3333-3333-3333-333333333333', 'callsheet',   true, true, true),
  ('33333333-3333-3333-3333-333333333333', 'planning',    true, true, true),
  ('33333333-3333-3333-3333-333333333333', 'production',  true, true, true),
  ('33333333-3333-3333-3333-333333333333', 'equipe',      true, true, true),
  ('33333333-3333-3333-3333-333333333333', 'materiel',    true, true, false),
  ('33333333-3333-3333-3333-333333333333', 'decors',      true, true, false),
  ('33333333-3333-3333-3333-333333333333', 'projet_info', true, true, false)
ON CONFLICT DO NOTHING;

-- ── Réalisateur : read + comment sur TOUT + edit livrables
INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit) VALUES
  ('44444444-4444-4444-4444-444444444444', 'projet_info', true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'equipe',      true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'planning',    true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'callsheet',   true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'production',  true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'livrables',   true, true, true),
  ('44444444-4444-4444-4444-444444444444', 'materiel',    true, true, false),
  ('44444444-4444-4444-4444-444444444444', 'decors',      true, true, false)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRATION ch3a_permissions.sql
-- ════════════════════════════════════════════════════════════════════════════
