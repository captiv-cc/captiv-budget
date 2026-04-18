-- ============================================================================
-- Migration : Planning PL-3.5 — Système de vues multi-lentilles
-- Date      : 2026-04-18
-- Contexte  : Introduit le concept de "vues" paramétrables sur le planning
--             d'un projet (ou à l'échelle de l'org). Une vue est un tuple
--             { kind, config } qui décrit la lentille de lecture du même
--             jeu de données (events / event_members / event_devis_lines).
--
--             Kinds supportés (cœur UI à enrichir par palier) :
--               - 'calendar_month'  : vue mensuelle (existant PL-2)
--               - 'calendar_week'   : vue semaine   (existant PL-3)
--               - 'calendar_day'    : vue jour      (existant PL-3)
--               - 'timeline'        : Gantt horizontal par lot/projet  (futur)
--               - 'table'           : tableau triable (type Notion)    (futur)
--               - 'kanban'          : Board par type/statut/lot        (futur)
--               - 'swimlanes'       : Swimlanes par membre (équipe)    (futur)
--
--             Rend PL-5 (filtres avancés) et XC-2 (vue multi-projets)
--             triviaux : ce sont des configs préenregistrées, pas des
--             nouveaux composants.
-- ============================================================================

BEGIN;

-- ── 1. planning_views ───────────────────────────────────────────────────────
-- Une vue appartient à une organisation et peut être :
--   (a) globale pour l'org (project_id NULL) — utile pour les vues
--       multi-projets (XC-2). Non exposée en Phase 1 mais le schéma le permet.
--   (b) scopée à un projet (project_id non NULL) — cas nominal Phase 1.
--
-- `is_shared = false` → visible uniquement par `created_by`.
-- `is_shared = true`  → visible par tous les membres de l'org (RLS ci-dessous).
-- `is_default = true` → vue sélectionnée par défaut à l'ouverture du planning ;
--   un trigger garantit qu'une seule vue peut être `is_default` pour un
--   (project_id, is_shared=true) donné.
CREATE TABLE IF NOT EXISTS planning_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id  UUID           REFERENCES projects(id)     ON DELETE CASCADE,

  name        TEXT NOT NULL,
  kind        TEXT NOT NULL
              CHECK (kind IN (
                'calendar_month','calendar_week','calendar_day',
                'timeline','table','kanban','swimlanes'
              )),

  -- Configuration libre (filters, groupBy, sortBy, hiddenFields, ...).
  -- Shape conseillé (non strict, évolue sans migration) :
  --   {
  --     "filters":  { "typeIds":[], "lotIds":[], "memberIds":[],
  --                   "statusMember":[], "search":"" },
  --     "groupBy":  "type" | "lot" | "member" | "status" | "location" | null,
  --     "sortBy":   { "field":"starts_at", "direction":"asc" },
  --     "hiddenFields": [],
  --     "showWeekends": true
  --   }
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Métadonnées cosmétiques (rendu du sélecteur de vue)
  icon        TEXT,                                    -- nom lucide-react
  color       TEXT,                                    -- hex (nullable)

  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  is_shared   BOOLEAN NOT NULL DEFAULT true,           -- partagée par défaut

  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planning_views_org_id_idx      ON planning_views(org_id);
CREATE INDEX IF NOT EXISTS planning_views_project_id_idx  ON planning_views(project_id);
CREATE INDEX IF NOT EXISTS planning_views_created_by_idx  ON planning_views(created_by);
-- Index partiel pour retrouver rapidement la vue par défaut d'un projet
CREATE INDEX IF NOT EXISTS planning_views_default_idx
  ON planning_views(project_id, is_shared)
  WHERE is_default = true;

ALTER TABLE planning_views ENABLE ROW LEVEL SECURITY;

-- Lecture :
--   - vues partagées de l'org → tous les membres de l'org
--   - vues privées             → uniquement leur créateur
DROP POLICY IF EXISTS "planning_views_read" ON planning_views;
CREATE POLICY "planning_views_read" ON planning_views FOR SELECT
  USING (
    org_id = get_user_org_id()
    AND (is_shared = true OR created_by = auth.uid())
  );

-- Écriture (INSERT/UPDATE/DELETE) :
--   - vues partagées → tout membre de l'org
--   - vues privées   → uniquement leur créateur
--   Toute nouvelle vue est implicitement créée dans l'org de l'utilisateur.
DROP POLICY IF EXISTS "planning_views_write" ON planning_views;
CREATE POLICY "planning_views_write" ON planning_views FOR ALL
  USING (
    org_id = get_user_org_id()
    AND (is_shared = true OR created_by = auth.uid())
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (is_shared = true OR created_by = auth.uid())
  );

DROP TRIGGER IF EXISTS planning_views_updated_at ON planning_views;
CREATE TRIGGER planning_views_updated_at
  BEFORE UPDATE ON planning_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2. Trigger : un seul is_default=true par (project_id, is_shared) ────────
-- Si on crée/update une vue en is_default=true, on remet à false les autres
-- vues du même scope (project_id + is_shared).
-- Pour les vues privées (is_shared=false), le scope inclut created_by.
CREATE OR REPLACE FUNCTION planning_views_enforce_single_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $planning_views_enforce_single_default$
BEGIN
  IF NEW.is_default = true THEN
    IF NEW.is_shared = true THEN
      UPDATE planning_views
        SET is_default = false
        WHERE org_id = NEW.org_id
          AND project_id IS NOT DISTINCT FROM NEW.project_id
          AND is_shared = true
          AND id <> NEW.id
          AND is_default = true;
    ELSE
      UPDATE planning_views
        SET is_default = false
        WHERE org_id = NEW.org_id
          AND project_id IS NOT DISTINCT FROM NEW.project_id
          AND is_shared = false
          AND created_by = NEW.created_by
          AND id <> NEW.id
          AND is_default = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$planning_views_enforce_single_default$;

DROP TRIGGER IF EXISTS planning_views_single_default ON planning_views;
CREATE TRIGGER planning_views_single_default
  AFTER INSERT OR UPDATE OF is_default, is_shared, project_id
  ON planning_views
  FOR EACH ROW EXECUTE FUNCTION planning_views_enforce_single_default();


-- ── 3. Helper : seed des 3 vues calendrier par défaut pour un projet ───────
-- Appelable depuis l'app lors de l'ouverture du planning d'un projet si
-- aucune vue n'existe encore (fallback DB). Sinon, le front fonctionne
-- avec des vues "builtin" en mémoire jusqu'à la première personnalisation.
-- NB : écrite en pur SQL (pas de variable PL/pgSQL) pour éviter les
-- éditeurs qui cassent le dollar-quoting et interprètent un SELECT INTO
-- variable comme un SELECT INTO table (cause de l'erreur 42P01 sur v_org_id).
CREATE OR REPLACE FUNCTION seed_default_planning_views_for_project(
  p_project_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $seed_default_planning_views$
BEGIN
  -- Ne seed que si aucune vue n'existe déjà pour ce projet
  IF EXISTS (SELECT 1 FROM planning_views WHERE project_id = p_project_id) THEN
    RETURN;
  END IF;

  -- Vérifie d'abord que le projet existe (via INSERT ... SELECT ; 0 ligne
  -- si projet inconnu, pas d'erreur bruyante, comportement idempotent).
  INSERT INTO planning_views
    (org_id, project_id, name, kind, config, icon, sort_order, is_default, is_shared, created_by)
  SELECT
    p.org_id,
    p_project_id,
    seeds.name,
    seeds.kind,
    '{}'::jsonb,
    seeds.icon,
    seeds.sort_order,
    seeds.is_default,
    true,
    auth.uid()
  FROM projects p
  CROSS JOIN (
    VALUES
      ('Mois',    'calendar_month', 'Calendar',      10, true ),
      ('Semaine', 'calendar_week',  'CalendarDays',  20, false),
      ('Jour',    'calendar_day',   'CalendarClock', 30, false)
  ) AS seeds(name, kind, icon, sort_order, is_default)
  WHERE p.id = p_project_id;
END;
$seed_default_planning_views$;


COMMIT;

-- ============================================================================
-- Fin de la migration PL-3.5.
-- Prochains chantiers qui deviennent des "configs préenregistrées" :
--   PL-5 : filtres avancés   → config.filters + config.groupBy
--   XC-2 : vue multi-projets → vue org-scopée (project_id = NULL) + filtres
--   Rendu :
--     - Timeline/Gantt, Table, Kanban, Swimlanes : à livrer en paliers,
--       chacun mappé depuis `kind`.
-- ============================================================================
