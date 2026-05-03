-- ============================================================================
-- Migration : PROJECT-SHARE FIX — share_projet_livrables_fetch
-- Date      : 2026-05-04
-- Contexte  : La RPC share_projet_livrables_fetch posée dans
--             20260504_project_share_tokens.sql avait été copiée depuis la
--             VERSION ORIGINALE de share_livrables_fetch (LIV-24A) avant
--             d'avoir reçu :
--               - le fix LIV-9 sur event_type_id (cf.
--                 20260503_liv24a_fix_event_type_id.sql) — ev.event_type_id
--                 n'existe plus (la colonne est portée par livrable_etapes,
--                 pas events). Avec calendar_level='phases' la RPC explose
--                 sur 42703.
--               - l'enrichissement org MT-PRE-1.A (cf.
--                 20260502_mtpre1a_share_livrables_org.sql) qui ajoute
--                 share_intro_text au branding.
--
--             Symptôme observé : depuis le portail projet, ouvrir
--             /share/projet/:token/livrables → écran "Page inaccessible"
--             (fallback générique). Le ev.event_type_id ne devait poser
--             problème qu'en mode 'phases', mais on aligne par sécurité
--             pour que les 3 niveaux (hidden, milestones, phases) marchent.
--
-- Action    : CREATE OR REPLACE FUNCTION share_projet_livrables_fetch
--             alignée 1-pour-1 sur la version actuelle de
--             share_livrables_fetch (post-MT-PRE-1.A), en remplaçant juste
--             le _share_token_resolve par _project_share_token_resolve
--             et le UPDATE livrable_share_tokens par _project_share_bump.
--
-- Idempotent : CREATE OR REPLACE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION share_projet_livrables_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_livrables_fetch$
DECLARE
  v_project_id      uuid;
  v_config          jsonb;
  v_calendar_level  text;
  v_show_periodes   boolean;
  v_show_envoi      boolean;
  v_show_feedback   boolean;
  v_result          jsonb;
BEGIN
  -- Résout token → project_id + config livrables (raise si invalide / expiré
  -- ou page non activée).
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'livrables');

  v_calendar_level := COALESCE(v_config->>'calendar_level', 'hidden');
  v_show_periodes  := COALESCE((v_config->>'show_periodes')::boolean,    true);
  v_show_envoi     := COALESCE((v_config->>'show_envoi_prevu')::boolean, true);
  v_show_feedback  := COALESCE((v_config->>'show_feedback')::boolean,    true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  NULL,  -- pas de label par sous-page (porté par le token global)
      'config', v_config
    ),
    -- Branding org — aligné sur MT-PRE-1.A (inclut share_intro_text). On garde
    -- LEFT JOIN pour rester gracieux sur les projets pré-multi-tenant
    -- (org_id IS NULL).
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
        'share_intro_text',  o.share_intro_text,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url,
        'periodes', CASE
          WHEN v_show_periodes THEN COALESCE(p.metadata->'periodes', 'null'::jsonb)
          ELSE 'null'::jsonb
        END
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         b.id,
          'nom',        b.nom,
          'prefixe',    b.prefixe,
          'couleur',    b.couleur,
          'sort_order', b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM livrable_blocks b
      WHERE b.project_id = v_project_id
        AND b.deleted_at IS NULL
    ), '[]'::jsonb),
    'livrables', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',             l.id,
          'block_id',       l.block_id,
          'numero',         l.numero,
          'nom',            l.nom,
          'format',         l.format,
          'duree',          l.duree,
          'version_label',  l.version_label,
          'statut',         l.statut,
          'date_livraison', l.date_livraison,
          'lien_frame',     l.lien_frame,
          'lien_drive',     l.lien_drive,
          'sort_order',     l.sort_order
        ) ORDER BY l.sort_order, l.created_at
      )
      FROM livrables l
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                v.id,
          'livrable_id',       v.livrable_id,
          'numero_label',      v.numero_label,
          'date_envoi',        v.date_envoi,
          'date_envoi_prevu',  CASE WHEN v_show_envoi THEN v.date_envoi_prevu ELSE NULL END,
          'lien_frame',        v.lien_frame,
          'statut_validation', v.statut_validation,
          'feedback_client',   CASE WHEN v_show_feedback THEN v.feedback_client ELSE NULL END,
          'sort_order',        v.sort_order,
          'created_at',        v.created_at
        ) ORDER BY v.livrable_id, v.sort_order, v.created_at
      )
      FROM livrable_versions v
      JOIN livrables l ON l.id = v.livrable_id
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    -- LIV-9 : event_type_id est porté DIRECTEMENT par livrable_etapes (la
    -- couleur de la barre Gantt est définie par l'étape, pas par l'event
    -- miroir). Pas de JOIN events nécessaire.
    'etapes', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',            e.id,
            'livrable_id',   e.livrable_id,
            'nom',           e.nom,
            'kind',          e.kind,
            'date_debut',    e.date_debut,
            'date_fin',      e.date_fin,
            'event_type_id', e.event_type_id,
            'sort_order',    e.sort_order
          ) ORDER BY e.date_debut, e.sort_order
        )
        FROM livrable_etapes e
        JOIN livrables l ON l.id = e.livrable_id
        WHERE l.project_id = v_project_id
          AND l.deleted_at IS NULL
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'event_types', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',       et.id,
            'slug',     et.slug,
            'label',    et.label,
            'color',    et.color,
            'category', et.category
          )
        )
        FROM event_types et
        WHERE et.id IN (
          SELECT DISTINCT le.event_type_id
            FROM livrable_etapes le
            JOIN livrables l ON l.id = le.livrable_id
           WHERE l.project_id = v_project_id
             AND l.deleted_at IS NULL
             AND le.event_type_id IS NOT NULL
        )
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'livrables');

  RETURN v_result;
END;
$share_projet_livrables_fetch$;

REVOKE ALL ON FUNCTION share_projet_livrables_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_livrables_fetch(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
