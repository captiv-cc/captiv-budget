-- ════════════════════════════════════════════════════════════════════════════
-- CHANTIER 4D — UI admin des templates métiers
-- ════════════════════════════════════════════════════════════════════════════
-- Ajoute :
--   1. Colonne base_template_id : trace d'un override org d'un template système
--   2. Fonction clone_metier_template : clone un template système en version org
--   3. Relaxation du nom (pas de contrainte d'unicité globale sur (org_id, key)
--      déjà en place depuis ch3a — un override porte la même key que l'original)
--
-- IDEMPOTENT.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colonne base_template_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE metiers_template
  ADD COLUMN IF NOT EXISTS base_template_id uuid
    REFERENCES metiers_template(id) ON DELETE SET NULL;

COMMENT ON COLUMN metiers_template.base_template_id IS
  'Si renseigné, ce template est un override org d''un template système (ou la copie d''un autre). Sert à tracer l''origine et à dédupliquer côté UI.';

CREATE INDEX IF NOT EXISTS idx_metiers_template_base
  ON metiers_template(base_template_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. clone_metier_template(source_id)
-- ─────────────────────────────────────────────────────────────────────────────
-- Duplique un template (système ou org) en un NOUVEAU template org, avec ses
-- permissions. Retourne l'id du nouveau template.
--
-- Sécurité : SECURITY DEFINER + check manuel que l'appelant est admin de l'org.
-- Le nouveau template est rattaché à l'org de l'appelant, is_system = false,
-- base_template_id = source_id (traçabilité).
CREATE OR REPLACE FUNCTION clone_metier_template(source_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    uuid;
  v_caller_id uuid := auth.uid();
  v_role      text;
  v_new_id    uuid;
  src         metiers_template%ROWTYPE;
BEGIN
  -- Vérif appelant authentifié
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Vérif appelant admin
  SELECT role, org_id INTO v_role, v_org_id
    FROM profiles WHERE id = v_caller_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can clone templates';
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Admin has no org';
  END IF;

  -- Lecture du template source
  SELECT * INTO src FROM metiers_template WHERE id = source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source template not found';
  END IF;

  -- Le source doit être soit système soit appartenir à l'org de l'appelant
  IF src.org_id IS NOT NULL AND src.org_id <> v_org_id THEN
    RAISE EXCEPTION 'Cannot clone template from another org';
  END IF;

  -- Insert de la copie — si la key existe déjà pour l'org, on suffixe
  INSERT INTO metiers_template (org_id, key, label, description, icon, color, is_system, base_template_id)
  VALUES (
    v_org_id,
    -- key : si déjà utilisée par un template org, suffixe _copy
    CASE
      WHEN EXISTS (SELECT 1 FROM metiers_template WHERE org_id = v_org_id AND key = src.key)
        THEN src.key || '_' || substring(md5(random()::text) from 1 for 4)
      ELSE src.key
    END,
    src.label,
    src.description,
    src.icon,
    src.color,
    false,
    source_id
  )
  RETURNING id INTO v_new_id;

  -- Copie des permissions
  INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit)
  SELECT v_new_id, outil_key, can_read, can_comment, can_edit
    FROM metier_template_permissions
   WHERE template_id = source_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clone_metier_template(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRATION ch4d_templates_metiers.sql
-- ════════════════════════════════════════════════════════════════════════════
