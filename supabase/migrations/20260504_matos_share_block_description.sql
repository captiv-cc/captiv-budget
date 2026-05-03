-- ============================================================================
-- Migration : MATOS-SHARE FIX — exposer matos_blocks.description côté partage
-- Date      : 2026-05-04
-- Contexte  : Hugo. La description manuelle du bloc (cf. migration
--             20260421_matos_block_description.sql, ex "CAM LArge, poids 20kg")
--             est visible côté admin sous le titre du bloc, mais n'est pas
--             retournée par les RPCs share_matos_fetch et
--             share_projet_materiel_fetch — elle disparaît côté visiteur.
--
-- Fix       : ajouter `description` dans le sous-objet `blocks` des 2 RPCs.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. share_matos_fetch — ajout description dans blocks
-- =====================================================================
CREATE OR REPLACE FUNCTION share_matos_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_matos_fetch$
DECLARE
  v_project_id     uuid;
  v_version_id    uuid;
  v_config        jsonb;
  v_label         text;
  v_show_loueurs  boolean;
  v_show_qte      boolean;
  v_show_remark   boolean;
  v_show_flags    boolean;
  v_show_check    boolean;
  v_result        jsonb;
BEGIN
  SELECT project_id, version_id_resolved, config, label
    INTO v_project_id, v_version_id, v_config, v_label
    FROM _matos_share_resolve(p_token);

  v_show_loueurs := COALESCE((v_config->>'show_loueurs')::boolean,    true);
  v_show_qte     := COALESCE((v_config->>'show_quantites')::boolean,  true);
  v_show_remark  := COALESCE((v_config->>'show_remarques')::boolean,  false);
  v_show_flags   := COALESCE((v_config->>'show_flags')::boolean,      false);
  v_show_check   := COALESCE((v_config->>'show_checklist')::boolean,  false);

  SELECT jsonb_build_object(
    'share', jsonb_build_object('label', v_label, 'config', v_config),
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
    'version', (
      SELECT jsonb_build_object(
        'id',        v.id,
        'numero',    v.numero,
        'label',     v.label,
        'is_active', v.is_active,
        'mode',      CASE
          WHEN (SELECT t.version_id IS NULL FROM matos_share_tokens t WHERE t.token = p_token)
            THEN 'active'
          ELSE 'snapshot'
        END
      )
      FROM matos_versions v WHERE v.id = v_version_id
    ),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',        v.id,
          'numero',    v.numero,
          'label',     v.label,
          'is_active', v.is_active
        ) ORDER BY v.numero, v.created_at
      )
      FROM matos_versions v
      WHERE v.project_id = v_project_id
    ), '[]'::jsonb),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          b.id,
          'titre',       b.titre,
          'description', b.description,
          'couleur',     b.couleur,
          'affichage',   b.affichage,
          'sort_order',  b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM matos_blocks b
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          i.id,
          'block_id',    i.block_id,
          'label',       i.label,
          'designation', i.designation,
          'quantite',    CASE WHEN v_show_qte    THEN i.quantite  ELSE NULL END,
          'flag',        CASE WHEN v_show_flags  THEN i.flag      ELSE NULL END,
          'remarques',   CASE WHEN v_show_remark THEN i.remarques ELSE NULL END,
          'pre_check_at',  CASE WHEN v_show_check THEN i.pre_check_at  ELSE NULL END,
          'post_check_at', CASE WHEN v_show_check THEN i.post_check_at ELSE NULL END,
          'prod_check_at', CASE WHEN v_show_check THEN i.prod_check_at ELSE NULL END,
          'sort_order',  i.sort_order,
          'loueurs', CASE
            WHEN v_show_loueurs THEN COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',         f.id,
                  'nom',        f.nom,
                  'sort_order', mil.sort_order
                ) ORDER BY mil.sort_order, f.nom
              )
              FROM matos_item_loueurs mil
              LEFT JOIN fournisseurs f ON f.id = mil.loueur_id
              WHERE mil.item_id = i.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) ORDER BY i.sort_order, i.created_at
      )
      FROM matos_items i
      JOIN matos_blocks b ON b.id = i.block_id
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    'photos', '[]'::jsonb,
    'stats', jsonb_build_object(
      'total_items',  (
        SELECT COUNT(*)
          FROM matos_items i
          JOIN matos_blocks b ON b.id = i.block_id
         WHERE b.version_id = v_version_id
      ),
      'total_blocks', (
        SELECT COUNT(*) FROM matos_blocks WHERE version_id = v_version_id
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  BEGIN
    UPDATE matos_share_tokens
       SET last_accessed_at = now(),
           view_count       = view_count + 1
     WHERE token = p_token;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_result;
END;
$share_matos_fetch$;

REVOKE ALL ON FUNCTION share_matos_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_matos_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 2. share_projet_materiel_fetch — ajout description dans blocks
-- =====================================================================
CREATE OR REPLACE FUNCTION share_projet_materiel_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_projet_materiel_fetch$
DECLARE
  v_project_id    uuid;
  v_config        jsonb;
  v_version_id    uuid;
  v_show_loueurs  boolean;
  v_show_qte      boolean;
  v_show_remark   boolean;
  v_show_flags    boolean;
  v_show_check    boolean;
  v_result        jsonb;
BEGIN
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'materiel', p_password);

  v_version_id := NULLIF(v_config->>'version_id', '')::uuid;
  IF v_version_id IS NULL THEN
    SELECT id INTO v_version_id
      FROM matos_versions
     WHERE matos_versions.project_id = v_project_id
       AND is_active = true
     LIMIT 1;
    IF v_version_id IS NULL THEN
      SELECT id INTO v_version_id
        FROM matos_versions
       WHERE matos_versions.project_id = v_project_id
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;
  END IF;

  v_show_loueurs := COALESCE((v_config->>'show_loueurs')::boolean,    true);
  v_show_qte     := COALESCE((v_config->>'show_quantites')::boolean,  true);
  v_show_remark  := COALESCE((v_config->>'show_remarques')::boolean,  false);
  v_show_flags   := COALESCE((v_config->>'show_flags')::boolean,      false);
  v_show_check   := COALESCE((v_config->>'show_checklist')::boolean,  false);

  SELECT jsonb_build_object(
    'share', jsonb_build_object('label', NULL, 'config', v_config),
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
    'version', (
      SELECT jsonb_build_object(
        'id',        v.id,
        'numero',    v.numero,
        'label',     v.label,
        'is_active', v.is_active,
        'mode',      CASE
          WHEN NULLIF(v_config->>'version_id', '') IS NULL
            THEN 'active'
          ELSE 'snapshot'
        END
      )
      FROM matos_versions v WHERE v.id = v_version_id
    ),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',        v.id,
          'numero',    v.numero,
          'label',     v.label,
          'is_active', v.is_active
        ) ORDER BY v.numero, v.created_at
      )
      FROM matos_versions v
      WHERE v.project_id = v_project_id
    ), '[]'::jsonb),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          b.id,
          'titre',       b.titre,
          'description', b.description,
          'couleur',     b.couleur,
          'affichage',   b.affichage,
          'sort_order',  b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM matos_blocks b
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          i.id,
          'block_id',    i.block_id,
          'label',       i.label,
          'designation', i.designation,
          'quantite',    CASE WHEN v_show_qte    THEN i.quantite  ELSE NULL END,
          'flag',        CASE WHEN v_show_flags  THEN i.flag      ELSE NULL END,
          'remarques',   CASE WHEN v_show_remark THEN i.remarques ELSE NULL END,
          'pre_check_at',  CASE WHEN v_show_check THEN i.pre_check_at  ELSE NULL END,
          'post_check_at', CASE WHEN v_show_check THEN i.post_check_at ELSE NULL END,
          'prod_check_at', CASE WHEN v_show_check THEN i.prod_check_at ELSE NULL END,
          'sort_order',  i.sort_order,
          'loueurs', CASE
            WHEN v_show_loueurs THEN COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',         f.id,
                  'nom',        f.nom,
                  'sort_order', mil.sort_order
                ) ORDER BY mil.sort_order, f.nom
              )
              FROM matos_item_loueurs mil
              LEFT JOIN fournisseurs f ON f.id = mil.loueur_id
              WHERE mil.item_id = i.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) ORDER BY i.sort_order, i.created_at
      )
      FROM matos_items i
      JOIN matos_blocks b ON b.id = i.block_id
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    'photos', '[]'::jsonb,
    'stats', jsonb_build_object(
      'total_items',  (
        SELECT COUNT(*)
          FROM matos_items i
          JOIN matos_blocks b ON b.id = i.block_id
         WHERE b.version_id = v_version_id
      ),
      'total_blocks', (
        SELECT COUNT(*) FROM matos_blocks WHERE version_id = v_version_id
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'materiel');

  RETURN v_result;
END;
$share_projet_materiel_fetch$;

REVOKE ALL ON FUNCTION share_projet_materiel_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_materiel_fetch(text, text)
  TO anon, authenticated;


NOTIFY pgrst, 'reload schema';

COMMIT;
