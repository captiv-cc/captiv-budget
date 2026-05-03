-- ============================================================================
-- Migration : PROJECT-SHARE HUB POLISH — exposer password_protected + cleanup
-- Date      : 2026-05-04
-- Contexte  : Le hub a besoin d'un flag `password_protected` (boolean) pour
--             afficher un badge "🔒 Portail privé" rappelant au visiteur que
--             le lien ne doit pas être partagé. On l'expose dans la section
--             `share` du payload du hub uniquement (pas dans les sous-pages
--             où c'est implicite — il a déjà passé le gate).
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION share_projet_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_projet_fetch$
DECLARE
  v_project_id        uuid;
  v_enabled           jsonb;
  v_label             text;
  v_password_protected boolean;
  v_result            jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  -- Lit le flag de protection mdp directement depuis la table (le visiteur
  -- a déjà passé le gate à ce stade ; on lui rappelle juste que le lien est
  -- privé). Pas un secret.
  SELECT password_hash IS NOT NULL
    INTO v_password_protected
    FROM project_share_tokens
   WHERE token = p_token;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',              v_label,
      'enabled_pages',      v_enabled,
      'password_protected', COALESCE(v_password_protected, false)
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'org', (
      SELECT jsonb_build_object(
        'id',                o.id,
        'display_name',      o.display_name,
        'legal_name',        o.legal_name,
        'tagline',           o.tagline,
        'logo_url_clair',    o.logo_url_clair,
        'logo_url_sombre',   o.logo_url_sombre,
        'logo_banner_url',   o.logo_banner_url,
        'brand_color',       o.brand_color,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    'teasers', jsonb_build_object(
      'equipe', CASE
        WHEN v_enabled ? 'equipe' THEN (
          SELECT jsonb_build_object(
            'persons',      COUNT(DISTINCT COALESCE(m.contact_id::text, m.id::text)),
            'attributions', COUNT(*)
          )
          FROM projet_membres m
          WHERE m.project_id = v_project_id
            AND m.parent_membre_id IS NULL
        )
        ELSE NULL
      END,
      'livrables', CASE
        WHEN v_enabled ? 'livrables' THEN (
          SELECT jsonb_build_object(
            'count', COUNT(*)
          )
          FROM livrables l
          WHERE l.project_id = v_project_id
            AND l.deleted_at IS NULL
        )
        ELSE NULL
      END
    ),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, '_hub');

  RETURN v_result;
END;
$share_projet_fetch$;

REVOKE ALL ON FUNCTION share_projet_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_fetch(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
