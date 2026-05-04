-- ============================================================================
-- Migration : PLANS-SHARE-5e/5 — intégration plans au portail projet
-- Date      : 2026-05-04
-- Contexte  : Étend le portail projet (`project_share_tokens`) pour accueillir
--             la page "plans" en plus d'équipe / livrables / matériel. Les
--             configs vivent dans `page_configs->'plans'` avec la même shape
--             que plans_share_tokens (scope, selected_plan_ids, show_versions).
--
-- Composants posés :
--   - share_projet_plans_fetch(token, password)
--       Mirror de share_plans_fetch avec config lue depuis page_configs.
--       Même payload (project + org + categories + plans + versions).
--
--   - share_projet_fetch (mise à jour) :
--       Ajout du teaser `plans: { count }` quand la page est activée.
--       Aligné sur les teasers équipe/livrables/materiel.
--
--   - Policy storage `plans_storage_anon_share` (mise à jour) :
--       Élargissement pour autoriser createSignedUrl côté anon non
--       seulement quand un plans_share_tokens actif existe, mais aussi
--       quand un project_share_tokens actif inclut 'plans' dans
--       enabled_pages. Sans cette élargissement, les visiteurs du
--       portail ne pourraient pas générer les signed URLs des plans.
--
-- Idempotent : CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS.
-- Dépend de  : 20260504_project_share_tokens.sql,
--              20260504_project_share_password*.sql,
--              20260504_plans_share_tokens.sql,
--              20260504_plans_v1.sql.
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. Élargissement policy storage anon
-- =====================================================================
-- La policy de 5a n'autorise anon à signer que si un plans_share_tokens
-- actif existe. Les visiteurs du portail projet doivent pouvoir signer
-- aussi quand le portail (project_share_tokens) inclut 'plans' dans
-- enabled_pages.

DROP POLICY IF EXISTS "plans_storage_anon_share" ON storage.objects;

CREATE POLICY "plans_storage_anon_share" ON storage.objects
  FOR SELECT
  TO anon
  USING (
    bucket_id = 'plans'
    AND (
      -- Token de share dédié plans actif sur le projet
      EXISTS (
        SELECT 1
          FROM plans_share_tokens t
         WHERE t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND t.project_id = ((storage.foldername(name))[1])::uuid
      )
      -- OU portail projet actif avec page 'plans' activée
      OR EXISTS (
        SELECT 1
          FROM project_share_tokens t
         WHERE t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND t.enabled_pages ? 'plans'
           AND t.project_id = ((storage.foldername(name))[1])::uuid
      )
    )
  );


-- =====================================================================
-- 2. RPC publique — fetch PLANS (sous-page du portail)
-- =====================================================================
-- Mirror de share_plans_fetch mais lit la config depuis page_configs.plans
-- au lieu d'une table dédiée. Payload IDENTIQUE pour permettre la
-- réutilisation directe du composant <PlansShareView /> côté front.
CREATE OR REPLACE FUNCTION share_projet_plans_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_projet_plans_fetch$
DECLARE
  v_project_id    uuid;
  v_config        jsonb;
  v_scope         text;
  v_selected      uuid[];
  v_show_versions boolean;
  v_result        jsonb;
BEGIN
  -- Résolution token + check mdp + check page activée.
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'plans', p_password);

  -- Lecture de la config plans (avec fallback default).
  v_scope         := COALESCE(v_config->>'scope', 'all');
  v_show_versions := COALESCE((v_config->>'show_versions')::boolean, false);
  -- selected_plan_ids : peut être un array JSON dans page_configs.plans.
  -- On le convertit en uuid[] côté Postgres ; vide si scope='all'.
  IF v_scope = 'selection' AND jsonb_typeof(v_config->'selected_plan_ids') = 'array' THEN
    SELECT ARRAY(
      SELECT (jsonb_array_elements_text(v_config->'selected_plan_ids'))::uuid
    ) INTO v_selected;
  ELSE
    v_selected := ARRAY[]::uuid[];
  END IF;

  -- Validation de scope (cohérent avec la table dédiée).
  IF v_scope NOT IN ('all', 'selection') THEN
    v_scope := 'all';
  END IF;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',         NULL,  -- pas de label par sous-page (porté par token global)
      'scope',         v_scope,
      'show_versions', v_show_versions
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
    'categories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         c.id,
          'key',        c.key,
          'label',      c.label,
          'color',      c.color,
          'sort_order', c.sort_order
        ) ORDER BY c.sort_order, c.label
      )
      FROM plan_categories c
      JOIN projects p ON p.org_id = c.org_id
      WHERE p.id = v_project_id
        AND c.is_archived = false
    ), '[]'::jsonb),
    'plans', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                pl.id,
          'category_id',       pl.category_id,
          'name',              pl.name,
          'description',       pl.description,
          'tags',              pl.tags,
          'storage_path',      pl.storage_path,
          'thumbnail_path',    pl.thumbnail_path,
          'file_type',         pl.file_type,
          'file_size',         pl.file_size,
          'page_count',        pl.page_count,
          'applicable_dates',  pl.applicable_dates,
          'current_version',   pl.current_version,
          'sort_order',        pl.sort_order,
          'created_at',        pl.created_at,
          'versions', CASE
            WHEN v_show_versions THEN COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',           pv.id,
                  'version_num',  pv.version_num,
                  'storage_path', pv.storage_path,
                  'file_type',    pv.file_type,
                  'file_size',    pv.file_size,
                  'page_count',   pv.page_count,
                  'comment',      pv.comment,
                  'created_at',   pv.created_at
                ) ORDER BY pv.version_num DESC
              )
              FROM plan_versions pv
              WHERE pv.plan_id = pl.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) ORDER BY pl.sort_order, pl.created_at
      )
      FROM plans pl
      WHERE pl.project_id = v_project_id
        AND pl.is_archived = false
        AND (
          v_scope = 'all'
          OR (v_scope = 'selection' AND pl.id = ANY(v_selected))
        )
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'total_plans', (
        SELECT COUNT(*)
          FROM plans pl
         WHERE pl.project_id = v_project_id
           AND pl.is_archived = false
           AND (
             v_scope = 'all'
             OR (v_scope = 'selection' AND pl.id = ANY(v_selected))
           )
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'plans');

  RETURN v_result;
END;
$share_projet_plans_fetch$;

REVOKE ALL ON FUNCTION share_projet_plans_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_plans_fetch(text, text)
  TO anon, authenticated;


-- =====================================================================
-- 3. share_projet_fetch — ajout du teaser plans
-- =====================================================================
-- On reproduit la version actuelle (post project_share_materiel) en
-- ajoutant juste le teaser plans { count } pour le hub.
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

  -- Pour le teaser matériel : on prend la version active courante du projet.
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
      END,
      'plans', CASE
        WHEN v_enabled ? 'plans' THEN (
          SELECT jsonb_build_object(
            'count', COUNT(*)
          )
          FROM plans pl
          WHERE pl.project_id = v_project_id
            AND pl.is_archived = false
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

-- ============================================================================
-- Tests rapides à passer côté Hugo
-- ============================================================================
-- 1. Activer la page plans sur un portail existant :
--    UPDATE project_share_tokens
--       SET enabled_pages = enabled_pages || '["plans"]'::jsonb,
--           page_configs  = page_configs || '{"plans": {"scope": "all", "show_versions": false}}'::jsonb
--     WHERE token = '<portail_token>';
--
-- 2. SELECT share_projet_fetch('<portail_token>');
--    → teasers.plans = { count: N } doit apparaître.
--
-- 3. SELECT share_projet_plans_fetch('<portail_token>');
--    → payload identique à share_plans_fetch (project + org + categories + plans).
--    → versions = [] partout par défaut.
--
-- 4. Mode selection avec versions :
--    UPDATE project_share_tokens
--       SET page_configs = jsonb_set(
--         page_configs,
--         '{plans}',
--         '{"scope": "selection", "selected_plan_ids": ["<uuid_1>", "<uuid_2>"], "show_versions": true}'::jsonb
--       )
--     WHERE token = '<portail_token>';
--    → SELECT share_projet_plans_fetch(...) ne retourne que les 2 plans avec leurs versions.
--
-- 5. Vérifier policy storage : un anon avec token portail incluant 'plans'
--    doit pouvoir signer des URLs sur les paths du projet.
-- ============================================================================
