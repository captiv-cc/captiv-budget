-- ============================================================================
-- Migration : Planning PL-1 — Modèle de données & CRUD
-- Date      : 2026-04-16
-- Contexte  : Introduction du pilier Planning de CAPTIV DESK.
--             Tables : event_types (org-scoped, personnalisables),
--                      locations (org-scoped, repérages réutilisables — PL-9),
--                      events (project-scoped, multi-types, récurrence JSONB),
--                      event_members (membres convoqués, statut invité/confirmé),
--                      event_devis_lines (traçabilité financière).
-- ============================================================================

BEGIN;

-- ── 1. event_types (org-scoped, personnalisables via UI admin) ──────────────
-- 13 valeurs par défaut seedées via slug. Les types "système" (is_system=true)
-- peuvent être archivés mais pas supprimés par l'utilisateur (garde-fou UI).
CREATE TABLE IF NOT EXISTS event_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  slug        TEXT,                                   -- stable key pour les types système (null = type ad hoc)
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#64748B',        -- hex pour rendu cohérent front/PDF
  icon        TEXT,                                   -- nom lucide-react (ex: "Camera")
  category    TEXT NOT NULL DEFAULT 'autre'
              CHECK (category IN ('pre_prod','tournage','post_prod','autre')),
  default_all_day   BOOLEAN NOT NULL DEFAULT false,
  default_duration_min INT,                            -- durée par défaut en minutes (null = libre)
  sort_order  INT NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)                                 -- un seul type système par slug/org
);

CREATE INDEX IF NOT EXISTS event_types_org_id_idx  ON event_types(org_id);
CREATE INDEX IF NOT EXISTS event_types_archived_idx ON event_types(org_id, archived);

ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_types_org" ON event_types;
CREATE POLICY "event_types_org" ON event_types FOR ALL
  USING      (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

DROP TRIGGER IF EXISTS event_types_updated_at ON event_types;
CREATE TRIGGER event_types_updated_at
  BEFORE UPDATE ON event_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2. locations (org-scoped, repérages réutilisables — jalon PL-9) ─────────
-- Créée dès PL-1 car référencée par events (nullable). Schéma minimal, enrichi
-- dans PL-9 (photos, contacts, notes d'accès).
CREATE TABLE IF NOT EXISTS locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  postal_code TEXT,
  country     TEXT,
  latitude    NUMERIC,
  longitude   NUMERIC,
  notes       TEXT,                                    -- accès, parking, horaires autorisés
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_org_id_idx ON locations(org_id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "locations_org" ON locations;
CREATE POLICY "locations_org" ON locations FOR ALL
  USING      (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

DROP TRIGGER IF EXISTS locations_updated_at ON locations;
CREATE TRIGGER locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 3. events (table principale, project-scoped) ────────────────────────────
-- Un événement appartient TOUJOURS à un projet. Le rattachement à un lot
-- (devis_lots) et aux lignes de devis est optionnel mais encouragé pour la
-- traçabilité financière. Horaires "façon Google Calendar" : si all_day=true,
-- starts_at/ends_at sont interprétés comme des journées entières côté front
-- (on stocke quand même timestamptz pour rester consistant ; la convention
-- fond est starts_at = 00:00 local, ends_at = 23:59 local ou +1j 00:00).
--
-- Récurrence : stockée en JSONB (freq/interval/byweekday/until/count).
-- Une instance récurrente est représentée par une SEULE ligne events avec
-- rrule non null. L'expansion en occurrences se fait côté client (PL-2)
-- puis pourra passer côté SQL via materialized view si nécessaire (v2).
CREATE TABLE IF NOT EXISTS events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id)       ON DELETE CASCADE,
  lot_id       UUID           REFERENCES devis_lots(id)    ON DELETE SET NULL,
  type_id      UUID           REFERENCES event_types(id)   ON DELETE SET NULL,
  location_id  UUID           REFERENCES locations(id)     ON DELETE SET NULL,

  title        TEXT NOT NULL,
  description  TEXT,

  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  all_day      BOOLEAN NOT NULL DEFAULT false,
  tz           TEXT NOT NULL DEFAULT 'Europe/Paris',    -- fuseau de référence

  -- Récurrence (null = événement unique). Exemple :
  --   { "freq": "weekly", "interval": 1, "byweekday": [1,3], "until": "2026-07-01" }
  --   { "freq": "daily",  "interval": 1, "count": 10 }
  rrule        JSONB,
  -- Exceptions de récurrence : liste de dates (ISO) à exclure de la série
  rrule_exdates JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Surcharge couleur (si null, on prend la couleur du type)
  color_override TEXT,

  notes        TEXT,                                     -- notes internes (pas envoyées au client)
  external_url TEXT,                                     -- lien vers doc/brief/storyboard

  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT events_dates_ordered CHECK (ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS events_project_id_idx   ON events(project_id);
CREATE INDEX IF NOT EXISTS events_lot_id_idx       ON events(lot_id);
CREATE INDEX IF NOT EXISTS events_type_id_idx      ON events(type_id);
CREATE INDEX IF NOT EXISTS events_starts_at_idx    ON events(starts_at);
CREATE INDEX IF NOT EXISTS events_project_range_idx ON events(project_id, starts_at, ends_at);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_org" ON events;
CREATE POLICY "events_org" ON events FOR ALL
  USING      (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 4. event_members (convocations équipe) ──────────────────────────────────
-- Un membre peut être :
--   (a) un utilisateur de la plateforme (profile_id) — notifications in-app ;
--   (b) un membre d'équipe projet (crew_member_id) — notifications email.
-- XOR strict pour éviter la confusion.
CREATE TABLE IF NOT EXISTS event_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  profile_id      UUID REFERENCES profiles(id)       ON DELETE CASCADE,
  crew_member_id  UUID REFERENCES crew_members(id)   ON DELETE CASCADE,
  role            TEXT,                                -- rôle sur l'événement (surcharge du rôle crew)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','declined','tentative')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_members_xor CHECK (
    (profile_id IS NOT NULL AND crew_member_id IS NULL)
    OR
    (profile_id IS NULL AND crew_member_id IS NOT NULL)
  ),
  -- Un membre (profile ou crew) ne peut apparaître qu'une fois par événement
  UNIQUE (event_id, profile_id),
  UNIQUE (event_id, crew_member_id)
);

CREATE INDEX IF NOT EXISTS event_members_event_id_idx      ON event_members(event_id);
CREATE INDEX IF NOT EXISTS event_members_profile_id_idx    ON event_members(profile_id);
CREATE INDEX IF NOT EXISTS event_members_crew_member_id_idx ON event_members(crew_member_id);
-- Index utile pour la détection de conflits multi-projets (PL-3 / XC-2)
CREATE INDEX IF NOT EXISTS event_members_profile_status_idx ON event_members(profile_id, status)
  WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_members_crew_status_idx ON event_members(crew_member_id, status)
  WHERE crew_member_id IS NOT NULL;

ALTER TABLE event_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_members_org" ON event_members;
CREATE POLICY "event_members_org" ON event_members FOR ALL
  USING (
    event_id IN (
      SELECT e.id FROM events e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    event_id IN (
      SELECT e.id FROM events e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = get_user_org_id()
    )
  );


-- ── 5. event_devis_lines (traçabilité financière) ───────────────────────────
-- Lien N-N entre un événement et les lignes de devis qu'il "consomme".
-- Utile pour calculer les jours réels par poste, recaler les estimations,
-- et afficher le budget alloué sur un jour de tournage.
CREATE TABLE IF NOT EXISTS event_devis_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id)       ON DELETE CASCADE,
  devis_line_id  UUID NOT NULL REFERENCES devis_lines(id)  ON DELETE CASCADE,
  quantity       NUMERIC,                                   -- optionnel (ex: 1 jour sur 5)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, devis_line_id)
);

CREATE INDEX IF NOT EXISTS event_devis_lines_event_id_idx      ON event_devis_lines(event_id);
CREATE INDEX IF NOT EXISTS event_devis_lines_devis_line_id_idx ON event_devis_lines(devis_line_id);

ALTER TABLE event_devis_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_devis_lines_org" ON event_devis_lines;
CREATE POLICY "event_devis_lines_org" ON event_devis_lines FOR ALL
  USING (
    event_id IN (
      SELECT e.id FROM events e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    event_id IN (
      SELECT e.id FROM events e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = get_user_org_id()
    )
  );


-- ── 6. Seed des 13 types d'événements par défaut (par organisation) ─────────
-- Exécuté pour chaque org existante. Pour les nouvelles orgs, le même seed
-- sera appelé à la création d'org (à ajouter dans le hook handle_new_org
-- ou depuis l'app au premier login admin).
INSERT INTO event_types (org_id, slug, label, color, icon, category, default_all_day, sort_order, is_system)
SELECT o.id, s.slug, s.label, s.color, s.icon, s.category, s.all_day, s.sort_order, true
FROM organisations o
CROSS JOIN (
  VALUES
    ('pre_production', 'Pré-production',    '#A855F7', 'ClipboardList', 'pre_prod',  false, 10),
    ('reperages',      'Repérages',          '#8B5CF6', 'MapPin',        'pre_prod',  false, 20),
    ('casting',        'Casting',            '#7C3AED', 'Users',         'pre_prod',  false, 30),
    ('essais',         'Essais',             '#6D28D9', 'Sparkles',      'pre_prod',  false, 40),
    ('tournage',       'Tournage',           '#EF4444', 'Camera',        'tournage',  true,  50),
    ('montage',        'Montage',            '#3B82F6', 'Film',          'post_prod', false, 60),
    ('etalonnage',     'Étalonnage',         '#2563EB', 'Palette',       'post_prod', false, 70),
    ('mix_sound',      'Mix / sound design', '#1D4ED8', 'AudioWaveform', 'post_prod', false, 80),
    ('vfx_compo',      'VFX / compositing',  '#1E40AF', 'Wand2',         'post_prod', false, 90),
    ('livraison',      'Livraison',          '#10B981', 'PackageCheck',  'autre',     false, 100),
    ('validation',     'Validation',         '#059669', 'CheckCircle2',  'autre',     false, 110),
    ('reunion',        'Réunion',            '#6B7280', 'Users2',        'autre',     false, 120),
    ('autre',          'Autre',              '#94A3B8', 'Circle',        'autre',     false, 130)
) AS s(slug, label, color, icon, category, all_day, sort_order)
ON CONFLICT (org_id, slug) DO NOTHING;


-- ── 7. Helper : seed des types par défaut pour une organisation donnée ──────
-- Utilisable depuis l'app au moment de la création d'org (ou depuis le hook
-- handle_new_org si on en ajoute un plus tard).
CREATE OR REPLACE FUNCTION seed_event_types_for_org(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO event_types (org_id, slug, label, color, icon, category, default_all_day, sort_order, is_system)
  VALUES
    (p_org_id, 'pre_production', 'Pré-production',    '#A855F7', 'ClipboardList', 'pre_prod',  false, 10,  true),
    (p_org_id, 'reperages',      'Repérages',          '#8B5CF6', 'MapPin',        'pre_prod',  false, 20,  true),
    (p_org_id, 'casting',        'Casting',            '#7C3AED', 'Users',         'pre_prod',  false, 30,  true),
    (p_org_id, 'essais',         'Essais',             '#6D28D9', 'Sparkles',      'pre_prod',  false, 40,  true),
    (p_org_id, 'tournage',       'Tournage',           '#EF4444', 'Camera',        'tournage',  true,  50,  true),
    (p_org_id, 'montage',        'Montage',            '#3B82F6', 'Film',          'post_prod', false, 60,  true),
    (p_org_id, 'etalonnage',     'Étalonnage',         '#2563EB', 'Palette',       'post_prod', false, 70,  true),
    (p_org_id, 'mix_sound',      'Mix / sound design', '#1D4ED8', 'AudioWaveform', 'post_prod', false, 80,  true),
    (p_org_id, 'vfx_compo',      'VFX / compositing',  '#1E40AF', 'Wand2',         'post_prod', false, 90,  true),
    (p_org_id, 'livraison',      'Livraison',          '#10B981', 'PackageCheck',  'autre',     false, 100, true),
    (p_org_id, 'validation',     'Validation',         '#059669', 'CheckCircle2',  'autre',     false, 110, true),
    (p_org_id, 'reunion',        'Réunion',            '#6B7280', 'Users2',        'autre',     false, 120, true),
    (p_org_id, 'autre',          'Autre',              '#94A3B8', 'Circle',        'autre',     false, 130, true)
  ON CONFLICT (org_id, slug) DO NOTHING;
END;
$$;


COMMIT;

-- ============================================================================
-- Fin de la migration PL-1.
-- Chantiers suivants :
--   PL-2 : vue calendrier (front),
--   PL-3 : détection de conflits (vue SQL ou calcul front),
--   PL-9 : enrichissement de `locations` (photos, contacts, accès).
-- ============================================================================
