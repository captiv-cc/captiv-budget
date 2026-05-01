-- ============================================================================
-- Migration : LIV-24A fix — share_livrables_fetch event_type_id sur etape
-- Date      : 2026-05-03
-- Contexte  : La migration LIV-24A référençait `ev.event_type_id` sur la
--             table `events`, alors que depuis LIV-9 c'est `livrable_etapes`
--             qui porte directement la colonne `event_type_id` (la barre du
--             Gantt est typée par l'étape, pas l'event miroir).
--
--             Erreur PG observée :
--               42703 · column ev.event_type_id does not exist
--               Perhaps you meant to reference the column "e.event_type_id"
--
--             On retire le LEFT JOIN events (inutile maintenant) et on lit
--             event_type_id directement sur livrable_etapes.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION share_livrables_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_livrables_fetch$
DECLARE
  v_project_id      uuid;
  v_config          jsonb;
  v_calendar_level  text;
  v_show_periodes   boolean;
  v_show_envoi      boolean;
  v_show_feedback   boolean;
  v_result          jsonb;
BEGIN
  SELECT project_id, config
    INTO v_project_id, v_config
    FROM _share_token_resolve(p_token);

  v_calendar_level := COALESCE(v_config->>'calendar_level', 'hidden');
  v_show_periodes  := COALESCE((v_config->>'show_periodes')::boolean,    true);
  v_show_envoi     := COALESCE((v_config->>'show_envoi_prevu')::boolean, true);
  v_show_feedback  := COALESCE((v_config->>'show_feedback')::boolean,    true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  (SELECT label  FROM livrable_share_tokens WHERE token = p_token),
      'config', v_config
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
    -- LIV-9 : event_type_id est porté DIRECTEMENT par livrable_etapes
    -- (pas par l'event miroir). On retire le LEFT JOIN events (inutile).
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
  )
  INTO v_result;

  UPDATE livrable_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_livrables_fetch$;

REVOKE ALL ON FUNCTION share_livrables_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_livrables_fetch(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
