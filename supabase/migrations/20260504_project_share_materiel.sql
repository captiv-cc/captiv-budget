-- ============================================================================
-- Migration : MATOS-SHARE-5/5 — intégration matériel au portail projet
-- Date      : 2026-05-04
-- Contexte  : Étend le portail projet (`project_share_tokens`) pour accueillir
--             la page "matériel" en plus d'équipe et livrables. Les configs
--             vivent dans `page_configs->'materiel'` avec la même shape que
--             matos_share_tokens.config + une clé `version_id` pour le mode
--             snapshot (NULL = mode 'active' qui suit la version courante).
--
-- Composants posés :
--   - share_projet_materiel_fetch(token, password)
--       Mirror de share_matos_fetch avec config lue depuis page_configs.
--       Même résolution de version (active/snapshot) et même payload.
--
--   - share_projet_fetch (mise à jour) :
--       Ajout du teaser `materiel: { items, blocks }` quand la page est
--       activée. Aligné sur les teasers équipe/livrables.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260504_project_share_tokens.sql, 20260504_matos_share_tokens.sql,
--              20260504_project_share_password_fix_search_path.sql.
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. RPC publique — fetch MATÉRIEL (sous-page du portail)
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
  -- Résolution token + check mdp + check page activée.
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'materiel', p_password);

  -- Mode version : NULL = active courante, sinon snapshot figé.
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

  -- Lecture des toggles avec fallback (cohérent DEFAULT_SHARE_CONFIG).
  v_show_loueurs := COALESCE((v_config->>'show_loueurs')::boolean,    true);
  v_show_qte     := COALESCE((v_config->>'show_quantites')::boolean,  true);
  v_show_remark  := COALESCE((v_config->>'show_remarques')::boolean,  false);
  v_show_flags   := COALESCE((v_config->>'show_flags')::boolean,      false);
  v_show_check   := COALESCE((v_config->>'show_checklist')::boolean,  false);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  NULL,  -- pas de label par sous-page (porté par token global)
      'config', v_config
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
          'id',         b.id,
          'titre',      b.titre,
          'couleur',    b.couleur,
          'affichage',  b.affichage,
          'sort_order', b.sort_order
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
          -- Loueurs : numero_reference JAMAIS exposé.
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
    -- Photos : pas implémenté en V1 (signed URLs storage à traiter en V2).
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


-- =====================================================================
-- 2. share_projet_fetch — ajout du teaser materiel
-- =====================================================================
-- On reproduit la version actuelle (post hub-polish) en ajoutant juste
-- le teaser materiel { items, blocks } pour le hub.
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
  v_active_version    uuid;
  v_result            jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  SELECT password_hash IS NOT NULL
    INTO v_password_protected
    FROM project_share_tokens
   WHERE token = p_token;

  -- Pour le teaser matériel : on prend la version active courante du projet
  -- (le hub n'est pas un snapshot — il s'aligne sur "ce qui existe maintenant").
  -- Si le token utilisera plus tard un snapshot pour la sous-page matériel,
  -- le teaser pourrait diverger. C'est OK : le teaser donne juste un ordre
  -- de grandeur (counts), pas une donnée stricte.
  IF v_enabled ? 'materiel' THEN
    SELECT id INTO v_active_version
      FROM matos_versions
     WHERE matos_versions.project_id = v_project_id
       AND is_active = true
     LIMIT 1;
    IF v_active_version IS NULL THEN
      SELECT id INTO v_active_version
        FROM matos_versions
       WHERE matos_versions.project_id = v_project_id
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;
  END IF;

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
      END,
      'materiel', CASE
        WHEN v_enabled ? 'materiel' AND v_active_version IS NOT NULL THEN (
          SELECT jsonb_build_object(
            'items',  (
              SELECT COUNT(*)
                FROM matos_items i
                JOIN matos_blocks b ON b.id = i.block_id
               WHERE b.version_id = v_active_version
            ),
            'blocks', (
              SELECT COUNT(*) FROM matos_blocks WHERE version_id = v_active_version
            )
          )
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
