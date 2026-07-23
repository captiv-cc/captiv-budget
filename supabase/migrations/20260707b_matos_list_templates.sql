-- ============================================================================
-- Migration : MAT-OUTILS — modèles de listes matériel (niveau organisation)
-- Date      : 2026-07-07
-- Contexte  : « Enregistrer comme modèle » une liste (structure blocs +
--             items, SANS loueurs ni checklists — propres à un projet) puis
--             « Nouvelle liste depuis un modèle » dans n'importe quel projet
--             de l'org. Snapshot jsonb : pas de FK vers les items d'origine.
--
--   data = { blocks: [{ titre, couleur, affichage, sort_order,
--                       items: [{ label, designation, quantite, remarques,
--                                 materiel_bdd_id }] }] }
--
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS matos_list_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  titre       text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{"blocks": []}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS matos_list_templates_org_idx ON matos_list_templates(org_id);

COMMENT ON TABLE matos_list_templates IS
  'Modèles de listes matériel réutilisables (org). Snapshot jsonb blocs+items, sans loueurs/checklists.';

ALTER TABLE matos_list_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_list_templates_org_read"  ON matos_list_templates;
DROP POLICY IF EXISTS "matos_list_templates_org_write" ON matos_list_templates;

-- Tous les membres de l'org lisent ET écrivent (ce sont les monteurs de
-- listes ; pas de gate admin comme materiel_bdd).
CREATE POLICY "matos_list_templates_org_read" ON matos_list_templates
  FOR SELECT USING (org_id = get_user_org_id());

CREATE POLICY "matos_list_templates_org_write" ON matos_list_templates
  FOR ALL
  USING (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

COMMIT;
